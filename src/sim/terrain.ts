// 地形高度场：碰撞（Rapier heightfield）、渲染网格、导航净空检查共用同一份数据。
// 布局：行优先，index = iz * res + ix；x = -size/2 + ix*cell，z = -size/2 + iz*cell。
// 三角剖分与 Rapier（parry）默认方式一致：每个格子沿 (x0,z1)-(x1,z0) 对角线切成两个三角形，
// 因此 heightAt() 返回的高度与物理碰撞面完全一致（有单元测试校验）。

import { clamp, segDist2D, smoothstep } from '../core/math';

export type Vec2 = [number, number];

export class Heightfield {
  readonly size: number;
  readonly res: number;
  readonly cell: number;
  readonly half: number;
  readonly data: Float32Array;
  minH = Infinity;
  maxH = -Infinity;

  constructor(size: number, res: number, data: Float32Array) {
    this.size = size;
    this.res = res;
    this.cell = size / (res - 1);
    this.half = size / 2;
    this.data = data;
    for (let i = 0; i < data.length; i++) {
      const h = data[i];
      if (h < this.minH) this.minH = h;
      if (h > this.maxH) this.maxH = h;
    }
  }

  grid(ix: number, iz: number): number {
    const r = this.res;
    ix = ix < 0 ? 0 : ix >= r ? r - 1 : ix;
    iz = iz < 0 ? 0 : iz >= r ? r - 1 : iz;
    return this.data[iz * r + ix];
  }

  /** 与物理碰撞面一致的高度。 */
  heightAt(x: number, z: number): number {
    const gx = clamp((x + this.half) / this.cell, 0, this.res - 1.000001);
    const gz = clamp((z + this.half) / this.cell, 0, this.res - 1.000001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const r = this.res;
    const i0 = iz * r + ix;
    const h00 = this.data[i0];
    const hx = this.data[i0 + 1];
    const hz = this.data[i0 + r];
    const hxz = this.data[i0 + r + 1];
    if (fx + fz <= 1) return h00 + fx * (hx - h00) + fz * (hz - h00);
    return hxz + (1 - fx) * (hz - hxz) + (1 - fz) * (hx - hxz);
  }

  /** 平滑法线（中心差分），用于着色与坡度判断。 */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }) {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nx /= l;
    ny /= l;
    nz /= l;
    out.x = nx;
    out.y = ny;
    out.z = nz;
    return out;
  }

  /** 坡度：0 = 水平，1 = 垂直。 */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z).y;
  }

  /** 圆形范围内的最高地形（用于航线净空）。 */
  maxInRadius(x: number, z: number, r: number, samples = 12): number {
    let m = this.heightAt(x, z);
    for (let ring = 1; ring <= 2; ring++) {
      const rr = (r * ring) / 2;
      for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        const h = this.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
        if (h > m) m = h;
      }
    }
    return m;
  }

  /** 线段上的最高地形（含两侧余量）。 */
  maxAlongSegment(ax: number, az: number, bx: number, bz: number, lateral: number, step = 8): number {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    let m = -Infinity;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const h = lateral > 0 ? this.maxInRadius(x, z, lateral, 8) : this.heightAt(x, z);
      if (h > m) m = h;
    }
    return m;
  }

  inside(x: number, z: number, margin = 0): boolean {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }

  /** 转换为 Rapier heightfield 需要的列优先矩阵（行 = z，列 = x）。 */
  toRapierHeights(): Float32Array {
    const r = this.res;
    const out = new Float32Array(r * r);
    for (let iz = 0; iz < r; iz++) {
      for (let ix = 0; ix < r; ix++) out[iz + ix * r] = this.data[iz * r + ix];
    }
    return out;
  }
}

/** 加密折线：Catmull-Rom 插值，间距约 step 米。 */
export function densifyPath(points: Vec2[], step = 6, closed = false): Vec2[] {
  if (points.length < 2) return points.slice();
  const pts = closed ? [...points, points[0]] : points;
  const out: Vec2[] = [];
  const get = (i: number): Vec2 => {
    if (closed) return pts[(i + pts.length - 1) % (pts.length - 1)];
    return pts[clamp(i, 0, pts.length - 1)];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = get(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z =
        0.5 *
        (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function pathLength(path: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return l;
}

/** 折线上的点：按弧长 s 取位置和切线方向。 */
export function pointOnPath(path: Vec2[], s: number): { p: Vec2; dir: Vec2 } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= s || i === path.length - 1) {
      const t = l > 0 ? clamp((s - acc) / l, 0, 1) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] };
    }
    acc += l;
  }
  return { p: path[path.length - 1], dir: [1, 0] };
}

export interface SplineField {
  dist: Float32Array;
  s: Float32Array;
  length: number;
}

/**
 * 地形构建器：各地图用它组合基础噪声、河道/峡谷/峡湾雕刻、平台压平等操作。
 * 同时维护一张地表材质掩码（R 湿地/沙滩、G 道路/裸土、B 植被抑制、A 积雪/冰）。
 */
export class HeightBuilder {
  readonly size: number;
  readonly res: number;
  readonly cell: number;
  readonly half: number;
  readonly data: Float32Array;
  readonly surface: Uint8Array;

  constructor(size: number, res: number) {
    this.size = size;
    this.res = res;
    this.cell = size / (res - 1);
    this.half = size / 2;
    this.data = new Float32Array(res * res);
    this.surface = new Uint8Array(res * res * 4);
  }

  x(ix: number): number {
    return -this.half + ix * this.cell;
  }
  z(iz: number): number {
    return -this.half + iz * this.cell;
  }

  fill(fn: (x: number, z: number) => number): this {
    const r = this.res;
    for (let iz = 0; iz < r; iz++) {
      const z = this.z(iz);
      for (let ix = 0; ix < r; ix++) this.data[iz * r + ix] = fn(this.x(ix), z);
    }
    return this;
  }

  map(fn: (h: number, x: number, z: number, i: number) => number): this {
    const r = this.res;
    for (let iz = 0; iz < r; iz++) {
      const z = this.z(iz);
      for (let ix = 0; ix < r; ix++) {
        const i = iz * r + ix;
        this.data[i] = fn(this.data[i], this.x(ix), z, i);
      }
    }
    return this;
  }

  get(x: number, z: number): number {
    const ix = clamp(Math.round((x + this.half) / this.cell), 0, this.res - 1);
    const iz = clamp(Math.round((z + this.half) / this.cell), 0, this.res - 1);
    return this.data[iz * this.res + ix];
  }

  /** 折线距离场：maxDist 之外为 Infinity。s 为最近点的弧长。 */
  splineField(points: Vec2[], maxDist: number, densify = true): SplineField {
    const path = densify ? densifyPath(points, 6) : points;
    const r = this.res;
    const dist = new Float32Array(r * r).fill(Infinity);
    const sArr = new Float32Array(r * r);
    let acc = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const minX = Math.min(a[0], b[0]) - maxDist;
      const maxX = Math.max(a[0], b[0]) + maxDist;
      const minZ = Math.min(a[1], b[1]) - maxDist;
      const maxZ = Math.max(a[1], b[1]) + maxDist;
      const ix0 = clamp(Math.floor((minX + this.half) / this.cell), 0, r - 1);
      const ix1 = clamp(Math.ceil((maxX + this.half) / this.cell), 0, r - 1);
      const iz0 = clamp(Math.floor((minZ + this.half) / this.cell), 0, r - 1);
      const iz1 = clamp(Math.ceil((maxZ + this.half) / this.cell), 0, r - 1);
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = this.z(iz);
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = this.x(ix);
          const { d, t } = segDist2D(x, z, a[0], a[1], b[0], b[1]);
          const i = iz * r + ix;
          if (d < dist[i] && d <= maxDist) {
            dist[i] = d;
            sArr[i] = acc + t * segLen;
          }
        }
      }
      acc += segLen;
    }
    return { dist, s: sArr, length: acc };
  }

  /** 沿折线应用剖面函数（河道、峡谷、峡湾、山谷、山脊）。 */
  applySpline(points: Vec2[], maxDist: number, fn: (h: number, d: number, s: number, x: number, z: number, len: number) => number): SplineField {
    const f = this.splineField(points, maxDist);
    const r = this.res;
    for (let iz = 0; iz < r; iz++) {
      const z = this.z(iz);
      for (let ix = 0; ix < r; ix++) {
        const i = iz * r + ix;
        const d = f.dist[i];
        if (d === Infinity) continue;
        this.data[i] = fn(this.data[i], d, f.s[i], this.x(ix), z, f.length);
      }
    }
    return f;
  }

  /** 把圆形区域压平到指定高度（停机坪、营地）。blend 为过渡带宽度。 */
  flatten(cx: number, cz: number, radius: number, height: number, blend = 20, mode: 'set' | 'min' | 'max' = 'set'): this {
    const r = this.res;
    const R = radius + blend;
    const ix0 = clamp(Math.floor((cx - R + this.half) / this.cell), 0, r - 1);
    const ix1 = clamp(Math.ceil((cx + R + this.half) / this.cell), 0, r - 1);
    const iz0 = clamp(Math.floor((cz - R + this.half) / this.cell), 0, r - 1);
    const iz1 = clamp(Math.ceil((cz + R + this.half) / this.cell), 0, r - 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const d = Math.hypot(this.x(ix) - cx, this.z(iz) - cz);
        if (d > R) continue;
        const w = 1 - smoothstep(radius, R, d);
        const i = iz * r + ix;
        const cur = this.data[i];
        let target = height;
        if (mode === 'min') target = Math.min(cur, height);
        if (mode === 'max') target = Math.max(cur, height);
        this.data[i] = cur + (target - cur) * w;
      }
    }
    return this;
  }

  /** 矩形压平（港口、跑道）。rot 为绕 Y 轴旋转（弧度）。 */
  flattenRect(cx: number, cz: number, hw: number, hd: number, rot: number, height: number, blend = 15, mode: 'set' | 'min' | 'max' = 'set'): this {
    const r = this.res;
    const R = Math.hypot(hw, hd) + blend;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const ix0 = clamp(Math.floor((cx - R + this.half) / this.cell), 0, r - 1);
    const ix1 = clamp(Math.ceil((cx + R + this.half) / this.cell), 0, r - 1);
    const iz0 = clamp(Math.floor((cz - R + this.half) / this.cell), 0, r - 1);
    const iz1 = clamp(Math.ceil((cz + R + this.half) / this.cell), 0, r - 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = this.x(ix) - cx;
        const dz = this.z(iz) - cz;
        const lx = Math.abs(dx * c - dz * s);
        const lz = Math.abs(dx * s + dz * c);
        const ox = Math.max(0, lx - hw);
        const oz = Math.max(0, lz - hd);
        const d = Math.hypot(ox, oz);
        if (d > blend) continue;
        const w = 1 - smoothstep(0, blend, d);
        const i = iz * r + ix;
        const cur = this.data[i];
        let target = height;
        if (mode === 'min') target = Math.min(cur, height);
        if (mode === 'max') target = Math.max(cur, height);
        this.data[i] = cur + (target - cur) * w;
      }
    }
    return this;
  }

  /** 盒式模糊平滑；mask 返回 0..1 的平滑强度。 */
  smooth(passes = 1, mask?: (x: number, z: number) => number): this {
    const r = this.res;
    const tmp = new Float32Array(r * r);
    for (let p = 0; p < passes; p++) {
      for (let iz = 0; iz < r; iz++) {
        for (let ix = 0; ix < r; ix++) {
          let sum = 0;
          let n = 0;
          for (let dz = -1; dz <= 1; dz++) {
            const zz = iz + dz;
            if (zz < 0 || zz >= r) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = ix + dx;
              if (xx < 0 || xx >= r) continue;
              sum += this.data[zz * r + xx];
              n++;
            }
          }
          const i = iz * r + ix;
          const avg = sum / n;
          const w = mask ? mask(this.x(ix), this.z(iz)) : 1;
          tmp[i] = this.data[i] + (avg - this.data[i]) * w;
        }
      }
      this.data.set(tmp);
    }
    return this;
  }

  /** 写地表掩码通道（取最大值），fn 返回 0..1。 */
  paint(channel: 0 | 1 | 2 | 3, fn: (x: number, z: number, h: number) => number): this {
    const r = this.res;
    for (let iz = 0; iz < r; iz++) {
      const z = this.z(iz);
      for (let ix = 0; ix < r; ix++) {
        const i = iz * r + ix;
        const v = fn(this.x(ix), z, this.data[i]);
        if (v <= 0) continue;
        const k = i * 4 + channel;
        const val = Math.round(clamp(v, 0, 1) * 255);
        if (val > this.surface[k]) this.surface[k] = val;
      }
    }
    return this;
  }

  /** 沿折线绘制地表掩码（道路、河岸）。 */
  paintPath(channel: 0 | 1 | 2 | 3, points: Vec2[], width: number, feather: number, strength = 1): this {
    const f = this.splineField(points, width + feather);
    const r = this.res;
    for (let i = 0; i < r * r; i++) {
      const d = f.dist[i];
      if (d === Infinity) continue;
      const v = (1 - smoothstep(width, width + feather, d)) * strength;
      const k = i * 4 + channel;
      const val = Math.round(clamp(v, 0, 1) * 255);
      if (val > this.surface[k]) this.surface[k] = val;
    }
    return this;
  }

  paintCircle(channel: 0 | 1 | 2 | 3, cx: number, cz: number, radius: number, feather: number, strength = 1): this {
    return this.paint(channel, (x, z) => (1 - smoothstep(radius, radius + feather, Math.hypot(x - cx, z - cz))) * strength);
  }

  build(): Heightfield {
    return new Heightfield(this.size, this.res, this.data);
  }
}
