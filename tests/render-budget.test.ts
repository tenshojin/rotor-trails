import { describe, expect, it } from 'vitest';
import { drawingRatio, PIXEL_BUDGET } from '../src/render/renderBudget';
import { QUALITY, type QualityId } from '../src/game/settings';

describe('device-independent pixel budgets', () => {
  it.each([
    [390, 844, 3], [844, 390, 3], [1024, 1366, 2], [1920, 1080, 1],
    [3840, 2160, 1], [3840, 2160, 2], [7680, 4320, 2], [16000, 600, 1],
  ])('bounds portrait, landscape, Retina, 4K/8K and ultrawide rendering: %s × %s @ %s', (w, h, dpr) => {
    for (const quality of Object.keys(QUALITY) as QualityId[]) {
      const r = drawingRatio(w, h, dpr, quality, 1, 4096);
      expect(w * h * r * r).toBeLessThanOrEqual(PIXEL_BUDGET[quality] + 0.001);
      expect(Math.max(w, h) * r).toBeLessThanOrEqual(4096);
      expect(r).toBeLessThanOrEqual(Math.min(dpr, QUALITY[quality].pixelRatio));
    }
  });

  it('reduces 4K Low from 3072 × 1728 to 1280 × 720 without changing UI coordinates', () => {
    const ratio = drawingRatio(3840, 2160, 1, 'low', 1);
    expect(3840 * ratio).toBe(1280);
    expect(2160 * ratio).toBe(720);
    expect(drawingRatio(3840, 2160, 1, 'low', 0.5)).toBe(ratio * 0.5);
    expect(drawingRatio(1280, 720, 2, 'high', 0.5)).toBe(1.5);
  });

  it('handles invalid device measurements and never upscales beyond a preset', () => {
    expect(drawingRatio(0, NaN, Infinity, 'low', NaN)).toBe(0.8);
    expect(drawingRatio(1280, 720, 2, 'low', 2)).toBe(0.8);
    expect(drawingRatio(1280, 720, 0, 'low', -1)).toBe(0.4);
  });
});
