// 每张地图的建筑模型库（Blender 导出的 models/props_<地图>.glb，见 tools/blender/props_*.py）：
// 根节点名 = 模型名，子网格按材质合并。渲染时按模型实例（来自 PropBuilder.beginModel）做实例化绘制。
// 文件不存在或加载失败时返回 null，道具退回程序几何体。

import * as THREE from 'three';
import { loadGltf } from './gltf';
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
    const gltf = await loadGltf(`models/${file}`);
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

/**
 * 三级细节模型（模型库里同时有 name、name@1、name@2，例如日本民居）：按到相机的距离把每个实例分到一级，
 * 每级每个子网格一个实例化网格。距离跨过阈值（带 10% 滞后）时才重写实例矩阵。
 * 包围球按全部实例一次算好（是各级实际可见集合的超集），视锥剔除仍然有效。
 */
export class LodModel {
  readonly meshes: THREE.InstancedMesh[] = [];
  private levels: Array<Array<{ im: THREE.InstancedMesh; local: THREE.Matrix4 }>> = [];
  private bases: THREE.Matrix4[] = [];
  private centers: THREE.Vector3[] = [];
  private cur: Int8Array;
  private readonly tmp = new THREE.Matrix4();

  /** dist：[近景→中景, 中景→远景] 的切换距离（米），乘以画质系数 */
  constructor(templates: THREE.Object3D[], list: ModelInstance[], private dist: [number, number]) {
    this.cur = new Int8Array(list.length).fill(-1);
    for (const inst of list) {
      _p.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      _q.setFromAxisAngle(_up, inst.rotY);
      _s.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      this.bases.push(new THREE.Matrix4().compose(_p, _q, _s));
      this.centers.push(new THREE.Vector3(inst.pos[0], inst.pos[1] + 3 * inst.scale[1], inst.pos[2]));
    }
    for (const template of templates) {
      const level: Array<{ im: THREE.InstancedMesh; local: THREE.Matrix4 }> = [];
      const rootInv = template.matrixWorld.clone().invert();
      template.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const local = rootInv.clone().multiply(mesh.matrixWorld);
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        this.bases.forEach((b, i) => im.setMatrixAt(i, this.tmp.multiplyMatrices(b, local)));
        im.computeBoundingSphere();
        im.count = 0;
        im.visible = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.name = mesh.name;
        level.push({ im, local });
        this.meshes.push(im);
      });
      this.levels.push(level);
    }
  }

  /** 每帧调用：k = 画质系数（越高越晚切到低一级）。 */
  update(cam: THREE.Vector3, k = 1): void {
    const d0 = this.dist[0] * k;
    const d1 = this.dist[1] * k;
    let changed = false;
    for (let i = 0; i < this.centers.length; i++) {
      const d = this.centers[i].distanceTo(cam);
      let want = d < d0 ? 0 : d < d1 ? 1 : 2;
      const c = this.cur[i];
      // 滞后：离阈值 10% 以内保持原级，避免在边界来回切换
      if (c >= 0 && want !== c) {
        const edge = want > c ? (c === 0 ? d0 : d1) : want === 0 ? d0 : d1;
        if (Math.abs(d - edge) < edge * 0.1) want = c;
      }
      if (want !== c) {
        this.cur[i] = want;
        changed = true;
      }
    }
    if (!changed) return;
    this.levels.forEach((level, li) => {
      for (const { im, local } of level) {
        let n = 0;
        for (let i = 0; i < this.cur.length; i++) {
          if (this.cur[i] !== li) continue;
          im.setMatrixAt(n++, this.tmp.multiplyMatrices(this.bases[i], local));
        }
        im.count = n;
        im.visible = n > 0;
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}

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
