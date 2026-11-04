// 汇流图：雨水从哪里流下来、汇到哪里。真实的大地从空中看，最耐看的纹理就是这张树枝一样的水系：
// 干河道、冲沟、沿沟生长的灌木。按地形算一遍（半分辨率）：
//   优先填洼（从地图边缘和海面开始，由低到高一格格往里走）：洼地也有出口，水系连得起来；
//   然后按相反的顺序把每一格的水交给它的下游，累加出每一格的集水面积，取对数存成 0..255。

import type { Heightfield } from '../sim/terrain';

const NB = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1];

/** 小顶堆（按键值 float 排序的格子编号） */
class Heap {
  private readonly id: Int32Array;
  private readonly key: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.id = new Int32Array(cap);
    this.key = new Float32Array(cap);
  }
  push(i: number, k: number): void {
    let c = this.size++;
    const { id, key } = this;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[p] <= k) break;
      id[c] = id[p];
      key[c] = key[p];
      c = p;
    }
    id[c] = i;
    key[c] = k;
  }
  /** 取出最小的，返回格子编号；键值放在 top */
  top = 0;
  pop(): number {
    const { id, key } = this;
    const r = id[0];
    this.top = key[0];
    const n = --this.size;
    const li = id[n];
    const lk = key[n];
    let c = 0;
    for (;;) {
      let m = c * 2 + 1;
      if (m >= n) break;
      if (m + 1 < n && key[m + 1] < key[m]) m++;
      if (key[m] >= lk) break;
      id[c] = id[m];
      key[c] = key[m];
      c = m;
    }
    id[c] = li;
    key[c] = lk;
    return r;
  }
}

export interface FlowMap {
  /** 每边多少格 */
  n: number;
  /** 0..255（对数集水面积，0 = 山脊上，255 = 大河） */
  data: Uint8Array;
}

export function makeFlowMap(t: Heightfield, waterLevel: number | null): FlowMap {
  const n = (t.res + 1) >> 1;
  const H = new Float32Array(n * n);
  // 每 2 格取一格，顺手做一次 3×3 平均（4 米网格的毛刺不算地形）
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const cx = Math.min(t.res - 1, x * 2);
      const cz = Math.min(t.res - 1, z * 2);
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += t.grid(cx + dx, cz + dz);
      H[z * n + x] = s / 9;
    }
  }
  const down = new Int32Array(n * n).fill(-1);
  const seen = new Uint8Array(n * n);
  const order = new Int32Array(n * n);
  const heap = new Heap(n * n);
  const wl = waterLevel ?? -Infinity;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      if (x === 0 || z === 0 || x === n - 1 || z === n - 1 || H[i] < wl) {
        seen[i] = 1;
        heap.push(i, H[i]);
      }
    }
  let m = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    const k = heap.top;
    order[m++] = c;
    const cx = c % n;
    const cz = (c / n) | 0;
    for (let d = 0; d < 16; d += 2) {
      const x = cx + NB[d];
      const z = cz + NB[d + 1];
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      if (seen[j]) continue;
      seen[j] = 1;
      down[j] = c;
      heap.push(j, Math.max(H[j], k + 0.001));
    }
  }
  const acc = new Float32Array(n * n).fill(1);
  for (let q = m - 1; q >= 0; q--) {
    const i = order[q];
    const d = down[i];
    if (d >= 0) acc[d] += acc[i];
  }
  // 集水面积小于 16 格的是坡面漫流，看不出沟；大于约 8000 格（0.5 km²）的按大河算
  let v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = Math.min(1, Math.max(0, (Math.log2(acc[i]) - 4) / 9));
  // 水流只走八个方向，一格宽的线走斜了就成了虚线：抹两遍，沟才是连着的一条
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(n * n);
    for (let z = 1; z < n - 1; z++)
      for (let x = 1; x < n - 1; x++) {
        const i = z * n + x;
        o[i] = (v[i] * 4 + (v[i - 1] + v[i + 1] + v[i - n] + v[i + n]) * 2 + v[i - n - 1] + v[i - n + 1] + v[i + n - 1] + v[i + n + 1]) / 16;
      }
    v = o;
  }
  const data = new Uint8Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.round(v[i] * 2.1 * 255));
  return { n, data };
}

/** 世界坐标处的汇流值 0..1 */
export function flowAt(f: FlowMap, size: number, x: number, z: number): number {
  const u = Math.min(f.n - 1, Math.max(0, Math.round((x / size + 0.5) * (f.n - 1))));
  const v = Math.min(f.n - 1, Math.max(0, Math.round((z / size + 0.5) * (f.n - 1))));
  return f.data[v * f.n + u] / 255;
}
