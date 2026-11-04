import { describe, expect, it } from 'vitest';
import { Heightfield } from '../src/sim/terrain';
import { flowAt, makeFlowMap } from '../src/world/flow';

/** 一条从北往南倾斜、中间一道沟的山坡 */
function valley(n = 129, size = 1024): Heightfield {
  const d = new Float32Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const cx = Math.abs(x - n / 2) / n;
      d[z * n + x] = (n - z) * 0.5 + cx * 40;
    }
  return new Heightfield(size, n, d);
}

describe('汇流图', () => {
  it('水往沟里汇，越往下游越大', () => {
    const t = valley();
    const f = makeFlowMap(t, null);
    const upper = flowAt(f, t.size, 0, -300);
    const lower = flowAt(f, t.size, 0, 300);
    const side = flowAt(f, t.size, 350, 300);
    expect(lower).toBeGreaterThan(upper);
    expect(lower).toBeGreaterThan(side);
  });

  it('洼地也有出口：盆地里的水连得起来，不会断在坑里', () => {
    const t = valley();
    const n = t.res;
    // 沟中段挖一个坑
    for (let z = 60; z < 68; z++) for (let x = 60; x < 68; x++) t.data[z * n + x] -= 12;
    const f = makeFlowMap(t, null);
    expect(flowAt(f, t.size, 0, 300)).toBeGreaterThan(0.4);
  });

  it('海面以下不累积（水到海里就结束）', () => {
    const t = valley();
    const f = makeFlowMap(t, 20);
    expect(flowAt(f, t.size, 0, 500)).toBeLessThanOrEqual(1);
    expect(f.data.length).toBe(f.n * f.n);
  });
});
