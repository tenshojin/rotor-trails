import { describe, it, expect } from 'vitest';
import { LANDING_LIMITS, gradeLanding } from '../src/sim/mission';
import { computeScore } from '../src/sim/scoring';
import { runAutopilot } from '../src/sim/autopilot';
import { FLAT } from './testmap';
import { run, sessionFor } from './helpers';

describe('着陆判定', () => {
  it('平稳、居中、姿态正常 → 安全且评级高', () => {
    const m = gradeLanding(0.7, 0.3, 2, 0.5, 10);
    expect(m.safe).toBe(true);
    expect(m.grade).toBe('perfect');
  });

  it('下降过快 / 漂移过大 / 姿态过大 / 不在坪上 → 不安全并给出原因', () => {
    expect(gradeLanding(LANDING_LIMITS.descent + 0.4, 0.3, 2, 0, 10).reasons[0]).toContain('下降速度过大');
    expect(gradeLanding(1, LANDING_LIMITS.horizontal + 0.5, 2, 0, 10).reasons[0]).toContain('水平漂移过大');
    expect(gradeLanding(1, 0.3, LANDING_LIMITS.attitude + 3, 0, 10).reasons[0]).toContain('姿态过大');
    expect(gradeLanding(1, 0.3, 2, 12, 10).reasons[0]).toContain('停机坪');
    expect(gradeLanding(3.5, 0.3, 2, 0, 10).safe).toBe(false);
  });

  it('评分随下降速度单调变差', () => {
    let prev = 101;
    for (let v = 0.5; v <= 2.4; v += 0.1) {
      const s = gradeLanding(v, 0.3, 2, 0.5, 10).score;
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('任务与检查点（测试平地）', () => {
  it('恢复检查点丢弃旧输入、待触发操作、维修与接触状态', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    try {
      run(s, 6, { vertical: 1 });
      s.buffs.boostCharges = 1;
      s.saveCheckpoint('空中恢复');
      const idx = s.checkpoints.length - 1;
      const hover = s.flight.hoverOn;
      s.t = 100;
      s.cycleNav();
      s.toggleHover();
      s.useBoost();
      s.repairProgress = 0.98;
      s.settledPad = 'R';
      s.terrainWarning = 2;
      s.input.pitch = 1;
      s.restoreCheckpoint(idx, 'exact');
      expect(s.input).toEqual({ pitch: 0, turn: 0, lateral: 0, vertical: 0 });
      expect(s.repairProgress).toBe(0);
      expect(s.settledPad).toBeNull();
      expect(s.terrainWarning).toBeNull();
      s.cycleNav();
      expect(s.drainEvents().some((e) => e.type === 'message')).toBe(true);
      s.step();
      expect(s.buffs.boostCharges).toBe(1);
      expect(s.buffs.boostActive).toBe(false);
      expect(s.flight.hoverOn).toBe(hover);
      expect(s.state).toBe('running');
    } finally {
      s.dispose();
    }
  });

  it('自动驾驶（只通过飞行员输入）能完成降落任务并给出结算', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    const r = runAutopilot(s, 240);
    expect(r.completed).toBe(true);
    expect(r.collisions).toBe(0);
    const sc = computeScore({
      mainDone: s.mission.complete,
      optionalDone: s.mission.optionalDone,
      optionalTotal: s.mission.optional.length,
      durability: s.damage.durability,
      collisions: s.damage.collisions,
      finalLanding: s.mission.finalLanding,
      safeRecoveries: s.stats.safeRecoveries,
    });
    expect(s.mission.finalLanding?.safe).toBe(true);
    expect(sc.total).toBeGreaterThan(800);
    expect(['S', 'A', 'B']).toContain(sc.rating);
    s.dispose();
  });

  it('坠毁后可从检查点恢复（精确 / 安全悬停两种方式），不会卡死', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    run(s, 6, { vertical: 1 });
    s.saveCheckpoint('空中');
    const idx = s.checkpoints.length - 1;
    // 制造坠毁：高速撞墙
    s.teleport(2300, 60, 0, 90, 75);
    for (let i = 0; i < 600 && s.state === 'running'; i++) {
      s.input.pitch = 1;
      s.step();
    }
    if (s.state === 'running') s.damage.durability = 0;
    run(s, 0.1, {});
    expect(s.state).toBe('crashed');
    const opts = s.restoreOptions();
    expect(opts.length).toBeGreaterThan(0);
    s.restoreCheckpoint(idx, 'safe');
    expect(s.state).toBe('running');
    expect(s.damage.durability).toBeGreaterThanOrEqual(40);
    expect(s.body.vel.length()).toBe(0);
    run(s, 5, {});
    expect(s.state).toBe('running');
    expect(s.agl).toBeGreaterThan(5);
    s.dispose();
  });
});

describe('评分（不使用时间）', () => {
  const base = { mainDone: true, optionalDone: 0, optionalTotal: 2, durability: 100, collisions: 0, finalLanding: gradeLanding(0.6, 0.2, 1, 0.3, 10), safeRecoveries: 0 };
  it('碰撞、耐久、安全恢复按规则扣分；未完成主线为 D', () => {
    const clean = computeScore(base);
    const bumped = computeScore({ ...base, collisions: 3, durability: 70 });
    expect(bumped.total).toBeLessThan(clean.total);
    expect(computeScore({ ...base, collisions: 100 }).total).toBeGreaterThanOrEqual(clean.total - 180 - 1);
    expect(computeScore({ ...base, safeRecoveries: 1 }).total).toBe(clean.total - 60);
    expect(computeScore({ ...base, mainDone: false }).rating).toBe('D');
    expect(computeScore({ ...base, optionalDone: 2 }).total).toBe(clean.total + 240);
  });
});
