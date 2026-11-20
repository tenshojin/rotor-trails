import { QUALITY, type QualityId } from '../game/settings';

/** Bound total GPU work as well as DPR: a 4K desktop at DPR 1 is still 8 million pixels. */
export const PIXEL_BUDGET: Record<QualityId, number> = {
  low: 1280 * 720,
  medium: 1920 * 1080,
  high: 2560 * 1440,
  ultra: 3840 * 2160,
};

export function drawingRatio(width: number, height: number, dpr: number, quality: QualityId, scale: number, maxDimension = 8192): number {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const deviceRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const limit = Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : 8192;
  const base = Math.min(deviceRatio, QUALITY[quality].pixelRatio, Math.sqrt(PIXEL_BUDGET[quality] / (w * h)), limit / w, limit / h);
  // Low uses browser scaling; other tiers use temporal upscaling inside the post pipeline.
  return base * (quality === 'low' ? Math.min(1, Math.max(0.5, Number.isFinite(scale) ? scale : 1)) : 1);
}
