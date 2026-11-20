// 地形宏观图的数据（贴图本身在 render/terrainMacro.ts 里做）。不能 import three.js：后台线程（workers/gen.worker.ts）也算这个。

import type { Heightfield } from '../sim/terrain';

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[row + Math.min(n - 1, Math.max(0, i))];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = s / w;
      s += src[row + Math.min(n - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(n - 1, Math.max(0, i)) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = s / w;
      s += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
  return out;
}

const DIRS: Array<[number, number]> = [[1, 0], [0.71, 0.71], [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71], [0, -1], [0.71, -0.71]];
const REACH = [3, 8, 20, 44];

/** 地形宏观图的像素（RGBA，每格一个）：R 小尺度凹凸、G 大尺度凹凸、B 天空可见度、A 平滑后的坡度（见 render/terrainMacro.ts） */
export function terrainMacroData(t: Heightfield): Uint8Array {
  const n = t.res;
  const h = t.data;
  // 两次盒式模糊接近高斯
  const small = boxBlur(boxBlur(h, n, 2), n, 2);
  const big = boxBlur(boxBlur(h, n, 8), n, 7);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const c1 = Math.max(-1, Math.min(1, (small[i] - h[i]) / 2.5));
      const c2 = Math.max(-1, Math.min(1, (big[i] - small[i]) / 14));
      // 天空可见度：八个方向上最高的地平线仰角
      let occ = 0;
      const h0 = h[i];
      for (const [dx, dy] of DIRS) {
        let m = 0;
        for (const r of REACH) {
          const px = x + Math.round(dx * r);
          const py = y + Math.round(dy * r);
          if (px < 0 || py < 0 || px >= n || py >= n) break;
          const s = (h[py * n + px] - h0) / (r * t.cell);
          if (s > m) m = s;
        }
        occ += m / Math.sqrt(1 + m * m);
      }
      const sky = 1 - occ / DIRS.length;
      const o = i * 4;
      data[o] = Math.round((c1 * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((c2 * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(sky * 255);
      const xl = Math.max(0, x - 1);
      const xr = Math.min(n - 1, x + 1);
      const yl = Math.max(0, y - 1);
      const yr = Math.min(n - 1, y + 1);
      const sx = (small[y * n + xr] - small[y * n + xl]) / ((xr - xl) * t.cell);
      const sy = (small[yr * n + x] - small[yl * n + x]) / ((yr - yl) * t.cell);
      data[o + 3] = Math.round((1 - 1 / Math.sqrt(1 + sx * sx + sy * sy)) * 255);
    }
  }
  return data;
}
