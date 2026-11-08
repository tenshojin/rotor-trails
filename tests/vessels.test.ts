// 走的船：航线都在够深的水上，图里的船模型都存在，河上的航线不上岸；
// 尾浪平贴着水面（两边一样高，不跟着船身横摇沉下去），顺着航迹往后张开
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { AMAZON } from '../src/maps/amazon';
import type { ModelLib } from '../src/render/modelLib';
import { Vessels, WAKE_TAN } from '../src/render/vessels';
import { findLoop, VesselMover } from '../src/sim/movers';

vi.mock('../src/render/modelLib', async (original) => ({
  ...(await original<typeof import('../src/render/modelLib')>()),
  instanceModel: () => [],
}));

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

  it('尾浪平贴水面、左右对称，顺着航线往后越张越开', () => {
    const loop = findLoop(sea, 0, 2000, 7)!;
    const mover = new VesselMover({ model: 'ferry', len: 46, speed: 7.5, bow: 1 }, loop, 2, 0);
    const v = new Vessels([mover], { templates: new Map([['ferry', {}]]) } as unknown as ModelLib);
    for (const t of [0, 13.7, 61, 230]) {
      v.update(t);
      const P = v.wakePoints(0)!;
      const rows = P.length / 9;
      let lastW = -1;
      for (let i = 0; i < rows; i++) {
        const k = i * 9;
        // 三个点都在水面上方同一个高度（船身横摇不带着尾浪）
        expect(P[k + 1]).toBeCloseTo(2.05, 5);
        expect(P[k + 4]).toBeCloseTo(2.05, 5);
        expect(P[k + 7]).toBeCloseTo(2.05, 5);
        // 中间的点在左右两点正中
        expect((P[k] + P[k + 6]) / 2).toBeCloseTo(P[k + 3], 4);
        expect((P[k + 2] + P[k + 8]) / 2).toBeCloseTo(P[k + 5], 4);
        const w = Math.hypot(P[k + 6] - P[k], P[k + 8] - P[k + 2]) / 2;
        expect(w).toBeGreaterThanOrEqual(lastW - 1e-3);
        lastW = w;
      }
      // 尾巴上张开的宽度是开尔文角
      expect(lastW).toBeCloseTo(46 * 5 * WAKE_TAN, 0);
      // 中线走的就是船的航线：离航线上的点不远（航线是 64 段的折线）
      const c = new THREE.Vector2(P[(rows - 1) * 9 + 3], P[(rows - 1) * 9 + 5]);
      const near = Math.min(...loop.map(([x, z]) => c.distanceTo(new THREE.Vector2(x, z))));
      expect(near).toBeLessThan(60);
    }
    v.dispose();
  });
});
