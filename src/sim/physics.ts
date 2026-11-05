// Rapier 物理世界封装：地形高度场、静态障碍物、直升机复合刚体、射线查询、接触事件。
// 直升机的位置、速度、姿态只由这里的 Rapier 刚体积分产生（唯一运动状态来源）。

import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { HELI } from '../config/flight';
import type { Heightfield } from './terrain';
import type { BodyState } from './flight';

export type SurfaceKind = 'terrain' | 'water' | 'structure' | 'tree' | 'rock' | 'pad' | 'boundary';
export type HeliPart = 'cabin' | 'boom' | 'skid' | 'rotor' | 'tailRotor';

export interface ColliderTag {
  kind: SurfaceKind;
  id?: string;
  padId?: string;
}

export interface ContactReport {
  part: HeliPart;
  tag: ColliderTag;
  /** 本步法向冲量（N·s） */
  impulse: number;
  /** 冲量折算的速度变化（m/s） */
  dv: number;
  /** 碰撞开始事件（无冲量信息） */
  started: boolean;
  /** 冲量方向（世界坐标，指向直升机受力方向） */
  dir: Vector3;
}

export interface RayHit {
  distance: number;
  tag: ColliderTag;
  normal: Vector3;
}

let initPromise: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ALONG_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly tags = new Map<number, ColliderTag>();
  readonly parts = new Map<number, HeliPart>();
  heli!: RAPIER.RigidBody;
  readonly dt: number;
  private disposed = false;
  private noTreePredicate: (c: RAPIER.Collider) => boolean;
  private allPredicate: (c: RAPIER.Collider) => boolean;
  mass = HELI.massBase;

  constructor(dt = 1 / 60) {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('物理步长必须是正数');
    this.dt = dt;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      this.world.timestep = dt;
      this.events = new RAPIER.EventQueue(true);
    } catch (error) {
      this.world.free();
      throw error;
    }
    this.noTreePredicate = (c) => {
      const t = this.tags.get(c.handle);
      return !!t && t.kind !== 'tree' && t.kind !== 'boundary';
    };
    this.allPredicate = (c) => {
      const t = this.tags.get(c.handle);
      return !!t && t.kind !== 'boundary';
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.events.free();
    } finally {
      try {
        this.world.free();
      } finally {
        this.tags.clear();
        this.parts.clear();
      }
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('物理世界已释放');
  }

  // ---------------- 静态世界 ----------------

  addTerrain(hf: Heightfield): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.heightfield(hf.res - 1, hf.res - 1, hf.toRapierHeights(), { x: hf.size, y: 1, z: hf.size })
      .setFriction(0.9)
      .setRestitution(0.02);
    return this.addCollider(desc, { kind: 'terrain' });
  }

  addWater(level: number, half: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half, 2, half).setTranslation(0, level - 2, 0).setFriction(0.3).setRestitution(0);
    return this.addCollider(desc, { kind: 'water' });
  }

  /** 地图边界：看不见的墙（碰到不扣耐久）。 */
  addBoundary(half: number, top: number): void {
    const t = 20;
    const h = top / 2 + 200;
    const y = top / 2 - 100;
    const walls: Array<[number, number, number, number]> = [
      [0, -half - t, half + t, t],
      [0, half + t, half + t, t],
      [-half - t, 0, t, half + t],
      [half + t, 0, t, half + t],
    ];
    for (const [x, z, hx, hz] of walls) {
      this.addCollider(RAPIER.ColliderDesc.cuboid(hx, h, hz).setTranslation(x, y, z).setFriction(0.2), { kind: 'boundary' });
    }
  }

  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY: number, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(yRot(rotY)).setFriction(0.8).setRestitution(0.05);
    return this.addCollider(desc, tag);
  }

  /** 任意朝向的长方体（用于岩拱等倾斜构件）。 */
  addBoxQ(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, q: { x: number; y: number; z: number; w: number }, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(q).setFriction(0.8).setRestitution(0.05);
    return this.addCollider(desc, tag);
  }

  addCylinder(cx: number, cy: number, cz: number, halfHeight: number, radius: number, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(cx, cy, cz).setFriction(0.8).setRestitution(0.05);
    return this.addCollider(desc, tag);
  }

  addBall(cx: number, cy: number, cz: number, radius: number, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.ball(radius).setTranslation(cx, cy, cz).setFriction(0.7).setRestitution(0.05);
    return this.addCollider(desc, tag);
  }

  addCapsule(cx: number, cy: number, cz: number, halfHeight: number, radius: number, tag: ColliderTag): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(cx, cy, cz).setFriction(0.7).setRestitution(0.05);
    return this.addCollider(desc, tag);
  }

  removeCollider(c: RAPIER.Collider): void {
    if (this.disposed) return;
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  private addCollider(desc: RAPIER.ColliderDesc, tag: ColliderTag, parent?: RAPIER.RigidBody): RAPIER.Collider {
    this.assertActive();
    const c = this.world.createCollider(desc, parent);
    this.tags.set(c.handle, tag);
    return c;
  }

  // ---------------- 直升机 ----------------

  createHeli(pos: Vector3, quat: Quaternion, mass: number): RAPIER.RigidBody {
    this.assertActive();
    const H = HELI;
    this.mass = mass;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setLinearDamping(0)
      .setAngularDamping(0)
      .setAdditionalMassProperties(mass, { x: 0, y: 0, z: 0 }, inertiaFor(mass), IDENTITY);
    const body = this.world.createRigidBody(desc);
    this.heli = body;
    const C = H.colliders;
    const ev = RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    const part = (d: RAPIER.ColliderDesc, p: HeliPart, friction: number) => {
      d.setDensity(0).setFriction(friction).setRestitution(0.05).setActiveEvents(ev).setContactForceEventThreshold(400);
      const c = this.world.createCollider(d, body);
      this.parts.set(c.handle, p);
      return c;
    };
    part(RAPIER.ColliderDesc.capsule(C.cabin.halfLength, C.cabin.radius).setTranslation(0, C.cabin.offsetY, C.cabin.offsetZ).setRotation(ALONG_Z), 'cabin', 0.45);
    part(RAPIER.ColliderDesc.capsule(C.boom.halfLength, C.boom.radius).setTranslation(0, C.boom.offsetY, C.boom.offsetZ).setRotation(ALONG_Z), 'boom', 0.45);
    part(RAPIER.ColliderDesc.ball(C.tailRotorRadius).setTranslation(-0.3, C.tailRotorY, C.tailRotorZ), 'tailRotor', 0.3);
    part(RAPIER.ColliderDesc.cylinder(C.rotorHalfHeight, H.rotorRadius).setTranslation(0, H.hubHeight, 0), 'rotor', 0.2);
    const S = H.skid;
    const skidHalf = (S.rear - S.front) / 2;
    const skidY = S.attachY - S.restLength + S.travel * 0.9 + 0.07;
    for (const sx of [-S.halfSpan, S.halfSpan]) {
      part(RAPIER.ColliderDesc.capsule(skidHalf, 0.07).setTranslation(sx, skidY, (S.rear + S.front) / 2).setRotation(ALONG_Z), 'skid', S.friction);
    }
    return body;
  }

  setHeliMass(mass: number): void {
    this.assertActive();
    this.mass = mass;
    this.heli.setAdditionalMassProperties(mass, { x: 0, y: 0, z: 0 }, inertiaFor(mass), IDENTITY, true);
  }

  readBody(out: BodyState): BodyState {
    this.assertActive();
    const t = this.heli.translation();
    const r = this.heli.rotation();
    const v = this.heli.linvel();
    const w = this.heli.angvel();
    out.pos.set(t.x, t.y, t.z);
    out.quat.set(r.x, r.y, r.z, r.w);
    out.vel.set(v.x, v.y, v.z);
    out.angVel.set(w.x, w.y, w.z);
    return out;
  }

  writeBody(s: BodyState): void {
    this.assertActive();
    const b = this.heli;
    b.setTranslation({ x: s.pos.x, y: s.pos.y, z: s.pos.z }, true);
    b.setRotation({ x: s.quat.x, y: s.quat.y, z: s.quat.z, w: s.quat.w }, true);
    b.setLinvel({ x: s.vel.x, y: s.vel.y, z: s.vel.z }, true);
    b.setAngvel({ x: s.angVel.x, y: s.angVel.y, z: s.angVel.z }, true);
    b.resetForces(true);
    b.resetTorques(true);
  }

  /** 施加本步外力并推进一步，返回接触报告。 */
  step(force: Vector3, torque: Vector3, pointForces: Array<{ f: Vector3; p: Vector3 }>, out: ContactReport[]): void {
    out.length = 0;
    if (this.disposed) return;
    const b = this.heli;
    b.resetForces(true);
    b.resetTorques(true);
    b.addForce({ x: force.x, y: force.y, z: force.z }, true);
    b.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);
    for (const pf of pointForces) b.addForceAtPoint({ x: pf.f.x, y: pf.f.y, z: pf.f.z }, { x: pf.p.x, y: pf.p.y, z: pf.p.z }, true);
    this.world.step(this.events);
    const dt = this.dt;
    this.events.drainContactForceEvents((e) => {
      const h1 = e.collider1();
      const h2 = e.collider2();
      const p1 = this.parts.get(h1);
      const p2 = this.parts.get(h2);
      const part = p1 ?? p2;
      const other = p1 !== undefined ? h2 : h1;
      if (part === undefined) return;
      const tag = this.tags.get(other);
      if (!tag) return;
      const impulse = e.totalForceMagnitude() * dt;
      const d = e.maxForceDirection();
      // Rapier 给出的方向是作用在 collider1 上的力方向
      const dir = new Vector3(d.x, d.y, d.z);
      if (p1 === undefined) dir.negate();
      out.push({ part, tag, impulse, dv: impulse / this.mass, started: false, dir });
    });
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const p1 = this.parts.get(h1);
      const p2 = this.parts.get(h2);
      const part = p1 ?? p2;
      if (part === undefined) return;
      const tag = this.tags.get(p1 !== undefined ? h2 : h1);
      if (!tag) return;
      out.push({ part, tag, impulse: 0, dv: 0, started: true, dir: new Vector3() });
    });
  }

  // ---------------- 查询 ----------------

  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  castRay(origin: Vector3, dir: Vector3, maxDist: number, includeTrees: boolean): RayHit | null {
    if (this.disposed) return null;
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      this.heli,
      includeTrees ? this.allPredicate : this.noTreePredicate,
    );
    if (!hit) return null;
    const tag = this.tags.get(hit.collider.handle);
    if (!tag) return null;
    return { distance: hit.timeOfImpact, tag, normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  castDown(origin: Vector3, maxDist: number, includeTrees: boolean): RayHit | null {
    return this.castRay(origin, DOWN, maxDist, includeTrees);
  }
}

const DOWN = new Vector3(0, -1, 0);

function yRot(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

function inertiaFor(mass: number) {
  const k = 1 + 0.6 * (mass / HELI.massBase - 1);
  return { x: HELI.inertia.pitch * k, y: HELI.inertia.yaw * k, z: HELI.inertia.roll * k };
}
