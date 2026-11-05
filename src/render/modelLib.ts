// 每张地图的建筑模型库（Blender 导出的 models/props_<地图>.glb，见 tools/blender/props_*.py）：
// 根节点名 = 模型名，子网格按材质合并。渲染时按模型实例（来自 PropBuilder.beginModel）做实例化绘制。
// 文件不存在或加载失败时返回 null，道具退回程序几何体。

import * as THREE from 'three/webgpu';
import { attribute, materialColor, materialRoughness, step, uv, vec4 } from 'three/tsl';
import { wetColor, wetRough, windowGlow } from './wetness';
import { loadGltf } from './gltf';
import { disposeTextures } from './disposeTextures';
import type { ModelInstance } from '../world/propBuilder';

/** 已有建筑模型库的地图（其余地图仍用程序几何体） */
export const MODEL_FILES: Record<string, string> = {
  training: 'props_training.glb',
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

/** 从 GLTF 的标准材质复制到节点材质的属性 */
export const STD_KEYS = ['name', 'color', 'map', 'normalMap', 'normalScale', 'roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'aoMap', 'aoMapIntensity', 'emissive', 'emissiveMap', 'emissiveIntensity', 'transparent', 'opacity', 'alphaTest', 'alphaMap', 'side', 'vertexColors', 'depthWrite'];

export async function loadModelLib(file: string): Promise<ModelLib | null> {
  try {
    const gltf = await loadGltf(`models/${file}`);
    const templates = new Map<string, THREE.Object3D>();
    gltf.scene.updateMatrixWorld(true);
    // 合并的纯色部件（f_vc，见 tools/blender/bldkit.py）：颜色在顶点色里，粗糙度 / 金属度在第二套 UV 里
    let vc: THREE.MeshStandardNodeMaterial | null = null;
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m.material as THREE.Material).name !== 'f_vc') return;
      if (!vc) {
        vc = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
        vc.name = 'f_vc';
        vc.colorNode = wetColor(vec4(attribute('color', 'vec3'), 1.0));
        vc.roughnessNode = wetRough(uv(1).x);
        vc.metalnessNode = uv(1).y;
        // 纯色部件里又暗又光滑的就是窗玻璃
        const col = attribute<'vec3'>('color', 'vec3');
        vc.emissiveNode = windowGlow(step(uv(1).x, 0.14).mul(step(col.r.add(col.g).add(col.b), 0.42)));
      }
      (m.material as THREE.Material).dispose();
      m.material = vc;
    });
    // 贴图材质（瓦、灰泥、木板、石材……）换成节点材质，接上雨天的湿润效果（同名材质共用一份）
    const conv = new Map<THREE.Material, THREE.Material>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      if (!src.isMeshStandardMaterial || (src as unknown as { isNodeMaterial?: boolean }).isNodeMaterial) return;
      let dst = conv.get(src);
      if (!dst) {
        const nm = new THREE.MeshStandardNodeMaterial();
        for (const k of STD_KEYS) (nm as unknown as Record<string, unknown>)[k] = (src as unknown as Record<string, unknown>)[k];
        nm.colorNode = wetColor(materialColor as unknown as THREE.Node<'vec4'>);
        nm.roughnessNode = wetRough(materialRoughness as unknown as THREE.Node<'float'>);
        conv.set(src, nm);
        dst = nm;
      }
      m.material = dst;
    });
    for (const src of conv.keys()) src.dispose();
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
    let disposed = false;
    return {
      templates,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
        disposeTextures(texs);
        templates.clear();
      },
    };
  } catch (e) {
    console.warn(`建筑模型 ${file} 加载失败，使用程序几何体：`, e);
    return null;
  }
}

/**
 * 近景（LOD0）里会投影的子网格（按材质名）：屋顶、墙、柱梁、台基、杆身等大部件。
 * 玻璃、窗框、设备、碎石地面这类小部件的影子几乎看不见，却要在每层阴影里各画一遍，CPU 提交开销很大。
 */
const LOD0_SHADOW = /(j_kawara|ibushi|plaster|sugi|yakisugi|granite|cedar|concrete|f_vc)/;
/** 中景（LOD1）里投影的子网格：墙体与屋面体块 */
const LOD1_SHADOW = /(kawara_flat|plaster|sugi|yakisugi|concrete|f_vc)/;

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
        // 近景只让大部件投影；中景全部投影；远景不投影（几个像素大的影子看不出来，却要在每层阴影里各画一遍）
        const lvl = this.levels.length;
        im.castShadow = lvl === 0 ? LOD0_SHADOW.test(mesh.name) : lvl === 1 && LOD1_SHADOW.test(mesh.name);
        // 中景、远景的实例都在 110 m 以外，不可能落进最近两层阴影：放到图层 1（见 sunShadows.ts）
        if (lvl > 0) im.layers.set(1);
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
