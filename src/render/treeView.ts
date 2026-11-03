// 植被渲染：每种树两级 LOD 的实例化网格；顶点着色器按真实风场摆动（风越大摆动越明显）。
// 低画质只缩短远景距离，碰撞相关的近处树木始终可见。

import * as THREE from 'three';
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

export interface TreeQuality {
  near: number;
  far: number;
  shadows: boolean;
}

export class TreeView {
  readonly group = new THREE.Group();
  private trees: TreeSet;
  private meshes: Array<[THREE.InstancedMesh, THREE.InstancedMesh] | null> = [];
  private byType: number[][] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private lastT = -10;
  private uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uGust: { value: 0 } };
  readonly material: THREE.MeshStandardMaterial;
  quality: TreeQuality = { near: 420, far: 2200, shadows: true };

  constructor(trees: TreeSet) {
    this.trees = trees;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    const U = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uGust;')
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
}
#endif`,
        );
    };
    this.material.customProgramCacheKey = () => 'tree-v1';
    for (let t = 0; t < TREE_TYPES.length; t++) this.byType.push([]);
    for (let i = 0; i < trees.count; i++) this.byType[trees.type[i]].push(i);
    TREE_TYPES.forEach((type, ti) => {
      const list = this.byType[ti];
      if (list.length === 0) {
        this.meshes.push(null);
        return;
      }
      const [g0, g1] = buildTree(type);
      const m0 = new THREE.InstancedMesh(g0, this.material, list.length);
      const m1 = new THREE.InstancedMesh(g1, this.material, list.length);
      for (const m of [m0, m1]) {
        m.count = 0;
        m.frustumCulled = false;
        m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
      }
      m0.castShadow = true;
      // 分配逐实例颜色缓冲（每次重排时按树的编号重新写入，保证颜色固定）
      m0.setColorAt(0, new THREE.Color(1, 1, 1));
      m1.setColorAt(0, new THREE.Color(1, 1, 1));
      this.meshes.push([m0, m1]);
    });
  }

  /** windX/windZ：相机附近的风（m/s）；gust 0..1 */
  update(t: number, cam: THREE.Camera, windX: number, windZ: number, gust: number, force = false): void {
    this.uniforms.uTime.value = t;
    (this.uniforms.uWind.value as THREE.Vector2).set(windX * 0.09, windZ * 0.09);
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
    const near2 = this.quality.near * this.quality.near;
    const far2 = this.quality.far * this.quality.far;
    const always2 = 300 * 300;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const cosHalf = Math.cos(1.15);
    TREE_TYPES.forEach((_type, ti) => {
      const pair = this.meshes[ti];
      if (!pair) return;
      const [m0, m1] = pair;
      const list = this.byType[ti];
      let n0 = 0;
      let n1 = 0;
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
        q.setFromAxisAngle(up, T.rot[i]);
        s.setScalar(T.s[i]);
        p.set(T.x[i], T.y[i], T.z[i]);
        m4.compose(p, q, s);
        const col = treeColor(T.x[i], T.z[i], ti);
        if (d2 < near2) {
          m0.setMatrixAt(n0, m4);
          m0.setColorAt(n0, col);
          n0++;
        } else {
          m1.setMatrixAt(n1, m4);
          m1.setColorAt(n1, col);
          n1++;
        }
      }
      m0.count = n0;
      m1.count = n1;
      m0.instanceMatrix.needsUpdate = true;
      m1.instanceMatrix.needsUpdate = true;
      if (m0.instanceColor) m0.instanceColor.needsUpdate = true;
      if (m1.instanceColor) m1.instanceColor.needsUpdate = true;
      m0.castShadow = this.quality.shadows;
    });
  }

  dispose(): void {
    for (const pair of this.meshes) {
      if (!pair) continue;
      for (const m of pair) {
        m.geometry.dispose();
        m.dispose();
      }
    }
    this.material.dispose();
  }
}

const _c = new THREE.Color();
/** 每棵树固定的颜色变化（由位置哈希决定）。 */
function treeColor(x: number, z: number, ti: number): THREE.Color {
  const v = 0.8 + hash(x, z, ti) * 0.4;
  return _c.setRGB(v * (0.94 + hash(z, x, 2) * 0.12), v, v * (0.88 + hash(x, ti, z) * 0.1));
}
