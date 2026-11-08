// 水面倒影：① 一次渲染只拷一次画面（以前每个取样点各拷一遍）；② 风把海面吹皱以后，远处的倒影淡下去
import { describe, expect, it } from 'vitest';
import { vec2 } from 'three/tsl';
import { frameCopy } from '../src/render/mirror';
import { seaRoughness } from '../src/render/water';

describe('画面拷贝', () => {
  it('海面、河面、风挡所有取样都从同一个节点出来，按它去重：一次渲染只拷一次', () => {
    const f = frameCopy();
    expect(frameCopy()).toBe(f);
    const a = f.sample(vec2(0.1, 0.2));
    const b = f.sample(vec2(0.7, 0.4));
    expect(a).not.toBe(b);
    // three.js 按 updateReference 的返回值记“这次渲染拷过没有”：两个取样点返回的是同一个东西
    const frame = {} as never;
    expect(a.updateReference(frame)).toBe(f);
    expect(b.updateReference(frame)).toBe(f);
    // 拷进来的还是 three.js 共用的那张画面贴图
    expect(a.value).toBe(f.value);
  });
});

describe('海面被风吹皱', () => {
  it('2 m/s 以下像镜子，10 m/s 以上吹满，中间平滑变大', () => {
    expect(seaRoughness(0, 0)).toBe(0);
    expect(seaRoughness(2, 0)).toBe(0);
    expect(seaRoughness(4, 0)).toBeLessThan(0.2);
    expect(seaRoughness(6, 0)).toBeCloseTo(0.5, 5);
    expect(seaRoughness(9, 0)).toBeGreaterThan(0.9);
    expect(seaRoughness(10, 0)).toBe(1);
    expect(seaRoughness(20, 0)).toBe(1);
    let last = -1;
    for (let v = 0; v <= 15; v += 0.25) {
      const r = seaRoughness(v, 0);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it('下雨的雨点也把水面打毛：小雨一点，暴雨六成', () => {
    expect(seaRoughness(2, 0.35)).toBeCloseTo(0.21, 5);
    expect(seaRoughness(2, 1)).toBeCloseTo(0.6, 5);
    // 风已经吹得更皱时按风算
    expect(seaRoughness(10, 0.35)).toBe(1);
  });
});
