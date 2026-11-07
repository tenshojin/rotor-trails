// 走的船：航线都在够深的水上，图里的船模型都存在，河上的航线不上岸
import { describe, expect, it } from 'vitest';
import { AMAZON } from '../src/maps/amazon';
import { findLoop } from '../src/render/vessels';

/** 一片海，中间一座岛 */
const sea = (x: number, z: number): number => (Math.hypot(x, z) < 500 ? 20 : -30);

describe('走的船', () => {
  it('找到的圈整个都在水上，离岛有距离', () => {
    const loop = findLoop(sea, 0, 2000, 7);
    expect(loop).not.toBeNull();
    for (const [x, z] of loop!) {
      expect(Math.hypot(x, z)).toBeGreaterThan(500);
      expect(Math.abs(x)).toBeLessThan(2000);
      expect(Math.abs(z)).toBeLessThan(2000);
    }
  });

  it('同样的种子是同一条航线', () => {
    expect(findLoop(sea, 0, 2000, 3)).toEqual(findLoop(sea, 0, 2000, 3));
  });

  it('全是陆地就不开船', () => {
    expect(findLoop(() => 40, 0, 2000, 1)).toBeNull();
  });

  it('亚马孙的客船沿河走，航线闭合，不跳', () => {
    for (const v of AMAZON.vessels ?? []) {
      const r = v.route!;
      expect(r.length).toBeGreaterThan(100);
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(260);
      }
    }
  });
});
