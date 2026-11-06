// 植被：按地图规则确定性散布（同一份实例数据同时用于实例化渲染与碰撞代理）。

import { Perlin2, Rng } from '../core/noise';
import { flowAt, type FlowMap } from './flow';
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
  // 大峡谷南缘的树（真实地形）：矮松又低又圆，犹他刺柏从根上就分杈，矮灌丛贴着地
  pinyon: { trunkH: 1.5, trunkR: 0.3, crownY: 3.4, crownR: 3.0, crownRy: 3.1, collide: true },
  pinyon2: { trunkH: 1.2, trunkR: 0.26, crownY: 2.8, crownR: 2.5, crownRy: 2.6, collide: true },
  ujuniper: { trunkH: 1.0, trunkR: 0.28, crownY: 2.5, crownR: 2.6, crownRy: 2.0, collide: true },
  ujuniper2: { trunkH: 1.0, trunkR: 0.28, crownY: 2.5, crownR: 2.6, crownRy: 2.0, collide: true },
  scrub: { trunkH: 0.2, trunkR: 0.1, crownY: 0.55, crownR: 1.25, crownRy: 0.75, collide: false },
  // 南缘高处的西黄松：比矮松高出好几倍
  ponderosa: { trunkH: 8, trunkR: 0.42, crownY: 13, crownR: 3.8, crownRy: 6.5, collide: true },
};

// 新树种只能加在后面：别的地图的树按下标存
export const TREE_TYPES: TreeType[] = ['pine', 'broadleaf', 'canopy', 'emergent', 'palm', 'spruce', 'birch', 'juniper', 'shrub', 'cactus', 'boulder', 'pinyon', 'pinyon2', 'ujuniper', 'ujuniper2', 'scrub', 'ponderosa'];

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
  /** 地图边上稀下去、没有种的树（x, z, 大小, 种类 连着排）：树冠图还算它们，地面的树冠层才接得上 */
  ghosts?: Float32Array;
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
  private hitCell(ix: number, iz: number, x: number, z: number, r: number): boolean {
    const arr = this.map.get(ix * 100003 + iz);
    if (!arr) return false;
    for (const f of arr) {
      const dx = x - f.x, dz = z - f.z, radius = f.r + r;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }
  hit(x: number, z: number, r: number): 'center' | 'neighbor' | null {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    if (this.hitCell(cx, cz, x, z, r)) return 'center';
    // 候选树冠也有半径：中心格没有占地，不代表相邻格的建筑不会被树冠覆盖。
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell), z1 = Math.floor((z + r) / this.cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        if (ix === cx && iz === cz) continue;
        if (this.hitCell(ix, iz, x, z, r)) return 'neighbor';
      }
    }
    return null;
  }
}

export function scatterTrees(map: MapDef, terrain: Heightfield, surface: Uint8Array, footprints: Footprint[], flow: FlowMap | null = null): TreeSet {
  const ex = new ExclusionGrid();
  for (const f of footprints) ex.add(f);
  for (const [x, z, r] of map.clearings) ex.add({ x, z, r });
  for (const p of map.pads) ex.add({ x: p.pos[0], z: p.pos[2], r: p.size * 0.75 + 8 });
  const rng = new Rng(map.seed * 7 + 11);
  const half = terrain.half - 30;
  // 地图边上：树到边线齐刷刷地断掉，从空中看地图就是一块方的。这里让林子一片片稀下去，
  // 融进地形画的树冠层（判定不消耗随机数，地图里面的树一棵也不会变）
  const edgeN = new Perlin2(map.seed + 41);
  const edgeK = terrain.size / 4096;
  const thinned = (x: number, z: number): boolean => {
    const e = terrain.half - Math.max(Math.abs(x), Math.abs(z));
    if (e > 620 * edgeK) return false;
    const reach = edgeK * Math.max(40, 300 + 420 * edgeN.noise(x / 340, z / 340) + 170 * edgeN.noise(x / 105, z / 105));
    if (e >= reach) return false;
    const r = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return r - Math.floor(r) > (e / reach) ** 1.5;
  };
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const ss: number[] = [];
  const ts: number[] = [];
  const rs: number[] = [];
  const ghosts: number[] = [];
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
        let w = rule.mask ? rule.mask(x, z, h, slope) : 1;
        // 沿沟生长：水汇到的地方比别处密得多
        if (rule.wash && flow) w = Math.min(1, w * (1 - rule.wash) + rule.wash * Math.min(1, flowAt(flow, map.size, x, z) * 2.2));
        if (w <= 0 || rng.float() > w) continue;
        const s = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * rng.float();
        const exclusion = ex.hit(x, z, spec.crownR * s * 0.7);
        if (exclusion === 'center') continue;
        // 新增的跨格/越界剔除仍消费旧版本的旋转随机数，后续实例位置不变。
        const rotation = rng.float() * Math.PI * 2;
        if (exclusion || x > half || z > half) continue;
        if (thinned(x, z)) {
          ghosts.push(x, z, s, ti);
          continue;
        }
        xs.push(x);
        ys.push(h - 0.2);
        zs.push(z);
        ss.push(s);
        ts.push(ti);
        rs.push(rotation);
      }
    }
  }
  return packTrees(terrain, xs, ys, zs, ss, ts, rs, ghosts);
}

/** 把一批树排进空间网格 */
export function packTrees(terrain: Heightfield, xs: number[], ys: number[], zs: number[], ss: number[], ts: number[], rs: number[], ghosts: number[] = [], extent = terrain.size): TreeSet {
  const count = xs.length;
  const cell = 64;
  const half = extent / 2;
  const dim = Math.ceil(extent / cell) + 1;
  const cellCount = new Int32Array(dim * dim);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(dim - 1, Math.max(0, Math.floor((xs[i] + half) / cell)));
    const cz = Math.min(dim - 1, Math.max(0, Math.floor((zs[i] + half) / cell)));
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
    half,
    ghosts: Float32Array.from(ghosts),
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
  const radiusSq = r * r;
  for (let cz = c0z; cz <= c1z; cz++)
    for (let cx = c0x; cx <= c1x; cx++) {
      const c = cz * t.dim + cx;
      const s = t.cellStart[c];
      const n = t.cellCount[c];
      for (let k = 0; k < n; k++) {
        const i = t.order[s + k];
        const dx = t.x[i] - x, dz = t.z[i] - z;
        if (dx * dx + dz * dz <= radiusSq) fn(i);
      }
    }
}
