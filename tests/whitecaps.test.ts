// 海面白浪：覆盖比例按风速（Monahan 1980），没风没有白浪，风越大越多；门槛按噪声贴图的分布算，覆盖越多门槛越低
import { describe, expect, it } from 'vitest';
import { whitecapCover } from '../src/render/water';

describe('海面白浪', () => {
  it('覆盖比例随风速：4 m/s 几乎没有，9 m/s 约 0.7%，14 m/s 约 3%，最多两成', () => {
    expect(whitecapCover(0)).toBe(0);
    expect(whitecapCover(4)).toBeLessThan(0.0005);
    expect(whitecapCover(9)).toBeGreaterThan(0.005);
    expect(whitecapCover(9)).toBeLessThan(0.01);
    expect(whitecapCover(14)).toBeGreaterThan(0.025);
    expect(whitecapCover(14)).toBeLessThan(0.04);
    expect(whitecapCover(60)).toBe(0.2);
    let last = -1;
    for (let v = 0; v <= 25; v += 0.5) {
      const c = whitecapCover(v);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
  });
});
