import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { smootherstep, smoothstep } from '../src/core/math';
import { WindField, type WindZoneDef } from '../src/sim/wind';

describe('零宽过渡边界', () => {
  it.each([smoothstep, smootherstep])('退化平滑过渡仍返回明确的阶跃值', (step) => {
    expect([step(5, 5, 4), step(5, 5, 5), step(5, 5, 6)]).toEqual([0, 1, 1]);
    expect(step(10, 0, 5)).toBe(0.5);
  });

  it('未羽化风区边界不会向飞行仿真传入 NaN', () => {
    const zone: WindZoneDef = { id: 'lift', name: '', a: [0, 0], b: [0, 0], radius: 100, feather: 0, kind: 'lift', vertical: 3 };
    const wind = new WindField({ dirFrom: 0, speed: 0, gustAmp: 0, turbulence: 0, zoneScale: 1 }, [zone], () => 0, 1);
    for (const x of [99, 100, 101]) {
      const sample = wind.sample(x, 50, 0, 0, new Vector3());
      expect(sample.toArray().every(Number.isFinite)).toBe(true);
      expect(sample.y).toBe(x < 100 ? 3 : 0);
    }
  });
});
