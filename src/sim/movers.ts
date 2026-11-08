// 会动的东西：港湾里走的船、路上跑的车、绕场飞的小飞机。
// 位置和朝向只由时间决定（同一个时刻算出来永远一样）：物理里的碰撞体（撞得上，会受伤）、画面上的模型、
// 船的尾浪都按它摆；存档、回到检查点都不用记它们在哪。
// 碰撞箱是模型自己的形状（tools/blender/collision_shapes.py 拼的几个盒子，见 world/modelShapes.ts）。

import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from 'three';
import { mulberry32 } from '../core/noise';
import type { MapDef, RoadCarsDef, TrafficDef, VesselDef } from '../maps/types';
import { MODEL_SHAPES, type ShapeBox } from '../world/modelShapes';

export type Point = [number, number];

/** 会动的东西都有的：模型名、碰撞箱、t 时刻的位置和朝向（模型自己的坐标系，和 glb 里一样） */
export interface Mover {
  readonly kind: 'vessel' | 'car' | 'plane';
  readonly model: string;
  readonly shapes: readonly ShapeBox[];
  pose(t: number, pos: Vector3, quat: Quaternion): void;
}

// ---------------- 船 ----------------

/**
 * 在开阔水面上找一个椭圆航线：绕一圈全是够深的水。找不到就返回 null。
 * ground：水底高度。圈子转着试，从大到小。
 */
export function findLoop(ground: (x: number, z: number) => number, water: number, half: number, seed: number): Point[] | null {
  const rng = mulberry32(seed);
  for (let i = 0; i < 400; i++) {
    const big = 1 - i / 500;
    const rx = (340 + 560 * rng()) * big;
    const rz = rx * (0.28 + 0.3 * rng());
    const rot = rng() * Math.PI;
    const cx = (rng() * 2 - 1) * (half - rx);
    const cz = (rng() * 2 - 1) * (half - rx);
    const pts: Point[] = [];
    let ok = true;
    for (let k = 0; k < 64 && ok; k++) {
      const a = (k / 64) * Math.PI * 2;
      const u = Math.cos(a) * rx;
      const v = Math.sin(a) * rz;
      const x = cx + u * Math.cos(rot) - v * Math.sin(rot);
      const z = cz + u * Math.sin(rot) + v * Math.cos(rot);
      // 离岸和岛都留点距离：往外再看一圈
      ok = Math.abs(x) < half && Math.abs(z) < half && ground(x, z) < water - 3 && ground(x + 60, z) < water - 1 && ground(x - 60, z) < water - 1 && ground(x, z + 60) < water - 1 && ground(x, z - 60) < water - 1;
      pts.push([x, z]);
    }
    if (ok) return pts;
  }
  return null;
}

/** 闭合航线：按走过的路程取点 */
export class Route {
  private readonly cum: number[] = [0];
  readonly len: number;

  constructor(readonly pts: Point[]) {
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.len = this.cum[pts.length];
  }

  at(s: number, out: Point): Point {
    s = ((s % this.len) + this.len) % this.len;
    let lo = 0;
    let hi = this.pts.length;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo];
    const b = this.pts[hi % this.pts.length];
    const k = (s - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    return out;
  }
}

const _p: Point = [0, 0];
const _n: Point = [0, 0];
const _e = new Euler();
const _hull = new Quaternion();
const _y = new Vector3(0, 1, 0);

export class VesselMover implements Mover {
  readonly kind = 'vessel' as const;
  readonly model: string;
  readonly shapes: readonly ShapeBox[];
  readonly route: Route;
  readonly len: number;
  readonly speed: number;
  /** 模型的船头朝哪边：-1 = -X，1 = +X */
  readonly bow: number;
  private readonly s0: number;
  private readonly bob: number;

  constructor(def: VesselDef, pts: Point[], readonly water: number, index: number) {
    this.model = def.model;
    this.shapes = MODEL_SHAPES[def.model] ?? [];
    this.route = new Route(pts);
    this.len = def.len;
    this.speed = def.speed;
    this.bow = def.bow ?? -1;
    this.s0 = this.route.len * ((index * 0.37) % 1);
    this.bob = index * 1.7;
  }

  /** t 时刻船中在航线上走到了哪（米） */
  s(t: number): number {
    return this.s0 + this.speed * t;
  }

  /** 航向（世界）：船头指向 (-sin, -cos)。取前后一段弦的方向，急弯上也是慢慢转过去的 */
  yaw(s: number): number {
    this.route.at(s + 14, _n);
    this.route.at(s - 8, _p);
    return Math.atan2(-(_n[0] - _p[0]), -(_n[1] - _p[1]));
  }

  pose(t: number, pos: Vector3, quat: Quaternion): void {
    const s = this.s(t);
    this.route.at(s, _p);
    pos.set(_p[0], this.water + 0.06 * Math.sin(t * 0.9 + this.bob), _p[1]);
    // 船身轻轻起伏；模型的长边沿 X，转到船头朝航向
    _e.set(0.006 * Math.sin(t * 0.7 + this.bob), this.yaw(s), 0.012 * Math.sin(t * 0.55 + this.bob * 1.3), 'YXZ');
    quat.setFromEuler(_e).multiply(_hull.setFromAxisAngle(_y, this.bow === 1 ? Math.PI / 2 : -Math.PI / 2));
  }
}

// ---------------- 路上的车 ----------------

const ROAD_SEGMENTS = 96;
/** 靠右走：离路中线多远（米） */
export const LANE = 1.7;

interface Road {
  pts: Vector3[];
  seg: number;
  len: number;
}

const _a = new Vector3();
const _b = new Vector3();

/** 一辆车：从路这头开到那头，停一会儿，掉头开回来；一个来回的时间是固定的，所以只看时间就知道它在哪 */
export class CarMover implements Mover {
  readonly kind = 'car' as const;
  readonly shapes: readonly ShapeBox[];
  /** 单程要开多久、到头歇多久、一个来回多久、t = 0 时在这个来回的第几秒 */
  private readonly leg: number;
  private readonly rest: number;
  private readonly period: number;
  private readonly c0: number;

  constructor(readonly model: string, private readonly road: Road, s0: number, dir0: 1 | -1, readonly speed: number, private readonly ground: (x: number, z: number) => number) {
    this.shapes = MODEL_SHAPES[model] ?? [];
    this.leg = Math.max(0.1, (road.len - 8) / speed);
    this.rest = 3 + 9 * ((road.len + speed * 13.7) % 1);
    this.period = 2 * (this.leg + this.rest);
    const s = Math.max(4, Math.min(road.len - 4, s0));
    this.c0 = dir0 > 0 ? (s - 4) / speed : this.leg + this.rest + (road.len - 4 - s) / speed;
  }

  /** t 时刻在路上的位置（米）和往哪边开（到头掉过头来就算反方向了） */
  state(t: number): { s: number; dir: 1 | -1 } {
    const P = this.period;
    const c = (((this.c0 + t) % P) + P) % P;
    const L = this.road.len;
    if (c < this.leg) return { s: 4 + this.speed * c, dir: 1 };
    if (c < this.leg + this.rest) return { s: L - 4, dir: -1 };
    if (c < 2 * this.leg + this.rest) return { s: L - 4 - this.speed * (c - this.leg - this.rest), dir: -1 };
    return { s: 4, dir: 1 };
  }

  private at(s: number, out: Vector3): Vector3 {
    const r = this.road;
    const f = Math.max(0, Math.min(ROAD_SEGMENTS - 0.001, s / r.seg));
    const i = Math.floor(f);
    return out.lerpVectors(r.pts[i], r.pts[i + 1], f - i);
  }

  pose(t: number, pos: Vector3, quat: Quaternion): void {
    const { s, dir } = this.state(t);
    this.at(s - 3 * dir, _a);
    this.at(s + 3 * dir, _b);
    const dx = _b.x - _a.x;
    const dz = _b.z - _a.z;
    const l = Math.hypot(dx, dz) || 1;
    // 靠右走：从上往下看，前进方向 (dx, dz) 的右手边是 (-dz, dx)
    const x = (_a.x + _b.x) / 2 - (dz / l) * LANE;
    const z = (_a.z + _b.z) / 2 + (dx / l) * LANE;
    const g = this.ground;
    const pitch = Math.atan2(g(x + (dx / l) * 2, z + (dz / l) * 2) - g(x - (dx / l) * 2, z - (dz / l) * 2), 4);
    pos.set(x, g(x, z), z);
    // （车头朝 +x）
    quat.setFromEuler(_e.set(0, Math.atan2(-dz, dx), pitch, 'YXZ'));
  }
}

/** 一条路上的几辆车 */
export function roadMovers(defs: readonly RoadCarsDef[], ground: (x: number, z: number) => number): CarMover[] {
  const out: CarMover[] = [];
  defs.forEach((def, d) => {
    const curve = new CatmullRomCurve3(def.pts.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
    const road: Road = { pts: curve.getSpacedPoints(ROAD_SEGMENTS), seg: curve.getLength() / ROAD_SEGMENTS, len: curve.getLength() };
    def.models.forEach((model, i) => {
      const spread = (i + 0.5) / def.models.length;
      out.push(new CarMover(model, road, road.len * ((spread + d * 0.37) % 1), i % 2 ? 1 : -1, def.speed * (0.85 + 0.3 * ((i * 0.618) % 1)), ground));
    });
  });
  return out;
}

// ---------------- 绕场飞的小飞机 ----------------

const AIR_SEGMENTS = 480;
/** 坡度最大 35 度（小飞机绕场不会压得更狠） */
const MAX_BANK = 0.61;

export class PlaneMover implements Mover {
  readonly kind = 'plane' as const;
  readonly model: string;
  readonly shapes: readonly ShapeBox[];
  readonly speed: number;
  private readonly pts: Vector3[];
  private readonly seg: number;

  constructor(def: TrafficDef) {
    this.model = def.model;
    this.shapes = MODEL_SHAPES[def.model] ?? [];
    this.speed = def.speed;
    const curve = new CatmullRomCurve3(def.route.map(([x, y, z]) => new Vector3(x, y, z)), true, 'centripetal');
    this.pts = curve.getSpacedPoints(AIR_SEGMENTS);
    this.seg = curve.getLength() / AIR_SEGMENTS;
  }

  /** 下雨下雪、起雾的时候不飞（也就撞不上） */
  static flies(w: { rain: number; snow: number; visibility: number }): boolean {
    return w.rain + w.snow < 0.3 && w.visibility > 2500;
  }

  private at(s: number, out: Vector3): Vector3 {
    const n = AIR_SEGMENTS;
    const f = (((s / this.seg) % n) + n) % n;
    const i = Math.floor(f);
    return out.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }

  private heading(s: number): number {
    this.at(s - 8, _a);
    this.at(s + 8, _b);
    return Math.atan2(-(_b.x - _a.x), -(_b.z - _a.z));
  }

  /** 这里转弯有多急就压多大的坡度：向心加速度 = v²·曲率 */
  private bank(s: number): number {
    const d = this.heading(s + 30) - this.heading(s - 30);
    const turn = Math.atan2(Math.sin(d), Math.cos(d)) / 60;
    return Math.max(-MAX_BANK, Math.min(MAX_BANK, Math.atan((this.speed * this.speed * turn) / 9.81)));
  }

  pose(t: number, pos: Vector3, quat: Quaternion): void {
    const s = this.speed * t;
    // 坡度是一点点压上去、一点点回来的：取刚飞过的一段的平均
    let roll = 0;
    for (let k = 0; k < 5; k++) roll += this.bank(s - k * 9);
    roll /= 5;
    this.at(s - 8, _a);
    this.at(s + 8, _b);
    const climb = Math.atan2(_b.y - _a.y, Math.hypot(_b.x - _a.x, _b.z - _a.z));
    this.at(s, pos);
    // 机头比航迹高一点（迎角）
    quat.setFromEuler(_e.set(climb + 0.05, this.heading(s), roll, 'YXZ'));
  }
}

/** 这张图上所有会动的东西。ground：水底和地面的高度（找航线用），road：路面高度 */
export function makeMovers(map: MapDef, ground: (x: number, z: number) => number, road: (x: number, z: number) => number): Mover[] {
  const out: Mover[] = [];
  const water = map.waterLevel;
  if (map.vessels && water !== null) {
    map.vessels.forEach((d, i) => {
      const pts = d.route ?? findLoop(ground, water, map.size / 2 - 200, map.seed + i * 97);
      if (pts) out.push(new VesselMover(d, pts, water, i));
    });
  }
  if (map.roadCars) out.push(...roadMovers(map.roadCars, road));
  if (map.traffic) out.push(new PlaneMover(map.traffic));
  return out;
}
