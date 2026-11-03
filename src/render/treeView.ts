// 植被渲染：Blender 生成的树木模型（models/trees.glb，见 tools/blender/trees.py），每种树三级细节的实例化网格；
// 顶点着色器按真实风场摆动（风越大摆动越明显），叶片另有细碎抖动。模型加载失败时退回程序几何体（两级细节）。
// 低画质只缩短远景距离，碰撞相关的近处树木始终可见。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
    case 'juniper':
      return [
        merge([trunk(S.trunkH + 0.6, S.trunkR, 0x6a5440, 5, 0.4), blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.6, 0x4d5e38), blob(S.crownR * 0.6, S.crownRy * 0.7, 1.0, S.crownY + 0.6, 0.6, 1, 0.6, 0x56683f)]),
        merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 0, 0.4, 0x4d5e38)]),
      ];
    case 'shrub':
      return [merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 1, 0.6, 0x5a6a3a)]), merge([blob(S.crownR, S.crownRy, 0, S.crownY, 0, 0, 0.4, 0x5a6a3a)])];
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
      const gltf = await new GLTFLoader().loadAsync(new URL('models/trees.glb', document.baseURI).href);
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
      return lib.size ? lib : null;
    } catch (e) {
      console.warn('树木模型加载失败，使用程序几何体：', e);
      return null;
    }
  })();
  return libPromise;
}

type WindUniforms = { uTime: { value: number }; uWind: { value: THREE.Vector2 }; uGust: { value: number } };

/** 风：树越高处弯得越多；叶片（TREE_LEAF）再加细碎抖动。 */
function patchWind(shader: THREE.WebGLProgramParametersWithUniforms, U: WindUniforms, leaf: boolean): void {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uGust;${leaf ? '\n#define TREE_LEAF' : ''}`)
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = ip.x * 0.071 + ip.z * 0.053;
  float hgt = max(0.0, position.y);
  float bend = hgt * hgt * 0.0011;
  float osc = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 3.7 + ph * 2.3) * 0.25;
  vec2 wv = uWind * (0.55 + 0.45 * osc) * (1.0 + uGust);
  mat3 im = mat3(instanceMatrix);
  float sc = length(im[0]);
  vec3 lw = transpose(im) * vec3(wv.x, 0.0, wv.y) / (sc * sc);
  transformed += lw * bend;
#ifdef TREE_LEAF
  transformed += objectNormal * sin(uTime * 5.3 + dot(position, vec3(2.1, 1.7, 2.9)) + ph) * 0.035 * (0.3 + length(uWind) * 2.0) / sc;
#endif
}
#endif`,
    );
}

/**
 * 叶片片元：① 远处（较小的 mip 级别）按级别放大不透明度，避免叶片越远越稀；
 * ② 双面渲染时背面不翻转法线（叶片法线朝树冠外侧，翻转会让背面发黑）。
 */
function patchLeafFragment(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <alphatest_fragment>',
      /* glsl */ `#ifdef USE_MAP
{
  vec2 tsz = vec2(textureSize(map, 0));
  vec2 ddx = dFdx(vMapUv * tsz), ddy = dFdy(vMapUv * tsz);
  diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy)))) * 0.25;
}
#endif
#include <alphatest_fragment>`,
    )
    .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
}

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
}

export class TreeView {
  readonly group = new THREE.Group();
  private trees: TreeSet;
  private sets: Array<LodMeshes[] | null> = [];
  private byType: number[][] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private lastT = -10;
  private uniforms: WindUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uGust: { value: 0 } };
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private leafMats: THREE.MeshStandardMaterial[] = [];
  private ownGeometry: THREE.BufferGeometry[] = [];
  /** 是否用 Blender 模型（三级细节）；否则为程序几何体（两级） */
  readonly modeled: boolean;
  private q: TreeQuality = { near: 420, far: 2200, shadows: true, aa: false };

  get quality(): TreeQuality {
    return this.q;
  }

  set quality(q: TreeQuality) {
    this.q = q;
    const aa = !!q.aa;
    for (const m of this.leafMats) {
      if (m.alphaToCoverage === aa) continue;
      m.alphaToCoverage = aa;
      m.needsUpdate = true;
    }
    this.lastT = -10;
  }

  constructor(trees: TreeSet, lib: TreeLib | null = null) {
    this.trees = trees;
    this.modeled = lib !== null;
    for (let t = 0; t < TREE_TYPES.length; t++) this.byType.push([]);
    for (let i = 0; i < trees.count; i++) this.byType[trees.type[i]].push(i);
    const white = new THREE.Color(1, 1, 1);
    TREE_TYPES.forEach((type, ti) => {
      const list = this.byType[ti];
      if (list.length === 0) {
        this.sets.push(null);
        return;
      }
      const lods = lib?.get(type);
      const geoSets = lods
        ? lods.map((parts) => parts.map((p) => ({ g: p.geometry, mat: this.materialFor(p.source), tint: p.source.name.includes('leaves') })))
        : buildTree(type).map((g) => {
            this.ownGeometry.push(g);
            return [{ g, mat: this.materialFor(null), tint: true }];
          });
      this.sets.push(
        geoSets.map((parts) => {
          const set: LodMeshes = { meshes: [], tinted: [] };
          for (const part of parts) {
            const m = new THREE.InstancedMesh(part.g, part.mat, list.length);
            if (set.meshes.length) m.instanceMatrix = set.meshes[0].instanceMatrix;
            else m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.count = 0;
            m.frustumCulled = false;
            m.receiveShadow = true;
            if (part.tint) {
              // 分配逐实例颜色缓冲（每次重排时按树的编号重新写入，保证颜色固定）
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

  /** GLB 材质 → 带风摆的渲染材质（同名共用）；null = 程序几何体用的顶点色材质。 */
  private materialFor(src: THREE.MeshStandardMaterial | null): THREE.MeshStandardMaterial {
    const key = src ? src.name : '__procedural';
    const hit = this.materials.get(key);
    if (hit) return hit;
    const U = this.uniforms;
    const leaf = !!src && src.name.includes('leaves');
    const still = !!src && src.name.includes('cactus');
    let m: THREE.MeshStandardMaterial;
    if (!src) {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    } else {
      m = new THREE.MeshStandardMaterial({
        map: src.map,
        normalMap: src.normalMap,
        normalScale: src.normalScale.clone(),
        roughnessMap: src.roughnessMap,
        color: src.color.clone(),
        roughness: src.roughnessMap ? 1 : Math.max(0.6, src.roughness),
        metalness: 0,
        side: leaf ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: leaf ? 0.5 : 0,
      });
      for (const t of [src.map, src.normalMap, src.roughnessMap]) if (t) t.anisotropy = 8;
      if (leaf) this.leafMats.push(m);
    }
    m.onBeforeCompile = (shader) => {
      if (!still) patchWind(shader, U, leaf);
      if (leaf) patchLeafFragment(shader);
    };
    m.customProgramCacheKey = () => `tree-v2-${leaf ? 'leaf' : still ? 'still' : src ? 'bark' : 'proc'}`;
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
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const moved = pos.distanceTo(this.lastPos) > 25 || dir.dot(this.lastDir) < 0.96 || t - this.lastT > 1.5;
    if (!moved && !force) return;
    this.lastPos.copy(pos);
    this.lastDir.copy(dir);
    this.lastT = t;
    const T = this.trees;
    const Q = this.q;
    // 细节分级距离：模型树三级（近景全细节 / 中景简化 / 远景体块），程序树两级
    const lim2 = (this.modeled ? [Math.min(Q.near * 0.42, 260), Q.near * 1.25] : [Q.near]).map((d) => d * d);
    const far2 = Q.far * Q.far;
    const always2 = 300 * 300;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const cosHalf = Math.cos(1.15);
    const shadowLods = this.modeled ? 2 : 1;
    TREE_TYPES.forEach((_type, ti) => {
      const sets = this.sets[ti];
      if (!sets) return;
      const counts = sets.map(() => 0);
      const list = this.byType[ti];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const dx = T.x[i] - pos.x;
        const dz = T.z[i] - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > far2) continue;
        if (d2 > always2) {
          const d = Math.sqrt(d2);
          if ((dx * dir.x + dz * dir.z) / d < cosHalf) continue;
        }
        let l = 0;
        while (l < lim2.length && d2 >= lim2[l]) l++;
        l = Math.min(l, sets.length - 1);
        const set = sets[l];
        const n = counts[l]++;
        q.setFromAxisAngle(up, T.rot[i]);
        s.setScalar(T.s[i]);
        p.set(T.x[i], T.y[i], T.z[i]);
        m4.compose(p, q, s);
        set.meshes[0].setMatrixAt(n, m4);
        if (set.tinted.length) {
          const col = treeColor(T.x[i], T.z[i], ti);
          for (const m of set.tinted) m.setColorAt(n, col);
        }
      }
      sets.forEach((set, l) => {
        for (const m of set.meshes) {
          m.count = counts[l];
          m.castShadow = Q.shadows && l < shadowLods;
        }
        set.meshes[0].instanceMatrix.needsUpdate = true;
        for (const m of set.tinted) if (m.instanceColor) m.instanceColor.needsUpdate = true;
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
/** 每棵树固定的颜色变化（由位置哈希决定）。 */
function treeColor(x: number, z: number, ti: number): THREE.Color {
  const v = 0.8 + hash(x, z, ti) * 0.4;
  return _c.setRGB(v * (0.94 + hash(z, x, 2) * 0.12), v, v * (0.88 + hash(x, ti, z) * 0.1));
}
