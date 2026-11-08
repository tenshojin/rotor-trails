// 任务目标的烟：没风是一根直柱，风越大升得越慢、斜着拖出去（看得出风向）。
import { describe, expect, it } from 'vitest';
import { SmokePlume } from '../src/render/smokePlume';

/** 放出来 a 秒的烟团在风 u 下：横着飘了多远、升了多高 */
function where(a: number, u: number): [number, number] {
  let x = 0;
  for (let s = 0; s < a; s += 0.05) x += u * SmokePlume.blow(s) * 0.05;
  return [x, SmokePlume.rise(a, SmokePlume.riseScale(u))];
}

describe('目标烟柱', () => {
  it('没风时直着往上升', () => {
    const [x, y] = where(10, 0);
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(50);
  });

  it('风越大烟柱越斜：9 m/s 时斜着拖出去', () => {
    let last = 90;
    for (const u of [2, 4, 6, 9, 12]) {
      const [x, y] = where(10, u);
      const deg = (Math.atan2(y, x) * 180) / Math.PI;
      expect(deg).toBeLessThan(last);
      last = deg;
    }
    const [x9, y9] = where(10, 9);
    expect((Math.atan2(y9, x9) * 180) / Math.PI).toBeLessThan(30);
    // 还是要升到树梢以上，远处看得见
    expect(y9).toBeGreaterThan(20);
  });
});
