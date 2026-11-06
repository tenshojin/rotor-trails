// 地图外面（只有画面，不碰撞）某一点的地面高度：地图边上的高度往外延伸，逐渐过渡到 farTerrain。
// 远景网格和水面倒影用的是同一份。

import type { MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';

export function farHeightAt(map: MapDef, hf: Heightfield, x: number, z: number): number {
  const cx = Math.max(-hf.half, Math.min(hf.half, x));
  const cz = Math.max(-hf.half, Math.min(hf.half, z));
  const edge = hf.heightAt(cx, cz);
  const out = Math.max(Math.abs(x) - hf.half, Math.abs(z) - hf.half, 0);
  const t = Math.min(1, out / (map.farBlend ?? 900));
  const farH = map.farTerrain ? map.farTerrain(x, z) : edge;
  return edge + (farH - edge) * t * t * (3 - 2 * t) - 2 - Math.min(6, out * 0.02);
}
