import { describe, it, expect } from 'vitest';
import { TRAINING } from '../src/maps/training';
import { run, sessionFor } from './helpers';

describe('飞行物理（训练场）', () => {
  it('静止在停机坪上保持稳定，不会弹跳或滑动', async () => {
    const s = await sessionFor(TRAINING);
    const y0 = s.body.pos.y;
    run(s, 4);
    expect(Math.abs(s.body.pos.y - y0)).toBeLessThan(0.3);
    expect(s.body.vel.length()).toBeLessThan(0.05);
    expect(s.gear.contactCount).toBe(4);
    expect(s.damage.durability).toBe(100);
    s.dispose();
  });

  it('按 Space 起飞，松开后保持高度（标准辅助）', async () => {
    const s = await sessionFor(TRAINING);
    const y0 = s.body.pos.y;
    run(s, 6, { vertical: 1 });
    const climbed = s.body.pos.y - y0;
    expect(climbed).toBeGreaterThan(15);
    run(s, 8, {});
    const yHold = s.body.pos.y;
    run(s, 6, {});
    expect(Math.abs(s.body.pos.y - yHold)).toBeLessThan(2.0);
    expect(Math.abs(s.body.vel.y)).toBeLessThan(0.6);
    s.dispose();
  });

  it('前倾加速有惯性：速度逐渐增加，松开后不会瞬间停止', async () => {
    const s = await sessionFor(TRAINING);
    run(s, 6, { vertical: 1 });
    run(s, 3, {});
    run(s, 2, { pitch: 1 });
    const v2 = s.groundSpeed;
    run(s, 8, { pitch: 1 });
    const v10 = s.groundSpeed;
    expect(v2).toBeLessThan(10);
    expect(v10).toBeGreaterThan(v2 + 10);
    run(s, 1, {});
    expect(s.groundSpeed).toBeGreaterThan(v10 * 0.85);
    s.dispose();
  });
});
