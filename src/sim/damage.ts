// 耐久与损伤：0–100 连续耐久，性能随耐久连续变化（无断崖），碰撞伤害按冲量/速度变化计算，
// 同一次接触只结算一次（接触事件合并），护盾阻止常规碰撞造成的耐久损失但不影响物理碰撞。

import { clamp } from '../core/math';
import type { ContactReport, HeliPart } from './physics';

export const DAMAGE = {
  /** 每步速度变化低于该值视为静止/挤压接触（重力支撑约 0.16 m/s/步），不计伤害 */
  restingDv: 0.3,
  /** 轻微碰撞容差（m/s） */
  tolerance: { cabin: 1.0, boom: 0.8, skid: 2.4, rotor: 0, tailRotor: 0 } as Record<HeliPart, number>,
  scale: { cabin: 4.0, boom: 4.6, skid: 3.0, rotor: 0, tailRotor: 0 } as Record<HeliPart, number>,
  exponent: 1.35,
  /** 同一部位的接触在该时间窗内合并为一次碰撞（s） */
  episodeWindow: 0.45,
  /** 旋翼撞击：基础伤害 + 速度相关伤害；冷却时间内不重复结算 */
  rotorBase: 18,
  rotorPerSpeed: 2.0,
  rotorCooldown: 1.2,
  tailRotorBase: 9,
  tailRotorPerSpeed: 1.4,
  tailRotorCooldown: 1.0,
  /** 擦碰：贴着障碍物高速滑动时的持续伤害（每秒） */
  scrapeSpeed: 4,
  scrapeRate: 0.55,
  scrapeMax: 7,
  /** 着陆：安全下降速度上限与重着陆伤害 */
  safeDescent: 2.0,
  hardLandingScale: 9,
  hardLandingExp: 1.5,
  /** 接地伤害达到该值才计入碰撞次数 */
  touchdownCollision: 3,
  /** 侧向接地速度过大 */
  safeHorizontal: 3.0,
  sideLoadScale: 5,
  /** 姿态不当着陆（坡度/俯仰过大） */
  safeAttitudeDeg: 14,
  attitudeScale: 2.2,
};

export type DamageStatus = 'normal' | 'damaged' | 'critical' | 'destroyed';

export type DamageCause = 'impact' | 'scrape' | 'rotor' | 'tailRotor' | 'hardLanding' | 'sideLoad' | 'attitude' | 'rollover' | 'water';

export const CAUSE_LABEL: Record<DamageCause, string> = {
  impact: '机身撞击',
  scrape: '机身擦碰',
  rotor: '旋翼撞击',
  tailRotor: '尾桨撞击',
  hardLanding: '过重着陆',
  sideLoad: '带侧滑着陆',
  attitude: '姿态不当着陆',
  rollover: '侧翻',
  water: '落水',
};

export interface DamageEvent {
  cause: DamageCause;
  amount: number;
  blocked: boolean;
  durability: number;
  /** 撞击强度（m/s），用于音效与镜头冲击 */
  severity: number;
}

/** 耐久 → 性能系数（连续、单调、无突变）：100 → 1.0，70 → 0.96，30 → 0.84，0 → 0.72 */
export function perfFactor(durability: number): number {
  const d = clamp(durability, 0, 100) / 100;
  return 1 - 0.28 * Math.pow(1 - d, 1.6);
}

/** 稳定性影响严重度 0..1（耐久 70 以上几乎为 0）。 */
export function severityOf(durability: number): number {
  const d = clamp(durability, 0, 100);
  return clamp((75 - d) / 75, 0, 1);
}

export function statusOf(durability: number): DamageStatus {
  if (durability <= 0) return 'destroyed';
  if (durability < 30) return 'critical';
  if (durability < 70) return 'damaged';
  return 'normal';
}

export const STATUS_LABEL: Record<DamageStatus, string> = {
  normal: '正常',
  damaged: '受损',
  critical: '严重受损',
  destroyed: '坠毁',
};

interface Episode {
  start: number;
  last: number;
  dvSum: number;
  charged: number;
}

export interface DamageSnapshot {
  durability: number;
  collisions: number;
  lastCause: DamageCause | null;
}

export class DamageModel {
  durability = 100;
  /** 计入评分的碰撞次数（每次合并后的碰撞算一次） */
  collisions = 0;
  lastCause: DamageCause | null = null;
  private episodes = new Map<HeliPart, Episode>();
  private rotorCd = 0;
  private tailCd = 0;
  private scrapeAcc = 0;
  private lastContactT = -10;

  get status(): DamageStatus {
    return statusOf(this.durability);
  }

  get perf(): number {
    return perfFactor(this.durability);
  }

  get severity(): number {
    return severityOf(this.durability);
  }

  reset(durability = 100): void {
    this.durability = durability;
    this.collisions = 0;
    this.lastCause = null;
    this.episodes.clear();
    this.rotorCd = this.tailCd = 0;
    this.scrapeAcc = 0;
    this.lastContactT = -10;
  }

  snapshot(): DamageSnapshot {
    return { durability: this.durability, collisions: this.collisions, lastCause: this.lastCause };
  }

  restore(s: DamageSnapshot): void {
    this.durability = s.durability;
    this.collisions = s.collisions;
    this.lastCause = s.lastCause;
    this.episodes.clear();
    this.rotorCd = this.tailCd = 0;
    this.scrapeAcc = 0;
    this.lastContactT = -10;
  }

  repair(amount: number): number {
    const before = this.durability;
    this.durability = clamp(this.durability + amount, 0, 100);
    return this.durability - before;
  }

  private apply(cause: DamageCause, amount: number, shield: boolean, severity: number, out: DamageEvent[]): void {
    if (amount <= 0.05) return;
    const blocked = shield;
    if (!blocked) {
      this.durability = clamp(this.durability - amount, 0, 100);
      this.lastCause = cause;
    }
    out.push({ cause, amount, blocked, durability: this.durability, severity });
  }

  /** 处理一步的接触报告。speed：机体速度（m/s）。 */
  processContacts(contacts: ContactReport[], t: number, dt: number, speed: number, shield: boolean, out: DamageEvent[]): void {
    this.rotorCd = Math.max(0, this.rotorCd - dt);
    this.tailCd = Math.max(0, this.tailCd - dt);
    let bodyContact = false;
    for (const c of contacts) {
      if (c.tag.kind === 'boundary') continue;
      if (c.part === 'rotor') {
        if (this.rotorCd <= 0) {
          this.rotorCd = DAMAGE.rotorCooldown;
          this.collisions++;
          this.apply('rotor', DAMAGE.rotorBase + DAMAGE.rotorPerSpeed * speed, shield, 6 + speed, out);
        }
        continue;
      }
      if (c.part === 'tailRotor') {
        if (this.tailCd <= 0) {
          this.tailCd = DAMAGE.tailRotorCooldown;
          this.collisions++;
          this.apply('tailRotor', DAMAGE.tailRotorBase + DAMAGE.tailRotorPerSpeed * speed, shield, 4 + speed, out);
        }
        continue;
      }
      if (c.started) {
        if (c.part !== 'skid') bodyContact = true;
        continue;
      }
      if (c.part !== 'skid') bodyContact = true;
      if (c.dv < DAMAGE.restingDv) continue;
      let ep = this.episodes.get(c.part);
      if (!ep || t - ep.start > DAMAGE.episodeWindow) {
        ep = { start: t, last: t, dvSum: 0, charged: 0 };
        this.episodes.set(c.part, ep);
      }
      ep.last = t;
      ep.dvSum += c.dv;
      const tol = DAMAGE.tolerance[c.part];
      const total = DAMAGE.scale[c.part] * Math.pow(Math.max(0, ep.dvSum - tol), DAMAGE.exponent);
      const add = total - ep.charged;
      if (add > 0.05) {
        if (ep.charged === 0) this.collisions++;
        ep.charged = total;
        this.apply('impact', add, shield, ep.dvSum, out);
      }
    }
    // 擦碰：机身与障碍物保持接触且高速滑动
    if (bodyContact) this.lastContactT = t;
    if (t - this.lastContactT < 0.12 && speed > DAMAGE.scrapeSpeed) {
      const rate = Math.min(DAMAGE.scrapeMax, DAMAGE.scrapeRate * (speed - DAMAGE.scrapeSpeed));
      this.scrapeAcc += rate * dt;
      if (this.scrapeAcc >= 1) {
        const amt = Math.floor(this.scrapeAcc);
        this.scrapeAcc -= amt;
        this.apply('scrape', amt, shield, 1.5, out);
      }
    }
  }

  /** 接地冲击（由起落架接地事件触发）。 */
  processTouchdown(descent: number, horizontal: number, attitudeDeg: number, shield: boolean, out: DamageEvent[]): void {
    let amt = 0;
    let cause: DamageCause = 'hardLanding';
    if (descent > DAMAGE.safeDescent) amt += DAMAGE.hardLandingScale * Math.pow(descent - DAMAGE.safeDescent, DAMAGE.hardLandingExp);
    if (horizontal > DAMAGE.safeHorizontal) {
      const a = DAMAGE.sideLoadScale * (horizontal - DAMAGE.safeHorizontal);
      // 水平速度很大时已不是“带侧滑着陆”，而是高速撞地
      if (a > amt) cause = horizontal > 9 ? 'impact' : 'sideLoad';
      amt += a;
    }
    if (attitudeDeg > DAMAGE.safeAttitudeDeg) {
      const a = DAMAGE.attitudeScale * (attitudeDeg - DAMAGE.safeAttitudeDeg) * Math.max(1, descent);
      if (a > amt) cause = 'attitude';
      amt += a;
    }
    if (amt > 0.5) {
      // 轻微的重着陆只扣少量耐久（着陆评分另行扣分），伤害达到一定程度才计为一次碰撞
      if (amt >= DAMAGE.touchdownCollision) this.collisions++;
      this.apply(cause, amt, shield, descent, out);
    }
  }

  /** 致命事件（侧翻、落水）：不属于常规碰撞，护盾不阻止。 */
  destroy(cause: DamageCause, out: DamageEvent[]): void {
    const amount = this.durability;
    this.durability = 0;
    this.lastCause = cause;
    out.push({ cause, amount, blocked: false, durability: 0, severity: 10 });
  }
}
