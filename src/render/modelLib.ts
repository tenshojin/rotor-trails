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
 * （地图上的静态建筑现在用下面的 PropBatches 合批；这个按模型分开的版本留着备用）
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

interface BatchPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** 子网格相对模型根节点的变换 */
  local: THREE.Matrix4;
  name: string;
}

function partsOf(template: THREE.Object3D): BatchPart[] {
  const out: BatchPart[] = [];
  const rootInv = template.matrixWorld.clone().invert();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    out.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material, local: rootInv.clone().multiply(mesh.matrixWorld), name: mesh.name });
  });
  return out;
}

/** 几何体的顶点属性格式：放进同一个 BatchedMesh 的几何体必须完全一样 */
function attributeSignature(g: THREE.BufferGeometry): string {
  const keys = Object.keys(g.attributes).sort();
  return keys.map((k) => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized ? 1 : 0}`).join(',') + (g.index ? '|i' : '|n');
}

/**
 * 静态模型（建筑、道具）合批：同一种材质、同样投不投影、同样进不进最近两层阴影的子网格，不管属于哪个模型，
 * 都放进一个 BatchedMesh，一次提交。
 * 以前每个模型的每个子网格一个实例化网格，日本港口一屏两百多个；three.js 每提交一个物体都有十几微秒的固定开销，
 * 光这些每帧就要四五毫秒（主线程是瓶颈，显卡只用了一半）。合批以后几十个。
 * 三级细节模型（name、name@1、name@2）按到相机的距离切换，每个实例只有一级可见（带 10% 滞后）；
 * 投影规则和以前一样：近景只让大部件投影，中景墙体屋面投影，远景不投影；中景、远景只进外面两层阴影（图层 1）。
 * 不做逐个实例的视锥剔除：以前每个实例化网格的包围球也盖着整张图上的同类实例，本来就剔不掉；
 * 在 JS 里逐个算包围球反倒比画出来还贵。可见集合只在细节级别变化时重排一次。
 */
export class PropBatches {
  readonly meshes: THREE.BatchedMesh[] = [];
  /** 每个模型实例、每一级细节：[批次, 实例号] */
  private slots: Array<Array<Array<[THREE.BatchedMesh, number]>>> = [];
  private centers: THREE.Vector3[] = [];
  private levels: number[] = [];
  private cur: Int8Array;

  /** dist：[近景→中景, 中景→远景] 的切换距离（米），乘以画质系数 */
  constructor(templates: Map<string, THREE.Object3D>, byName: Map<string, ModelInstance[]>, private dist: [number, number]) {
    type Place = { geo: THREE.BufferGeometry; m: THREE.Matrix4; inst: number; level: number };
    const groups = new Map<string, { mat: THREE.Material; cast: boolean; far: boolean; places: Place[] }>();
    const add = (p: BatchPart, cast: boolean, far: boolean, base: THREE.Matrix4, inst: number, level: number) => {
      const key = `${p.mat.id}|${attributeSignature(p.geo)}|${cast ? 1 : 0}|${far ? 1 : 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { mat: p.mat, cast, far, places: [] }));
      g.places.push({ geo: p.geo, m: new THREE.Matrix4().multiplyMatrices(base, p.local), inst, level });
    };
    for (const [name, list] of byName) {
      const lod = templates.has(`${name}@1`) && templates.has(`${name}@2`);
      const tpl = (lod ? [name, `${name}@1`, `${name}@2`] : [name]).map((n) => partsOf(templates.get(n)!));
      for (const inst of list) {
        const idx = this.centers.length;
        _p.set(inst.pos[0], inst.pos[1], inst.pos[2]);
        _q.setFromAxisAngle(_up, inst.rotY);
        _s.set(inst.scale[0], inst.scale[1], inst.scale[2]);
        const base = new THREE.Matrix4().compose(_p, _q, _s);
        this.centers.push(new THREE.Vector3(inst.pos[0], inst.pos[1] + 3 * inst.scale[1], inst.pos[2]));
        this.levels.push(tpl.length);
        this.slots.push(tpl.map(() => []));
        tpl.forEach((parts, level) => {
          for (const p of parts) {
            // 没有细节分级的模型：全部投影、进全部四层阴影（和以前一样）
            const cast = !lod || (level === 0 ? LOD0_SHADOW.test(p.name) : level === 1 && LOD1_SHADOW.test(p.name));
            add(p, cast, level > 0, base, idx, level);
          }
        });
      }
    }
    for (const g of groups.values()) {
      // 同一几何体的实例排在一起：绘制时连着的同一几何体合成一次实例化绘制
      const geos = [...new Set(g.places.map((p) => p.geo))];
      const order = new Map(geos.map((x, i) => [x, i]));
      g.places.sort((a, b) => order.get(a.geo)! - order.get(b.geo)!);
      let nv = 0;
      let ni = 0;
      for (const x of geos) {
        nv += x.attributes.position.count;
        ni += x.index ? x.index.count : 0;
      }
      const bm = new THREE.BatchedMesh(g.places.length, nv, ni, g.mat);
      const ids = geos.map((x) => bm.addGeometry(x));
      for (const p of g.places) {
        const id = bm.addInstance(ids[order.get(p.geo)!]);
        bm.setMatrixAt(id, p.m);
        bm.setVisibleAt(id, false);
        this.slots[p.inst][p.level].push([bm, id]);
      }
      bm.perObjectFrustumCulled = false;
      bm.sortObjects = false;
      bm.castShadow = g.cast;
      bm.receiveShadow = true;
      // 中景、远景的实例都在 110 m 以外，不可能落进最近两层阴影：放到图层 1（见 sunShadows.ts）
      if (g.far) bm.layers.set(1);
      bm.computeBoundingSphere();
      bm.name = `${g.mat.name}${g.cast ? '' : ' (no shadow)'}${g.far ? ' (far)' : ''}`;
      this.meshes.push(bm);
    }
    this.cur = new Int8Array(this.centers.length).fill(-1);
    // 没有细节分级的模型一直可见
    for (let i = 0; i < this.centers.length; i++) {
      if (this.levels[i] !== 1) continue;
      for (const [bm, id] of this.slots[i][0]) bm.setVisibleAt(id, true);
      this.cur[i] = 0;
    }
  }

  /** 每帧调用：k = 画质系数（越高越晚切到低一级）。 */
  update(cam: THREE.Vector3, k = 1): void {
    const d0 = this.dist[0] * k;
    const d1 = this.dist[1] * k;
    for (let i = 0; i < this.centers.length; i++) {
      if (this.levels[i] === 1) continue;
      const d = this.centers[i].distanceTo(cam);
      let want = d < d0 ? 0 : d < d1 ? 1 : 2;
      const c = this.cur[i];
      // 滞后：离阈值 10% 以内保持原级，避免在边界来回切换
      if (c >= 0 && want !== c) {
        const edge = want > c ? (c === 0 ? d0 : d1) : want === 0 ? d0 : d1;
        if (Math.abs(d - edge) < edge * 0.1) want = c;
      }
      if (want === c) continue;
      if (c >= 0) for (const [bm, id] of this.slots[i][c]) bm.setVisibleAt(id, false);
      for (const [bm, id] of this.slots[i][want]) bm.setVisibleAt(id, true);
      this.cur[i] = want;
    }
  }

  /** 当前各级细节的实例数（测试、调试用） */
  levelCounts(): number[] {
    const n = [0, 0, 0];
    for (const c of this.cur) if (c >= 0) n[c]++;
    return n;
  }

  dispose(): void {
    for (const bm of this.meshes) bm.dispose();
    this.meshes.length = 0;
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
