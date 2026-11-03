// 每张地图的建筑模型库（Blender 导出的 models/props_<地图>.glb，见 tools/blender/props_*.py）：
// 根节点名 = 模型名，子网格按材质合并。渲染时按模型实例（来自 PropBuilder.beginModel）做实例化绘制。
// 文件不存在或加载失败时返回 null，道具退回程序几何体。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelInstance } from '../world/propBuilder';

/** 已有建筑模型库的地图（其余地图仍用程序几何体） */
export const MODEL_FILES: Record<string, string> = {
  japan: 'props_japan.glb',
  fjord: 'props_fjord.glb',
  himalaya: 'props_himalaya.glb',
  amazon: 'props_amazon.glb',
  canyon: 'props_canyon.glb',
};

export interface ModelLib {
  templates: Map<string, THREE.Object3D>;
  dispose(): void;
}

export async function loadModelLib(file: string): Promise<ModelLib | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(new URL(`models/${file}`, document.baseURI).href);
    const templates = new Map<string, THREE.Object3D>();
    gltf.scene.updateMatrixWorld(true);
    for (const child of gltf.scene.children) templates.set(child.name, child);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const texs = new Set<THREE.Texture>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      geos.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mats.add(mat);
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) texs.add(v as THREE.Texture);
      }
    });
    for (const t of texs) t.anisotropy = 8;
    return {
      templates,
      dispose() {
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
        for (const t of texs) t.dispose();
      },
    };
  } catch (e) {
    console.warn(`建筑模型 ${file} 加载失败，使用程序几何体：`, e);
    return null;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** 为一组同名模型实例生成实例化网格（每个子网格一份）。 */
export function instanceModel(template: THREE.Object3D, list: ModelInstance[]): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const rootInv = template.matrixWorld.clone().invert();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const local = rootInv.clone().multiply(mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((inst, i) => {
      _p.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      _q.setFromAxisAngle(_up, inst.rotY);
      _s.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      _m.compose(_p, _q, _s).multiply(local);
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = mesh.name;
    out.push(im);
  });
  return out;
}
