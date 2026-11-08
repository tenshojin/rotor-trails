// 外界气温：仪表上显示的和机载系统（排气温度、皮托管结冰、风挡起雾）用的是同一个数；下雪天贴着冰点
import { describe, expect, it } from 'vitest';
import { outsideAirTemp } from '../src/sim/weather';

describe('外界气温', () => {
  it('晴天按标准大气：海平面 15 ℃，每升 1000 m 降 6.5 ℃', () => {
    expect(outsideAirTemp(0, 0, 0)).toBeCloseTo(15, 5);
    expect(outsideAirTemp(2000, 0, 0)).toBeCloseTo(2, 5);
  });

  it('下雨凉几度', () => {
    expect(outsideAirTemp(0, 1, 0)).toBeCloseTo(12, 5);
  });

  it('下雪的时候在冰点上下，不会是 10 ℃ 的雪', () => {
    // 峡湾小雪（0.6）、训练场小雪（0.55）都在海平面附近
    expect(outsideAirTemp(0, 0, 0.6)).toBeLessThanOrEqual(0);
    expect(outsideAirTemp(400, 0, 0.55)).toBeLessThanOrEqual(0);
    expect(outsideAirTemp(0, 0, 0.6)).toBeGreaterThan(-8);
  });

  it('高原本来就比冰点冷，下雪不会让它变暖', () => {
    expect(outsideAirTemp(4000, 0, 0.75)).toBeCloseTo(15 - 26, 5);
  });

  it('天气慢慢转成下雪时气温连续地降下来，不会一下跳到冰点', () => {
    let prev = outsideAirTemp(0, 0, 0);
    for (let s = 0.005; s <= 0.6; s += 0.005) {
      const t = outsideAirTemp(0, 0, s);
      expect(prev - t).toBeLessThan(1.2);
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      prev = t;
    }
  });
});
