// 救援模式：超大地图上的长途任务。调度员派活，飞过去，接到伤员，送到诊所，飞回基地。
// 一趟的停靠点写在地图里（MapDef.rescues），这里把它变成普通的任务目标，再加上一条伤员的状况：
// 从接到电话起一直往下走，飞得颠簸掉得更快，送到为止。掉到 0 不算失败，只是评分很难看。

import { clamp } from '../core/math';
import type { MissionDef, ObjectiveDef, PadDef, RescueDef, RescueStop, V3 } from '../maps/types';

/** 进近点在坪的上空多高 */
const APPROACH_AGL = 90;
/** 吊运：悬停在伤员头顶，离地这个高度范围以内（绳子就这么长） */
export const HOIST = { minH: 12, maxH: 32, radius: 16, duration: 18, maxSpeed: 2.5 };

function objective(stop: RescueStop, i: number, pad: PadDef): ObjectiveDef {
  const [x, y, z] = pad.pos;
  const approach: V3 = [x, y + APPROACH_AGL, z];
  const id = `r${i}-${stop.pad}`;
  if (stop.what === 'hoist') {
    return { id, kind: 'hover', title: stop.task, detail: stop.radio, center: [x, y, z], radius: HOIST.radius, minH: HOIST.minH, maxH: HOIST.maxH, duration: HOIST.duration, maxSpeed: HOIST.maxSpeed, cargo: 'hoist', people: true, approach };
  }
  return { id, kind: 'land', title: stop.task, detail: stop.radio, padId: stop.pad, dwell: stop.dwell ?? 6, cargo: stop.what, people: true, approach };
}

/** 一趟救援的主线任务 */
export function rescueMission(def: RescueDef, pads: ReadonlyMap<string, PadDef>): MissionDef {
  return {
    startCargo: 0,
    optional: [],
    main: def.stops.map((s, i) => {
      const pad = pads.get(s.pad);
      if (!pad) throw new Error(`救援停靠点不存在：${s.pad}`);
      return objective(s, i, pad);
    }),
  };
}

/** 这一趟要飞多少米（从起点一站一站直线飞） */
export function rescueDistance(def: RescueDef, pads: ReadonlyMap<string, PadDef>): number {
  let at = pads.get(def.start)!.pos;
  let total = 0;
  for (const s of def.stops) {
    const p = pads.get(s.pad)!.pos;
    total += Math.hypot(p[0] - at[0], p[2] - at[2]);
    at = p;
  }
  return total;
}

export interface RescueSnapshot {
  health: number;
  delivered: number;
  results: number[];
}

export class RescueRuntime {
  /** 伤员状况：100 是刚接到电话时 */
  health = 100;
  /** 这一步飞得有多颠（0..1） */
  rough = 0;
  /** 送到了几个人 */
  delivered = 0;
  /** 每个人送到时的状况 */
  results: number[] = [];
  private readonly rate: number;

  constructor(readonly def: RescueDef) {
    this.rate = 100 / (def.golden * 60);
  }

  /** 伤员都送到了吗（送到以后状况不再变化） */
  get waiting(): boolean {
    return this.delivered < this.def.stops.filter((s) => s.what === 'unload').length;
  }

  /** aboard：机上有人；accel：机身感受到的加速度和 1g 差多少（m/s²） */
  update(dt: number, aboard: boolean, accel: number): void {
    if (!this.waiting) return;
    this.rough = aboard ? clamp((Math.abs(accel) - 2.5) / 6, 0, 1) : 0;
    this.health = Math.max(0, this.health - this.rate * (1 + 4 * this.rough) * dt);
  }

  /** 送到了一个：记下这个人的状况，下一个电话接着来 */
  deliver(): void {
    this.results.push(this.health);
    this.delivered++;
    this.health = 100;
  }

  /** 所有人送到时的平均状况 */
  get score(): number {
    return this.results.length ? this.results.reduce((a, b) => a + b, 0) / this.results.length : 0;
  }

  /** 有人的时候硬着陆：抬着担架的人和伤员都受不了 */
  bump(descent: number): void {
    if (this.waiting && descent > 2) this.health = Math.max(0, this.health - (descent - 2) * 6);
  }

  snapshot(): RescueSnapshot {
    return { health: this.health, delivered: this.delivered, results: [...this.results] };
  }

  restore(s: RescueSnapshot): void {
    this.health = s.health;
    this.delivered = s.delivered;
    this.results = [...s.results];
    this.rough = 0;
  }
}

/** 换算成人话 */
export function conditionLabel(health: number): string {
  return health > 70 ? '稳定' : health > 40 ? '在恶化' : health > 15 ? '危重' : '生命垂危';
}
