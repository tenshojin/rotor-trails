// 植被渲染：Blender 生成的树木模型（models/trees.glb，见 tools/blender/trees.py），每种树三级细节的实例化网格；
// 顶点着色器按真实风场摆动（风越大摆动越明显），叶片另有细碎抖动。模型加载失败时退回程序几何体（两级细节）。
// 低画质只缩短远景距离，碰撞相关的近处树木始终可见。

import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cameraViewMatrix,
  dFdx,
  dFdy,
  dot,
  float,
  interleavedGradientNoise,
  length,
  log2,
  max,
  min,
  mix,
  normalize,
  normalLocal,
  normalViewGeometry,
  positionGeometry,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  varyingProperty,
  vertexColor,
} from 'three/tsl';
import { HELI } from '../config/flight';
import { FOG, gustAt, WASH, WASH_Y, WIND } from './atmosphere';
import { terrainSun } from './sunMap';
import { getNoiseTexture } from './textures';
import { VFOG } from './volumetricFog';
import { loadGltf } from './gltf';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { layerTable, strataWarp, type RockFormDef } from '../world/rockForm';
import { TREE_SPECS, TREE_TYPES, type TreeSet } from '../world/vegetation';
import type { TreeType } from '../maps/types';

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function colorize(g: THREE.BufferGeometry, hex: number, jitter = 0.12): THREE.BufferGeometry {
  const c = new THREE.Color().setHex(hex);
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (hash(pos.getX(i), pos.getY(i), pos.getZ(i)) - 0.5) * jitter;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  return m.index ? m.toNonIndexed() : m;
}

function blob(r: number, ry: number, x: number, y: number, z: number, detail: number, noise: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const k = 1 + (hash(px * 3.1, py * 2.7, pz * 1.9) - 0.5) * noise;
    pos.setXYZ(i, px * r * k + x, py * ry * k + y, pz * r * k + z);
  }
  return colorize(clean(g), hex, 0.22);
}

function trunk(h: number, r: number, hex: number, seg = 6, bend = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.65, r, h, seg, 3, true);
  g.translate(0, h / 2, 0);
  if (bend) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / h;
      pos.setX(i, pos.getX(i) + bend * y * y);
    }
  }
  g.deleteAttribute('uv');
  return colorize(g, hex, 0.1);
}

function cone(r: number, h: number, y: number, hex: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg, 2, false);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const k = 1 + (hash(px, pos.getY(i), pz) - 0.5) * 0.25;
    pos.setX(i, px * k);
    pos.setZ(i, pz * k);
  }
  g.translate(0, y + h / 2, 0);
  return colorize(clean(g), hex, 0.18);
}

function frondGeo(len: number, y: number, hex: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = new THREE.PlaneGeometry(len, 0.9, 4, 1);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + len / 2;
      pos.setXYZ(k, x, pos.getY(k) * (1 - x / len) - (x * x) / (len * 2.4), 0);
    }
    g.rotateX(Math.PI / 2);
    g.rotateY(a);
    g.translate(0, y, 0);
    g.deleteAttribute('uv');
    parts.push(colorize(g, hex, 0.2));
  }
  const m = mergeGeometries(parts);
  m.computeVertexNormals();
  return m;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ps = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') q.deleteAttribute(k);
    if (!q.getAttribute('normal')) q.computeVertexNormals();
    return q;
  });
  const m = mergeGeometries(ps)!;
  m.computeBoundingSphere();
  return m;
}

/** 每种树：[近景 LOD0, 远景 LOD1] */
function buildTree(type: TreeType): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const S = TREE_SPECS[type];
  const bark = 0x5a4430;
  switch (type) {
    case 'pine':
      return [
        merge([
          trunk(S.trunkH + 1, S.trunkR, 0x4e3b2c, 6, 0.8),
          blob(S.crownR, S.crownRy * 0.55, 0.8, S.crownY, 0, 1, 0.5, 0x2f4a26),
          blob(S.crownR * 0.7, S.crownRy * 0.45, -1.4, S.crownY - 1.6, 0.8, 1, 0.5, 0x34522a),
          blob(S.crownR * 0.6, S.crownRy * 0.4, 1.8, S.crownY - 2.6, -1.0, 1, 0.5, 0x2c4624),
        ]),
        merge([trunk(S.trunkH, S.trunkR, 0x4e3b2c, 3), blob(S.crownR, S.crownRy * 0.7, 0.4, S.crownY - 0.8, 0, 0, 0.3, 0x2f4a26)]),
      ];
    case 'broadleaf':
      return [
        merge([
          trunk(S.trunkH + 1, S.trunkR, bark),
          blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.45, 0x41632e),
          blob(S.crownR * 0.65, S.crownRy * 0.7, 1.8, S.crownY + 0.8, 1.0, 1, 0.45, 0x4a6c33),
          blob(S.crownR * 0.6, S.crownRy * 0.65, -1.7, S.crownY - 0.4, -1.2, 1, 0.45, 0x3b5a29),
        ]),
        merge([trunk(S.trunkH, S.trunkR, bark, 3), blob(S.crownR * 1.05, S.crownRy, 0, S.crownY, 0, 0, 0.3, 0x41632e)]),
      ];
    case 'canopy':
      return [
        merge([
          trunk(S.trunkH + 2, S.trunkR, 0x6a5a48, 7),
          blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.5, 0x2e5a22),
          blob(S.crownR * 0.6, S.crownRy * 0.8, 3.5, S.crownY + 1.4, 2, 1, 0.5, 0x386a28),
          blob(S.crownR * 0.6, S.crownRy * 0.75, -3.2, S.crownY + 0.6, -2.5, 1, 0.5, 0x2a5320),
          blob(S.crownR * 0.5, S.crownRy * 0.7, 0.5, S.crownY + 1.8, -3.6, 1, 0.5, 0x3f7030),
        ]),
        merge([trunk(S.trunkH, S.trunkR, 0x6a5a48, 3), blob(S.crownR * 1.1, S.crownRy * 1.1, 0, S.crownY + 0.5, 0, 0, 0.3, 0x30602a)]),
      ];
    case 'emergent':
      return [
        merge([
          trunk(S.trunkH + 3, S.trunkR, 0x8a8070, 8),
          blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.45, 0x456e2c),
          blob(S.crownR * 0.6, S.crownRy * 0.8, 5, S.crownY + 1, 3, 1, 0.45, 0x3d6428),
          blob(S.crownR * 0.6, S.crownRy * 0.8, -5, S.crownY - 0.5, -3, 1, 0.45, 0x4c7632),
        ]),
        merge([trunk(S.trunkH, S.trunkR, 0x8a8070, 4), blob(S.crownR * 1.15, S.crownRy * 1.1, 0, S.crownY, 0, 0, 0.3, 0x456e2c)]),
      ];
    case 'palm':
      return [merge([trunk(S.trunkH, S.trunkR, 0x7a6a50, 6, 1.6), frondGeo(4.2, S.crownY, 0x4f7a30)]), merge([trunk(S.trunkH, S.trunkR, 0x7a6a50, 3, 1.6), blob(S.crownR, S.crownRy, 1.6, S.crownY, 0, 0, 0.3, 0x4f7a30)])];
    case 'spruce':
      return [
        merge([
          trunk(S.trunkH + 3, S.trunkR, 0x4a3a2c, 5),
          cone(S.crownR, S.crownRy * 0.75, S.trunkH, 0x23402a),
          cone(S.crownR * 0.75, S.crownRy * 0.6, S.trunkH + S.crownRy * 0.5, 0x284a2f),
          cone(S.crownR * 0.5, S.crownRy * 0.5, S.trunkH + S.crownRy * 0.95, 0x2c5034),
        ]),
        merge([cone(S.crownR, S.crownRy * 1.9, S.trunkH * 0.5, 0x264530, 5)]),
      ];
    case 'birch':
      return [
        merge([trunk(S.trunkH + 1, S.trunkR, 0xd8d4c8, 6), blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.5, 0x6b8a3a), blob(S.crownR * 0.6, S.crownRy * 0.6, 0.8, S.crownY + 1.6, 0.5, 1, 0.5, 0x7a9a44)]),
        merge([trunk(S.trunkH, S.trunkR, 0xd8d4c8, 3), blob(S.crownR, S.crownRy * 1.1, 0, S.crownY, 0, 0, 0.3, 0x6b8a3a)]),
      ];
    case 'pinyon':
    case 'pinyon2':
    case 'ujuniper':
    case 'ujuniper2':
    case 'ponderosa':
    case 'juniper':
      return [
        merge([trunk(S.trunkH + 0.6, S.trunkR, 0x6a5440, 5, 0.4), blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.6, 0x4d5e38), blob(S.crownR * 0.6, S.crownRy * 0.7, 1.0, S.crownY + 0.6, 0.6, 1, 0.6, 0x56683f)]),
        merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 0, 0.4, 0x4d5e38)]),
      ];
    case 'scrub':
    case 'shrub':
      return [merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.6, 0x5a6a3a)]), merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 0, 0.4, 0x5a6a3a)])];
    case 'boulder': {
      // 棱角分明的石块：几个不规则的面拼起来，半埋在地里
      const rock = (detail: number, noise: number) => {
        const g = merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, detail, noise, 0x8e867c), blob(S.crownR * 0.62, S.crownRy * 0.6, 0.72, S.crownY * 0.5, 0.35, detail, noise, 0x7e776e)]);
        return g;
      };
      return [rock(1, 0.5), blob(S.crownR * 1.05, S.crownRy, 0, S.crownY, 0, 0, 0.35, 0x8a8278)];
    }
    case 'cactus': {
      const body = new THREE.CapsuleGeometry(S.trunkR, S.trunkH - S.trunkR * 2, 4, 8);
      body.translate(0, S.trunkH / 2, 0);
      const arm1 = new THREE.CapsuleGeometry(S.trunkR * 0.7, 1.6, 3, 6);
      arm1.translate(0.75, S.trunkH * 0.62, 0);
      const arm2 = new THREE.CapsuleGeometry(S.trunkR * 0.65, 1.3, 3, 6);
      arm2.translate(-0.7, S.trunkH * 0.5, 0);
      const elbow1 = new THREE.CapsuleGeometry(S.trunkR * 0.6, 0.6, 3, 6);
      elbow1.rotateZ(Math.PI / 2);
      elbow1.translate(0.45, S.trunkH * 0.5, 0);
      const parts = [body, arm1, arm2, elbow1].map((g) => {
        g.deleteAttribute('uv');
        return colorize(g, 0x4f6e3a, 0.12);
      });
      const lod1 = trunk(S.trunkH, S.trunkR, 0x4f6e3a, 4);
      return [merge(parts), merge([lod1])];
    }
  }
}

/** 模型库里的一个部件（同一材质的网格） */
interface TreePart {
  geometry: THREE.BufferGeometry;
  /** GLB 里的原材质（只取贴图和颜色，渲染用 TreeView 自己的材质） */
  source: THREE.MeshStandardMaterial;
}
/** 每种树三级细节，每级若干部件 */
export type TreeLib = Map<TreeType, TreePart[][]>;

const IDENTITY = new THREE.Matrix4();
let libPromise: Promise<TreeLib | null> | null = null;

/** 加载树木模型库（所有地图共用，只加载一次）；失败返回 null。 */
export function loadTreeLib(): Promise<TreeLib | null> {
  libPromise ??= (async () => {
    try {
      const gltf = await loadGltf('models/trees.glb');
      gltf.scene.updateMatrixWorld(true);
      const nodes = new Map<string, THREE.Object3D>();
      for (const c of gltf.scene.children) nodes.set((c.userData.name as string | undefined) ?? c.name, c);
      const lib: TreeLib = new Map();
      for (const type of TREE_TYPES) {
        const lods: TreePart[][] = [];
        for (let l = 0; l < 3; l++) {
          const node = nodes.get(`${type}_${l}`);
          if (!node) break;
          const parts: TreePart[] = [];
          node.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const g = m.matrixWorld.equals(IDENTITY) ? m.geometry : m.geometry.clone().applyMatrix4(m.matrixWorld);
            parts.push({ geometry: g, source: m.material as THREE.MeshStandardMaterial });
          });
          lods.push(parts);
        }
        if (lods.length === 3) lib.set(type, lods);
      }
      if (!lib.size) libPromise = null;
      return lib.size ? lib : null;
    } catch (e) {
      libPromise = null;
      console.warn('树木模型加载失败，使用程序几何体：', e);
      return null;
    }
  })();
  return libPromise;
}

function makeWindUniforms() {
  return { uTime: uniform(0), uWind: uniform(new THREE.Vector2()), uGust: uniform(0), uFar: uniform(2200) };
}
type WindUniforms = ReturnType<typeof makeWindUniforms>;

/**
 * 风摆（顶点位移，实例化变换之后、世界坐标里）：越高摆得越多（与高度平方成正比），
 * 两个频率叠加；叶片另有沿法线的细碎抖动。相位取顶点的世界坐标，一棵树的不同枝叶略有先后。
 */
function windPosition(U: WindUniforms, leaf: boolean): THREE.Node<'vec3'> {
  const hgt = max(0.0, positionGeometry.y);
  // 摆幅不按高度的平方算：那样几米高的灌木几乎不动。这里矮的植物也看得出在摇，高树也不会甩得太夸张
  const bend = pow(hgt, 0.8).mul(0.12).toVar();
  const ph = positionLocal.x.mul(0.071).add(positionLocal.z.mul(0.053));
  const osc = sin(U.uTime.mul(1.6).add(ph)).mul(0.6).add(sin(U.uTime.mul(3.7).add(ph.mul(2.3))).mul(0.25)).toVar();
  // 阵风扫到这里时一下弯下去、再弹回来；平时只是轻轻地晃
  const gust = gustAt(positionLocal.xz).toVar();
  const amp = (WIND.k as unknown as THREE.Node<'float'>).mul(gust.mul(1.25).add(0.3)).mul(U.uGust.mul(0.6).add(1.0)).toVar();
  const down = WIND.dir as unknown as THREE.Node<'vec2'>;
  const lean = down.mul(amp.mul(osc.mul(0.42).add(0.72)));
  // 顺风摆的同时横着也晃一点，树梢走的是一个小椭圆
  const side = vec2(down.y.negate(), down.x).mul(amp.mul(0.34).mul(sin(U.uTime.mul(1.13).add(ph.mul(1.7)))));
  const wv = lean.add(side);
  let p: THREE.Node<'vec3'> = positionLocal.add(vec3(wv.x, 0.0, wv.y).mul(bend));
  // 旋翼下洗：桨盘下面是一根往下冲的气柱，打到地面后贴着地向四周散开，能吹到两三个旋翼直径以外。
  // 靠近的树被压得向外弯，一阵一阵地回弹；矮的灌木也一样东倒西歪
  const R = HELI.rotorRadius;
  const dv = positionLocal.xz.sub(WASH.xy);
  const dr = length(dv).max(0.01).toVar();
  const below = WASH_Y.sub(positionLocal.y);
  const column = float(1).sub(smoothstep(R * 1.1, R * 2.6, dr)).mul(float(1).sub(smoothstep(R * 2.5, R * 9.0, below))).mul(smoothstep(-R, 0.0, below)).toVar();
  const sheet = float(1).sub(smoothstep(R * 2.0, R * 7.5, dr)).mul(WASH.z);
  const washK = max(column, sheet).mul(WASH.w).toVar();
  // 气流是一阵一阵往外跑的，里面还夹着急促的抖动
  const press = sin(U.uTime.mul(8.6).sub(dr.mul(0.4)).add(ph)).mul(0.34).add(sin(U.uTime.mul(21.0).add(ph.mul(3.3)).add(hgt.mul(0.6))).mul(0.16)).add(0.78);
  const tall = min(pow(hgt, 0.9).mul(0.44), 4.6);
  const radial = smoothstep(0.0, R * 0.5, dr);
  p = p.add(vec3(dv.x.div(dr).mul(radial), column.mul(-0.7).sub(0.12), dv.y.div(dr).mul(radial)).mul(washK.mul(press).mul(tall)));
  if (leaf) {
    // 叶子的抖动：阵风来的时候抖得厉害，旋翼底下更是抖成一片
    const flutter = sin(U.uTime.mul(5.3).add(dot(positionGeometry, vec3(2.1, 1.7, 2.9))).add(ph)).mul(0.05).mul(amp.mul(3.0).add(0.25).add(washK.mul(3.5)));
    const whip = sin(U.uTime.mul(27.0).add(dot(positionGeometry, vec3(3.1, 2.3, 2.7))).add(ph)).mul(washK).mul(0.2);
    p = p.add(normalLocal.mul(flutter.add(whip)));
  }
  return p;
}

/** 石块的颜色：几何体是中性灰，乘上地图的岩石色 */
const BOULDER = TREE_TYPES.indexOf('boulder');
const rockTint = new THREE.Color();
/** 这张地图树叶的整体偏色 */
const leafTint = new THREE.Color(1, 1, 1);

export interface TreeQuality {
  near: number;
  far: number;
  shadows: boolean;
  /** 多重采样抗锯齿开着时，叶片边缘用 alpha-to-coverage 柔化 */
  aa?: boolean;
}

/** 一级细节的网格：各部件共用一份实例矩阵；tinted 是接收逐棵颜色变化的网格（叶片） */
interface LodMeshes {
  meshes: THREE.InstancedMesh[];
  tinted: THREE.InstancedMesh[];
  /** 列表长度；owner[槽位] = 这个槽位上是这种树的第几棵 */
  count: number;
  owner: Int32Array;
  /** 这一轮空出来的槽位、改写过的槽位 */
  holes: number[];
  dirty: number[];
}

/** 一种树里每一棵现在的位置：细节级（-1 = 不画）、槽位、是否按远景放大 */
interface Placed {
  lod: Int8Array;
  slot: Int32Array;
  big: Uint8Array;
}

// 每次刷新只改真正换了细节级或进出视野的树。整张列表重写一次要往显卡传几 MB，传输队列一满，
// 连后面几十字节的写入也要排队，飞行中每隔一秒就卡 200 多毫秒
/** 一帧最多挪动多少棵远处的树（急转弯时排队，近处的不受限） */
const TREE_BUDGET = 2000;
/** 两个改动的槽位隔得比这近就并成一次上传 */
const SLOT_GAP = 8;

function uploadSlots(set: LodMeshes): void {
  const d = set.dirty;
  if (d.length === 0) return;
  d.sort((a, b) => a - b);
  const im = set.meshes[0].instanceMatrix;
  const send = (a: number, b: number): void => {
    im.addUpdateRange(a * 16, (b - a) * 16);
    for (const m of set.tinted) m.instanceColor?.addUpdateRange(a * 3, (b - a) * 3);
  };
  let a = -1;
  let b = -1;
  for (const s of d) {
    if (s >= set.count) break;
    if (a >= 0 && s <= b + SLOT_GAP) {
      b = s + 1;
      continue;
    }
    if (a >= 0) send(a, b);
    a = s;
    b = s + 1;
  }
  d.length = 0;
  if (a < 0) return;
  send(a, b);
  im.needsUpdate = true;
  for (const m of set.tinted) if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

export class TreeView {
  readonly group = new THREE.Group();
  private trees: TreeSet;
  private sets: Array<LodMeshes[] | null> = [];
  private placed: Placed[] = [];
  private byType: number[][] = [];
  /** 上一帧的预算用完了，还有远处的树在排队 */
  private backlog = false;
  /** 下一次刷新一次排完（刚载入、画质改变） */
  private rebuild = true;
  private pending = new Int32Array(0);
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private lastT = -10;
  /** 地层（有的话，石块的颜色按它所在的那一层来：崖顶是白岩，崖下是红岩） */
  private readonly form: RockFormDef | null;
  private readonly layers: ReturnType<typeof layerTable> | null;
  private bigTrees = 0;
  /** 每棵树换细节级的距离都错开一点（距离平方的系数）：不错开的话，换级的地方是一道整齐的圆弧 */
  private spread: Float32Array;
  private uniforms: WindUniforms = makeWindUniforms();
  private materials = new Map<string, THREE.MeshStandardNodeMaterial>();
  private leafMats: THREE.MeshStandardNodeMaterial[] = [];
  private ownGeometry: THREE.BufferGeometry[] = [];
  /** 是否用 Blender 模型（三级细节）；否则为程序几何体（两级） */
  readonly modeled: boolean;
  private q: TreeQuality = { near: 420, far: 2200, shadows: true, aa: false };

  get quality(): TreeQuality {
    return this.q;
  }

  set quality(q: TreeQuality) {
    // 叶片边缘的锯齿交给后期的时间抗锯齿（TRAA）处理，不再用 alpha-to-coverage
    this.q = q;
    this.uniforms.uFar.value = q.far;
    this.lastT = -10;
    this.rebuild = true;
  }

  /** dry：干旱地带的稀树（树的数量多，但不是雨林：远处不压暗、不偏绿） */
  constructor(trees: TreeSet, lib: TreeLib | null = null, rock = 0x8a8278, form: RockFormDef | null = null, tint: readonly [number, number, number] = [1, 1, 1], private readonly dry = false) {
    this.trees = trees;
    this.form = form;
    this.layers = form ? layerTable(form) : null;
    // 风化的石头颜色比新鲜岩面灰一些、暗一些
    leafTint.setRGB(tint[0], tint[1], tint[2]);
    rockTint.setHex(rock);
    const grey = (rockTint.r + rockTint.g + rockTint.b) / 3;
    rockTint.lerp(new THREE.Color(grey, grey, grey), 0.55).multiplyScalar(0.85 / Math.max(grey, 0.03));
    this.modeled = lib !== null;
    for (let i = 0; i < trees.count; i++) {
      const name = TREE_TYPES[trees.type[i]];
      if (name !== 'shrub' && name !== 'scrub' && name !== 'boulder') this.bigTrees++;
    }
    this.spread = new Float32Array(trees.count);
    for (let i = 0; i < trees.count; i++) this.spread[i] = 0.5 + 1.25 * hash(trees.x[i], trees.z[i], 3.7);
    for (let t = 0; t < TREE_TYPES.length; t++) this.byType.push([]);
    for (let i = 0; i < trees.count; i++) this.byType[trees.type[i]].push(i);
    const white = new THREE.Color(1, 1, 1);
    TREE_TYPES.forEach((type, ti) => {
      const list = this.byType[ti];
      this.placed.push({ lod: new Int8Array(list.length).fill(-1), slot: new Int32Array(list.length), big: new Uint8Array(list.length) });
      if (list.length > this.pending.length) this.pending = new Int32Array(list.length);
      if (list.length === 0) {
        this.sets.push(null);
        return;
      }
      const lods = lib?.get(type);
      const geoSets = lods
        ? lods.map((parts, l) => parts.map((p) => ({ g: p.geometry, mat: this.materialFor(p.source, l === 2), tint: p.source.name.includes('leaves') })))
        : buildTree(type).map((g) => {
            this.ownGeometry.push(g);
            return [{ g, mat: this.materialFor(null, false, type === 'boulder'), tint: true }];
          });
      this.sets.push(
        geoSets.map((parts, lodIdx) => {
          const set: LodMeshes = { meshes: [], tinted: [], count: 0, owner: new Int32Array(list.length), holes: [], dirty: [] };
          for (const part of parts) {
            const m = new THREE.InstancedMesh(part.g, part.mat, list.length);
            // 不能标成 DynamicDrawUsage：WebGPU 后端对动态缓冲每次绘制都整块重传（实测每帧 60 MB），只上传改过的槽位
            if (set.meshes.length) m.instanceMatrix = set.meshes[0].instanceMatrix;
            m.count = 0;
            m.frustumCulled = false;
            m.receiveShadow = true;
            // 中景、远景的树离镜头至少上百米，不会落进最近两层阴影（图层 1，见 sunShadows.ts）
            if (lodIdx > 0) m.layers.set(1);
            if (part.tint) {
              // 分配逐实例颜色缓冲（树放进槽位时按它的编号写入，保证颜色固定）
              m.setColorAt(0, white);
              set.tinted.push(m);
            }
            set.meshes.push(m);
            this.group.add(m);
          }
          return set;
        }),
      );
    });
  }

  /** GLB 材质 → 带风摆的渲染材质（同名共用）；null = 程序几何体用的顶点色材质。mass：最远一级的体块树冠。 */
  private materialFor(src: THREE.MeshStandardMaterial | null, mass = false, rock = false): THREE.MeshStandardNodeMaterial {
    const leaf = !!src && src.name.includes('leaves');
    const key = src ? src.name + (leaf && mass ? '#mass' : '') : rock ? '__rock' : '__procedural';
    const hit = this.materials.get(key);
    if (hit) return hit;
    const U = this.uniforms;
    const still = rock || (!!src && src.name.includes('cactus'));
    let m: THREE.MeshStandardNodeMaterial;
    if (!src) {
      m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
      if (rock) {
        // 一块纯色的石头从远处看是地上一颗橘子：上面要有风化的斑驳和裂缝，整体也比岩壁的颜色暗
        const q = positionWorld;
        const noise = getNoiseTexture();
        const big = texture(noise, q.xz.add(q.y.mul(0.6)).mul(0.13)).r;
        const mid = texture(noise, q.zx.sub(q.y.mul(0.8)).mul(0.57)).g;
        const fine = texture(noise, q.xz.mul(2.1).add(q.y)).b;
        const worn = mix(float(0.34), float(0.92), smoothstep(0.32, 0.7, big.mul(0.55).add(mid.mul(0.45)))).mul(fine.mul(0.35).add(0.82));
        m.colorNode = vec4(vec3(worn), 1);
        // 石块在影子里只有环境光，比旁边的地面暗一大截，逆光时是地上一个个黑洞。地面反上来的光补一点
        m.emissiveNode = vertexColor().rgb.mul(varyingProperty('vec3', 'vInstanceColor')).mul(worn).mul(FOG.color.mul(0.08).add(VFOG.sun.mul(0.03)));
      }
    } else {
      m = new THREE.MeshStandardNodeMaterial({
        map: src.map,
        normalMap: leaf ? null : src.normalMap,
        normalScale: src.normalScale.clone(),
        roughnessMap: src.roughnessMap,
        color: src.color.clone(),
        roughness: src.roughnessMap ? 1 : Math.max(0.6, src.roughness),
        metalness: 0,
        side: leaf ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: leaf ? 0.5 : 0,
      });
      for (const t of [src.map, src.normalMap, src.roughnessMap]) if (t) t.anisotropy = 8;
      // 贴图是松树皮：南缘的矮松、刺柏皮是灰褐色的，西黄松是橙褐色的
      if (this.dry && src.name === 'tree_bark') m.color.setRGB(0.52, 0.48, 0.46);
      if (src.name === 'tree_bark_pond') m.color.setRGB(1.05, 0.72, 0.5);
      if (leaf && src.map) {
        // 远处（较小的 mip 级别）按级别放大不透明度，避免叶片越远越稀
        const map = src.map;
        const img = map.image as { width?: number; height?: number } | null;
        const sz = vec2(img?.width ?? 1024, img?.height ?? 1024);
        const tuv = uv().mul(sz);
        const ddx = dFdx(tuv);
        const ddy = dFdy(tuv);
        // （干旱地带的树小，叶卡一两米宽：放大多了卡片糊成实心的方块，树冠成了迷彩球）
        const boost = max(0.0, log2(max(dot(ddx, ddx), dot(ddy, ddy))).mul(0.5)).mul(this.dry ? 0.17 : 0.25).add(1.0);
        const c = texture(map, uv());
        let albedo: THREE.Node<'vec3'> = c.rgb.mul(vec3(src.color.r, src.color.g, src.color.b));
        let cover: THREE.Node<'float'> = float(1);
        if (mass) {
          // 最远一级是一个光滑的椭球，从上面看就是一地绿球。用世界坐标的细胞噪声画出一团团的枝叶：
          // 团块亮、缝隙暗，轮廓上啃出缺口；太阳照出的球面明暗也压平一半（真的树冠是毛的，没有这么圆）
          const noise = getNoiseTexture();
          const wp = positionWorld.xz.add(positionWorld.y.mul(0.7));
          const c1 = texture(noise, wp.mul(0.0125)).b;
          const c2 = texture(noise, wp.mul(0.034).add(0.37)).b;
          const lump = float(1).sub(c1.mul(c1).mul(1.25)).mul(0.62).add(float(1).sub(c2.mul(c2).mul(1.25)).mul(0.38)).toVar();
          // （近处两级的树叶互相遮挡、接收阴影，比这一级暗得多：密林里要压下来，不然一圈暗树围着一片亮树）
          const dense = this.bigTrees > 50000 && !this.dry;
          const gain = dense ? 0.7 : this.dry ? 1.0 : 1.25;
          albedo = albedo.mul(mix(float(0.42 * gain), float(1.32 * gain), lump)).mul(dense ? vec3(0.62, 0.95, 0.58) : this.dry ? vec3(1.0, 1.0, 0.92) : vec3(0.92, 1.0, 0.82));
          const rim = float(1).sub(abs(dot(normalViewGeometry, normalize(positionView.negate()))));
          cover = step(rim.mul(rim).mul(0.86), lump);
        } else if (this.bigTrees > 50000 && !this.dry) {
          albedo = albedo.mul(smoothstep(170.0, 520.0, length(positionWorld.sub(cameraPosition))).mul(0.3).add(1.0));
        }
        // 透明度再看粗一级的贴图：一两个像素大的叶子不再切成一颗颗碎点，树冠边缘是成团的
        // （取两者较小的：只用粗的，透明的地方也会露出来，卡片边上是一圈黑边和邻格的白线）
        // 画得到的最远处，树一棵棵化进地形的树冠层，不是一条线上突然没了
        const fade = float(1).sub(smoothstep(U.uFar.mul(0.78), U.uFar, length(positionWorld.sub(cameraPosition))));
        const keep = step(interleavedGradientNoise(screenCoordinate.xy), fade);
        m.colorNode = vec4(albedo, min(c.a, texture(map, uv()).bias(float(0.8)).a).mul(boost).mul(keep).mul(cover));
        // 叶片是半透明的：迎着太阳看时被照透（发亮的黄绿色）；树冠里的暗处也有叶片之间反射的绿光，不是黑洞
        const back = pow(max(dot(normalize(positionWorld.sub(cameraPosition)), FOG.sunDir), 0.0), 3.0);
        // （阳光那部分要乘山影：在山的影子里叶片没有被照透，否则一棵棵树在暗处发光）
        // （太阳很低时迎光的一面也亮：叶子是一层层竖着的，不是平铺的）
        // （干旱地带的地面又亮又裸，树冠底下有不少反上来的光：逆光时不是纯黑的剪影）
        const fill = this.dry ? VFOG.sun.mul(0.05) : vec3(0.0);
        // （每棵树自己的颜色也要算进去，树种的色调才不会被这层光冲掉）
        const own = this.dry ? varyingProperty('vec3', 'vInstanceColor') : vec3(1.0);
        m.emissiveNode = albedo.mul(own).mul(vec3(1.08, 1.16, 0.72)).mul(FOG.color.mul(0.13).add(VFOG.sun.mul(back.mul(0.15).add(0.018).add(VFOG.low.mul(0.16))).mul(terrainSun(positionWorld))).add(fill));
        // 双面渲染时背面不翻转法线（叶片法线朝树冠外侧，翻转会让背面发黑）
        m.normalNode = mass ? normalize(mix(normalViewGeometry, cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz, 0.5)) : normalViewGeometry;
      }
      if (leaf) this.leafMats.push(m);
    }
    if (!still) m.positionNode = windPosition(U, leaf);
    m.name = key;
    this.materials.set(key, m);
    return m;
  }

  /** windX/windZ：相机附近的风（m/s）；gust 0..1 */
  update(t: number, cam: THREE.Camera, windX: number, windZ: number, gust: number, force = false): void {
    this.uniforms.uTime.value = t;
    this.uniforms.uWind.value.set(windX * 0.09, windZ * 0.09);
    this.uniforms.uGust.value = gust;
    const pos = cam.position;
    // 视线方向和距离都按三维算：飞得高、往下看时，脚下的树也在视野里，而且离得很远（按水平距离算，
    // 正下方一圈是全细节，前方一块楔形是远景，别的地方没有树，从高空看是一个圆加一块三角）
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const away = pos.distanceTo(this.lastPos);
    const moved = this.backlog || away > 25 || dir.dot(this.lastDir) < 0.96 || t - this.lastT > 1.5;
    if (!moved && !force) return;
    // 瞬移、刚载入：一次排好，不留到后面几帧
    let budget = force || this.rebuild || away > 400 ? Infinity : TREE_BUDGET;
    this.rebuild = false;
    this.backlog = false;
    this.lastPos.copy(pos);
    this.lastDir.copy(dir);
    this.lastT = t;
    const T = this.trees;
    const Q = this.q;
    // 细节分级距离：模型树三级（近景全细节 / 中景简化 / 远景体块），程序树两级
    // 密林（亚马孙）：树的数量是别的地图的好几倍，近景细节收得更早；远处隔一棵画一棵、放大一点，
    // 那里地形本身已经画了树冠层，看不出少了树
    // （灌木和石块不算：密林是说大树多）
    const dense = this.bigTrees > 50000;
    // （最近一级的叶卡最费：大峡谷南缘的树小，180 米外全细节也看不出来）
    const lim2 = (this.modeled ? [Math.min(Q.near * 0.42, dense ? 170 : this.dry ? 180 : 260), Q.near * (dense ? 1.1 : 1.25)] : [Q.near]).map((d) => d * d);
    const thin2 = dense ? Q.far * Q.far * 0.16 : Infinity;
    const far2 = Q.far * Q.far;
    const always2 = 300 * 300;
    const urgent2 = lim2[lim2.length - 1];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    // 视野的边界进出不对称：已经在画的树要转出更远才摘掉，稍微转一下头不用搬动一大片
    const cosHalf = Math.cos(1.15);
    const cosKeep = Math.cos(1.35);
    // （最远一级的体块树冠不投影：试过，影子是一块块圆边，树冠看上去像荷叶。远处林子的明暗交给接触阴影，见 post.ts）
    const shadowLods = this.modeled ? 2 : 1;
    const put = (set: LodMeshes, n: number, i: number, big: number, ti: number): void => {
      q.setFromAxisAngle(up, T.rot[i]);
      s.setScalar(big ? T.s[i] * 1.3 : T.s[i]);
      p.set(T.x[i], T.y[i], T.z[i]);
      m4.compose(p, q, s);
      set.meshes[0].setMatrixAt(n, m4);
      if (set.tinted.length) {
        const col = treeColor(T.x[i], T.z[i], ti);
        // （矮灌丛的贴图是细枝，又暗又碎：影子里一团黑）
        if (this.dry && TREE_TYPES[ti] === 'scrub') col.multiplyScalar(2.2);
        // （松针贴图是别的地图用的翠绿色，南缘的西黄松发黄发灰）
        if (TREE_TYPES[ti] === 'ponderosa') col.multiply(ponderosaTint);
        if (ti === BOULDER && this.form && this.layers) {
          const f = this.form;
          const L = this.layers;
          const q = Math.min(L.at.length - 1, Math.max(0, (T.y[i] + strataWarp(f, T.x[i], T.z[i]) - f.y0) | 0));
          col.setHex(f.bands[L.band[L.at[q]]].c);
          // （模型本身是中性灰，和 rockTint 一样按亮度拉回来）
          col.multiplyScalar(((0.85 / Math.max(0.03, (col.r + col.g + col.b) / 3)) * (0.78 + hash(T.x[i], T.z[i], 5.1) * 0.4)));
        }
        for (const m of set.tinted) m.setColorAt(n, col);
      }
      set.dirty.push(n);
    };
    const pend = this.pending;
    const spread = this.spread;
    TREE_TYPES.forEach((_type, ti) => {
      const sets = this.sets[ti];
      if (!sets) return;
      const P = this.placed[ti];
      const list = this.byType[ti];
      let np = 0;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const was = P.lod[k];
        const dx = T.x[i] - pos.x;
        const dy = T.y[i] - pos.y;
        const dz = T.z[i] - pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        let l = -1;
        let big = 0;
        if (d2 <= far2 && (d2 <= always2 || (dx * dir.x + dy * dir.y + dz * dir.z) / Math.sqrt(d2) >= (was >= 0 ? cosKeep : cosHalf))) {
          const dj = d2 * spread[i];
          big = dj > thin2 ? 1 : 0;
          if (!big || (i & 1) === 0) {
            l = 0;
            while (l < lim2.length && dj >= lim2[l]) l++;
            l = Math.min(l, sets.length - 1);
          }
        }
        if (l === was && (l < 0 || big === P.big[k])) continue;
        if (budget <= 0 && d2 > urgent2) {
          this.backlog = true;
          continue;
        }
        budget--;
        P.big[k] = big;
        if (l === was) {
          put(sets[l], P.slot[k], i, big, ti);
          continue;
        }
        if (was >= 0) sets[was].holes.push(P.slot[k]);
        P.lod[k] = l;
        if (l >= 0) pend[np++] = k;
      }
      // 新来的树先填空位，不够再接到列表尾巴上
      for (let a = 0; a < np; a++) {
        const k = pend[a];
        const set = sets[P.lod[k]];
        const n = set.holes.length ? (set.holes.pop() as number) : set.count++;
        set.owner[n] = k;
        P.slot[k] = n;
        put(set, n, list[k], P.big[k], ti);
      }
      sets.forEach((set, l) => {
        // 还剩空位：拿列表尾巴上的树填上，列表保持连续（实例绘制只能画前 count 个）
        if (set.holes.length) {
          set.holes.sort((a, b) => a - b);
          const mat = set.meshes[0].instanceMatrix.array;
          while (set.holes.length) {
            const h = set.holes.pop() as number;
            const last = --set.count;
            if (h === last) continue;
            const k = set.owner[last];
            set.owner[h] = k;
            P.slot[k] = h;
            mat.copyWithin(h * 16, last * 16, last * 16 + 16);
            for (const m of set.tinted) m.instanceColor?.array.copyWithin(h * 3, last * 3, last * 3 + 3);
            set.dirty.push(h);
          }
        }
        for (const m of set.meshes) {
          m.count = set.count;
          m.castShadow = Q.shadows && l < shadowLods;
        }
        uploadSlots(set);
      });
    });
  }

  dispose(): void {
    for (const sets of this.sets) {
      if (!sets) continue;
      for (const set of sets) for (const m of set.meshes) m.dispose();
    }
    for (const g of this.ownGeometry) g.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}

const _c = new THREE.Color();
const ponderosaTint = new THREE.Color(0.8, 0.66, 0.46);
/** 每棵树固定的颜色变化（由位置哈希决定）。 */
function treeColor(x: number, z: number, ti: number): THREE.Color {
  const v = 0.8 + hash(x, z, ti) * 0.4;
  if (ti === BOULDER) return _c.copy(rockTint).multiplyScalar(0.75 + hash(x, z, ti) * 0.5);
  return _c.setRGB(v * (0.94 + hash(z, x, 2) * 0.12) * leafTint.r, v * leafTint.g, v * (0.88 + hash(x, ti, z) * 0.1) * leafTint.b);
}
