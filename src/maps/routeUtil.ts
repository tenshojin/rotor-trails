// 航线工具：沿地形样条（峡谷、河道、峡湾、山谷）自动生成航点，保证航线与地形走向一致。

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
