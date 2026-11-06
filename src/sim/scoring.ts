// 评分：不使用通关时间。奖励谨慎而精确的驾驶：主线、可选任务、剩余耐久、碰撞次数、最终降落质量。

import type { LandingMetrics } from './mission';

export interface ScoreInput {
  mainDone: boolean;
  optionalDone: number;
  optionalTotal: number;
  durability: number;
  collisions: number;
  finalLanding: LandingMetrics | null;
  /** 使用“安全恢复”的次数 */
  safeRecoveries: number;
}

export interface ScoreResult {
  total: number;
  rating: 'S' | 'A' | 'B' | 'C' | 'D';
  breakdown: Array<{ label: string; value: number; note?: string }>;
}

export const SCORE = {
  main: 600,
  perOptional: 120,
  durability: 2,
  collision: -15,
  collisionCap: -180,
  landingMax: 200,
  safeRecovery: -60,
  thresholds: { S: 1050, A: 900, B: 760, C: 620 },
};

export function computeScore(s: ScoreInput): ScoreResult {
  const b: ScoreResult['breakdown'] = [];
  b.push({ label: '主线任务', value: s.mainDone ? SCORE.main : 0, note: s.mainDone ? '完成' : '未完成' });
  b.push({ label: '可选任务', value: s.optionalDone * SCORE.perOptional, note: `${s.optionalDone}/${s.optionalTotal}` });
  b.push({ label: '剩余耐久', value: Math.round(Math.max(0, s.durability) * SCORE.durability), note: `${Math.round(s.durability)}` });
  b.push({ label: '碰撞', value: Math.max(SCORE.collisionCap, s.collisions * SCORE.collision), note: `${s.collisions} 次` });
  const landing = s.finalLanding ? Math.round((s.finalLanding.score / 100) * SCORE.landingMax) : 0;
  b.push({ label: '最终降落质量', value: landing, note: s.finalLanding ? `${Math.round(s.finalLanding.score)} 分` : '—' });
  if (s.safeRecoveries > 0) b.push({ label: '安全恢复', value: s.safeRecoveries * SCORE.safeRecovery, note: `${s.safeRecoveries} 次` });
  const total = Math.max(0, b.reduce((a, x) => a + x.value, 0));
  const T = SCORE.thresholds;
  const rating = !s.mainDone ? 'D' : total >= T.S ? 'S' : total >= T.A ? 'A' : total >= T.B ? 'B' : total >= T.C ? 'C' : 'D';
  return { total, rating, breakdown: b };
}
