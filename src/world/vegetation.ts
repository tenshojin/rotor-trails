// 植被：按地图规则确定性散布（同一份实例数据同时用于实例化渲染与碰撞代理）。

import { Rng } from '../core/noise';
import type { MapDef, TreeType } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import type { Footprint } from './propBuilder';

export interface TreeSpec {
  /** 树干高度/半径（scale = 1） */
  trunkH: number;
  trunkR: number;
  /** 树冠中心高度、水平半径、垂直半径 */
  crownY: number;
  crownR: number;
  crownRy: number;
  /** 是否参与碰撞 */
  collide: boolean;
}

export const TREE_SPECS: Record<TreeType, TreeSpec> = {
  pine: { trunkH: 7, trunkR: 0.28, crownY: 7.5, crownR: 3.6, crownRy: 2.2, collide: true },
  broadleaf: { trunkH: 6, trunkR: 0.32, crownY: 8, crownR: 4.2, crownRy: 3.4, collide: true },
  canopy: { trunkH: 20, trunkR: 0.7, crownY: 24, crownR: 9, crownRy: 5, collide: true },
  emergent: { trunkH: 40, trunkR: 1.3, crownY: 45, crownR: 12, crownRy: 5, collide: true },
  palm: { trunkH: 9, trunkR: 0.25, crownY: 9.5, crownR: 3.2, crownRy: 1.4, collide: true },
  spruce: { trunkH: 2, trunkR: 0.3, crownY: 9, crownR: 2.8, crownRy: 7.5, collide: true },
  birch: { trunkH: 8, trunkR: 0.2, crownY: 9.5, crownR: 2.6, crownRy: 3.2, collide: true },
  juniper: { trunkH: 1.2, trunkR: 0.25, crownY: 2.4, crownR: 2.3, crownRy: 1.8, collide: true },
  shrub: { trunkH: 0.3, trunkR: 0.1, crownY: 0.9, crownR: 1.3, crownRy: 0.9, collide: false },
  cactus: { trunkH: 6.5, trunkR: 0.4, crownY: 4.5, crownR: 1.4, crownRy: 2.2, collide: true },
  // 崖脚和河滩上散落的石块：贴在地上，不算障碍物（直升机不会飞到离地一两米）
  boulder: { trunkH: 0.1, trunkR: 0.1, crownY: 0.4, crownR: 1.1, crownRy: 0.8, collide: false },
};

export const TREE_TYPES: TreeType[] = ['pine', 'broadleaf', 'canopy', 'emergent', 'palm', 'spruce', 'birch', 'juniper', 'shrub', 'cactus', 'boulder'];

export interface TreeSet {
  count: number;
  type: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  s: Float32Array;
  rot: Float32Array;
  /** 空间网格（64 m）：cellStart/cellCount 对应排序后的 order */
  cell: number;
  dim: number;
  half: number;
  cellStart: Int32Array;
  cellCount: Int32Array;
  order: Int32Array;
}

class ExclusionGrid {
  private cell = 32;
  private map = new Map<number, Footprint[]>();
  add(f: Footprint): void {
    const c = this.cell;
    const x0 = Math.floor((f.x - f.r) / c);
    const x1 = Math.floor((f.x + f.r) / c);
    const z0 = Math.floor((f.z - f.r) / c);
    const z1 = Math.floor((f.z + f.r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = z0; j <= z1; j++) {
        const k = i * 100003 + j;
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(f);
      }
  }
  hit(x: number, z: number, r: number): boolean {
    const k = Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell);
    const arr = this.map.get(k);
    if (!arr) return false;
    for (const f of arr) if (Math.hypot(x - f.x, z - f.z) < f.r + r) return true;
    return false;
  }
}

export function scatterTrees(map: MapDef, terrain: Heightfield, surface: Uint8Array, footprints: Footprint[]): TreeSet {
  const ex = new ExclusionGrid();
  for (const f of footprints) ex.add(f);
  for (const [x, z, r] of map.clearings) ex.add({ x, z, r });
  for (const p of map.pads) ex.add({ x: p.pos[0], z: p.pos[2], r: p.size * 0.75 + 8 });
  const rng = new Rng(map.seed * 7 + 11);
  const half = terrain.half - 30;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const ss: number[] = [];
  const ts: number[] = [];
  const rs: number[] = [];
  const res = terrain.res;
  for (const rule of map.vegetation) {
    const spacing = Math.sqrt(1e6 / rule.density);
    const spec = TREE_SPECS[rule.type];
    const ti = TREE_TYPES.indexOf(rule.type);
    for (let gz = -half; gz < half; gz += spacing) {
      for (let gx = -half; gx < half; gx += spacing) {
        const x = gx + rng.float() * spacing;
        const z = gz + rng.float() * spacing;
        const h = terrain.heightAt(x, z);
        if (map.waterLevel !== null && h < map.waterLevel + 0.8) continue;
        if (rule.minH !== undefined && h < rule.minH) continue;
        if (rule.maxH !== undefined && h > rule.maxH) continue;
        const slope = terrain.slopeAt(x, z);
        if (slope > (rule.maxSlope ?? 0.35)) continue;
        // 地表掩码 B 通道：道路/河岸/营地不长树
        const ix = Math.round((x + terrain.half) / terrain.cell);
        const iz = Math.round((z + terrain.half) / terrain.cell);
        if (surface[(iz * res + ix) * 4 + 2] > 110) continue;
        // A 通道：积雪（或港区的水泥地）上也不长
        if (surface[(iz * res + ix) * 4 + 3] > 90) continue;
        const w = rule.mask ? rule.mask(x, z, h, slope) : 1;
        if (w <= 0 || rng.float() > w) continue;
        const s = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * rng.float();
        if (ex.hit(x, z, spec.crownR * s * 0.7)) continue;
        xs.push(x);
        ys.push(h - 0.2);
        zs.push(z);
        ss.push(s);
        ts.push(ti);
        rs.push(rng.float() * Math.PI * 2);
      }
    }
  }
  const count = xs.length;
  const cell = 64;
  const dim = Math.ceil(terrain.size / cell) + 1;
  const cellCount = new Int32Array(dim * dim);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(dim - 1, Math.max(0, Math.floor((xs[i] + terrain.half) / cell)));
    const cz = Math.min(dim - 1, Math.max(0, Math.floor((zs[i] + terrain.half) / cell)));
    const c = cz * dim + cx;
    cellOf[i] = c;
    cellCount[c]++;
  }
  const cellStart = new Int32Array(dim * dim);
  let acc = 0;
  for (let c = 0; c < dim * dim; c++) {
    cellStart[c] = acc;
    acc += cellCount[c];
  }
  const fill = new Int32Array(dim * dim);
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const c = cellOf[i];
    order[cellStart[c] + fill[c]++] = i;
  }
  return {
    count,
    type: Uint8Array.from(ts),
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    s: Float32Array.from(ss),
    rot: Float32Array.from(rs),
    cell,
    dim,
    half: terrain.half,
    cellStart,
    cellCount,
    order,
  };
}

/** 遍历某点半径范围内的树（按网格）。 */
export function forTreesNear(t: TreeSet, x: number, z: number, r: number, fn: (i: number) => void): void {
  const c0x = Math.max(0, Math.floor((x - r + t.half) / t.cell));
  const c1x = Math.min(t.dim - 1, Math.floor((x + r + t.half) / t.cell));
  const c0z = Math.max(0, Math.floor((z - r + t.half) / t.cell));
  const c1z = Math.min(t.dim - 1, Math.floor((z + r + t.half) / t.cell));
  for (let cz = c0z; cz <= c1z; cz++)
    for (let cx = c0x; cx <= c1x; cx++) {
      const c = cz * t.dim + cx;
      const s = t.cellStart[c];
      const n = t.cellCount[c];
      for (let k = 0; k < n; k++) {
        const i = t.order[s + k];
        if (Math.hypot(t.x[i] - x, t.z[i] - z) <= r) fn(i);
      }
    }
}
