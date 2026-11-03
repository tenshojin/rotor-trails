import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { DAMAGE, DamageModel, perfFactor, severityOf, statusOf, type DamageEvent } from '../src/sim/damage';
import type { ContactReport, HeliPart } from '../src/sim/physics';
import { FLAT } from './testmap';
import { run, sessionFor } from './helpers';

function contact(part: HeliPart, dv: number, started = false): ContactReport {
  return { part, tag: { kind: 'rock' }, impulse: dv * 1750, dv, started, dir: new Vector3(0, 1, 0) };
}

describe('耐久与损伤', () => {
  it('70 / 30 阈值与状态', () => {
    expect(statusOf(100)).toBe('normal');
    expect(statusOf(70)).toBe('normal');
    expect(statusOf(69.9)).toBe('damaged');
    expect(statusOf(30)).toBe('damaged');
    expect(statusOf(29.9)).toBe('critical');
    expect(statusOf(0)).toBe('destroyed');
  });

  it('性能随耐久连续、单调下降（没有突变的台阶）', () => {
    let prev = perfFactor(100);
    expect(prev).toBe(1);
    for (let d = 99; d >= 0; d--) {
      const p = perfFactor(d);
      expect(p).toBeLessThanOrEqual(prev);
      expect(prev - p).toBeLessThan(0.01);
      prev = p;
    }
    expect(perfFactor(0)).toBeGreaterThan(0.7);
    expect(severityOf(90)).toBe(0);
    expect(severityOf(10)).toBeGreaterThan(severityOf(40));
  });

  it('同一次碰撞的连续接触帧合并结算，只计一次碰撞', () => {
    const m = new DamageModel();
    const out: DamageEvent[] = [];
    // 0.3 秒内 18 个物理步都报告冲量
    for (let i = 0; i < 18; i++) m.processContacts([contact('cabin', 0.6)], i / 60, 1 / 60, 3, false, out);
    const total = out.reduce((s, e) => s + e.amount, 0);
    const expected = DAMAGE.scale.cabin * Math.pow(18 * 0.6 - DAMAGE.tolerance.cabin, DAMAGE.exponent);
    expect(m.collisions).toBe(1);
    expect(total).toBeCloseTo(expected, 1);
    expect(m.durability).toBeCloseTo(100 - expected, 1);
  });

  it('低于容差的轻触不扣耐久', () => {
    const m = new DamageModel();
    const out: DamageEvent[] = [];
    m.processContacts([contact('skid', 1.5)], 0, 1 / 60, 1, false, out);
    expect(m.durability).toBe(100);
    expect(m.collisions).toBe(0);
  });

  it('旋翼持续触碰：冷却时间内只结算一次', () => {
    const m = new DamageModel();
    const out: DamageEvent[] = [];
    for (let i = 0; i < 60; i++) m.processContacts([contact('rotor', 0)], i / 60, 1 / 60, 5, false, out);
    expect(out.filter((e) => e.cause === 'rotor').length).toBe(1);
    expect(m.collisions).toBe(1);
  });

  it('护盾阻止耐久损失，但碰撞仍然发生（计数、事件照常）', () => {
    const m = new DamageModel();
    const out: DamageEvent[] = [];
    m.processContacts([contact('rotor', 0)], 0, 1 / 60, 10, true, out);
    expect(m.durability).toBe(100);
    expect(m.collisions).toBe(1);
    expect(out[0].blocked).toBe(true);
    expect(out[0].amount).toBeGreaterThan(0);
  });

  it('维修恢复耐久且不超过 100；恢复后性能随之恢复', () => {
    const m = new DamageModel();
    m.durability = 50;
    const p50 = m.perf;
    expect(m.repair(25)).toBe(25);
    expect(m.durability).toBe(75);
    expect(m.perf).toBeGreaterThan(p50);
    expect(m.repair(40)).toBe(25);
    expect(m.durability).toBe(100);
    expect(m.perf).toBe(1);
  });

  it('接地：正常下降无损伤；重着陆按下降速度扣耐久；轻微重着陆不计为碰撞', () => {
    const m = new DamageModel();
    const out: DamageEvent[] = [];
    m.processTouchdown(1.4, 0.3, 3, false, out);
    expect(m.durability).toBe(100);
    m.processTouchdown(2.2, 0.3, 3, false, out);
    expect(m.durability).toBeLessThan(100);
    expect(m.collisions).toBe(0);
    m.processTouchdown(4.5, 0.3, 3, false, out);
    expect(m.collisions).toBe(1);
    expect(100 - m.durability).toBeGreaterThan(10);
  });

  it('飞行中受损后可用功率连续下降（会话内）', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    run(s, 4, { vertical: 1 });
    const p100 = s.flight.telemetry.powerAvail;
    s.damage.durability = 50;
    run(s, 0.5, {});
    const p50 = s.flight.telemetry.powerAvail;
    s.damage.durability = 20;
    run(s, 0.5, {});
    const p20 = s.flight.telemetry.powerAvail;
    expect(p50).toBeLessThan(p100);
    expect(p20).toBeLessThan(p50);
    expect(p20 / p100).toBeCloseTo(perfFactor(20), 2);
    s.damage.repair(100);
    run(s, 0.5, {});
    expect(s.flight.telemetry.powerAvail).toBeCloseTo(p100, 0);
    s.dispose();
  });
});
