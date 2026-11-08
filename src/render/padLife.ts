// 停机坪上的货：卸一次货，坪边上堆一批木箱。只有画面，不碰物理，一张图所有的货箱一次实例绘制。
// 以前每块坪还站着一个地勤；2026-11-08 用户要求人物模型先全部撤下（“这个我之后再想办法”），这里只剩货箱。
// 货箱是 tools/blender/crate.py 建的 models/crate.glb（钉木条的箱子：托盘、横板、护角、盖子，颜色在顶点色里），
// 加载完之前先用下面的简单几何体顶着。

import * as THREE from 'three/webgpu';
import type { MapDef } from '../maps/types';
import { padWorld } from '../maps/padLayout';
import type { GameSession } from '../sim/session';
import { markNearShadow } from './sunShadows';
import { loadGltf } from './gltf';

function paint(g: THREE.BufferGeometry, c: number[]): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    const ix = g.index;
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number[]): THREE.BufferGeometry => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);

/** 模型没到之前的简单货箱 */
function crateGeometry(): THREE.BufferGeometry {
  const wood = [0.42, 0.29, 0.16];
  const dark = [0.26, 0.17, 0.09];
  return merge([
    box(1.1, 0.12, 1.1, 0, 0.06, 0, dark),
    box(1, 0.86, 1, 0, 0.55, 0, wood),
    box(1.02, 0.08, 1.02, 0, 0.3, 0, dark),
    box(1.02, 0.08, 1.02, 0, 0.8, 0, dark),
  ]);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _y = new THREE.Vector3(0, 1, 0);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export class PadLife {
  readonly group = new THREE.Group();
  private readonly pads: MapDef['pads'];
  private readonly crates: THREE.InstancedMesh;
  private readonly mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  private geo: THREE.BufferGeometry;
  /** 货箱多高：第三个箱子摞在前两个上面 */
  private crateH = 0.94;
  private disposed = false;
  /** 哪些坪上堆着货（坪的编号 → 第几批） */
  private stock = '';

  constructor(map: MapDef) {
    this.pads = map.pads;
    const n = Math.max(1, map.pads.length);
    this.geo = crateGeometry();
    this.crates = new THREE.InstancedMesh(this.geo, this.mat, n * 4);
    this.crates.frustumCulled = false;
    this.crates.castShadow = true;
    this.crates.receiveShadow = true;
    this.group.add(this.crates);
    for (let i = 0; i < n * 4; i++) this.crates.setMatrixAt(i, HIDE);
    this.crates.count = 0;
    this.group.name = 'Pad cargo';
    markNearShadow(this.group);
    void this.load();
  }

  /** 换成 Blender 建的货箱。失败了就继续用简单几何体，不影响别的 */
  private async load(): Promise<void> {
    try {
      const gltf = await loadGltf('models/crate.glb');
      const o = gltf.scene.getObjectByName('crate') as THREE.Mesh | undefined;
      // glb 里的材质不用：货箱用 this.mat（顶点色）
      gltf.scene.traverse((x) => ((x as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.());
      if (!o?.isMesh || this.disposed) {
        o?.geometry?.dispose();
        return;
      }
      this.geo.dispose();
      this.geo = o.geometry;
      this.crates.geometry = this.geo;
      this.geo.computeBoundingBox();
      this.crateH = this.geo.boundingBox!.max.y;
      if (this.stock) this.stack();
    } catch (e) {
      console.warn('货箱模型加载失败，用简单几何体代替：', e);
    }
  }

  /** 这块坪上堆一批货：卸一次堆一批 */
  private stack(): void {
    let i = 0;
    const done = this.stock ? this.stock.split(',') : [];
    for (const id of done) {
      const pad = this.pads.find((p) => p.id === id);
      if (!pad || i + 3 > this.crates.instanceMatrix.count) continue;
      const e = pad.size * 0.42;
      for (const [dx, dy, dz, r] of [[0, 0, 0, 0.1], [1.2, 0, 0.1, -0.08], [0.55, this.crateH, 0.04, 0.3]]) {
        const [x, y, z] = padWorld(pad, -e + dx, 0.02 + dy, e - 0.8 + dz);
        _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, (pad.rotY ?? 0) + r), _s.set(1, 1, 1));
        this.crates.setMatrixAt(i++, _m);
      }
    }
    this.crates.count = i;
    this.crates.instanceMatrix.needsUpdate = true;
  }

  update(s: GameSession | null, _t: number, _dt: number): void {
    if (!s) return;
    const done = [...s.mission.main, ...s.mission.optional]
      .filter((o) => o.status === 'done' && o.def.kind === 'land' && o.def.cargo === 'unload')
      .map((o) => (o.def as { padId: string }).padId)
      .join(',');
    if (done !== this.stock) {
      this.stock = done;
      this.stack();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.crates.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
