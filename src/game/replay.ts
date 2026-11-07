// 回放：一路记下飞机的位置、姿态、速度和旋翼转速，回头用电影镜头再放一遍。
// 回放不碰物理：把录下来的姿态写进 session.body 给画面和声音看，放完原样写回去。

import { Quaternion } from 'three';
import type { BodyState } from '../sim/flight';

/** 一秒录十五帧：位置用速度做三次插值，放出来是顺的 */
const STEP = 1 / 15;
/** 录最近四分钟 */
const CAP = 15 * 240;
/** 每帧：时间、位置 3、姿态 4、速度 3、转速、升力、空速、第几段 */
const W = 15;
/** 两帧之间跳了这么远就是传送（选景点、从检查点继续、撞了之后回到空中）：从这里起是新的一段，放的时候是一个剪辑点 */
const JUMP = 30;
/** 录够这么长才值得放 */
export const REPLAY_MIN = 8;

export interface TapeFrame {
  rpm: number;
  thrust: number;
  airspeed: number;
  /** 第几段（两段之间是传送，镜头要切） */
  seg?: number;
}

const _a = new Quaternion();
const _b = new Quaternion();

export class FlightTape {
  private readonly d = new Float64Array(CAP * W);
  private first = 0;
  private n = 0;
  private clock = 0;
  private wait = 0;
  private seg = 0;
  private readonly out: TapeFrame = { rpm: 0, thrust: 0, airspeed: 0, seg: 0 };

  private at(i: number): number {
    return ((this.first + i) % CAP) * W;
  }

  clear(): void {
    this.first = this.n = this.seg = 0;
    this.clock = this.wait = 0;
  }

  /** 能放多少秒 */
  get seconds(): number {
    return this.n < 2 ? 0 : this.d[this.at(this.n - 1)] - this.d[this.at(0)];
  }

  /** 每帧调。idle：停在地上不动，这段不录（超仿真的冷舱启动没什么好看的） */
  record(dt: number, b: BodyState, frame: TapeFrame, idle: boolean): void {
    if (idle) return;
    this.wait += dt;
    if (this.wait < STEP) return;
    const d = this.d;
    if (this.n > 0) {
      const o = this.at(this.n - 1);
      if (Math.hypot(b.pos.x - d[o + 1], b.pos.y - d[o + 2], b.pos.z - d[o + 3]) > JUMP) this.seg++;
    }
    this.clock += this.wait;
    this.wait = 0;
    if (this.n === CAP) {
      this.first = (this.first + 1) % CAP;
      this.n--;
    }
    const o = this.at(this.n++);
    d[o] = this.clock;
    d[o + 1] = b.pos.x;
    d[o + 2] = b.pos.y;
    d[o + 3] = b.pos.z;
    d[o + 4] = b.quat.x;
    d[o + 5] = b.quat.y;
    d[o + 6] = b.quat.z;
    d[o + 7] = b.quat.w;
    d[o + 8] = b.vel.x;
    d[o + 9] = b.vel.y;
    d[o + 10] = b.vel.z;
    d[o + 11] = frame.rpm;
    d[o + 12] = frame.thrust;
    d[o + 13] = frame.airspeed;
    d[o + 14] = this.seg;
  }

  /** 把第 t 秒的姿态写进 b */
  pose(t: number, b: BodyState): TapeFrame {
    const d = this.d;
    const out = this.out;
    if (this.n === 0) return out;
    const start = d[this.at(0)];
    const T = start + Math.min(Math.max(t, 0), this.seconds);
    let lo = 0;
    let hi = Math.max(0, this.n - 1);
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (d[this.at(m)] <= T) lo = m;
      else hi = m;
    }
    const p = this.at(lo);
    const q = this.at(hi);
    const h = d[q] - d[p];
    // （两段之间不插值：传送不是飞过去的）
    const u = h > 0 && d[p + 14] === d[q + 14] ? Math.min(1, (T - d[p]) / h) : T >= d[q] ? 1 : 0;
    const u2 = u * u;
    const u3 = u2 * u;
    const k0 = 2 * u3 - 3 * u2 + 1;
    const k1 = (u3 - 2 * u2 + u) * h;
    const k2 = 3 * u2 - 2 * u3;
    const k3 = (u3 - u2) * h;
    const mix = (i: number, j: number): number => k0 * d[p + i] + k1 * d[p + j] + k2 * d[q + i] + k3 * d[q + j];
    const lerp = (i: number): number => d[p + i] + (d[q + i] - d[p + i]) * u;
    b.pos.set(mix(1, 8), mix(2, 9), mix(3, 10));
    b.vel.set(lerp(8), lerp(9), lerp(10));
    b.angVel.set(0, 0, 0);
    _a.set(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
    _b.set(d[q + 4], d[q + 5], d[q + 6], d[q + 7]);
    b.quat.slerpQuaternions(_a, _b, u);
    out.rpm = lerp(11);
    out.thrust = lerp(12);
    out.airspeed = lerp(13);
    out.seg = u >= 1 ? d[q + 14] : d[p + 14];
    return out;
  }
}
