// 真实地形的高程数据：三层嵌套的网格（核心 / 中圈 / 远圈），由 tools/real/prep_grandcanyon.py 生成。
// 文件格式：gzip 压缩的 Uint16 小端序列。按行存差分（相邻两格的高度差，之字形编码成无符号数），
// 真实地形相邻格差得不大，这样压缩率比直接存高度高一倍。解码：累加差分 × 量化步长 + 基准高度。

import { Heightfield } from '../sim/terrain';
import type { MapDef, RealLevelDef, RealTerrainDef, TreeType } from '../maps/types';
import { packTrees, TREE_TYPES, type TreeSet } from './vegetation';

export interface RealGrid {
  size: number;
  res: number;
  cell: number;
  half: number;
  data: Float32Array;
}

export interface RealData {
  def: RealTerrainDef;
  levels: RealGrid[];
  /** 核心区 10 米一格的副本：雾、倒影、光照这些低频的东西不需要全分辨率 */
  low: Heightfield;
  lowSurface: Uint8Array;
  /** 阳光的山影：核心区 5 米一格，再往外用中圈，影子一直算到几十公里外 */
  sunInner: Heightfield;
  sunOuter: Heightfield;
  /** 地图外某点的地面高度（只有画面用） */
  heightAt(x: number, z: number): number;
}

export function decodeGrid(bytes: ArrayBuffer, def: RealLevelDef): RealGrid {
  const n = def.res;
  const src = new Uint16Array(bytes);
  if (src.length !== n * n) throw new Error(`高程文件大小不对：${src.length} / ${n * n}`);
  const out = new Float32Array(n * n);
  const q = def.step;
  for (let z = 0; z < n; z++) {
    // 每行第一格相对上一行第一格，其余相对左边一格
    let v = z > 0 ? Math.round((out[(z - 1) * n] - def.base) / q) : 0;
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const u = src[i];
      v += u & 1 ? -((u + 1) >> 1) : u >> 1;
      out[i] = def.base + v * q;
    }
  }
  return { size: def.size, res: n, cell: def.size / (n - 1), half: def.size / 2, data: out };
}

async function fetchGrid(base: string, def: RealLevelDef): Promise<RealGrid> {
  const res = await fetch(new URL(base + def.heights, document.baseURI).href);
  if (!res.ok) throw new Error(`高程数据下载失败：${def.heights}（${res.status}）`);
  const bytes = await res.arrayBuffer();
  return decodeGrid(await gunzip(bytes), def);
}

/** 文件是 gzip 压缩的。有的服务器会替浏览器解开，有的不会，所以看文件头再决定 */
export async function gunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** 影像里认出来的树：文件里种类的编号（见 prep_grandcanyon.py 的 find_trees） */
const REAL_TREE_TYPES: TreeType[] = ['juniper', 'pine', 'broadleaf', 'shrub'];

/** 真实的树：位置是从航拍上一棵一棵认出来的 */
export async function loadRealTrees(def: RealTerrainDef, terrain: Heightfield, keepOut: Array<[number, number, number]>): Promise<TreeSet | null> {
  if (!def.trees) return null;
  const res = await fetch(new URL(def.base + def.trees, document.baseURI).href);
  if (!res.ok) throw new Error(`树的数据下载失败：${res.status}`);
  const bytes = await gunzip(await res.arrayBuffer());
  const n = bytes.byteLength / 6;
  const xz = new Uint16Array(bytes, 0, n * 2);
  const meta = new Uint8Array(bytes, n * 4, n * 2);
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const ss: number[] = [];
  const ts: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (xz[i * 2] / 65535 - 0.5) * terrain.size;
    const z = (xz[i * 2 + 1] / 65535 - 0.5) * terrain.size;
    if (keepOut.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
    xs.push(x);
    ys.push(terrain.heightAt(x, z) - 0.2);
    zs.push(z);
    ss.push(meta[i * 2 + 1] / 100);
    ts.push(TREE_TYPES.indexOf(REAL_TREE_TYPES[meta[i * 2]]));
    rs.push(((i * 2654435761) % 6283) / 1000);
  }
  return packTrees(terrain, xs, ys, zs, ss, ts, rs);
}

/** 外圈的影像只有 10 米一个像素，认不出树。几个景点周围按高度和坡度种一片，飞到跟前才不是一片光地 */
export function outerForest(map: MapDef, terrain: Heightfield, trees: TreeSet, extent: number): TreeSet {
  const forest = map.outerForest;
  if (!forest?.length) return trees;
  const xs = Array.from(trees.x);
  const ys = Array.from(trees.y);
  const zs = Array.from(trees.z);
  const ss = Array.from(trees.s);
  const ts = Array.from(trees.type);
  const rs = Array.from(trees.rot);
  const R = 1300;
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const f of forest) {
    const [cx, cz] = f.at;
    const floor = terrain.heightAt(cx, cz) - 120;
    for (let i = 0; i < 9000; i++) {
      const a = rnd() * Math.PI * 2;
      // 中间留一块空地落得下去；往外慢慢稀，从天上看不是一个圆
      const d = 60 + R * Math.pow(rnd(), 0.7) * (0.75 + 0.25 * Math.sin(a * 3 + cx));
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const k = f.kinds[(rnd() * f.kinds.length) | 0];
      const size = f.scale[0] + rnd() * (f.scale[1] - f.scale[0]);
      if (Math.abs(x) < terrain.half && Math.abs(z) < terrain.half) continue;
      // 崖边的陡坡和谷底不种
      if (terrain.slopeAt(x, z) > 0.12 || terrain.heightAt(x, z) < floor) continue;
      xs.push(x);
      ys.push(terrain.heightAt(x, z) - 0.2);
      zs.push(z);
      ss.push(size);
      ts.push(TREE_TYPES.indexOf(k));
      rs.push(rnd() * 6.283);
    }
  }
  return packTrees(terrain, xs, ys, zs, ss, ts, rs, [], extent);
}

/** 双线性取样；超出范围返回 null */
export function sampleGrid(g: RealGrid, x: number, z: number): number | null {
  const fx = (x + g.half) / g.cell;
  const fz = (z + g.half) / g.cell;
  if (fx < 0 || fz < 0 || fx >= g.res - 1 || fz >= g.res - 1) return null;
  const ix = fx | 0;
  const iz = fz | 0;
  const u = fx - ix;
  const v = fz - iz;
  const o = iz * g.res + ix;
  const d = g.data;
  return (d[o] * (1 - u) + d[o + 1] * u) * (1 - v) + (d[o + g.res] * (1 - u) + d[o + g.res + 1] * u) * v;
}

function downsample(g: RealGrid, step: number): Heightfield {
  const n = (g.res - 1) / step + 1;
  const out = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out[z * n + x] = g.data[z * step * g.res + x * step];
  return new Heightfield(g.size, n, out);
}

export function buildRealData(def: RealTerrainDef, levels: RealGrid[]): RealData {
  const low = downsample(levels[0], 4);
  return {
    def,
    levels,
    low,
    lowSurface: new Uint8Array(low.res * low.res * 4),
    sunInner: downsample(levels[0], (levels[0].res - 1) / (levels[1].res - 1)),
    sunOuter: new Heightfield(levels[1].size, levels[1].res, levels[1].data),
    heightAt(x, z) {
      for (const g of levels) {
        const h = sampleGrid(g, x, z);
        if (h !== null) return h;
      }
      return levels[levels.length - 1].data[0];
    },
  };
}

const cache = new Map<string, Promise<RealData>>();

export function loadRealData(def: RealTerrainDef): Promise<RealData> {
  let p = cache.get(def.base);
  if (!p) {
    p = Promise.all(def.levels.map((l) => fetchGrid(def.base, l))).then((levels) => buildRealData(def, levels));
    cache.set(def.base, p);
    p.catch(() => cache.delete(def.base));
  }
  return p;
}
