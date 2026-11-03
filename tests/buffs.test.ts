import { describe, it, expect } from 'vitest';
import { BUFFS, BuffSystem } from '../src/sim/buffs';
import { BOOST } from '../src/config/flight';
import { FLAT } from './testmap';
import { run, sessionFor } from './helpers';

describe('Buff 规则', () => {
  it('动力增强：拾取后储存 1 次，持有时不能再拾取；使用后约 7 秒，渐入渐出', () => {
    const b = new BuffSystem();
    expect(b.pickup('boost', 100)).toBe('stored');
    expect(b.pickup('boost', 100)).toBe('alreadyHolding');
    expect(b.boostCharges).toBe(1);
    expect(b.activateBoost()).toBe(true);
    expect(b.boostCharges).toBe(0);
    expect(b.activateBoost()).toBe(false);
    const dt = 1 / 60;
    let maxJump = 0;
    let prev = b.boostLevel;
    let t = 0;
    let tFull = -1;
    while (t < BOOST.duration + 3) {
      b.update(dt);
      t += dt;
      maxJump = Math.max(maxJump, Math.abs(b.boostLevel - prev));
      prev = b.boostLevel;
      if (tFull < 0 && b.boostLevel >= 0.999) tFull = t;
    }
    expect(tFull).toBeGreaterThan(BOOST.rampIn * 0.8);
    expect(maxJump).toBeLessThan(0.05);
    expect(b.boostLevel).toBe(0);
    expect(BUFFS.boost.duration).toBeGreaterThanOrEqual(6);
    expect(BUFFS.boost.duration).toBeLessThanOrEqual(8);
  });

  it('护盾：拾取即生效约 9 秒；重复拾取只能有限延长（上限 14 秒）', () => {
    const b = new BuffSystem();
    expect(b.pickup('shield', 100)).toBe('shield');
    expect(b.shieldTime).toBe(BUFFS.shield.duration);
    expect(b.pickup('shield', 100)).toBe('shieldExtended');
    expect(b.pickup('shield', 100)).toBe('shieldExtended');
    expect(b.shieldTime).toBe(BUFFS.shield.maxDuration);
    for (let i = 0; i < 60 * 15; i++) b.update(1 / 60);
    expect(b.shieldActive).toBe(false);
  });

  it('维修补给：耐久满时不被消耗', () => {
    const b = new BuffSystem();
    expect(b.pickup('repair', 100)).toBe('full');
    expect(b.pickup('repair', 60)).toBe('repaired');
  });

  it('计时基于仿真时间：不推进仿真（暂停）时 Buff 时间冻结', () => {
    const b = new BuffSystem();
    b.pickup('shield', 100);
    const t0 = b.shieldTime;
    // 暂停：不调用 update
    expect(b.shieldTime).toBe(t0);
    b.update(1);
    expect(b.shieldTime).toBeCloseTo(t0 - 1, 6);
  });

  it('动力增强通过物理生效：可用功率提高约 25%，爬升更快', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    run(s, 4, { vertical: 1 });
    const p0 = s.flight.telemetry.powerAvail;
    s.buffs.pickup('boost', 100);
    s.useBoost();
    run(s, 2, { vertical: 1 });
    const p1 = s.flight.telemetry.powerAvail;
    expect(p1 / p0).toBeGreaterThan(1.2);
    expect(p1 / p0).toBeLessThan(1.31);
    s.dispose();
  });

  it('会话内拾取：飞过补给点即拾取；维修补给在耐久满时保留在原处', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    // 维修补给 r1 在 (0,40,500)
    s.teleport(0, 40, 500, 0, 0);
    run(s, 0.2, {});
    expect(s.pickupsTaken.has('r1')).toBe(false);
    s.damage.durability = 60;
    run(s, 0.2, {});
    expect(s.pickupsTaken.has('r1')).toBe(true);
    expect(s.damage.durability).toBeCloseTo(85, 0);
    s.dispose();
  });

  it('检查点恢复：Buff 状态与已拾取记录一起恢复，不能反复刷补给', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    s.teleport(0, 40, 300, 0, 0); // 动力补给 b1
    run(s, 0.2, {});
    expect(s.buffs.boostCharges).toBe(1);
    s.saveCheckpoint('测试点');
    const cpIndex = s.checkpoints.length - 1;
    s.useBoost();
    run(s, 1, {});
    expect(s.buffs.boostCharges).toBe(0);
    s.teleport(0, 40, 400, 0, 0); // 护盾 s1（检查点之后拾取）
    run(s, 0.2, {});
    expect(s.pickupsTaken.has('s1')).toBe(true);
    s.restoreCheckpoint(cpIndex, 'exact');
    expect(s.buffs.boostCharges).toBe(1);
    expect(s.buffs.boostTime).toBe(0);
    expect(s.pickupsTaken.has('b1')).toBe(true); // 检查点前拾取的：保持已拾取
    expect(s.pickupsTaken.has('s1')).toBe(false); // 检查点后拾取的：随状态一起回退
    expect(s.buffs.shieldActive).toBe(false);
    s.dispose();
  });
});
