// 任务系统：主线任务按顺序进行（明确的未开始 / 进行中 / 完成状态），可选任务随时可做。
// 降落任务综合判断位置、下降速度、水平速度、姿态与稳定程度，“碰到停机坪”不算完成。

import type { MissionDef, ObjectiveDef, V3 } from '../maps/types';
import { speedMark } from '../core/speedMark';
import { tr } from '../i18n';

export type LandingGrade = 'perfect' | 'good' | 'ok' | 'rough' | 'unsafe';

export const GRADE_LABEL: Record<LandingGrade, string> = {
  perfect: tr('完美'),
  good: tr('良好'),
  ok: tr('合格'),
  rough: tr('粗糙'),
  unsafe: tr('不合格'),
};

export interface LandingMetrics {
  descent: number;
  horizontal: number;
  attitudeDeg: number;
  offset: number;
  score: number;
  grade: LandingGrade;
  safe: boolean;
  reasons: string[];
}

/** 安全着陆条件（同时用于 HUD 着陆辅助的绿/黄/红提示） */
export const LANDING_LIMITS = { descent: 2.5, horizontal: 2.5, attitude: 12, offsetMargin: 0.5 };

export function gradeLanding(descent: number, horizontal: number, attitudeDeg: number, offset: number, padHalf: number): LandingMetrics {
  if (![descent, horizontal, attitudeDeg, offset, padHalf].every(Number.isFinite) || padHalf <= 0) {
    return { descent, horizontal, attitudeDeg, offset, score: 0, grade: 'unsafe', safe: false, reasons: [tr('着陆数据无效，请重新进近')] };
  }
  const reasons: string[] = [];
  if (descent > LANDING_LIMITS.descent) reasons.push(tr`下降速度过大（${descent.toFixed(1)} m/s）`);
  if (horizontal > LANDING_LIMITS.horizontal) reasons.push(tr`水平漂移过大（${horizontal.toFixed(1)} m/s）`);
  if (attitudeDeg > LANDING_LIMITS.attitude) reasons.push(tr`机身姿态过大（${attitudeDeg.toFixed(0)}°）`);
  if (offset > padHalf + LANDING_LIMITS.offsetMargin) reasons.push(tr('未落在停机坪范围内'));
  let score = 100;
  score -= Math.max(0, descent - 0.8) * 22;
  score -= Math.max(0, horizontal - 0.5) * 16;
  score -= Math.max(0, attitudeDeg - 4) * 2.5;
  score -= Math.max(0, offset - padHalf * 0.25) * (40 / padHalf);
  score = Math.max(0, Math.min(100, score));
  const safe = reasons.length === 0;
  const grade: LandingGrade = !safe ? 'unsafe' : score >= 85 ? 'perfect' : score >= 65 ? 'good' : score >= 40 ? 'ok' : 'rough';
  return { descent, horizontal, attitudeDeg, offset, score: safe ? score : 0, grade, safe, reasons };
}

export type ObjectiveStatus = 'pending' | 'active' | 'done';

export interface ObjectiveRT {
  def: ObjectiveDef;
  status: ObjectiveStatus;
  progress: number;
  /** 已被接受的接地（降落任务等待卸货中） */
  landing: LandingMetrics | null;
  visited: boolean[];
  hint: string;
  /** 巡查航线进度 */
  routeIdx: number;
}

export interface MissionSnapshot {
  index: number;
  cargo: number;
  main: Array<{ status: ObjectiveStatus; progress: number; visited: boolean[]; landing: LandingMetrics | null; routeIdx: number }>;
  optional: Array<{ status: ObjectiveStatus; progress: number; visited: boolean[]; landing: LandingMetrics | null; routeIdx: number }>;
  finalLanding: LandingMetrics | null;
  landings: LandingMetrics[];
}

export type MissionEvent =
  | { type: 'objectiveStart'; obj: ObjectiveRT; optional: boolean }
  | { type: 'objectiveDone'; obj: ObjectiveRT; optional: boolean; landing: LandingMetrics | null }
  | { type: 'landingRejected'; obj: ObjectiveRT; metrics: LandingMetrics }
  | { type: 'landingAccepted'; obj: ObjectiveRT; metrics: LandingMetrics }
  | { type: 'lockedPad'; message: string }
  | { type: 'inspectPoint'; obj: ObjectiveRT; label: string; remaining: number }
  | { type: 'cargo'; action: 'load' | 'unload' | 'drop'; cargo: number }
  | { type: 'missionComplete' };

export interface MissionContext {
  t: number;
  dt: number;
  pos: { x: number; y: number; z: number };
  speed: number;
  /** 水平地速（HUD 上那个“地速”）。巡查的限速按它判：玩家是看着它减速的。不给时用 speed */
  hspeed?: number;
  /** 滑橇底面高度（世界 y） */
  skidY: number;
  /** 稳定停放在哪个停机坪上（null = 没有） */
  settledPad: string | null;
  /** 本步的接地事件（只在接地那一步出现） */
  touchdown: { padId: string | null; metrics: LandingMetrics } | null;
  airborne: boolean;
}

type InspectPoint = Extract<ObjectiveDef, { kind: 'inspect' }>['points'][number];

/**
 * 离巡查点的判定范围还差多少：判定范围是闪灯下面的一根竖直圆柱（见 maps/types.ts 里 points 的说明）。
 * far：水平还差几米；high：高出圆柱顶几米；都是 0 并且 inside 才算在里面
 */
export function inspectGap(p: InspectPoint, pos: { x: number; y: number; z: number }): { inside: boolean; far: number; high: number } {
  const horiz = Math.hypot(pos.x - p.pos[0], pos.z - p.pos[2]);
  const top = p.top ?? p.pos[1] + p.radius;
  return { inside: horiz < p.radius && pos.y <= top, far: Math.max(0, horiz - p.radius), high: Math.max(0, pos.y - top) };
}

function mkRT(def: ObjectiveDef): ObjectiveRT {
  return {
    def,
    status: 'pending',
    progress: 0,
    landing: null,
    visited: def.kind === 'inspect' ? def.points.map(() => false) : [],
    hint: '',
    routeIdx: 0,
  };
}

function copyLanding(landing: LandingMetrics): LandingMetrics {
  return { ...landing, reasons: [...landing.reasons] };
}

export class MissionRuntime {
  readonly def: MissionDef;
  readonly main: ObjectiveRT[];
  readonly optional: ObjectiveRT[];
  index = 0;
  cargo: number;
  finalLanding: LandingMetrics | null = null;
  /** 所有被接受的降落（统计用） */
  landings: LandingMetrics[] = [];
  complete = false;
  /** 教学模式：在到达对应步骤前暂停任务判定 */
  locked = false;
  private lockedMsgT = -10;

  constructor(def: MissionDef) {
    this.def = def;
    this.main = def.main.map(mkRT);
    this.optional = def.optional.map(mkRT);
    this.cargo = def.startCargo;
    // 只有休闲飞行的地图没有主线任务
    if (this.main[0]) this.main[0].status = 'active';
    for (const o of this.optional) o.status = 'active';
  }

  current(): ObjectiveRT | null {
    return this.main[this.index] ?? null;
  }

  get doneCount(): number {
    return this.main.filter((o) => o.status === 'done').length;
  }

  get optionalDone(): number {
    return this.optional.filter((o) => o.status === 'done').length;
  }

  /** 当前目标点：降落/悬停为进近点；巡查为最近的未完成点。 */
  goalOf(o: ObjectiveRT, pos: { x: number; y: number; z: number }): V3 {
    const d = o.def;
    if (d.kind === 'inspect' && d.route && d.route.length > 0) {
      return d.route[o.routeIdx];
    }
    if (d.kind === 'inspect') {
      let best: V3 = d.approach;
      let bd = Infinity;
      d.points.forEach((p, i) => {
        if (o.visited[i]) return;
        const dd = Math.hypot(p.pos[0] - pos.x, p.pos[1] - pos.y, p.pos[2] - pos.z);
        if (dd < bd) {
          bd = dd;
          best = p.pos;
        }
      });
      return best;
    }
    return d.approach;
  }

  update(ctx: MissionContext, padHalf: (id: string) => number, padCenter: (id: string) => V3, out: MissionEvent[]): void {
    if (this.complete || this.locked) return;
    const cur = this.current();
    if (cur?.status === 'active') this.updateObjective(cur, false, ctx, padHalf, padCenter, out);
    for (const o of this.optional) {
      if (o.status !== 'active') continue;
      this.updateObjective(o, true, ctx, padHalf, padCenter, out);
    }
    // 在后续任务的停机坪上着陆：提示锁定
    if (ctx.touchdown && ctx.touchdown.padId) {
      const pid = ctx.touchdown.padId;
      const future = this.main.findIndex((o, i) => i > this.index && o.def.kind === 'land' && o.def.padId === pid);
      const isCurrent = cur && cur.def.kind === 'land' && cur.def.padId === pid;
      const isOpt = this.optional.some((o) => o.status === 'active' && o.def.kind === 'land' && o.def.padId === pid);
      if (future >= 0 && !isCurrent && !isOpt && ctx.t - this.lockedMsgT > 4) {
        this.lockedMsgT = ctx.t;
        out.push({ type: 'lockedPad', message: tr`这里是后续任务的降落点，请先完成：${cur?.def.title ?? ''}` });
      }
    }
  }

  private updateObjective(
    o: ObjectiveRT,
    isOpt: boolean,
    ctx: MissionContext,
    padHalf: (id: string) => number,
    padCenter: (id: string) => V3,
    out: MissionEvent[],
  ): void {
    const d = o.def;
    if (d.kind === 'land') {
      const half = padHalf(d.padId);
      const c = padCenter(d.padId);
      if (ctx.touchdown && ctx.touchdown.padId === d.padId) {
        const m = ctx.touchdown.metrics;
        const offset = Math.hypot(ctx.pos.x - c[0], ctx.pos.z - c[2]);
        const g = gradeLanding(m.descent, m.horizontal, m.attitudeDeg, offset, half);
        if (g.safe) {
          o.landing = g;
          out.push({ type: 'landingAccepted', obj: o, metrics: g });
        } else {
          o.landing = null;
          out.push({ type: 'landingRejected', obj: o, metrics: g });
        }
      }
      if (ctx.airborne) {
        o.landing = null;
        o.progress = 0;
      }
      if (o.landing && ctx.settledPad === d.padId) {
        o.progress = Math.min(1, o.progress + ctx.dt / Math.max(0.1, d.dwell));
        o.hint = d.cargo === 'load' ? tr('装载物资中…保持停稳') : d.cargo === 'unload' ? tr('卸载物资中…保持停稳') : tr('保持停稳…');
        if (o.progress >= 1) this.finish(o, isOpt, o.landing, out);
      } else if (!o.landing) {
        const dist = Math.hypot(ctx.pos.x - c[0], ctx.pos.z - c[2]);
        o.hint = dist < 120 ? tr('平稳降落：下降 < 2.5 m/s，水平漂移 < 2.5 m/s，姿态 < 12°') : '';
      }
    } else if (d.kind === 'hover') {
      const dx = ctx.pos.x - d.center[0];
      const dz = ctx.pos.z - d.center[2];
      const horiz = Math.hypot(dx, dz);
      const h = ctx.skidY - d.center[1];
      const inside = horiz < d.radius && h >= d.minH && h <= d.maxH && ctx.speed < d.maxSpeed;
      if (inside) o.progress = Math.min(1, o.progress + ctx.dt / d.duration);
      else o.progress = Math.max(0, o.progress - ctx.dt / (d.duration * 2.5));
      if (horiz < d.radius * 6) {
        const parts: string[] = [];
        if (h < d.minH) parts.push(tr`升高 ${(d.minH - h).toFixed(1)} m`);
        else if (h > d.maxH) parts.push(tr`降低 ${(h - d.maxH).toFixed(1)} m`);
        if (horiz >= d.radius) parts.push(tr`靠近目标 ${(horiz - d.radius + 0.5).toFixed(0)} m`);
        if (ctx.speed >= d.maxSpeed) parts.push(tr`减速至 ${d.maxSpeed} m/s 以下`);
        o.hint = inside ? tr`保持悬停… ${Math.round(o.progress * 100)}%` : parts.join(' · ');
      } else o.hint = '';
      if (o.progress >= 1) this.finish(o, isOpt, null, out);
    } else {
      // 只让固定仿真步推进巡查航线；HUD、地图和自动驾驶的目标查询保持只读。
      if (d.route?.length) {
        while (o.routeIdx < d.route.length - 1 && Math.hypot(ctx.pos.x - d.route[o.routeIdx][0], ctx.pos.z - d.route[o.routeIdx][2]) < 55) o.routeIdx++;
      }
      // 限速看 HUD 上的“地速”（水平速度），和玩家眼睛盯着的数一致。速度在文字里写成记号，显示时换成玩家选的单位
      const slow = (ctx.hspeed ?? ctx.speed) <= d.maxSpeed;
      // （“太快了”的提示要留到速度降下来为止；按整句比，不按开头的字比：译成别的语言后开头不一样）
      const fast = tr`速度过快：低于 ${speedMark(d.maxSpeed)} 才能看清`;
      let remaining = 0;
      // 离得最近、还没巡查的那个点
      let next: { label: string; far: number; high: number; gap: number } | null = null;
      for (let i = 0; i < d.points.length; i++) {
        if (o.visited[i]) continue;
        const p = d.points[i];
        const g = inspectGap(p, ctx.pos);
        if (g.inside) {
          if (slow) {
            o.visited[i] = true;
            out.push({ type: 'inspectPoint', obj: o, label: p.label, remaining: o.visited.filter((v) => !v).length });
            continue;
          }
          o.hint = fast;
        }
        remaining++;
        const gap = Math.hypot(g.far, g.high);
        if (!next || gap < next.gap) next = { label: p.label, far: g.far, high: g.high, gap };
      }
      o.progress = 1 - remaining / d.points.length;
      if (remaining === 0) {
        this.finish(o, isOpt, null, out);
        return;
      }
      if (o.hint === fast && !slow) return;
      // 快到下一个巡查点了：直接说还差什么（还要靠近几米、要降多少、要不要减速），不光写“还剩几个”
      const parts: string[] = [];
      if (next && next.gap < 150) {
        if (next.far > 0) parts.push(tr`靠近目标 ${Math.ceil(next.far)} m`);
        if (next.high > 0) parts.push(tr`降低 ${Math.ceil(next.high)} m`);
        if (!slow) parts.push(tr`减速至 ${speedMark(d.maxSpeed)} 以下`);
      }
      o.hint = next && parts.length ? tr`${next.label}：${parts.join(' · ')}` : tr`剩余 ${remaining} 个巡查点`;
    }
  }

  private finish(o: ObjectiveRT, isOpt: boolean, landing: LandingMetrics | null, out: MissionEvent[]): void {
    o.status = 'done';
    o.progress = 1;
    o.hint = '';
    const d = o.def;
    if (landing) this.landings.push(landing);
    if (d.kind === 'land' && d.cargo) {
      if (d.cargo === 'load') this.cargo++;
      else this.cargo = Math.max(0, this.cargo - 1);
      out.push({ type: 'cargo', action: d.cargo, cargo: this.cargo });
    }
    if (d.kind === 'hover' && d.cargo === 'drop') {
      this.cargo = Math.max(0, this.cargo - 1);
      out.push({ type: 'cargo', action: 'drop', cargo: this.cargo });
    }
    out.push({ type: 'objectiveDone', obj: o, optional: isOpt, landing });
    if (!isOpt) {
      this.index++;
      if (this.index >= this.main.length) {
        this.complete = true;
        this.finalLanding = landing;
        out.push({ type: 'missionComplete' });
      } else {
        const next = this.main[this.index];
        next.status = 'active';
        out.push({ type: 'objectiveStart', obj: next, optional: false });
      }
    }
  }

  snapshot(): MissionSnapshot {
    const s = (o: ObjectiveRT) => ({ status: o.status, progress: o.progress, visited: [...o.visited], landing: o.landing ? copyLanding(o.landing) : null, routeIdx: o.routeIdx });
    return {
      index: this.index,
      cargo: this.cargo,
      main: this.main.map(s),
      optional: this.optional.map(s),
      finalLanding: this.finalLanding ? copyLanding(this.finalLanding) : null,
      landings: this.landings.map(copyLanding),
    };
  }

  restore(s: MissionSnapshot): void {
    this.lockedMsgT = -Infinity;
    this.index = s.index;
    this.cargo = s.cargo;
    const r = (o: ObjectiveRT, x: MissionSnapshot['main'][number]) => {
      o.status = x.status;
      o.progress = x.progress;
      o.visited = [...x.visited];
      o.landing = x.landing ? copyLanding(x.landing) : null;
      o.routeIdx = x.routeIdx ?? 0;
      o.hint = '';
    };
    this.main.forEach((o, i) => r(o, s.main[i]));
    this.optional.forEach((o, i) => r(o, s.optional[i]));
    this.finalLanding = s.finalLanding ? copyLanding(s.finalLanding) : null;
    this.landings = s.landings.map(copyLanding);
    this.complete = this.index >= this.main.length;
  }
}
