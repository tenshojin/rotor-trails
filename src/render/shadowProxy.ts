// 只投影的合并网格。GLTFLoader 把一个多材质网格拆成一组子网格（一个材质一个，变换都是单位阵），
// 画阴影时材质用不上（阴影通道统一换成只写深度的材质），可这一组几十个子网格在每层阴影里都要各提交一次：
// 座舱固定件 31 个、机身外壳 14 个、座椅 8 个……座舱视角每帧光它们就占阴影提交的四成。
// 把同一组里能合的子网格合成一个只进阴影的网格（只要顶点位置），原来的子网格不再投影。
// “只进阴影”靠图层：合并网格在图层 5 / 6，主相机不开这两层；分层阴影的近两层开 5、远两层开 6（见 sunShadows.ts）。
// 合并网格是这一组的子物体，组怎么动（旋翼转、操纵杆摆、座椅随视点挪）它就跟着怎么动；
// 子网格各自的变换、显隐和材质在运行中不能变（GLTFLoader 拆出来的子网格本来就是这样）。

import * as THREE from 'three/webgpu';

/** 原网格进最近两层阴影（带图层 2，或者还是默认图层、会被 markNearShadow 加上图层 2） */
export const SHADOW_PROXY_NEAR = 5;
/** 原网格进外面两层阴影（带图层 0 或 1） */
export const SHADOW_PROXY_FAR = 6;

type ShadowMat = THREE.Material & {
  alphaMap?: THREE.Texture | null;
  displacementMap?: THREE.Texture | null;
  transmission?: number;
  positionNode?: unknown;
  castShadowNode?: unknown;
  maskShadowNode?: unknown;
};

function identity(o: THREE.Object3D): boolean {
  return o.position.lengthSq() === 0 && o.quaternion.x === 0 && o.quaternion.y === 0 && o.quaternion.z === 0 && o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1;
}

/** 这个网格能不能并进只投影的合并网格 */
function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  if (!m.castShadow || !m.visible || m.children.length > 0 || !identity(m)) return false;
  if (Array.isArray(m.material) || !m.geometry.getAttribute('position')) return false;
  if (Object.keys(m.geometry.morphAttributes).length > 0) return false;
  const mat = m.material as ShadowMat;
  // 阴影通道会沿用原材质的镂空、透明、顶点位移；这些不能合
  if (!mat.visible || mat.transparent || mat.alphaTest > 0 || mat.alphaMap || mat.displacementMap || (mat.transmission ?? 0) > 0) return false;
  if (mat.positionNode || mat.castShadowNode || mat.maskShadowNode) return false;
  return proxyLayers(m.layers.mask) !== 0;
}

/** 合并网格该在哪些图层：原网格进哪几层阴影，合并网格就进哪几层 */
export function proxyLayers(mask: number): number {
  let out = 0;
  if (mask & (1 << 2) || mask === 1) out |= 1 << SHADOW_PROXY_NEAR;
  if (mask & 0b11) out |= 1 << SHADOW_PROXY_FAR;
  return out;
}

function mergePositions(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const m of meshes) {
    const n = m.geometry.getAttribute('position').count;
    verts += n;
    idx += m.geometry.index ? m.geometry.index.count : n;
  }
  const pos = new Float32Array(verts * 3);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let v = 0;
  let k = 0;
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      pos[(v + i) * 3] = p.getX(i);
      pos[(v + i) * 3 + 1] = p.getY(i);
      pos[(v + i) * 3 + 2] = p.getZ(i);
    }
    const src = m.geometry.index;
    if (src) for (let i = 0; i < src.count; i++) index[k++] = v + src.getX(i);
    else for (let i = 0; i < p.count; i++) index[k++] = v + i;
    v += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export interface ShadowProxies {
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/**
 * 在 root 下找“一组单位变换的子网格”，把同一组里能合的（正反面、阴影面、图层都一样）合成只投影的网格。
 * 返回新建的网格和资源（调用方负责释放）。一组里只有一个能合的就不动。
 */
export function mergeShadowCasters(root: THREE.Object3D): ShadowProxies {
  const out: ShadowProxies = { meshes: [], geometries: [], materials: [] };
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && o.children.length > 1) groups.push(o);
  });
  const mats = new Map<string, THREE.Material>();
  for (const group of groups) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of group.children) {
      if (!mergeable(c)) continue;
      const mat = c.material as THREE.Material;
      const key = `${mat.side}:${mat.shadowSide}:${proxyLayers(c.layers.mask)}`;
      const list = buckets.get(key);
      if (list) list.push(c);
      else buckets.set(key, [c]);
    }
    for (const [key, list] of buckets) {
      if (list.length < 2) continue;
      const src = list[0].material as THREE.Material;
      let mat = mats.get(key);
      if (!mat) {
        // 只在阴影通道里画（那里材质换成只写深度的，只沿用正反面）；万一被别的相机看到也不写颜色和深度
        mat = new THREE.MeshBasicMaterial({ side: src.side, colorWrite: false, depthWrite: false });
        mat.shadowSide = src.shadowSide;
        mat.name = 'shadow_proxy';
        mats.set(key, mat);
        out.materials.push(mat);
      }
      const geo = mergePositions(list);
      const proxy = new THREE.Mesh(geo, mat);
      proxy.name = `${group.name || group.type}_shadow`;
      proxy.castShadow = true;
      proxy.receiveShadow = false;
      proxy.layers.mask = proxyLayers(list[0].layers.mask);
      group.add(proxy);
      for (const m of list) m.castShadow = false;
      out.meshes.push(proxy);
      out.geometries.push(geo);
    }
  }
  return out;
}
