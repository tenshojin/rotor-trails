// Buff：动力增强（拾取后储存 1 次，Shift 主动使用）、免伤护盾（拾取即生效）、维修补给（立即恢复耐久）。
// 所有计时都基于仿真时间：暂停时冻结，检查点保存/恢复完整状态。

import { BOOST } from '../config/flight';
import { approach } from '../core/math';

export const BUFFS = {
  boost: { duration: BOOST.duration, maxCharges: 1 },
  shield: { duration: 9, maxDuration: 14 },
  repair: { amount: 25 },
  pickupRadius: 7.5,
};

export type BuffKind = 'boost' | 'shield' | 'repair';

export type PickupResult = 'stored' | 'shield' | 'shieldExtended' | 'repaired' | 'full' | 'alreadyHolding';

export interface BuffSnapshot {
  boostCharges: number;
  boostTime: number;
  boostLevel: number;
  shieldTime: number;
}

export class BuffSystem {
  boostCharges = 0;
  /** 动力增强剩余时间（s） */
  boostTime = 0;
  /** 动力增强实际作用量 0..1（渐入渐出，避免突变） */
  boostLevel = 0;
  shieldTime = 0;

  get boostActive(): boolean {
    return this.boostTime > 0;
  }

  get shieldActive(): boolean {
    return this.shieldTime > 0;
  }

  reset(): void {
    this.boostCharges = 0;
    this.boostTime = 0;
    this.boostLevel = 0;
    this.shieldTime = 0;
  }

  update(dt: number): void {
    if (this.boostTime > 0) this.boostTime = Math.max(0, this.boostTime - dt);
    const target = this.boostTime > 0 ? 1 : 0;
    const rate = target > this.boostLevel ? 1 / BOOST.rampIn : 1 / BOOST.rampOut;
    this.boostLevel = approach(this.boostLevel, target, rate * dt);
    if (this.shieldTime > 0) this.shieldTime = Math.max(0, this.shieldTime - dt);
  }

  /** 拾取。repairNeeded 为 false 时维修补给不被消耗（耐久已满）。 */
  pickup(kind: BuffKind, durability: number): PickupResult {
    if (kind === 'boost') {
      if (this.boostCharges >= BUFFS.boost.maxCharges) return 'alreadyHolding';
      this.boostCharges++;
      return 'stored';
    }
    if (kind === 'shield') {
      if (this.shieldTime > 0) {
        // 重复拾取：刷新并有限延长，不能无限叠加
        this.shieldTime = Math.min(BUFFS.shield.maxDuration, this.shieldTime + BUFFS.shield.duration);
        return 'shieldExtended';
      }
      this.shieldTime = BUFFS.shield.duration;
      return 'shield';
    }
    return durability >= 100 ? 'full' : 'repaired';
  }

  activateBoost(): boolean {
    if (this.boostCharges <= 0 || this.boostTime > 0) return false;
    this.boostCharges--;
    this.boostTime = BUFFS.boost.duration;
    return true;
  }

  snapshot(): BuffSnapshot {
    return { boostCharges: this.boostCharges, boostTime: this.boostTime, boostLevel: this.boostLevel, shieldTime: this.shieldTime };
  }

  restore(s: BuffSnapshot): void {
    this.boostCharges = s.boostCharges;
    this.boostTime = s.boostTime;
    this.boostLevel = s.boostLevel;
    this.shieldTime = s.shieldTime;
  }
}
