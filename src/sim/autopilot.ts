// 自动驾驶（测试用）：只通过与玩家相同的操纵输入（前后/转向/平移/升降 + 悬停开关）飞完任务，
// 用于自动化验证各地图主线可完成、航线可飞，以及估计通关用时。它不直接改写飞机状态。

import { RAD, clamp, headingDelta, wrap360 } from '../core/math';
import type { V3 } from '../maps/types';
import type { GameSession } from './session';

type Phase = 'cruise' | 'approach' | 'position' | 'descend' | 'dwell' | 'hoverTask' | 'takeoff';

export interface AutopilotLog {
  t: number;
  phase: Phase;
  note: string;
}

export class Autopilot {
  private s: GameSession;
  phase: Phase = 'takeoff';
  log: AutopilotLog[] = [];
  /** 每段路线的偏好（分岔处选第几条），按 leg 索引 */
  pathPref: Record<number, number> = {};
  doOptional: boolean;
  cruise = 40;
  private lastObj = '';
  private stuckT = 0;

  constructor(s: GameSession, opts: { pathPref?: Record<number, number>; optional?: boolean; cruise?: number } = {}) {
    this.s = s;
    this.pathPref = opts.pathPref ?? {};
    this.doOptional = opts.optional ?? false;
    if (opts.cruise) this.cruise = opts.cruise;
  }

  private note(n: string): void {
    this.log.push({ t: +this.s.t.toFixed(1), phase: this.phase, note: n });
  }

  private setHover(on: boolean): void {
    if (this.s.flight.hoverOn !== on) this.s.toggleHover();
  }

  /** 计算一步的操纵输入（写入 session.input）。 */
  update(): void {
    const s = this.s;
    const inp = s.input;
    inp.pitch = inp.turn = inp.lateral = inp.vertical = 0;
    if (s.state !== 'running') return;
    const b = s.body;
    const tel = s.flight.telemetry;
    const hdg = wrap360(tel.heading * RAD);
    const sinH = Math.sin(tel.heading);
    const cosH = Math.cos(tel.heading);
    const vF = b.vel.x * sinH - b.vel.z * cosH;
    const vR = b.vel.x * cosH + b.vel.z * sinH;
    const cur = s.mission.current();
    if (!cur) return;
    // 分岔：设置偏好路线
    const pref = this.pathPref[s.nav.leg];
    if (pref !== undefined && s.nav.path === null) s.nav.preferred = pref;
    if (cur.def.id !== this.lastObj) {
      this.lastObj = cur.def.id;
      this.note(`开始任务 ${cur.def.id}`);
      if (this.phase !== 'takeoff') this.phase = s.gear.contactCount > 0 ? 'takeoff' : 'cruise';
    }
    const d = cur.def;
    // 任务目标点
    let goal: V3 | null = null;
    let goalTop = 0;
    let padHalf = 10;
    if (d.kind === 'land') {
      const p = s.pad(d.padId)!;
      goal = p.pos;
      goalTop = p.pos[1];
      padHalf = p.size / 2;
    } else if (d.kind === 'hover') {
      goal = d.center;
      goalTop = d.center[1];
    }
    const nav = s.nav.info;
    const distGoal = goal ? Math.hypot(b.pos.x - goal[0], b.pos.z - goal[2]) : Infinity;

    // ---------- 起飞 ----------
    if (this.phase === 'takeoff') {
      this.setHover(false);
      inp.vertical = 1;
      if (s.agl > 18 || (s.agl > 8 && s.gear.contactCount === 0 && b.vel.y > 2)) {
        this.phase = 'cruise';
        this.note('起飞完成');
      }
      return;
    }

    // ---------- 进入进近 ----------
    if ((this.phase === 'cruise') && goal && (nav.mode === 'approach' || distGoal < 380) && d.kind !== 'inspect') {
      this.phase = 'approach';
      this.note(`进近 ${d.id} 距离 ${distGoal.toFixed(0)}`);
    }

    // ---------- 巡航 / 进近：航向 + 速度 + 高度 ----------
    if (this.phase === 'cruise' || this.phase === 'approach') {
      this.setHover(false);
      let target: V3 = nav.target;
      let vDes = Math.min(this.cruise, nav.speed ?? this.cruise);
      let alt = Math.max(nav.targetAlt, nav.recoverAlt ?? -1e9);
      if (this.phase === 'approach' && goal) {
        target = goal;
        vDes = clamp(distGoal * 0.11, 2.5, this.cruise);
        alt = goalTop + clamp(distGoal * 0.22, d.kind === 'hover' ? (d.minH + d.maxH) / 2 + 3 : 14, 70);
      } else if (d.kind === 'inspect') {
        const dd = Math.hypot(b.pos.x - target[0], b.pos.z - target[2]);
        if (dd < 260) vDes = Math.min(vDes, d.maxSpeed * 0.7);
        alt = target[1];
      }
      // 转弯前减速
      if (nav.turn && nav.turn.speed && nav.turn.distance < Math.max(150, tel.groundSpeed * 6)) vDes = Math.min(vDes, nav.turn.speed);
      // 地形前视：保证净空
      for (const tt of [2, 4, 7, 10]) {
        const px = b.pos.x + b.vel.x * tt;
        const pz = b.pos.z + b.vel.z * tt;
        const g = s.world.ctx.ground(px, pz) + (this.phase === 'approach' && distGoal < 120 ? 12 : 30);
        if (g > alt) alt = g;
      }
      const brg = Math.atan2(target[0] - b.pos.x, -(target[2] - b.pos.z)) * RAD;
      const herr = headingDelta(hdg, brg);
      inp.turn = clamp(herr / 22, -1, 1);
      // 大角度转弯时先减速
      if (Math.abs(herr) > 50) vDes = Math.min(vDes, 14);
      inp.pitch = clamp((vDes - vF) / 7, -1, 1);
      inp.lateral = clamp(-vR / 6, -0.6, 0.6);
      inp.vertical = clamp((alt - b.pos.y) / 10 - b.vel.y * 0.08, -1, 1);
      if (this.phase === 'approach' && goal && distGoal < 14 && tel.groundSpeed < 3.5) {
        this.phase = d.kind === 'hover' ? 'hoverTask' : 'position';
        this.note(`到达目标上空 ${d.id}`);
      }
      // 卡住保护（长时间低速且远离目标）：重新进入巡航
      if (tel.groundSpeed < 1 && this.phase === 'approach' && distGoal > 30) {
        this.stuckT += 1 / 60;
        if (this.stuckT > 8) {
          this.stuckT = 0;
          this.phase = 'cruise';
        }
      } else this.stuckT = 0;
      return;
    }

    // ---------- 悬停定位与降落 ----------
    if (goal && (this.phase === 'position' || this.phase === 'descend' || this.phase === 'hoverTask')) {
      this.setHover(true);
      const ex = goal[0] - b.pos.x;
      const ez = goal[2] - b.pos.z;
      const offF = ex * sinH - ez * cosH;
      const offR = ex * cosH + ez * sinH;
      const off = Math.hypot(offF, offR);
      if (off > 1.2) {
        inp.pitch = clamp(offF / 9, -0.7, 0.7);
        inp.lateral = clamp(offR / 9, -0.7, 0.7);
      }
      if (this.phase === 'hoverTask' && d.kind === 'hover') {
        const h = s.skidY - goalTop;
        const mid = (d.minH + d.maxH) / 2;
        inp.vertical = clamp((mid - h) / 3, -1, 1);
        if (Math.abs(mid - h) < 1) inp.vertical = 0;
        return;
      }
      if (this.phase === 'position' && off < Math.max(2.5, padHalf * 0.25) && tel.groundSpeed < 1.5) {
        this.phase = 'descend';
        this.note('开始下降');
      }
      if (this.phase === 'descend') {
        inp.vertical = off < padHalf * 0.5 ? -1 : 0;
        if (s.gear.contactCount >= 3 && s.settledTime > 0.5) {
          this.phase = 'dwell';
          this.note('已接地');
        }
      }
      return;
    }

    // ---------- 停稳等待卸货 ----------
    if (this.phase === 'dwell') {
      this.setHover(false);
      inp.vertical = -1;
      if (cur.landing === null && s.settledTime > 1.5 && cur.progress === 0) {
        // 着陆不合格（或不在坪上）：重新起飞再降
        this.note('着陆未被接受，重新尝试');
        this.phase = 'takeoff';
      }
      return;
    }
  }

  /** 任务切换后（上一任务完成）由外部调用：准备起飞。 */
  onObjectiveDone(): void {
    this.phase = this.s.gear.contactCount > 0 ? 'takeoff' : 'cruise';
    this.setHover(false);
  }
}

export interface AutoRunResult {
  completed: boolean;
  crashed: boolean;
  time: number;
  durability: number;
  collisions: number;
  log: AutopilotLog[];
  objectives: string[];
}

/** 运行自动驾驶直到完成/坠毁/超时（仿真时间）。 */
export function runAutopilot(s: GameSession, maxSeconds: number, opts: { pathPref?: Record<number, number>; optional?: boolean; cruise?: number } = {}): AutoRunResult {
  const ap = new Autopilot(s, opts);
  const done: string[] = [];
  const steps = Math.round(maxSeconds * 60);
  for (let i = 0; i < steps && s.state === 'running'; i++) {
    ap.update();
    s.step();
    for (const e of s.drainEvents()) {
      if (e.type === 'mission' && e.ev.type === 'objectiveDone') {
        done.push(`${e.ev.obj.def.id}@${s.t.toFixed(0)}s`);
        if (!e.ev.optional) ap.onObjectiveDone();
      }
      if (e.type === 'mission' && e.ev.type === 'landingRejected') ap.log.push({ t: +s.t.toFixed(1), phase: ap.phase, note: '着陆不合格：' + e.ev.metrics.reasons.join(',') });
      if (e.type === 'damage' && !e.ev.blocked && e.ev.amount > 1) ap.log.push({ t: +s.t.toFixed(1), phase: ap.phase, note: `受损 ${e.ev.cause} -${e.ev.amount.toFixed(1)}` });
    }
  }
  return {
    completed: s.state === 'complete',
    crashed: s.state === 'crashed',
    time: s.t,
    durability: s.damage.durability,
    collisions: s.damage.collisions,
    log: ap.log,
    objectives: done,
  };
}
