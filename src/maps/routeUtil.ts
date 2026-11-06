// 航线工具：沿地形样条（峡谷、河道、峡湾、山谷）自动生成航点，保证航线与地形走向一致。

import { riverOffsets } from '../world/river';
import { densifyPath, type Vec2 } from '../sim/terrain';
import type { RouteNodeDef, V3 } from './types';

export class PathSampler {
  readonly pts: Vec2[];
  readonly cum: number[];
  readonly len: number;

  constructor(ctrl: Vec2[]) {
    this.pts = densifyPath(ctrl, 6);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }

  at(s: number): Vec2 {
    s = Math.max(0, Math.min(this.len, s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo];
    const t = seg > 0 ? (s - this.cum[lo]) / seg : 0;
    return [this.pts[lo][0] + (this.pts[hi][0] - this.pts[lo][0]) * t, this.pts[lo][1] + (this.pts[hi][1] - this.pts[lo][1]) * t];
  }

  /** 最近点的弧长 */
  arcOf(x: number, z: number): number {
    let best = Infinity;
    let bs = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const d = Math.hypot(this.pts[i][0] - x, this.pts[i][1] - z);
      if (d < best) {
        best = d;
        bs = this.cum[i];
      }
    }
    return bs;
  }

  point(s: number, y: number): V3 {
    const p = this.at(s);
    return [Math.round(p[0]), Math.round(y), Math.round(p[1])];
  }

  /** 在弧长 s0→s1 之间每隔 step 生成航点（不含端点外的部分）。 */
  nodes(prefix: string, s0: number, s1: number, step: number, alt: (s: number) => number, base: Partial<RouteNodeDef> & { label: string }, extra: Record<number, Partial<RouteNodeDef>> = {}): RouteNodeDef[] {
    const out: RouteNodeDef[] = [];
    const dir = s1 >= s0 ? 1 : -1;
    const total = Math.abs(s1 - s0);
    const n = Math.max(1, Math.round(total / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + (dir * total * i) / n;
      out.push({
        id: `${prefix}${i}`,
        pos: this.point(s, alt(s)),
        radius: base.radius ?? 45,
        speed: base.speed,
        label: base.label,
        clearance: base.clearance,
        ...extra[i],
      });
    }
    return out;
  }
}

/**
 * 沿一条中心线做河：off(s) 是偏离中心线的距离（河在谷底蜿蜒），keep 里的圆（停机坪、建筑）要绕开。
 * 返回沿下游方向排列的点 [x, z, 水面高度, 半宽]；level 随 s 升高时自动反过来排。
 */
/** 点到折线的距离（地图外的河谷用；只有这一段折线的范围附近才算） */
export function polylineDist(path: Vec2[], x: number, z: number, reach: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [px, pz] of path) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  if (x < minX - reach || x > maxX + reach || z < minZ - reach || z > maxZ + reach) return Infinity;
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 地图外面的河（只有画面）：沿折线等距取点，水面跟着远景地形一起下沉（见 TerrainView.buildFar），
 * 否则河是浮在半空的。half：河面半宽。
 */
export function farRiverLine(path: Vec2[], mapSize: number, level: number, half: number, step = 45): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n + (i + 2 === path.length ? 1 : 0); k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const beyond = Math.max(0, Math.abs(x) - mapSize / 2, Math.abs(z) - mapSize / 2);
      out.push([x, z, level - 2 - Math.min(6, beyond * 0.02), half]);
    }
  }
  return out;
}

export function riverLine(
  P: PathSampler,
  s0: number,
  s1: number,
  step: number,
  off: (s: number) => number,
  level: (s: number) => number,
  half: (s: number) => number,
  keep: Array<[number, number, number]>,
): Array<[number, number, number, number]> {
  const pts: Array<{ x: number; z: number; nx: number; nz: number; off: number; s: number }> = [];
  for (let s = s0; s <= s1; s += step) {
    const c = P.at(s);
    const a = P.at(s - 6);
    const b = P.at(s + 6);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    pts.push({ x: c[0], z: c[1], nx: -(b[1] - a[1]) / l, nz: (b[0] - a[0]) / l, off: off(s), s });
  }
  riverOffsets(pts, keep);
  const out = pts.map((p): [number, number, number, number] => [p.x + p.nx * p.off, p.z + p.nz * p.off, level(p.s), half(p.s)]);
  return out[0][2] < out[out.length - 1][2] ? out.reverse() : out;
}
