// 河流下切：真实的山是水切出来的。雨水汇成支流、支流汇成干流，流量越大切得越深，切出来的沟又把更多的水引过来，
// 山脊和山谷因此是一棵树的形状（从空中看像叶脉），每条支流都顺着坡找到更大的河。
// 噪声和手画的曲线做不出这种结构：山是一团一团的，坡上没有水系，沟是平行的（一排窗帘褶）。
//
// 这里用地貌学里的河流功率法则（stream power law）：下切速度 = K · 汇水面积^m · 坡度。做法：
//   1. 从出口（海、地图边、不能动的地方）往上按高度铺开，找到每一格的水流去向（优先级泛洪，洼地也流得出去）；
//   2. 从上游往下游累加汇水面积；
//   3. 从下游往上游用隐式解更新高度（Braun & Willett 2013，步长多大都不会炸）；
//   4. 坡面的土往低处蠕动（扩散），太陡的地方垮塌（休止角）。
// 只在粗网格上算，结果作为“切掉了多少”叠回原来的高度，原来的细节都还在。
// 只往下切、不往上堆：航线上不会多出新的障碍。

import { Perlin2 } from '../core/noise';

export interface DissectOptions {
  /** 模拟网格的边长（格） */
  grid: number;
  /** 迭代次数 */
  steps: number;
  /** 下切系数：越大切得越快 */
  k: number;
  /** 最深切多少米 */
  maxCut: number;
  /** 汇水面积的指数 */
  m?: number;
  /** 坡面蠕动的速度（0..0.25） */
  creep?: number;
  /** 休止角的坡度（高差 / 水平距离） */
  talus?: number;
  waterLevel: number | null;
  /** 0..1 的保护图（和高度图同样大小）：0 的地方不动，同时是水流的出口 */
  mask?: Float32Array;
  /** 这一点的岩石有多软（0..1，缺省都是 1）：硬岩切得慢，河就绕着走 */
  soft?: (x: number, z: number) => number;
  size: number;
  seed: number;
}

/** 按高度出堆的小顶堆（下标、高度存在两个定长数组里，比对象快得多） */
class Heap {
  private readonly id: Int32Array;
  private readonly key: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.id = new Int32Array(cap);
    this.key = new Float32Array(cap);
  }
  push(i: number, k: number): void {
    let c = this.n++;
    const id = this.id;
    const key = this.key;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[p] <= k) break;
      key[c] = key[p];
      id[c] = id[p];
      c = p;
    }
    key[c] = k;
    id[c] = i;
  }
  pop(): number {
    const id = this.id;
    const key = this.key;
    const top = id[0];
    const n = --this.n;
    const k = key[n];
    const v = id[n];
    let c = 0;
    for (;;) {
      let l = c * 2 + 1;
      if (l >= n) break;
      if (l + 1 < n && key[l + 1] < key[l]) l++;
      if (key[l] >= k) break;
      key[c] = key[l];
      id[c] = id[l];
      c = l;
    }
    key[c] = k;
    id[c] = v;
    return top;
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** 把高度图降采样到 n × n（每格取覆盖范围的平均） */
function shrink(src: Float32Array, res: number, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const r = (res - 1) / (n - 1);
  const w = Math.max(0, Math.round(r / 2));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const cx = Math.round(x * r);
      const cy = Math.round(y * r);
      let s = 0;
      let c = 0;
      for (let j = Math.max(0, cy - w); j <= Math.min(res - 1, cy + w); j++)
        for (let i = Math.max(0, cx - w); i <= Math.min(res - 1, cx + w); i++) {
          s += src[j * res + i];
          c++;
        }
      out[y * n + x] = s / c;
    }
  return out;
}

const cubic = (a: number, b: number, c: number, d: number, t: number): number => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/** 粗网格上切掉的量，插值回高度图（三次插值：沟底是圆的，不是一格格的台阶） */
function apply(data: Float32Array, res: number, cut: Float32Array, n: number): void {
  const r = (n - 1) / (res - 1);
  const at = (x: number, y: number): number => cut[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  const col = [0, 0, 0, 0];
  for (let y = 0; y < res; y++) {
    const fy = y * r;
    const iy = Math.min(n - 2, fy | 0);
    const v = fy - iy;
    for (let x = 0; x < res; x++) {
      const fx = x * r;
      const ix = Math.min(n - 2, fx | 0);
      const u = fx - ix;
      for (let k = 0; k < 4; k++) col[k] = cubic(at(ix - 1, iy - 1 + k), at(ix, iy - 1 + k), at(ix + 1, iy - 1 + k), at(ix + 2, iy - 1 + k), u);
      data[y * res + x] += Math.min(0, cubic(col[0], col[1], col[2], col[3], v));
    }
  }
}

export function dissect(data: Float32Array, res: number, o: DissectOptions): void {
  const n = o.grid;
  const N = n * n;
  const cell = o.size / (n - 1);
  const h0 = shrink(data, res, n);
  const h = Float32Array.from(h0);
  const m = o.m ?? 0.45;
  const creep = o.creep ?? 0.12;
  const talus = (o.talus ?? 1.15) * cell;
  const water = o.waterLevel ?? -1e9;
  const fixed = new Uint8Array(N);
  const free = new Float32Array(N).fill(1);
  const mask = o.mask ? shrink(o.mask, res, n) : null;
  const pn = new Perlin2(o.seed + 91);
  const rain = new Float32Array(N);
  const soft = new Float32Array(N);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (mask) free[i] = mask[i];
      if ((mask && mask[i] < 0.03) || h[i] <= water) fixed[i] = 1;
      // 雨量和岩性有大块的差别：否则河网均匀得像一张网
      rain[i] = 1 + 0.5 * pn.fbm(x / (n / 5) + 3, y / (n / 5) - 2, 3);
      const wx = -o.size / 2 + x * cell;
      const wz = -o.size / 2 + y * cell;
      const hard = 0.55 + 0.9 * Math.max(0, 0.5 + pn.fbm(x / (n / 9) - 7, y / (n / 9) + 5, 4));
      soft[i] = hard * (o.soft ? o.soft(wx, wz) : 1);
    }
  // 水从哪儿流出地图：只有地图边上的低口（每一格都当出口的话，四条边上全是一排排短沟）
  const outlet = new Uint8Array(N);
  const w = Math.max(3, Math.round(n / 14));
  const sides: Array<(t: number) => number> = [(t) => t, (t) => (n - 1) * n + t, (t) => t * n, (t) => t * n + n - 1];
  for (const at of sides) {
    const line = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      let s = 0;
      let c = 0;
      for (let q = Math.max(0, t - w); q <= Math.min(n - 1, t + w); q++) {
        s += h[at(q)];
        c++;
      }
      line[t] = s / c;
    }
    for (let t = 1; t < n - 1; t++) {
      let low = true;
      for (let q = Math.max(0, t - w); q <= Math.min(n - 1, t + w) && low; q++) if (line[q] < line[t]) low = false;
      if (low) outlet[at(t)] = 1;
    }
  }
  // 地图里最低的地方不能被切得更低：河的终点就在那儿
  let bottom = Infinity;
  for (let i = 0; i < N; i++) if (h0[i] < bottom) bottom = h0[i];
  bottom = Math.max(bottom, water);
  const heap = new Heap(N);
  const seen = new Uint8Array(N);
  const order = new Int32Array(N);
  const recv = new Int32Array(N);
  const area = new Float32Array(N);
  const dist = new Float32Array(N);
  const diag = cell * Math.SQRT2;
  const tmp = new Float32Array(N);
  // 一点点抖动：不然水流只走格子的八个方向，河是一段段的直线
  const jit = new Float32Array(N);
  for (let i = 0; i < N; i++) jit[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let step = 0; step < o.steps; step++) {
    // 1. 水流去向
    seen.fill(0);
    heap.n = 0;
    let cnt = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (fixed[i] || outlet[i]) {
          seen[i] = 1;
          recv[i] = i;
          dist[i] = cell;
          heap.push(i, h[i]);
        }
      }
    while (heap.n > 0) {
      const c = heap.pop();
      order[cnt++] = c;
      const cx = c % n;
      const cy = (c / n) | 0;
      const hc = h[c];
      for (let k = 0; k < 8; k++) {
        const x = cx + NX[k];
        const y = cy + NZ[k];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = y * n + x;
        if (seen[i]) continue;
        seen[i] = 1;
        recv[i] = c;
        dist[i] = k < 4 ? cell : diag;
        heap.push(i, Math.max(h[i], hc) + jit[i] * 0.02);
      }
    }
    // 2. 汇水面积（下游在 order 前面，反着走就是从上游到下游）
    for (let i = 0; i < N; i++) area[i] = rain[i] * cell * cell;
    for (let q = cnt - 1; q >= 0; q--) {
      const i = order[q];
      const r = recv[i];
      if (r !== i) area[r] += area[i];
    }
    // 3. 下切（隐式）
    for (let q = 0; q < cnt; q++) {
      const i = order[q];
      const r = recv[i];
      if (r === i) {
        // 地图边上的出口：水流出地图，当作外面还有一段缓坡
        if (!fixed[i]) {
          const f = (o.k * soft[i] * Math.pow(area[i], m)) / cell;
          h[i] -= (f / (1 + f)) * Math.max(0, h[i] - Math.max(bottom, h0[i] - o.maxCut)) * 0.05;
        }
        continue;
      }
      const hr = h[r];
      if (h[i] <= hr) continue;
      const f = (o.k * soft[i] * free[i] * Math.pow(area[i], m)) / dist[i];
      h[i] = (h[i] + f * hr) / (1 + f);
    }
    // 4. 坡面蠕动 + 垮塌，且不能切过头、不能高过原来
    tmp.set(h);
    for (let y = 1; y < n - 1; y++)
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (fixed[i]) continue;
        const a = tmp[i - 1];
        const b = tmp[i + 1];
        const c = tmp[i - n];
        const d = tmp[i + n];
        const v = tmp[i];
        let next = v + creep * free[i] * (a + b + c + d - 4 * v) * 0.25;
        const low = Math.min(a, b, c, d);
        if (v - low > talus) next -= (v - low - talus) * 0.35 * free[i];
        h[i] = Math.min(h0[i], Math.max(bottom, h0[i] - o.maxCut, next));
      }
  }
  const cut = tmp;
  for (let i = 0; i < N; i++) cut[i] = h[i] - h0[i];
  apply(data, res, cut, n);
}
