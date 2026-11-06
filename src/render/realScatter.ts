// 真实地形的地面散布。航拍 1.25 米一个像素，飞到几十米高的时候，地上的灌木和碎石只是一团糊的斑。
// 这里在镜头周围铺几圈网格，全部放在显卡上算：世界按格子切开，每格用格子坐标的哈希决定里面有没有东西、
// 放在哪儿、多大，高度从地形的高度贴图里取，疏密看 scatter.webp（prep_grandcanyon.py 的 scatter_map）。
// 每帧 CPU 只传镜头所在的格子号，没有任何实例数据要上传。同一格每次算出来都一样，飞回来东西还在原地。
//
// 灌木（托恩托平台上的黑灌木、南缘的灌丛）：和 trees.glb 里的矮灌丛是同一个模型，旋翼的气流吹得动。
// 碎石：有棱角的小块，颜色取脚下的影像，一片多一片少。枯草：离得近才看得见的细草丛。
// 树：核心区的树是从航拍上认出来的；外圈的影像 10 米一个像素认不出树，这里按深绿的地方种一圈，飞过去不是一片平地。

import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  cos,
  dot,
  float,
  floor,
  fract,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  textureLoad,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { HELI } from '../config/flight';
import type { TreeType } from '../maps/types';
import type { RingTree } from '../sim/session';
import type { RealData, RealGrid } from '../world/realData';
import { FOG, gustAt, WASH, WIND } from './atmosphere';
import { getNoiseTexture } from './textures';
import type { TreeLib } from './treeView';
import { VFOG } from './volumetricFog';

type N<T extends string> = THREE.Node<T>;

type Kind = 'shrub' | 'rock' | 'grass' | 'leaf' | 'bark';

interface RingDef {
  kind: Kind;
  /** 一格多大（米） */
  cell: number;
  /** 镜头所在的格子往外几格 */
  half: number;
  /** 从多远开始有（米）：更近的归里面一圈 */
  inner: number;
  /** 密度图满值时一格里有东西的概率 */
  p: number;
  /** 大小（米，半径）：min、max */
  size: [number, number];
  /** 几何体的细分 */
  detail: number;
  /** 离地多高以内才画 */
  agl: number;
  shadow: boolean;
  seed: number;
  /** 高处才长的大树（西黄松） */
  tall?: boolean;
  /** 同一批树的两级细节：近的一级只画这个距离以内，远的一级只画这个距离以外 */
  nearTo?: number;
  farFrom?: number;
}

/** 外圈的树在多远换成全细节的模型 */
const TREE_SWAP = 72;

/** 由近到远。外圈的格子大、东西大、几何体简单 */
const RINGS: RingDef[] = [
  { kind: 'shrub', cell: 1.7, half: 66, inner: 0, p: 0.5, size: [0.3, 0.95], detail: 0, agl: 240, shadow: true, seed: 1.7 },
  { kind: 'shrub', cell: 3.4, half: 112, inner: 96, p: 0.9, size: [0.42, 1.1], detail: 2, agl: 700, shadow: false, seed: 3.1 },
  { kind: 'rock', cell: 0.9, half: 60, inner: 0, p: 0.3, size: [0.05, 0.55], detail: 1, agl: 200, shadow: true, seed: 5.3 },
  { kind: 'rock', cell: 3.6, half: 80, inner: 50, p: 0.3, size: [0.3, 1.3], detail: 0, agl: 520, shadow: false, seed: 7.9 },
  { kind: 'grass', cell: 1.15, half: 56, inner: 0, p: 0.5, size: [0.3, 0.62], detail: 0, agl: 110, shadow: false, seed: 9.2 },
];

/** 外圈的树：一个树种一组，树叶和树干同一个种子，放在同一个地方 */
const TREE_RING = { cell: 8, half: 70, inner: 0, p: 0.55, size: [0.72, 1.2] as [number, number], detail: 0, agl: 900, shadow: true };
/** 外圈的西黄松：大、稀，格子也大。没有它的话，一过核心区的边，林子就矮了一截，地上看得出一条线 */
const TALL_RING = { cell: 16, half: 35, inner: 0, p: 0.75, size: [0.8, 1.25] as [number, number], detail: 0, agl: 900, shadow: true, tall: true };

/** 各画质的数量：格子往外几成（0 = 不画） */
export const SCATTER_RANGE: Record<string, number> = { low: 0, medium: 0.55, high: 0.8, ultra: 1 };

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 碎石：二十个面的多面体，顶点推开一点，有棱有角。面法线由着色器算（flatShading），所以顶点可以共用：
 * 12 个顶点，不是 60 个。这几圈碎石一共几万块，顶点着色器里要查地形，少算五倍 */
function rockGeometry(detail: number): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(1, detail);
  const pos = src.getAttribute('position');
  const r = rng(131);
  // （面多的那个推得轻一点，不然全是刺）
  const spread = detail ? 0.36 : 0.6;
  const index = new Map<string, number>();
  const verts: number[] = [];
  const faces: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let n = index.get(key);
    if (n === undefined) {
      n = verts.length / 3;
      const k = 1 - spread / 2 + r() * spread;
      verts.push(pos.getX(i) * k * (0.8 + r() * 0.5), pos.getY(i) * k * 0.72 + 0.12, pos.getZ(i) * k * (0.8 + r() * 0.5));
      index.set(key, n);
    }
    faces.push(n);
  }
  src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(faces);
  g.computeVertexNormals();
  return g;
}

/** 三片交叉的面：宽 2、高 1，根部 y = 0 */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1.1, cz, -cx, 1.1, -cz);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

function tuftTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const r = rng(11);
  for (let i = 0; i < 70; i++) {
    const x = 30 + r() * (W - 60);
    const lean = (r() - 0.5) * 110;
    const h = 40 + r() * 84;
    const w = 0.9 + r() * 1.5;
    const v = 150 + r() * 105;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.moveTo(x - w, H);
    g.quadraticCurveTo(x + lean * 0.2 - w * 0.5, H - h * 0.6, x + lean, H - h);
    g.quadraticCurveTo(x + lean * 0.2 + w * 0.5, H - h * 0.6, x + w, H);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** 读回去做碰撞的范围：每边多少格 */
const PROBE = 32;

interface Probe {
  def: RingDef;
  rt: THREE.RenderTarget;
  quad: THREE.QuadMesh;
  origin: THREE.UniformNode<'vec2', THREE.Vector2>;
  type: TreeType;
}

interface Ring {
  def: RingDef;
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  origin: THREE.UniformNode<'vec2', THREE.Vector2>;
  reach: THREE.UniformNode<'float', number>;
  inner: THREE.UniformNode<'float', number>;
}

export class RealScatter {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly tuft = tuftTexture();
  private range = 1;
  private probes: Probe[] = [];
  private nextProbe = 0;
  private reading = false;
  private probed = false;

  /** models：灌木、外圈的树（来自 trees.glb）和叶片图集；模型没加载上就不画 */
  constructor(
    private readonly data: RealData,
    /** 核心区：高度、疏密图、影像 */
    private readonly core: { height: THREE.Texture; density: THREE.Texture; image: THREE.Texture },
    /** 外圈：高度、法线、影像。外圈的影像 10 米一个像素，看不出灌木，疏密按坡度和颜色估 */
    private readonly mid: { height: THREE.Texture; normal: THREE.Texture; image: THREE.Texture; aux: THREE.Texture | null },
    private readonly models: ScatterModels | null,
    /** 这些圆里什么都不长（停机坪）：x、z、半径 */
    private readonly keepOut: Array<[number, number, number]>,
    quality: string,
  ) {
    // 近处的碎石面多一些：飞低了看得见棱，二十个面的石头是一块多面体
    const rocks = [rockGeometry(0), rockGeometry(1)];
    const tuft = tuftGeometry();
    this.geos.push(...rocks, tuft);
    for (const def of RINGS) {
      if (def.kind === 'shrub' && !models) continue;
      const src = def.kind === 'shrub' ? models!.shrub[def.detail] : def.kind === 'rock' ? rocks[def.detail] : tuft;
      this.rings.push(this.ring(def, src));
    }
    models?.trees.forEach((t, i) => {
      const seed = 11.3 + i * 4.1;
      const ring = t.tall ? TALL_RING : TREE_RING;
      this.rings.push(this.ring({ ...ring, kind: 'leaf', seed, farFrom: TREE_SWAP }, t.leaf));
      if (t.bark) this.rings.push(this.ring({ ...ring, kind: 'bark', seed, farFrom: TREE_SWAP }, t.bark));
      // 飞低了跟前的几棵：全细节的模型
      const near = { ...ring, half: Math.ceil((TREE_SWAP + 24) / ring.cell), seed, nearTo: TREE_SWAP };
      this.rings.push(this.ring({ ...near, kind: 'leaf' }, t.nearLeaf));
      if (t.nearBark) this.rings.push(this.ring({ ...near, kind: 'bark' }, t.nearBark));
    });
    this.setQuality(quality);
  }

  private ring(def: RingDef, src: THREE.BufferGeometry): Ring {
    const side = def.half * 2 + 1;
    const cells = new Float32Array(side * side * 2);
    // 由中间往外排：画质低的时候只画前面一段，还是一个完整的圈
    const order: [number, number][] = [];
    for (let j = -def.half; j <= def.half; j++) for (let i = -def.half; i <= def.half; i++) order.push([i, j]);
    order.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    order.forEach(([i, j], k) => {
      cells[k * 2] = i;
      cells[k * 2 + 1] = j;
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = src.index;
    for (const name of Object.keys(src.attributes)) geo.setAttribute(name, src.getAttribute(name));
    geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = order.length;
    const origin = uniform(new THREE.Vector2());
    const reach = uniform(def.half * def.cell);
    const inner = uniform(def.inner);
    const mat = this.material(def, origin, reach, inner);
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = def.shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.placedOnGpu = true;
    this.group.add(mesh);
    return { def, mesh, geo, origin, reach, inner };
  }

  private material(def: RingDef, origin: N<'vec2'>, reach: N<'float'>, inner: N<'float'>): THREE.MeshStandardNodeMaterial {
    const grass = def.kind === 'grass';
    const shrub = def.kind === 'shrub';
    const rock = def.kind === 'rock';
    const leaf = def.kind === 'leaf';
    const bark = def.kind === 'bark';
    const tree = leaf || bark;
    const solid = rock || bark;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: solid ? THREE.FrontSide : THREE.DoubleSide, alphaTest: solid ? 0 : 0.5, flatShading: rock });
    const noise = getNoiseTexture();
    const { h, wx, wz, y0, muv, inCore, img1, keep, full } = this.cellAt(def, origin.add(attribute<'vec2'>('cell', 'vec2')));
    const dist = length(vec3(wx, y0, wz).sub(cameraPosition)).toVar();
    // 进出都是一棵棵慢慢长出来的：每棵的距离错开一点，看不出一条线
    const swapAt = dist.add(h.w.mul(14.0));
    const out = def.nearTo ? step(swapAt, def.nearTo) : float(1).sub(smoothstep(reach.mul(0.72), reach.mul(0.98), dist.add(h.z.mul(reach).mul(0.1))));
    const inn = def.farFrom ? step(def.farFrom, swapAt) : def.inner > 0 ? smoothstep(inner.mul(0.72), inner, dist.add(h.w.mul(inner).mul(0.25))) : float(1);
    const size = full.mul(keep).mul(out).mul(inn).toVar();
    const ang = h.x.mul(6.2832).add(h.y.mul(11.0));
    const ca = cos(ang).toVar();
    const sa = sin(ang).toVar();
    // 同一个形状靠三个方向不同的伸缩变出不一样的东西
    // （灌木模型半径 1.25 米）
    const unit = shrub ? 0.8 : 1;
    const sx = size.mul(unit).mul(mix(float(0.78), float(1.25), h.y));
    const sz = size.mul(unit).mul(mix(float(0.78), float(1.25), h.z));
    const sy = size.mul(unit).mul(grass ? mix(float(0.9), float(1.5), h.x) : tree ? mix(float(0.85), float(1.2), h.x) : mix(float(0.7), float(1.15), h.x));
    const v = positionGeometry;
    const lx = v.x.mul(sx);
    const lz = v.z.mul(sz);
    let wxz: N<'vec2'> = vec2(lx.mul(ca).sub(lz.mul(sa)), lx.mul(sa).add(lz.mul(ca)));
    let ly: N<'float'> = v.y.mul(sy).sub(shrub || tree ? size.mul(0.08) : size.mul(0.3));
    if (rock) {
      // 石头不是端端正正放着的
      ly = ly.add(lx.mul(h.y.sub(0.5))).add(lz.mul(h.x.sub(0.5)));
    }
    if (!rock) {
      // 风和旋翼的气流。矮东西也要看得出在动
      const up = max(v.y, 0.0).mul(tree ? 0.16 : 1);
      const ph = wx.mul(0.31).add(wz.mul(0.23));
      const gust = gustAt(vec2(wx, wz)).toVar();
      const amp = (WIND.k as unknown as N<'float'>).mul(gust.mul(1.6).add(0.4));
      const down = WIND.dir as unknown as N<'vec2'>;
      const sway = amp.mul(sin(time.mul(2.1).add(ph)).mul(0.5).add(0.8)).mul(shrub ? 0.22 : 0.8);
      const R = HELI.rotorRadius;
      const dv = vec2(wx, wz).sub(WASH.xy);
      const dr = length(dv).max(0.01).toVar();
      const rn = dr.div(R);
      const wk = smoothstep(0.1, 0.6, rn).mul(float(1).sub(smoothstep(2.4, 7.0, rn))).mul(WASH.z).mul(WASH.w).toVar();
      const puff = max(sin(dr.mul(0.6).sub(time.mul(8.0)).add(ph)).mul(0.42).add(0.66), 0.0).add(sin(time.mul(24.0).add(ph.mul(3.1))).mul(0.14));
      const push = wk.mul(puff).mul(shrub ? 0.8 : 1.6).mul(size).toVar();
      wxz = wxz.add(down.mul(sway).add(dv.div(dr).mul(push)).mul(up));
      ly = ly.sub(push.mul(up).mul(0.3));
    }
    m.positionNode = vec3(wx.add(wxz.x), y0.add(ly), wz.add(wxz.y));

    // 颜色：脚下的影像给底色
    const ground = mix(img1, texture(this.core.image, muv).level(float(3.5)).rgb, inCore);
    const gl = dot(ground, vec3(0.2126, 0.7152, 0.0722));
    let tint: N<'vec3'>;
    if (leaf) {
      // （松针贴图是翠绿色的，南缘的西黄松发黄发灰，和 treeView.ts 的一样）
      tint = def.tall ? mix(vec3(0.68, 0.56, 0.39), vec3(0.92, 0.76, 0.53), h.y) : mix(vec3(0.95, 0.98, 0.9), vec3(1.3, 1.3, 1.14), h.y);
    } else if (bark) {
      tint = def.tall ? vec3(0.2, 0.125, 0.08) : vec3(0.1, 0.085, 0.07);
    } else if (shrub) {
      // 图集里的颜色乘这个：峡谷里发黑，南缘的灰绿一些，隔几丛有一丛枯黄的
      const rim = smoothstep(1900.0, 2100.0, y0);
      // （真的黑灌木反照率也有一成多：太暗的话影子里就是一地黑胡椒）
      const dark = mix(vec3(1.3, 1.25, 1.12), vec3(1.8, 1.7, 1.45), h.y);
      const pale = mix(vec3(1.2, 1.22, 1.04), vec3(1.62, 1.6, 1.3), h.y);
      tint = mix(mix(dark, pale, rim), vec3(2.3, 1.8, 1.1), step(0.9, h.x).mul(0.8));
    } else if (rock) {
      // 和脚下的地是同一种石头，新鲜的断面亮一些
      tint = mix(ground, vec3(gl), 0.12).mul(mix(float(0.78), float(1.5), h.x));
    } else {
      tint = mix(vec3(0.27, 0.225, 0.13), vec3(0.42, 0.36, 0.22), h.y);
    }
    const col = vertexStage(tint);
    if (bark) {
      const skin = def.nearTo && this.models?.barkMap ? texture(this.models.barkMap, uv()).rgb.mul(3.2) : vec3(1.0);
      m.colorNode = vec4(col.mul(skin), 1);
      m.normalNode = normalize(cameraViewMatrix.mul(vec4(vertexStage(normalWorldOf(ca, sa)), 0.0)).xyz);
    } else if (shrub || leaf) {
      const t = texture(this.models!.map, uv());
      // 贴近地面的枝叶被自己挡着，暗
      const low = leaf ? float(1) : smoothstep(0.0, 0.8, positionGeometry.y).mul(0.55).add(0.5);
      const albedo = t.rgb.mul(col).mul(low);
      m.colorNode = vec4(albedo, min(t.a.mul(1.5), 1.0));
      // 影子里的灌木也不是黑的：地面反上来的光和天光
      m.emissiveNode = albedo.mul(VFOG.sun.mul(0.07).add(FOG.color.mul(0.16)).add(vertexStage(ground).mul(VFOG.sun).mul(0.3)));
      m.normalNode = normalize(cameraViewMatrix.mul(vec4(vertexStage(normalWorldOf(ca, sa)).mul(0.8).add(vec3(0, 0.3, 0)), 0.0)).xyz);
      // 查阴影的点往太阳方向挪一点：一丛灌木不挡自己，身上不是一片网纹；树的影子还是落得上来
      if (shrub) m.receivedShadowPositionNode = positionWorld.add(FOG.sunDir.mul(1.3));
    } else if (rock) {
      const pu = positionGeometry.xz.mul(0.31).add(positionGeometry.y.mul(0.23)).add(vertexStage(vec2(h.y, h.z)));
      const albedo = col.mul(texture(noise, pu).g.mul(0.7).add(0.65));
      m.colorNode = vec4(albedo, 1);
      m.emissiveNode = albedo.mul(VFOG.sun.mul(0.05));
    } else {
      const t = texture(this.tuft, uv());
      m.colorNode = vec4(col.mul(t.r.mul(1.0).add(0.25)), t.a);
      m.normalNode = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
    }
    return m;
  }

  /** 一格里的东西：放在哪儿、脚下多高、有没有、多大。画面和读回去做碰撞用的是同一份，算出来一定一样 */
  private cellAt(def: RingDef, ci: N<'vec2'>) {
    const shrub = def.kind === 'shrub';
    const rock = def.kind === 'rock';
    const tree = def.kind === 'leaf' || def.kind === 'bark';
    const g = this.data.levels[0];
    const g1 = this.data.levels[1];
    const noise = getNoiseTexture();
    // 四个互不相干的随机数（Dave Hoskins 的无三角函数哈希：换显卡结果也一样）
    const q = ci.add(def.seed * 17.0);
    let p4: N<'vec4'> = fract(vec4(q.x, q.y, q.x, q.y).mul(vec4(0.1031, 0.103, 0.0973, 0.1099)));
    p4 = p4.add(dot(p4, p4.wzxy.add(33.33)));
    const h = fract(p4.xxyz.add(p4.yzzw).mul(p4.zywx)).toVar();
    const wx = ci.x.add(h.x).mul(def.cell).toVar();
    const wz = ci.y.add(h.y).mul(def.cell).toVar();
    const muv = vec2(wx, wz).div(g.size).add(0.5).toVar();
    const muv1 = vec2(wx, wz).div(g1.size).add(0.5).toVar();
    const inCore = step(max(abs2(wx), abs2(wz)), g.half - 3).toVar();
    // 脚下的地：和地形同一种三角剖分（斜边从 (1,0) 到 (0,1)），外圈 10 米一格，差一点就悬空了
    const groundAt = (tex: THREE.Texture, l: RealGrid): N<'float'> => {
      const last = l.res - 1;
      const fx = wx.add(l.half).div(l.cell).toVar();
      const fz = wz.add(l.half).div(l.cell).toVar();
      const ix = floor(fx).toVar();
      const iz = floor(fz).toVar();
      const tx = fx.sub(ix).toVar();
      const tz = fz.sub(iz).toVar();
      const load = (a: N<'float'>, b: N<'float'>): N<'float'> => textureLoad(tex, ivec2(int(max(min(a, last), 0.0)), int(max(min(b, last), 0.0)))).r;
      const a = load(ix, iz);
      const b = load(ix.add(1.0), iz).toVar();
      const c = load(ix, iz.add(1.0)).toVar();
      const e = load(ix.add(1.0), iz.add(1.0));
      const first = a.add(b.sub(a).mul(tx)).add(c.sub(a).mul(tz));
      const second = e.add(c.sub(e).mul(float(1).sub(tx))).add(b.sub(e).mul(float(1).sub(tz)));
      return mix(first, second, step(1.0, tx.add(tz)));
    };
    const y0 = mix(groundAt(this.mid.height, g1), groundAt(this.core.height, g), inCore).toVar();
    // 颜色和疏密：核心区查图，外圈按影像和坡度估
    // （外圈的疏密按十几米的尺度估：一个像素 5 米，单看一个像素全是噪点）
    const img1 = texture(this.mid.image, muv1).level(float(1)).rgb.toVar();
    const nm = texture(this.mid.normal, muv1).level(float(1));
    const steep = smoothstep(0.1, 0.55, length(nm.rg.mul(2.0).sub(1.0)));
    const l1 = dot(img1, vec3(0.2126, 0.7152, 0.0722));
    const dark = float(1).sub(smoothstep(0.1, 0.3, l1));
    // （河里不长东西：核心区的疏密图里已经扣掉了）
    const dry = this.mid.aux ? float(1).sub(smoothstep(0.08, 0.2, texture(this.mid.aux, muv1).level(float(0)).g)) : float(1);
    const est = vec3(mix(float(0.42), float(0.8), dark).mul(float(1).sub(steep.mul(0.6))), steep.mul(0.75).add(0.08), float(0.32).mul(float(1).sub(steep))).mul(dry);
    const dens = mix(est, texture(this.core.density, muv).level(float(0)).rgb, inCore).toVar();
    // 碎石一片多一片少，不是均匀撒的
    // 外圈的树：高处、不陡、够深的地方。影子里的崖壁也暗，所以要看高度
    const forest = float(1).sub(smoothstep(0.075, 0.17, l1)).mul(float(1).sub(steep)).mul(smoothstep(1750.0, 1900.0, y0)).mul(float(1).sub(inCore)).mul(dry);
    const d = tree ? (def.tall ? forest.mul(smoothstep(2060.0, 2230.0, y0)) : forest) : shrub ? dens.x : rock ? dens.y.mul(smoothstep(0.34, 0.66, texture(noise, vec2(wx, wz).div(490.0)).level(float(0)).r).mul(0.9).add(0.25)) : dens.z;
    let inside: N<'float'> = step(max(abs2(wx), abs2(wz)), g1.half - 8);
    for (const [cx, cz, r] of this.keepOut.slice(0, 16)) inside = inside.mul(step(r, length(vec2(wx, wz).sub(vec2(cx, cz)))));
    const keep = step(h.z, d.mul(def.p)).mul(inside);
    // 小的多、大的少
    const big = rock ? h.w.mul(h.w).mul(h.w) : h.w.mul(h.w);
    const full = mix(float(def.size[0]), float(def.size[1]), big);
    return { h, wx, wz, y0, muv, inCore, img1, keep, full };
  }

  /** 机身周围的外圈树：它们只存在于显卡上，物理看不见。隔一会儿在显卡上把周围的格子算一遍读回来，碰撞用（见 session.ts） */
  probe(renderer: THREE.WebGPURenderer, pos: THREE.Vector3, t: number, done: (trees: RingTree[]) => void): void {
    if (this.reading || t < this.nextProbe) return;
    this.nextProbe = t + 0.4;
    const core = this.data.levels[0].half;
    const low = pos.y - this.data.heightAt(pos.x, pos.z) < 140;
    if (!low || Math.max(Math.abs(pos.x), Math.abs(pos.z)) < core - 100) {
      if (this.probed) done([]);
      this.probed = false;
      return;
    }
    if (this.probes.length === 0) this.makeProbes();
    if (this.probes.length === 0) return;
    this.reading = true;
    const prev = renderer.getRenderTarget();
    const reads = this.probes.map((p) => {
      p.origin.value.set(Math.floor(pos.x / p.def.cell) - PROBE / 2, Math.floor(pos.z / p.def.cell) - PROBE / 2);
      renderer.setRenderTarget(p.rt);
      p.quad.render(renderer);
      return renderer.readRenderTargetPixelsAsync(p.rt, 0, 0, PROBE, PROBE) as Promise<Float32Array>;
    });
    renderer.setRenderTarget(prev);
    void Promise.all(reads)
      .then((all) => {
        const out: RingTree[] = [];
        all.forEach((px, k) => {
          for (let i = 0; i < PROBE * PROBE; i++) {
            const s = px[i * 4 + 3];
            if (s > 0) out.push({ x: px[i * 4], y: px[i * 4 + 1], z: px[i * 4 + 2], s, type: this.probes[k].type });
          }
        });
        this.probed = true;
        done(out);
      })
      .catch(() => undefined)
      .finally(() => {
        this.reading = false;
      });
  }

  private makeProbes(): void {
    this.models?.trees.forEach((t, i) => {
      const def: RingDef = { ...(t.tall ? TALL_RING : TREE_RING), kind: 'leaf', seed: 11.3 + i * 4.1 };
      const rt = new THREE.RenderTarget(PROBE, PROBE, { depthBuffer: false, type: THREE.FloatType });
      rt.texture.minFilter = THREE.NearestFilter;
      rt.texture.magFilter = THREE.NearestFilter;
      rt.texture.generateMipmaps = false;
      const origin = uniform(new THREE.Vector2());
      const c = this.cellAt(def, origin.add(floor(uv().mul(PROBE))));
      const m = new THREE.NodeMaterial();
      m.fragmentNode = vec4(c.wx, c.y0, c.wz, c.full.mul(c.keep));
      this.mats.push(m);
      this.probes.push({ def, rt, quad: new THREE.QuadMesh(m), origin, type: t.type });
    });
  }

  setQuality(q: string): void {
    this.range = SCATTER_RANGE[q] ?? 0.7;
    for (const r of this.rings) {
      const half = Math.max(1, Math.round(r.def.half * this.range));
      // 格子是由里往外排的：只画前面这些
      r.geo.instanceCount = this.range > 0 ? Math.round(Math.PI * half * half) : 0;
      r.reach.value = half * r.def.cell;
      // 里面一圈也变小了：两圈要接得上
      r.inner.value = r.def.inner * this.range;
    }
  }

  update(cam: THREE.Vector3): void {
    const T = this.data.heightAt(cam.x, cam.z);
    const agl = cam.y - T;
    this.group.visible = this.range > 0 && agl < 920;
    if (!this.group.visible) return;
    // 外圈的树：一圈够不到核心区外面的时候一棵也长不出来，但几百万个顶点还是要跑一遍
    const core = this.data.levels[0].half;
    const edge = Math.max(Math.abs(cam.x), Math.abs(cam.z));
    for (const r of this.rings) {
      const tree = r.def.kind === 'leaf' || r.def.kind === 'bark';
      r.mesh.visible = agl < r.def.agl && (!tree || edge + r.reach.value > core);
      if (!r.mesh.visible) continue;
      r.origin.value.set(Math.floor(cam.x / r.def.cell), Math.floor(cam.z / r.def.cell));
    }
  }

  dispose(): void {
    for (const r of this.rings) r.geo.dispose();
    for (const p of this.probes) p.rt.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tuft.dispose();
    this.group.clear();
  }
}

export interface ScatterModels {
  /** 灌木的三级细节 */
  shrub: THREE.BufferGeometry[];
  /** 外圈的树：简化过的一级，和跟前用的全细节一级 */
  trees: Array<{ leaf: THREE.BufferGeometry; bark: THREE.BufferGeometry | null; nearLeaf: THREE.BufferGeometry; nearBark: THREE.BufferGeometry | null; tall: boolean; type: TreeType }>;
  /** 树皮贴图（全细节的那一级用） */
  barkMap: THREE.Texture | null;
  /** 叶片图集 */
  map: THREE.Texture;
}

/** 从 trees.glb 里取散布要用的模型 */
export function scatterModels(lib: TreeLib | null): ScatterModels | null {
  const lods = lib?.get('scrub');
  const map = lods?.[0]?.[0]?.source.map;
  if (!lods || !map) return null;
  const trees: ScatterModels['trees'] = [];
  let barkMap: THREE.Texture | null = null;
  for (const type of ['pinyon', 'ujuniper', 'ponderosa'] as const) {
    const parts = lib?.get(type)?.[1];
    const leaf = parts?.find((p) => p.source.name.includes('leaves'));
    // （树干用最简单的一级：只露出来一小截，一棵顶一棵的顶点数）
    const trunk = lib?.get(type)?.[2]?.find((p) => !p.source.name.includes('leaves')) ?? parts?.find((p) => p !== leaf);
    const full = lib?.get(type)?.[0];
    const fullLeaf = full?.find((p) => p.source.name.includes('leaves'));
    const fullBark = full?.find((p) => p !== fullLeaf);
    barkMap ??= fullBark?.source.map ?? null;
    if (leaf && fullLeaf) trees.push({ leaf: leaf.geometry, bark: trunk?.geometry ?? null, nearLeaf: fullLeaf.geometry, nearBark: fullBark?.geometry ?? null, tall: type === 'ponderosa', type });
  }
  return { shrub: [lods[0][0].geometry, lods[1][0].geometry, lods[2][0].geometry], trees, barkMap, map };
}

function abs2(a: N<'float'>): N<'float'> {
  return max(a, a.negate());
}

/** 几何体的法线转到世界里（绕竖轴转了 ang） */
function normalWorldOf(ca: N<'float'>, sa: N<'float'>): N<'vec3'> {
  const n = normalGeometry;
  return vec3(n.x.mul(ca).sub(n.z.mul(sa)), n.y, n.x.mul(sa).add(n.z.mul(ca)));
}
