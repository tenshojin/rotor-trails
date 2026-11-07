// 山壁的回声：左右分得清，高过山顶就没有了，开阔地没有
import { describe, expect, it } from 'vitest';
import { wallDistances } from '../src/sim/echo';

/** 一条南北向的峡谷：x = -200 和 x = 300 各有一面 500 米高的墙 */
const canyon = (x: number): number => (x < -200 || x > 300 ? 500 : 0);

describe('山壁的回声', () => {
  it('朝北飞：左边是西墙，右边是东墙', () => {
    const [l, r] = wallDistances(canyon, 0, 100, 0, 0);
    expect(l).toBeGreaterThan(180);
    expect(l).toBeLessThan(240);
    expect(r).toBeGreaterThan(280);
    expect(r).toBeLessThan(340);
  });

  it('掉头朝南：左右换过来', () => {
    const [l, r] = wallDistances(canyon, 0, 100, 0, Math.PI);
    expect(l).toBeGreaterThan(r);
  });

  it('飞过山顶就没有墙了', () => {
    expect(wallDistances(canyon, 0, 600, 0, 0)).toEqual([0, 0]);
  });

  it('开阔地没有回声', () => {
    expect(wallDistances(() => 0, 0, 100, 0, 1)).toEqual([0, 0]);
  });

  it('墙太远听不见', () => {
    expect(wallDistances((x) => (Math.abs(x) > 2000 ? 500 : 0), 0, 100, 0, 0)).toEqual([0, 0]);
  });
});
