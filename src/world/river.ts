// 河道：在地形上挖出河床，把两岸修到和水面差不多高，再画上卵石滩。水面本身在 render/riverView.ts。

import { smoothstep } from '../core/math';
import type { RiverDef, V3 } from '../maps/types';
import type { HeightBuilder, Vec2 } from '../sim/terrain';

/**
 * 河线的水面高度是按谷底估的。实际地形经过侵蚀，河线绕开建筑时还会偏到谷坡上，两岸可能比水面还低，
 * 水就架在半空。这里按两岸真实的地面把水面往下调，并保证一路往下流（pts 从上游排到下游）。
 */
export function settleRiver(hb: HeightBuilder, r: RiverDef): void {
  const n = hb.res;
  const ground = (x: number, z: number): number => {
    const fx = Math.min(n - 1.001, Math.max(0, (x + hb.half) / hb.cell));
    const fz = Math.min(n - 1.001, Math.max(0, (z + hb.half) / hb.cell));
    const ix = fx | 0;
    const iz = fz | 0;
    const u = fx - ix;
    const v = fz - iz;
    const d = hb.data;
    const o = iz * n + ix;
    return (d[o] * (1 - u) + d[o + 1] * u) * (1 - v) + (d[o + n] * (1 - u) + d[o + n + 1] * u) * v;
  };
  const pts = r.pts;
  const level = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    let low = p[2];
    for (const w of [p[3] + 3, p[3] + 9]) {
      low = Math.min(low, ground(p[0] + nx * w, p[1] + nz * w) - 0.4, ground(p[0] - nx * w, p[1] - nz * w) - 0.4);
    }
    return low;
  });
  for (let i = 1; i < level.length; i++) level[i] = Math.min(level[i], level[i - 1]);
  // 抹平台阶，再保证一次不往回流
  for (let pass = 0; pass < 3; pass++) {
    const prev = [...level];
    for (let i = 1; i + 1 < level.length; i++) level[i] = Math.min(prev[i], (prev[i - 1] + prev[i] * 2 + prev[i + 1]) / 4);
  }
  for (let i = 1; i < level.length; i++) level[i] = Math.min(level[i], level[i - 1]);
  pts.forEach((p, i) => {
    p[2] = level[i];
  });
}

export function carveRiver(hb: HeightBuilder, r: RiverDef, mask?: Float32Array): void {
  const pts = r.pts;
  const line: Vec2[] = pts.map((p) => [p[0], p[1]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (s: number): [number, number] => {
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= s) lo = m;
      else hi = m;
    }
    const t = cum[hi] > cum[lo] ? Math.min(1, Math.max(0, (s - cum[lo]) / (cum[hi] - cum[lo]))) : 0;
    return [pts[lo][2] + (pts[hi][2] - pts[lo][2]) * t, pts[lo][3] + (pts[hi][3] - pts[lo][3]) * t];
  };
  let maxHalf = 0;
  for (const p of pts) maxHalf = Math.max(maxHalf, p[3]);
  const reach = maxHalf * 1.6 + r.bank + 6;
  const res = hb.res;
  const size = hb.size;
  const cell = size / (res - 1);
  hb.applySpline(line, reach, (h, d, s, x, z, len) => {
    const [lv, hw] = at((s / len) * total);
    if (d >= hw + r.bank) return h;
    // 保护区（停机坪、建筑一带）不动地形，但河床除外：河线已经绕开了建筑，这里再不挖，河就钻到地下去了。
    // 水边挖到底，往外才慢慢回到保护区的高度
    const k0 = mask ? mask[Math.round((z + size / 2) / cell) * res + Math.round((x + size / 2) / cell)] : 1;
    const k = Math.max(k0, 1 - smoothstep(hw, hw + r.bank, d));
    if (k <= 0) return h;
    let v: number;
    if (d < hw) {
      const u = d / hw;
      v = lv - r.depth * (1 - u * u) - 0.15;
    } else {
      // 河岸：贴着水边比水面高一点点，再缓缓接回原来的地面
      const t = smoothstep(hw, hw + r.bank, d);
      v = lv + 0.35 + (h - lv - 0.35) * t;
    }
    return h + (v - h) * k;
  });
  if (r.bar) hb.paintPath(0, line, maxHalf + r.bar, 6, 0.85);
  // 河道和河滩上不长树
  hb.paintPath(2, line, maxHalf + 4, 4, 1);
}

/** 按离河道的距离判断某点是否落在 keep 圆里（生成河线时绕开停机坪和建筑） */
export function riverOffsets(pts: Array<{ x: number; z: number; nx: number; nz: number; off: number }>, keep: Array<[number, number, number]>): void {
  for (let pass = 0; pass < 6; pass++) {
    for (const p of pts) {
      for (const [kx, kz, kr] of keep) {
        const x = p.x + p.nx * p.off;
        const z = p.z + p.nz * p.off;
        const dx = x - kx;
        const dz = z - kz;
        const d = Math.hypot(dx, dz);
        if (d >= kr) continue;
        // 沿河道法线往远离圆心的一侧推
        const side = dx * p.nx + dz * p.nz >= 0 ? 1 : -1;
        p.off += side * (kr - d);
      }
    }
    // 抹平，不让河线在绕开的地方拐死弯
    for (let i = 1; i < pts.length - 1; i++) pts[i].off = (pts[i - 1].off + pts[i].off * 2 + pts[i + 1].off) / 4;
  }
}

export type { V3 };
