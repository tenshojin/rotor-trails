// 停机坪上的人和货：每块坪有一个地勤，你朝他飞过来他举手引导，旋翼的风打过来他弯下腰；送到的物资堆在坪边上。
// 一张图十几块坪：身体、两条手臂、货箱各一次实例绘制。只有画面，不碰物理。

import * as THREE from 'three/webgpu';
import type { MapDef, PadDef } from '../maps/types';
import { padWorld } from '../maps/padLayout';
import type { GameSession } from '../sim/session';
import { markNearShadow } from './sunShadows';

/** 肩膀离脚多高、左右多宽（米） */
const SHOULDER = 1.42;
const SHOULDER_W = 0.21;

const VEST = [0.95, 0.44, 0.06];
const STRIPE = [0.86, 0.86, 0.78];
const TROUSERS = [0.06, 0.07, 0.1];
const SKIN = [0.62, 0.43, 0.32];
const HELMET = [0.82, 0.82, 0.78];
const BOOT = [0.05, 0.045, 0.04];

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
  for (const part of parts) {
    const g = part.index ? part : part;
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
const cap = (r: number, l: number, x: number, y: number, z: number, c: number[]): THREE.BufferGeometry => paint(new THREE.CapsuleGeometry(r, l, 3, 8).translate(x, y, z), c);

/** 脚在原点，脸朝 -z */
function bodyGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.13, 0.08, 0.27, -0.1, 0.04, -0.035, BOOT),
    box(0.13, 0.08, 0.27, 0.1, 0.04, -0.035, BOOT),
    cap(0.082, 0.66, -0.1, 0.46, 0, TROUSERS),
    cap(0.082, 0.66, 0.1, 0.46, 0, TROUSERS),
    box(0.33, 0.14, 0.19, 0, 0.9, 0, TROUSERS),
    cap(0.165, 0.34, 0, 1.17, 0, VEST),
    box(0.345, 0.05, 0.3, 0, 1.1, 0, STRIPE),
    box(0.345, 0.05, 0.3, 0, 1.28, 0, STRIPE),
    paint(new THREE.SphereGeometry(0.105, 10, 8).translate(0, 1.6, 0), SKIN),
    paint(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.62, 0), HELMET),
    box(0.24, 0.014, 0.1, 0, 1.635, -0.1, HELMET),
    // 耳罩：停机坪上吵
    box(0.26, 0.09, 0.06, 0, 1.59, 0, TROUSERS),
  ]);
}

/** 肩膀在原点，手臂朝下；手里拿着引导棒 */
function armGeometry(): THREE.BufferGeometry {
  return merge([
    cap(0.055, 0.56, 0, -0.33, 0, VEST),
    box(0.08, 0.05, 0.1, 0, -0.14, 0, STRIPE),
    paint(new THREE.SphereGeometry(0.052, 8, 6).translate(0, -0.66, 0), SKIN),
    paint(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6).translate(0, -0.88, 0), [1, 0.34, 0.05]),
  ]);
}

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

interface Crew {
  pad: PadDef;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 手举得多高 0..1、弯腰的程度 0..1 */
  wave: number;
  duck: number;
  phase: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _o = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function damp(a: number, b: number, k: number, dt: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}

export class PadLife {
  readonly group = new THREE.Group();
  private readonly crew: Crew[] = [];
  private readonly body: THREE.InstancedMesh;
  private readonly armL: THREE.InstancedMesh;
  private readonly armR: THREE.InstancedMesh;
  private readonly crates: THREE.InstancedMesh;
  private readonly mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  private readonly geos: THREE.BufferGeometry[];
  /** 哪些坪上堆着货（坪的编号 → 第几批） */
  private stock = '';

  constructor(map: MapDef) {
    for (const pad of map.pads) {
      // 站在坪的一角：旋翼打不到，降落时看得见
      const e = pad.size * 0.44;
      const [x, y, z] = padWorld(pad, e, 0.02, -e);
      this.crew.push({ pad, x, y, z, yaw: 0, wave: 0, duck: 0, phase: x * 0.37 });
    }
    const n = Math.max(1, this.crew.length);
    this.geos = [bodyGeometry(), armGeometry(), crateGeometry()];
    this.body = new THREE.InstancedMesh(this.geos[0], this.mat, n);
    this.armL = new THREE.InstancedMesh(this.geos[1], this.mat, n);
    this.armR = new THREE.InstancedMesh(this.geos[1], this.mat, n);
    this.crates = new THREE.InstancedMesh(this.geos[2], this.mat, n * 4);
    for (const m of [this.body, this.armL, this.armR, this.crates]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    for (let i = 0; i < n * 4; i++) this.crates.setMatrixAt(i, HIDE);
    this.crates.count = 0;
    this.group.name = 'Pad crew';
    markNearShadow(this.group);
  }

  /** 这块坪上堆一批货：卸一次堆一批 */
  private stack(): void {
    let i = 0;
    const done = this.stock ? this.stock.split(',') : [];
    for (const id of done) {
      const pad = this.crew.find((c) => c.pad.id === id)?.pad;
      if (!pad || i + 3 > this.crates.instanceMatrix.count) continue;
      const e = pad.size * 0.42;
      for (const [dx, dy, dz, r] of [[0, 0, 0, 0.1], [1.2, 0, 0.1, -0.08], [0.55, 0.94, 0.04, 0.3]]) {
        const [x, y, z] = padWorld(pad, -e + dx, 0.02 + dy, e - 0.8 + dz);
        _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, (pad.rotY ?? 0) + r), _s.set(1, 1, 1));
        this.crates.setMatrixAt(i++, _m);
      }
    }
    this.crates.count = i;
    this.crates.instanceMatrix.needsUpdate = true;
  }

  update(s: GameSession | null, t: number, dt: number): void {
    const target = s?.mission.current()?.def;
    const aim = target?.kind === 'land' ? target.padId : null;
    const hx = s?.body.pos.x ?? 1e9;
    const hy = s?.body.pos.y ?? 1e9;
    const hz = s?.body.pos.z ?? 1e9;
    if (s) {
      const done = [...s.mission.main, ...s.mission.optional]
        .filter((o) => o.status === 'done' && o.def.kind === 'land' && o.def.cargo === 'unload')
        .map((o) => (o.def as { padId: string }).padId)
        .join(',');
      if (done !== this.stock) {
        this.stock = done;
        this.stack();
      }
    }
    this.crew.forEach((c, i) => {
      const dx = hx - c.x;
      const dz = hz - c.z;
      const d = Math.hypot(dx, dz);
      const low = hy - c.y;
      // 看着飞机。太远了就看着坪中间
      const look = d < 500 ? Math.atan2(-dx, -dz) : Math.atan2(c.x - c.pad.pos[0], c.z - c.pad.pos[2]);
      let turn = look - c.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      c.yaw += turn * (1 - Math.exp(-2.2 * dt));
      c.wave = damp(c.wave, c.pad.id === aim && d < 320 && low > 3 ? 1 : 0, 3, dt);
      // 飞机压过来，风打在身上：弯腰、背过一点
      const wash = d < 34 && low < 24 && low > 0.5 ? 1 - d / 34 : 0;
      c.duck = damp(c.duck, Math.min(1, wash * 1.6), 3, dt);
      const lean = c.duck * 0.42;
      _q.setFromAxisAngle(_y, c.yaw).multiply(_qa.setFromAxisAngle(_x, -lean));
      const crouch = 1 - c.duck * 0.1;
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, crouch, 1));
      this.body.setMatrixAt(i, _m);
      // 肩膀：先转到身体的朝向，再绕肩膀抬手。两只手一起在头顶上摆
      const beat = Math.sin(t * 4.2 + c.phase) * 0.32;
      const up = c.wave * (2.7 + beat);
      const down = (1 - c.wave) * (0.05 + 0.03 * Math.sin(t * 0.9 + c.phase));
      for (const [mesh, side] of [[this.armL, -1], [this.armR, 1]] as const) {
        _o.set(side * SHOULDER_W, SHOULDER * crouch, 0).applyQuaternion(_q);
        _qa.setFromAxisAngle(_z, side * (up + down));
        _m.compose(_p.set(c.x + _o.x, c.y + _o.y, c.z + _o.z), _qa.premultiply(_q), _s.set(1, 1, 1));
        mesh.setMatrixAt(i, _m);
      }
    });
    for (const m of [this.body, this.armL, this.armR]) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.body, this.armL, this.armR, this.crates]) m.dispose();
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}
