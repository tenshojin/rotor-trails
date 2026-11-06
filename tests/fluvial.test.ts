import { describe, expect, it } from 'vitest';
import { dissect } from '../src/world/fluvial';

/** 一块向一边倾斜的坡，上面加一点起伏 */
function slope(res: number): Float32Array {
  const d = new Float32Array(res * res);
  for (let y = 0; y < res; y++)
    for (let x = 0; x < res; x++) d[y * res + x] = 300 * (x / (res - 1)) + 6 * Math.sin(y * 0.37) * Math.cos(x * 0.21) + 3 * Math.sin(y * 0.11 + x * 0.17);
  return d;
}

const opts = { grid: 65, steps: 24, k: 0.04, maxCut: 120, size: 2048, seed: 7, waterLevel: null };

describe('河流下切', () => {
  it('只往下切，不往上堆，切深不超过上限', () => {
    const res = 129;
    const a = slope(res);
    const b = Float32Array.from(a);
    dissect(b, res, opts);
    let deepest = 0;
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeLessThanOrEqual(a[i] + 1e-3);
      deepest = Math.max(deepest, a[i] - b[i]);
    }
    expect(deepest).toBeGreaterThan(5);
    expect(deepest).toBeLessThan(opts.maxCut * 1.2);
  });

  it('切出来的是沟：同一高度带上有深有浅', () => {
    const res = 129;
    const a = slope(res);
    const b = Float32Array.from(a);
    dissect(b, res, opts);
    const x = 96;
    const cuts: number[] = [];
    for (let y = 8; y < res - 8; y++) cuts.push(a[y * res + x] - b[y * res + x]);
    expect(Math.max(...cuts) - Math.min(...cuts)).toBeGreaterThan(4);
  });

  it('保护图为 0 的地方一点不动', () => {
    const res = 129;
    const a = slope(res);
    const b = Float32Array.from(a);
    const mask = new Float32Array(res * res).fill(1);
    for (let y = 50; y < 80; y++) for (let x = 60; x < 90; x++) mask[y * res + x] = 0;
    dissect(b, res, { ...opts, mask });
    for (let y = 56; y < 74; y++) for (let x = 66; x < 84; x++) expect(Math.abs(b[y * res + x] - a[y * res + x])).toBeLessThan(0.5);
  });

  it('水面以下不动', () => {
    const res = 129;
    const a = slope(res);
    for (let i = 0; i < a.length; i++) a[i] -= 100;
    const b = Float32Array.from(a);
    dissect(b, res, { ...opts, waterLevel: 0 });
    for (let i = 0; i < a.length; i++) if (a[i] < -20) expect(Math.abs(b[i] - a[i])).toBeLessThan(1);
  });

  it('同样的种子结果一样', () => {
    const res = 129;
    const a = slope(res);
    const b = Float32Array.from(a);
    dissect(a, res, opts);
    dissect(b, res, opts);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
