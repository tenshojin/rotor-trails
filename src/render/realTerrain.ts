// 真实地形的渲染：三层嵌套的高程网格，一共几百平方公里到两万多平方公里，靠一块 64×64 的网格反复用。
// 做法是 CDLOD：每层一棵四叉树，每帧按距离选出要画的块，一次实例化绘制画完。
//   顶点着色器从高度贴图取高度。块的边长是 2 的幂倍的格子，顶点正好落在格点上，不需要插值，
//   所以最细一级和物理碰撞面完全重合。
//   快到下一级的距离时，奇数顶点的高度慢慢滑到粗一级网格上的位置（几何变形），看不到跳变。
// 法线不用顶点法线：高度差在 CPU 上算成一张带 mipmap 的法线图，远处的粗网格上也有细节，太阳一动整个峡谷的明暗都跟着变。

import * as THREE from 'three/webgpu';
import { abs, attribute, Break, cameraPosition, cameraViewMatrix, clamp, dot, float, floor, Fn, fract, If, int, interleavedGradientNoise, ivec2, length, Loop, max, min, mix, mod, normalize, normalWorld, positionGeometry, positionWorld, pow, screenCoordinate, smoothstep, sqrt, step, texture, textureLoad, time, vec2, vec3, vec4 } from 'three/tsl';
import type { RealData, RealGrid } from '../world/realData';
import { FOG } from './atmosphere';
import { disposeTextures } from './disposeTextures';
import type { HiRing, HiSample } from './hiRing';
import { terrainSun } from './sunMap';
import type { TerrainLayers } from './terrainLayers';
import { getNoiseTexture } from './textures';
import { VFOG } from './volumetricFog';

/** 每块的格数 */
const C = 64;
/** 最多同时画多少块 */
const MAX_PATCH = 1024;
/** 一格多大时切到下一级：离镜头 RANGE × 格长的地方，一格大约占 6 个像素 */
const RANGE = 140;
/** 崖壁的岩层照片一格多少米 */
const WALL_TILE = 46;

type N<T extends string> = THREE.Node<T>;

export interface RealLevelTextures {
  image: THREE.Texture;
}

interface Level {
  grid: RealGrid;
  /** 这一层四叉树有几级（0 最细） */
  depth: number;
  /** minY, maxY 的金字塔：mm[k] 是第 k 级，每块两个数 */
  mm: Float32Array[];
  height: THREE.DataTexture;
  normal: THREE.DataTexture;
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  patches: THREE.InstancedBufferAttribute;
  /** 里面那一层占的范围（半边长），这一层在它里面不画 */
  hole: number;
}

/** 一块 (C+1)² 的网格，四周加一圈往下垂的裙边，遮住不同层、不同级之间的细缝。position = (列, 是否裙边, 行) */
function patchGeometry(): { position: THREE.BufferAttribute; index: THREE.BufferAttribute } {
  const n = C + 1;
  const pos: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i, 0, j);
  const idx: number[] = [];
  // 对角线走 (x0, z1)-(x1, z0)，和物理高度场（Rapier）的三角剖分一致
  for (let j = 0; j < C; j++)
    for (let i = 0; i < C; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const edge = (from: (k: number) => number, flip: boolean) => {
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const v = from(k);
      pos.push(pos[v * 3], 1, pos[v * 3 + 2]);
    }
    for (let k = 0; k < C; k++) {
      const a = from(k);
      const b = from(k + 1);
      const c = base + k;
      const d = base + k + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  };
  edge((k) => k, true);
  edge((k) => C * n + k, false);
  edge((k) => k * n, false);
  edge((k) => k * n + C, true);
  return { position: new THREE.BufferAttribute(new Float32Array(pos), 3), index: new THREE.BufferAttribute(new Uint32Array(idx), 1) };
}

/** 高度差算成法线图：R、G 是法线的 x、z，y 由它们算回来。8 位够用：影像本身的细节盖住了量化 */
function normalTexture(g: RealGrid): THREE.DataTexture {
  const n = g.res;
  const out = new Uint8Array(n * n * 2);
  const d = g.data;
  const k = 1 / (2 * g.cell);
  for (let z = 0; z < n; z++) {
    const zu = z > 0 ? z - 1 : z;
    const zd = z < n - 1 ? z + 1 : z;
    for (let x = 0; x < n; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < n - 1 ? x + 1 : x;
      const sx = (d[z * n + xr] - d[z * n + xl]) * k;
      const sz = (d[zd * n + x] - d[zu * n + x]) * k;
      const m = 1 / Math.sqrt(1 + sx * sx + sz * sz);
      const o = (z * n + x) * 2;
      out[o] = Math.round((-sx * m * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((-sz * m * 0.5 + 0.5) * 255);
    }
  }
  const t = new THREE.DataTexture(out, n, n, THREE.RGFormat, THREE.UnsignedByteType);
  t.name = 'RealNormal';
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function heightTexture(g: RealGrid): THREE.DataTexture {
  const t = new THREE.DataTexture(g.data, g.res, g.res, THREE.RedFormat, THREE.FloatType);
  t.name = 'RealHeight';
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function pyramid(g: RealGrid): Float32Array[] {
  const out: Float32Array[] = [];
  const cells = g.res - 1;
  let nb = cells / C;
  const base = new Float32Array(nb * nb * 2);
  for (let bz = 0; bz < nb; bz++)
    for (let bx = 0; bx < nb; bx++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let z = bz * C; z <= (bz + 1) * C; z += 2)
        for (let x = bx * C; x <= (bx + 1) * C; x += 2) {
          const h = g.data[z * g.res + x];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      base[(bz * nb + bx) * 2] = lo - 2;
      base[(bz * nb + bx) * 2 + 1] = hi + 2;
    }
  out.push(base);
  while (nb > 1) {
    const prev = out[out.length - 1];
    const m = nb / 2;
    const cur = new Float32Array(m * m * 2);
    for (let z = 0; z < m; z++)
      for (let x = 0; x < m; x++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const o = ((z * 2 + dz) * nb + x * 2 + dx) * 2;
          lo = Math.min(lo, prev[o]);
          hi = Math.max(hi, prev[o + 1]);
        }
        cur[(z * m + x) * 2] = lo;
        cur[(z * m + x) * 2 + 1] = hi;
      }
    out.push(cur);
    nb = m;
  }
  return out;
}

const _box = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();

export class RealTerrain {
  readonly group = new THREE.Group();
  lodScale = 1;
  shadowRange = 300;
  private levels: Level[] = [];
  private mats: THREE.Material[] = [];
  /** 核心区的高度贴图（地面散布取高度用） */
  get coreHeight(): THREE.Texture {
    return this.levels[0].height;
  }
  /** 外圈的高度、法线贴图（外圈的散布用） */
  get midMaps(): { height: THREE.Texture; normal: THREE.Texture } {
    return this.levels[1];
  }
  private shadow: { mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; patches: THREE.InstancedBufferAttribute; level: Level } | null = null;
  private count = 0;

  constructor(
    private readonly data: RealData,
    images: THREE.Texture[],
    private readonly strata: THREE.Texture | null,
    /** 每一层的辅助图，没有的层是 null */
    private readonly aux: Array<THREE.Texture | null>,
    private readonly layers: TerrainLayers | null,
    /** 30 厘米影像，只有核心区用 */
    private readonly hi: HiRing | null = null,
  ) {
    const { position, index } = patchGeometry();
    const grids = data.levels;
    grids.forEach((g, i) => {
      const height = heightTexture(g);
      const normal = normalTexture(g);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', position);
      geo.setIndex(index);
      const patches = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PATCH * 4), 4);
      geo.setAttribute('tileInfo', patches);
      geo.instanceCount = 0;
      const level: Level = {
        grid: g,
        depth: Math.round(Math.log2((g.res - 1) / C)) + 1,
        mm: pyramid(g),
        height,
        normal,
        mesh: null as unknown as THREE.Mesh,
        geo,
        patches,
        hole: i > 0 ? grids[i - 1].half : 0,
      };
      const mat = this.material(level, images[i], i === 0, this.aux[i] ?? null);
      this.mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = i < 2;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.placedOnGpu = true;
      level.mesh = mesh;
      this.levels.push(level);
      this.group.add(mesh);
    });
    // 投影只要镜头附近的一小片：单独一份实例，不进主画面的颜色
    const L0 = this.levels[0];
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', position);
    sg.setIndex(index);
    const sp = new THREE.InstancedBufferAttribute(new Float32Array(256 * 4), 4);
    sg.setAttribute('tileInfo', sp);
    sg.instanceCount = 0;
    // 只要位置：阴影通道不需要地表的颜色
    const sm = new THREE.MeshBasicNodeMaterial();
    sm.positionNode = (L0.mesh.material as THREE.MeshStandardNodeMaterial).positionNode;
    sm.colorWrite = false;
    sm.depthWrite = false;
    this.mats.push(sm);
    const mesh = new THREE.Mesh(sg, sm);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = -10;
    this.shadow = { mesh, geo: sg, patches: sp, level: L0 };
    this.group.add(mesh);
  }

  private material(lv: Level, image: THREE.Texture, core: boolean, auxTex: THREE.Texture | null): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
    const g = lv.grid;
    const last = g.res - 1;
    m.positionNode = Fn(() => {
      const v = positionGeometry;
      // 名字别叫 patch：那是 WGSL 的保留字，整个着色器都会编译失败
      const p = attribute<'vec4'>('tileInfo', 'vec4');
      const st = p.z;
      const ix = p.x.add(v.x.mul(st)).toVar();
      const iz = p.y.add(v.z.mul(st)).toVar();
      const load = (a: N<'float'>, b: N<'float'>): N<'float'> => textureLoad(lv.height, ivec2(int(min(a, last)), int(min(b, last)))).r;
      const h0 = load(ix, iz).toVar();
      // 粗一级网格上这个顶点的高度：奇数顶点落在粗网格的边上，取两头的平均。斜边的方向和三角剖分一致
      const oi = mod(v.x, 2.0);
      const oj = mod(v.z, 2.0);
      const dj = oj.mul(oi.mul(2.0).sub(1.0));
      const hA = load(ix.sub(oi.mul(st)), iz.add(dj.mul(st)));
      const hB = load(ix.add(oi.mul(st)), iz.sub(dj.mul(st)));
      const x = ix.mul(g.cell).sub(g.half).toVar();
      const z = iz.mul(g.cell).sub(g.half).toVar();
      const d = length(vec3(x, h0, z).sub(cameraPosition));
      const k = clamp(d.div(p.w).sub(0.62).div(0.3), 0.0, 1.0);
      const y = mix(h0, hA.add(hB).mul(0.5), k).sub(v.y.mul(st.mul(g.cell * 1.5).add(3.0)));
      return vec3(x, y, z);
    })();
    const noise = getNoiseTexture();
    const strata = this.strata;
    const st = this.data.def.strata;
    const L = this.layers;
    const P = positionWorld;
    const LUMW = vec3(0.2126, 0.7152, 0.0722);
    const uv0 = P.xz.div(g.size).add(0.5).toVar();
    const nTex = texture(lv.normal, uv0);
    const nx = nTex.r.mul(2.0).sub(1.0);
    const nz = nTex.g.mul(2.0).sub(1.0);
    const N0 = normalize(vec3(nx, sqrt(max(float(1).sub(nx.mul(nx)).sub(nz.mul(nz)), 0.0)), nz)).toVar();
    // 明暗要比高程看起来硬：和十几米尺度的平均法线比，差的部分放大。山脊和沟的边一下就利了，山的形状不变
    const nLow = texture(lv.normal, uv0).bias(float(3));
    const sx = nx.add(nx.sub(nLow.r.mul(2.0).sub(1.0)).mul(0.9));
    const sz = nz.add(nz.sub(nLow.g.mul(2.0).sub(1.0)).mul(0.9));
    const Nsharp = normalize(vec3(sx, sqrt(max(float(1).sub(nx.mul(nx)).sub(nz.mul(nz)), 0.02)), sz)).toVar();
    const dist = length(P.sub(cameraPosition)).toVar();
    // （层与层之间的过渡烘在影像里了，见 prep_grandcanyon.py 的 blend_edge）
    const photo = texture(image, uv0).rgb;
    let col: N<'vec3'> = photo;
    // 镜头周围换成 30 厘米的。影子不在颜色里：照片里的影子只挡直射光，和实时影子挡的是同一份光，叠在一起也只暗一层
    let hiK: N<'float'> = float(0);
    let hi: HiSample | null = null;
    let hiSoil: N<'vec3'> = vec3(0);
    let stretch: N<'float'> = float(0);
    if (core && this.hi) {
      hi = this.hi.sample(P);
      hiK = hi.k.toVar();
      // 三十几度以上的坡，航拍贴到地上是拉长的，灌木的影子成了一块块豹纹和顺着坡的毛。这些坡取模糊一点的影像，
      // 比周围暗一截的斑也提起来，纹理交给下面的石头
      stretch = smoothstep(0.16, 0.34, float(1).sub(N0.y)).toVar();
      hiSoil = hi.soft(4).toVar();
      col = mix(col, mix(hi.rgb, max(hi.soft(3), hi.soft(5).mul(0.97)), stretch), hiK);
    }
    // 真正的崖壁：航拍是从正上方拍的，接近竖直的面在照片上只有一条缝，贴上去是一道道竖着拉长的条纹。
    // 这里的地层几乎是水平的，同一高度就是同一层岩石：颜色改从岩层色表里查，明暗只取照片的低频。
    // 不到七十度的坡照片拍得清清楚楚，不能动
    const wob = texture(noise, P.xz.div(47.0)).r.sub(0.5);
    const wall = smoothstep(0.6, 0.86, float(1).sub(N0.y).add(wob.mul(0.2))).toVar();
    const tw = pow(abs(N0), vec3(4.0)).toVar();
    const twn = tw.div(tw.x.add(tw.z).add(0.0001)).toVar();
    // 岩层的凹凸：硬层突出来，软层缩进去。不到七十度的坡上也有，只是弱一点
    let ledge: N<'float'> = float(0);
    /** 岩层坐标：层面微微倾斜、有起伏，崖壁的贴图沿着它走 */
    let ysv: N<'float'> = P.y;
    /** 1 = 这里是基底的变质岩 */
    let basement: N<'float'> = float(0);
    /** 陡的基底岩石（内峡谷）：航拍在这些坡上拉得很长，颜色也被谷里的反光染黄了 */
    let schist: N<'float'> = float(0);
    if (strata && st) {
      const yy = P.y.add(P.x.mul(st.dip[0])).add(P.z.mul(st.dip[1])).toVar();
      // 层面不是尺子画的
      const ys = yy.add(texture(noise, P.xz.div(1400.0)).g.sub(0.5).mul(16.0)).add(texture(noise, P.xz.div(190.0)).r.sub(0.5).mul(3.0)).toVar();
      const layUV = vec2(ys.sub(st.y0).div(st.y1 - st.y0), 0.5).toVar();
      if (st.basement) schist = float(1).sub(smoothstep(st.basement - 20, st.basement + 20, ys)).mul(smoothstep(0.15, 0.38, float(1).sub(N0.y))).toVar();
      const lay4 = texture(strata, layUV);
      // （色表里的颜色是定了的；饱和度在这里收一点，正午的红墙不能像荧光的；影子里的蓝天光又把红照得发粉，蓝色压一点）
      const flat = texture(strata, layUV).level(float(5)).rgb;
      // （颜色取几十米尺度的平均，细的一条条只留一半明暗：条纹全留着的话，整面墙是一块木纹贴面）
      const even = mix(lay4.rgb, flat.mul(dot(lay4.rgb, LUMW).div(max(dot(flat, LUMW), 0.02)).sub(1.0).mul(0.5).add(1.0)), 0.8);
      const lay = mix(vec3(dot(even, LUMW)), even, 0.84).mul(vec3(1.03, 0.98, 0.88)).toVar();
      // 透明通道是这一层岩石有多硬（0.5~1）。往上一点比往下一点硬，这里就是突出的岩层的底面，朝下、暗
      const du = 0.9 / (st.y1 - st.y0);
      const hard = lay4.a.sub(0.75).mul(4.0).toVar();
      const ax = twn.x;
      // （贴图不跟着小起伏走：这里的岩层平得像书页，层线一弯就成了褶皱的变质岩）
      ysv = yy.add(texture(noise, P.xz.div(1400.0)).g.sub(0.5).mul(16.0)).toVar();
      if (st.basement) basement = step(ysv, float(st.basement)).toVar();
      // （一道岩层的底面不是从头到尾一条黑线，有的地方塌了，有的地方被盖住了）
      const brk = smoothstep(0.38, 0.62, texture(noise, P.xz.div(260.0).add(ys.div(900.0))).r);
      ledge = texture(strata, layUV.add(vec2(du, 0))).a.sub(texture(strata, layUV.sub(vec2(du, 0))).a).mul(4.0).mul(brk).toVar();
      const low = texture(image, uv0).bias(float(4)).rgb;
      const shade = clamp(dot(low, LUMW).div(max(dot(flat, LUMW), 0.02)), 0.8, 1.22);
      // 雨水顺着崖壁流下来的痕迹：竖着的长条，有的深有的浅。沿着崖壁走的坐标分两个方向取，不管崖壁朝哪边都有变化；
      // 两种尺度都乘上一大片的噪声：一段崖壁上多，一段上少，不是等距排着的
      // （不是尺子画的直线）
      const bend = texture(noise, P.xz.div(330.0)).r.sub(0.5).mul(60.0).toVar();
      const streak = (s: number, ss: number, ch: 'r' | 'g'): N<'float'> => texture(noise, vec2(P.z.add(bend).mul(s), ys.mul(ss)))[ch].mul(ax).add(texture(noise, vec2(P.x.add(bend).mul(s), ys.mul(ss).add(0.37)))[ch].mul(float(1).sub(ax))).sub(0.5);
      const patchy = texture(noise, P.xz.div(610.0)).r.mul(1.6).sub(0.2);
      // （宽的只有暗的一边、稀稀拉拉的几道：两边都有的话和横着的岩层叠在一起，整面墙成了格子布）
      const varnish = smoothstep(0.04, 0.2, streak(0.0031, 0.00031, 'r').negate()).mul(-0.15).mul(max(patchy, 0.0)).add(streak(0.0117, 0.00093, 'g').mul(0.08).mul(float(1.2).sub(patchy.mul(0.6))));
      // 五十几度到七十度的坡：照片的明暗还看得清，颜色已经是拉长的，崖壁的上下边上是一排竖着的牙。明暗留着，颜色换成这一层岩石的
      const semi = smoothstep(0.4, 0.6, float(1).sub(N0.y).add(wob.mul(0.2)));
      const grain = clamp(dot(col, LUMW).div(max(dot(low, LUMW), 0.02)), 0.6, 1.5);
      // （30 厘米的照片这个坡度上台阶拍得出来，留一些；留多了崖边还是一排竖着的牙）
      col = mix(col, lay.mul(shade).mul(grain).mul(hard.mul(0.16).add(0.92)), semi.mul(0.85).mul(float(1).sub(hiK.mul(0.35))));
      col = mix(col, lay.mul(shade).mul(varnish.add(1.0)).mul(hard.mul(0.16).add(0.92)), wall);
    }
    const aux = auxTex ? texture(auxTex, uv0) : null;
    // （G 通道：河边 0→0.5 是水陆交界，再往里 0.5→1 是离岸多远）
    // （掩码一格十几米，贴着河的陡壁也算进去了，墙上挂着一道道水色和白浪：水面是平的，陡的地方不算）
    const wet: N<'float'> = aux ? smoothstep(0.14, 0.34, aux.g).mul(float(1).sub(smoothstep(0.04, 0.16, float(1).sub(N0.y)))).toVar() : float(0);
    const flatK = float(1).sub(wall).mul(float(1).sub(wet)).toVar();
    // 片岩发黑发灰，和上面暖色的沉积岩分得开
    col = mix(col, mix(vec3(dot(col, LUMW)), col, 0.45).mul(vec3(0.72, 0.71, 0.75)), schist.mul(float(1).sub(wet)));
    // 飞低了，航拍上一个像素放大成一大块，树和灌木是一团团糊的斑。这些东西近处已经是立体的了（树、散布的灌木和碎石），
    // 地面只留下十来米尺度的底色，细节交给下面的细节层
    if (core) {
      // （一片灌木在航拍上是十几米的一块脏：比周围几十米的平均色暗太多的地方提起来，灌木已经立在那儿了）
      let soil: N<'vec3'> = max(texture(image, uv0).bias(float(3.2)).rgb, texture(image, uv0).bias(float(5.2)).rgb.mul(0.88));
      let near: N<'float'> = float(1).sub(smoothstep(45.0, 240.0, dist));
      if (hi && this.hi) {
        // 30 厘米的影像离得够近也是放大的，地上一团团的树冠和灌木还是糊。这些立体的东西已经站在那儿了，
        // 比周围暗一截的才换成底色，路面、屋顶、石头都留着；一百多米外全是照片
        const close = float(1).sub(smoothstep(20.0, 110.0, dist)).toVar();
        const blob = float(1).sub(smoothstep(0.5, 0.85, dot(col, LUMW).div(max(dot(hiSoil, LUMW), 0.02))));
        soil = mix(soil, hiSoil, hiK);
        // （别的地方也退一半：放大的照片明暗太硬，近处的细节全靠细节层）
        near = mix(near, close.mul(max(blob, 0.45)), hiK);
        // 照片里的影子只挡直射光，和实时影子挡的是同一份光。近处投影子的东西已经换掉了，影子也不要；河面的太阳碎光要留着
        // （陡坡上照片里的小影子也是拉长的，一片片模糊的黑斑，不要）
        const lit = mix(float(1), hi.sun, hiK.mul(this.hi.sunMatch).mul(float(1).sub(wet)).mul(float(1).sub(close.mul(flatK))).mul(float(1).sub(stretch)));
        m.receivedShadowNode = Fn(([s]: [N<'float'>]) => s.mul(lit)) as unknown as () => THREE.Node;
      }
      // （模糊之后草和土混成一片黄绿色，灰一点才像土）
      col = mix(col, mix(soil, vec3(dot(soil, LUMW)), 0.2), near.mul(flatK));
    } else {
      // 外圈的影像五米一个像素，树和树影是一团团糊的黑斑，真树已经站在那儿了：贴地飞的时候把这些斑提起来
      const lift = max(col, texture(image, uv0).bias(float(2.6)).rgb.mul(0.94));
      col = mix(col, lift, float(1).sub(smoothstep(300.0, 1800.0, dist)).mul(flatK));
    }
    let N: N<'vec3'> = N0;
    if (L) {
      // 近处的石头和土：1.25 米一个像素，低空飞过时不够。细节层只取明暗和法线，颜色还是航拍的
      const kN = float(1).sub(smoothstep(90.0, 900.0, dist)).toVar();
      const kF = float(1).sub(smoothstep(500.0, 3600.0, dist)).toVar();
      // 细节层一张贴图：R、G 法线，B 明暗（相对这一层平均亮度的倍数除以 2，见 terrainLayers.ts 的 PACKED）
      const at = (uv: N<'vec2'>, l: number): N<'vec4'> => texture(L.normal, uv).depth(int(l));
      const lum = (c: N<'vec4'>): N<'float'> => c.b.mul(2.0);
      const nxy = (c: N<'vec4'>): N<'vec2'> => c.rg.mul(2.0).sub(1.0);
      const u0 = P.xz.div(L.tiles[0]);
      const u1 = P.xz.div(L.tiles[1] * 3.7).add(0.37);
      // 最近的一层碎石：同一张碎石贴图缩小，错开方向，离得近才有
      const u2 = vec2(P.z.negate(), P.x).div(L.tiles[1] * 0.8).add(0.21);
      // 陡坡（三十多度以上）：从正上方贴的细节层在坡上被拉长了。改成贴在坡面上，一层几米、一层几十米的石头。
      // 大的这层坐标用噪声扭一下，几十米一格的重复在大面积的山坡上一眼就看得出来
      const steep = smoothstep(0.2, 0.5, float(1).sub(N0.y)).mul(float(1).sub(wet)).toVar();
      const kR = float(1).sub(smoothstep(120.0, 1500.0, dist)).toVar();
      const warp = texture(noise, P.xz.div(420.0)).rg.sub(0.5).mul(16.0).toVar();
      const big = L.tiles[3] * 2.0;
      // 崖壁：这张照片本来就是一面层状的岩壁，岩层、节理、崩落的岩块都是真的，按真实比例贴才像，贴小了是一面砖墙。
      // 几十米一格。一格的高度走完就把水平位置错开，同一块石头不会一层一层地摞上去；错开的地方正好落在层面上
      const wallUv = (tile: number, off: number): [N<'vec2'>, N<'vec2'>] => {
        const row = fract(floor(ysv.div(tile).add(off)).mul(0.6180339).add(off)).mul(tile).toVar();
        const v = ysv.negate();
        const a = vec2(P.z.add(warp.x).add(row), v).div(tile);
        const b = vec2(P.x.sub(warp.x).add(row), v).div(tile).add(0.41);
        // （大峡谷最底下的片岩是变质岩，片理几乎是竖着的：同一张贴图转过来，和上面水平的沉积岩隔着一道不整合面）
        const lean = (u: N<'vec2'>): N<'vec2'> => mix(u, vec2(u.y.mul(0.94).add(u.x.mul(0.34)), u.x.mul(-0.94).add(u.y.mul(0.34))), basement);
        return [lean(a), lean(b)];
      };
      const [ux, uz] = wallUv(WALL_TILE, 0);
      const [vx, vz] = wallUv(WALL_TILE * 3.1, 0.37);
      const [fx, fz] = wallUv(WALL_TILE * 0.27, 0.71);
      const rx = vec2(P.z.add(warp.x), P.y.negate().add(warp.y)).div(big);
      const rz = vec2(P.x.add(warp.y), P.y.negate().sub(warp.x)).div(big).add(0.29);
      const ry = P.xz.add(warp).div(big).add(0.13);
      // （同一张放大五倍：近处是碎石，远一点是大石块）
      const ry2 = vec2(P.z.negate(), P.x).add(warp).div(big * 5.3).add(0.57);
      const g0 = at(u0, 0).toVar();
      const g1 = at(u1, 1).toVar();
      const g2 = at(u2, 1).toVar();
      const wx = at(ux, 2).toVar();
      const wz = at(uz, 2).toVar();
      const bx = at(vx, 2).toVar();
      const bz = at(vz, 2).toVar();
      const ex = at(fx, 2).toVar();
      const ez = at(fz, 2).toVar();
      const ro = at(rx, 3).toVar();
      const rp = at(rz, 3).toVar();
      const rt = at(ry, 3).toVar();
      const rt2 = at(ry2, 3).toVar();
      const a = twn.x;
      const b = float(1).sub(a);
      const mixLum = (x: N<'vec4'>, z: N<'vec4'>): N<'float'> => lum(x).mul(a).add(lum(z).mul(b));
      // （五十度以下的坡从上面贴：从侧面贴到缓坡上，石头被拉成一道道的毛）
      const topK = smoothstep(0.28, 0.5, N0.y).toVar();
      const rockLum = mix(mixLum(ro, rp), lum(rt).mul(mix(float(1), lum(rt2), 0.7)), topK);
      const rockK = max(wall, steep).toVar();
      // 崖壁的岩层从五十度往上就有；再缓的坡是碎石和土，贴岩层是错的
      const cliffK = smoothstep(0.26, 0.52, float(1).sub(N0.y).add(wob.mul(0.2))).mul(float(1).sub(wet)).toVar();
      const kMid = float(1).sub(smoothstep(900.0, 4200.0, dist)).mul(cliffK).toVar();
      const kBig = float(1).sub(smoothstep(2200.0, 7000.0, dist)).mul(cliffK).toVar();
      const kFine = float(1).sub(smoothstep(50.0, 300.0, dist)).mul(cliffK).toVar();
      // 平地的三层只留给不陡的地方
      const flatD = flatK.mul(float(1).sub(steep)).toVar();
      const kC = float(1).sub(smoothstep(12.0, 170.0, dist)).toVar();
      // （30 厘米影像离远了自己就有这个尺度的细节，贴图只留一点；飞低了一格放大成十来个像素，还是要细节层）
      const keep = float(1).sub(hiK.mul(smoothstep(90.0, 320.0, dist)).mul(0.6)).toVar();
      const gain = mix(float(1), lum(g0), kN.mul(flatD).mul(0.7).mul(keep)).mul(mix(float(1), lum(g1), kF.mul(flatD).mul(0.4).mul(keep))).mul(mix(float(1), lum(g2), kC.mul(flatD).mul(0.5))).mul(mix(float(1), rockLum, kR.mul(rockK).mul(float(1).sub(cliffK.mul(0.7))).mul(0.6)));
      const cliffGain = mix(float(1), mixLum(wx, wz), kMid.mul(0.68)).mul(mix(float(1), mixLum(bx, bz), kBig.mul(0.45))).mul(mix(float(1), mixLum(ex, ez), kFine.mul(0.32)));
      col = col.mul(gain).mul(clamp(cliffGain, 0.4, 1.7));
      const n0 = nxy(g0);
      const n1 = nxy(g1);
      const n2 = nxy(g2);
      const flatN = vec3(n0.x, 0.0, n0.y).mul(kN.mul(0.75).mul(keep)).add(vec3(n1.x, 0.0, n1.y).mul(kF.mul(0.4).mul(keep))).add(vec3(n2.y.negate(), 0.0, n2.x).mul(kC.mul(0.6))).mul(flatD);
      const onWall = (x: N<'vec4'>, z: N<'vec4'>): N<'vec3'> => {
        const nx0 = nxy(x);
        const nz0 = nxy(z);
        return vec3(0.0, nx0.y, nx0.x).mul(a).add(vec3(nz0.x, nz0.y, 0.0).mul(b));
      };
      const nt = nxy(rt).add(nxy(rt2).mul(0.8));
      const wallN = onWall(wx, wz).mul(kMid.mul(1.15)).add(onWall(bx, bz).mul(kBig.mul(1.0))).add(onWall(ex, ez).mul(kFine.mul(0.6))).add(mix(onWall(ro, rp), vec3(nt.x, 0.0, nt.y), topK).mul(kR.mul(0.55).mul(rockK).mul(float(1).sub(cliffK.mul(0.6)))));
      // 岩层的凹凸只有近处看得出来。离远了 mipmap 自己把它平均掉，这里不用再管
      const slopeK = smoothstep(0.3, 0.72, float(1).sub(N0.y)).mul(float(1).sub(wet)).toVar();
      const fine = float(1).sub(smoothstep(250.0, 1800.0, dist));
      N = normalize(Nsharp.add(flatN).add(wallN).add(vec3(0, -1.0, 0).mul(ledge).mul(slopeK).mul(1.3).mul(fine)));
      // （太阳擦着崖壁照的时候凹凸压下来，不然一片硬边的黑斑，见 terrainShader.ts）
      N = normalize(mix(N0, N, smoothstep(0.02, 0.4, abs(dot(N0, FOG.sunDir))).mul(0.8).add(0.2)));
    }
    // 山坳里和谷底看到的天空少，散射光也少
    let ao: N<'float'> = float(1);
    let sky: N<'float'> = float(1);
    if (aux) {
      const fade = smoothstep(g.half * 0.93, g.half * 0.995, max(abs(P.x), abs(P.z)));
      sky = mix(aux.b, float(1), fade).toVar();
      ao = sky.mul(float(1).sub(aux.r.mul(0.6).mul(float(1).sub(fade))));
    }
    // 河：激光测绘把水面压平了，影像里是泥沙的绿褐色和急流的白浪。这里把光滑度和水波补上
    let rough: N<'float'> = float(0.92);
    let mirror: N<'vec3'> = vec3(0);
    if (aux) {
      const t = time;
      const w1 = texture(noise, P.xz.div(61.0).add(vec2(t.mul(0.013), t.mul(0.004)))).rg.sub(0.5);
      const w2 = texture(noise, P.xz.div(17.0).sub(vec2(t.mul(0.03), t.mul(-0.011)))).rg.sub(0.5);
      // 远处的小波浪看不见，只剩平均下来的镜面：波浪留着的话，掠射的视线全被打到地面上，看不到天空的倒影
      const near = float(1).sub(smoothstep(60.0, 500.0, dist)).mul(0.8).add(0.2);
      const ripple = w1.mul(0.05).add(w2.mul(0.04)).mul(near);
      const Nw = normalize(vec3(ripple.x, 1.0, ripple.y)).toVar();
      N = mix(N, Nw, wet);
      rough = mix(rough, float(0.1), wet);
      // 大坝放出来的水又冷又清，是青绿色的，浅的地方透出河底，急流是白的。影像里的土黄色是泥沙和反光混在一起
      const deep = smoothstep(0.5, 0.92, aux.g);
      const body = mix(vec3(0.05, 0.095, 0.06), vec3(0.011, 0.062, 0.05), deep);
      // 白浪：比周围的水亮一截的地方（影像上的水面本身就有亮有暗，不能看绝对亮度）
      const calm = dot(texture(image, uv0).bias(float(5)).rgb, LUMW);
      // （外圈的河面掩码 20 米一格，比影像粗：岸上亮的石头和沙洲落在水里，不能都当白浪，看起来像一河冰块）
      // （看 1.25 米的影像：30 厘米的水面是影子里提亮的，亮点全成了白浪）
      const foam0 = smoothstep(core ? 1.2 : 1.9, core ? 1.75 : 2.8, dot(photo, LUMW).div(max(calm, 0.02)));
      // 白浪在翻：两层噪声朝不同方向走，一团团地出现又散开
      const churn = texture(noise, P.xz.div(9.0).add(vec2(t.mul(0.19), t.mul(-0.11)))).r.mul(texture(noise, P.xz.div(3.7).sub(vec2(t.mul(0.31), t.mul(0.16)))).g);
      const foam = clamp(foam0.mul(churn.mul(3.4).add(0.25)), 0.0, 0.92).toVar();
      col = mix(col, mix(body, vec3(0.62, 0.66, 0.62), foam), wet);
      rough = mix(rough, float(0.75), foam.mul(wet));
      // 倒影：沿反射的方向在高度图里走，撞到崖壁就取那里的影像。出了这一层的范围就是天空
      const I = normalize(P.sub(cameraPosition)).toVar();
      const Rd = I.sub(Nw.mul(dot(I, Nw).mul(2.0))).toVar();
      const hit = Fn(() => {
        const out = vec3(0.5, 0.5, 0).toVar();
        If(wet.greaterThan(0.02), () => {
          // 步长是一段比一段长的，撞到崖壁的地方一格一格的。起点每帧每个像素错开一点，时间抗锯齿把台阶抹成软边
          const t = float(9.0).mul(interleavedGradientNoise(screenCoordinate.xy.add(fract(time.mul(7.13)).mul(64.0))).mul(0.65).add(0.7)).toVar();
          Loop(15, () => {
            const q = P.add(Rd.mul(t)).toVar();
            const hx = int(clamp(q.x.add(g.half).div(g.cell), 0.0, last));
            const hz = int(clamp(q.z.add(g.half).div(g.cell), 0.0, last));
            If(q.y.lessThan(textureLoad(lv.height, ivec2(hx, hz)).r), () => {
              out.assign(vec3(q.xz.div(g.size).add(0.5), 1.0));
              Break();
            });
            t.mulAssign(1.45);
          });
        });
        return out;
      })().toVar();
      const hitUv = hit.xy;
      const hitK = hit.z;
      const nh = texture(lv.normal, hitUv).level(float(3));
      const hxn = nh.r.mul(2.0).sub(1.0);
      const hzn = nh.g.mul(2.0).sub(1.0);
      const hn = vec3(hxn, sqrt(max(float(1).sub(hxn.mul(hxn)).sub(hzn.mul(hzn)), 0.0)), hzn);
      const lit = max(dot(hn, FOG.sunDir), 0.0).mul(0.3).add(0.05);
      const fres = pow(float(1).sub(max(dot(I, Nw).negate(), 0.0)), 5.0).mul(0.96).add(0.03);
      mirror = texture(image, hitUv).level(float(3)).rgb.mul(VFOG.sun).mul(lit).mul(fres).mul(hitK).mul(wet);
      // 水面不用散射光的遮挡：天空的倒影不能被算成“山坳里暗”。撞到崖壁的地方天空就不反射了
      ao = mix(ao, float(1).sub(hitK.mul(0.92)), wet);
    }
    m.colorNode = vec4(col, 1);
    m.roughnessNode = rough;
    m.normalNode = normalize(cameraViewMatrix.mul(vec4(N, 0.0)).xyz);
    m.aoNode = ao;
    // 背阴的岩壁被对面晒着太阳的岩壁照亮：暖色的光在峡谷里来回反射，影子才不是一片蓝黑
    const shadeK = float(1).sub(terrainSun(P));
    const backK = clamp(float(0.32).sub(dot(normalize(normalWorld), FOG.sunDir)), 0.0, 1.0);
    // （0.05 是地面反上来的光：沙漠的地面亮，影子里不是只有蓝天的光。没有这一项，树影是一块块蓝黑的印子）
    m.emissiveNode = col.mul(VFOG.sun).mul(shadeK.mul(float(1.2).sub(sky)).mul(0.14).add(backK.mul(0.1)).add(0.05)).add(mirror);
    return m;
  }

  private emit(l: Level, k: number, bx: number, bz: number): void {
    if (this.count >= MAX_PATCH) return;
    const a = l.patches.array as Float32Array;
    const o = this.count * 4;
    const step = 1 << k;
    a[o] = bx * C * step;
    a[o + 1] = bz * C * step;
    a[o + 2] = step;
    // 到这个距离时已经完全变成下一级的形状
    a[o + 3] = RANGE * l.grid.cell * step * 2 * this.lodScale;
    this.count++;
  }

  private walk(l: Level, k: number, bx: number, bz: number, cam: THREE.Vector3): void {
    const nb = (l.grid.res - 1) / (C << k);
    const span = C * (1 << k) * l.grid.cell;
    const x0 = -l.grid.half + bx * span;
    const z0 = -l.grid.half + bz * span;
    // 完全在里面一层的范围内：不画
    if (l.hole > 0 && x0 >= -l.hole && x0 + span <= l.hole && z0 >= -l.hole && z0 + span <= l.hole) return;
    const o = (bz * nb + bx) * 2;
    _box.min.set(x0, l.mm[k][o], z0);
    _box.max.set(x0 + span, l.mm[k][o + 1], z0 + span);
    if (!_frustum.intersectsBox(_box)) return;
    const overlap = l.hole > 0 && x0 < l.hole && x0 + span > -l.hole && z0 < l.hole && z0 + span > -l.hole;
    const dist = _box.distanceToPoint(cam);
    const near = k > 0 && dist < RANGE * l.grid.cell * (1 << k) * this.lodScale;
    if (k > 0 && (near || overlap)) {
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) this.walk(l, k - 1, bx * 2 + dx, bz * 2 + dz, cam);
      return;
    }
    this.emit(l, k, bx, bz);
  }

  update(cam: THREE.Vector3, camera?: THREE.Camera): void {
    if (camera) _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, (camera as unknown as { reversedDepth?: boolean }).reversedDepth);
    for (const l of this.levels) {
      this.count = 0;
      this.walk(l, l.depth - 1, 0, 0, cam);
      l.geo.instanceCount = this.count;
      l.patches.clearUpdateRanges();
      l.patches.addUpdateRange(0, this.count * 4);
      l.patches.needsUpdate = true;
    }
    this.updateShadow(cam);
  }

  /** 镜头附近的地形投影：固定用粗一级的块，太阳的影子不需要 2.5 米的精度 */
  private updateShadow(cam: THREE.Vector3): void {
    const s = this.shadow;
    if (!s) return;
    const l = s.level;
    const k = 2;
    const span = C * (1 << k) * l.grid.cell;
    const nb = (l.grid.res - 1) / (C << k);
    const R = Math.ceil(Math.min(2400, Math.max(600, this.shadowRange * 1.4)) / span);
    const cx = Math.floor((cam.x + l.grid.half) / span);
    const cz = Math.floor((cam.z + l.grid.half) / span);
    const a = s.patches.array as Float32Array;
    let n = 0;
    for (let z = cz - R; z <= cz + R; z++)
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 0 || z < 0 || x >= nb || z >= nb || n >= 256) continue;
        const o = n * 4;
        a[o] = x * C * (1 << k);
        a[o + 1] = z * C * (1 << k);
        a[o + 2] = 1 << k;
        a[o + 3] = 1e9;
        n++;
      }
    s.geo.instanceCount = n;
    s.patches.clearUpdateRanges();
    s.patches.addUpdateRange(0, n * 4);
    s.patches.needsUpdate = true;
  }

  dispose(): void {
    for (const l of this.levels) {
      l.geo.dispose();
      disposeTextures([l.height, l.normal]);
    }
    this.shadow?.geo.dispose();
    for (const m of this.mats) m.dispose();
    this.group.clear();
    this.levels.length = 0;
  }
}
