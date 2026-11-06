import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildingFrame, buildRealData, decodeGrid, gunzip, loadRealTrees, sampleGrid } from '../src/world/realData';
import { Heightfield } from '../src/sim/terrain';
import { TREE_TYPES } from '../src/world/vegetation';
import { GRAND_CANYON } from '../src/maps/grandcanyon';
import { getMap, MAPS, REAL_MAPS } from '../src/maps/index';
import type { RealLevelDef } from '../src/maps/types';

/** 和 tools/real/prep_grandcanyon.py 的 save_heights 同一种编码 */
function encode(h: Float64Array, n: number, base: number, step: number): ArrayBuffer {
  const q = Array.from(h, (v) => Math.round((v - base) / step));
  const out = new Uint16Array(n * n);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const d = x > 0 ? q[i] - q[i - 1] : z > 0 ? q[i] - q[i - n] : q[i];
      out[i] = d >= 0 ? d * 2 : -d * 2 - 1;
    }
  return out.buffer;
}

const level = (size: number, res: number, base: number, step: number): RealLevelDef => ({ size, res, heights: 'x', image: 'y', base, step });

describe('真实地形数据', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('树：位置、种类、大小解出来对得上，高度贴着地面，停机坪上的不要', async () => {
    // 和 prep_grandcanyon.py 的 find_trees 同一种格式：先是全部的 x、z（Uint16），再是种类和大小
    const buf = new ArrayBuffer(3 * 6);
    new Uint16Array(buf, 0, 6).set([32768, 32768, 49152, 32768, 16384, 16384]);
    new Uint8Array(buf, 12, 6).set([0, 100, 1, 80, 3, 60]);
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
    vi.stubGlobal('fetch', async () => new Response(buf));
    const size = 1024;
    const terrain = new Heightfield(size, 65, new Float32Array(65 * 65).fill(50));
    const def = { ...GRAND_CANYON.real!, trees: 't.dat' };
    const t = (await loadRealTrees(def, terrain, [[0, 0, 30]]))!;
    expect(t.count).toBe(2);
    const i = Array.from(t.x.slice(0, 2)).findIndex((x) => x > 0);
    expect(t.x[i]).toBeCloseTo(256, 0);
    expect(t.z[i]).toBeCloseTo(0, 0);
    expect(t.y[i]).toBeCloseTo(49.8);
    expect(t.s[i]).toBeCloseTo(0.8);
    expect(TREE_TYPES[t.type[i]]).toBe('pinyon');
    expect(TREE_TYPES[t.type[1 - i]]).toBe('scrub');
  });

  it('地图里写的基准高度和生成的数据一致（差一米整张图的高度就都错了）', () => {
    const meta = JSON.parse(readFileSync('public/real/grandcanyon/meta.json', 'utf8')) as { bases: number[] };
    expect(GRAND_CANYON.real!.levels.map((l) => l.base)).toEqual(meta.bases);
  });

  it('新树种只加在后面：别的地图的树按下标存，前面不能动', () => {
    expect(TREE_TYPES.slice(0, 11)).toEqual(['pine', 'broadleaf', 'canopy', 'emergent', 'palm', 'spruce', 'birch', 'juniper', 'shrub', 'cactus', 'boulder']);
  });

  it('房子：墙埋到最低的角下面，檐口按最高的角算，建在坡上也不悬空', () => {
    // 朝东每米升高 0.1 米的坡
    const n = 65;
    const size = 640;
    const h = new Float32Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] = 100 + (x / (n - 1) - 0.5) * size * 0.1;
    const terrain = new Heightfield(size, n, h);
    const f = buildingFrame(terrain, [0, 0, 40, 20, 0, 6, 2]);
    expect(f.base).toBeCloseTo(100 - 2 - 1.5, 1);
    expect(f.top).toBeCloseTo(100 + 2 + 6, 1);
    // 转九十度：长边顺着南北，东西方向只有 20 米宽
    const g = buildingFrame(terrain, [0, 0, 40, 20, 90, 6, 2]);
    expect(g.top).toBeCloseTo(100 + 1 + 6, 1);
  });

  it('描的房子都在可飞范围里，也没有和起降场重叠', () => {
    const def = GRAND_CANYON.real!;
    expect(def.buildings!.length).toBeGreaterThan(30);
    for (const [x, z, w, d] of def.buildings!) {
      expect(Math.abs(x)).toBeLessThan(GRAND_CANYON.size / 2);
      expect(Math.abs(z)).toBeLessThan(GRAND_CANYON.size / 2);
      expect(w).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(0);
      for (const p of GRAND_CANYON.pads) expect(Math.hypot(x - p.pos[0], z - p.pos[2])).toBeGreaterThan(p.size + Math.hypot(w, d) / 2);
    }
  });

  it('没有树的数据时交回给程序生成', async () => {
    const { trees: _trees, ...def } = GRAND_CANYON.real!;
    expect(await loadRealTrees(def, new Heightfield(64, 5, new Float32Array(25)), [])).toBeNull();
  });

  it('差分编码解出来和原始高度一样（误差不超过量化步长的一半）', () => {
    const n = 65;
    const h = new Float64Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] = 1200 + 300 * Math.sin(x / 7) * Math.cos(z / 5) + (x > 30 ? 180 : 0);
    const g = decodeGrid(encode(h, n, 800, 0.05), level(640, n, 800, 0.05));
    expect(g.cell).toBe(10);
    for (let i = 0; i < h.length; i++) expect(Math.abs(g.data[i] - h[i])).toBeLessThan(0.026);
  });

  it('gzip 文件头：压缩过的解开，已经被服务器解开的原样返回', async () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(await gunzip(raw)).toBe(raw);
    const packed = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    expect(new Uint8Array(await gunzip(packed))).toEqual(new Uint8Array(raw));
  });

  it('文件大小不对直接报错，不会读出一张错位的地形', () => {
    expect(() => decodeGrid(new ArrayBuffer(100), level(640, 65, 0, 1))).toThrow();
  });

  it('取样：网格点上就是网格的值，中间是插值，范围外返回空', () => {
    const n = 5;
    const data = new Float32Array(n * n).map((_, i) => i % n);
    const g = { size: 40, res: n, cell: 10, half: 20, data };
    expect(sampleGrid(g, -20, -20)).toBe(0);
    expect(sampleGrid(g, -10, 0)).toBe(1);
    expect(sampleGrid(g, -15, 0)).toBeCloseTo(0.5);
    expect(sampleGrid(g, 25, 0)).toBeNull();
  });

  it('里层优先：地图外的高度按从里到外第一个覆盖这一点的网格取', () => {
    const inner = { size: 40, res: 5, cell: 10, half: 20, data: new Float32Array(25).fill(100) };
    const outer = { size: 160, res: 5, cell: 40, half: 80, data: new Float32Array(25).fill(7) };
    const r = buildRealData(GRAND_CANYON.real!, [inner, outer, outer]);
    expect(r.heightAt(0, 0)).toBe(100);
    expect(r.heightAt(50, 0)).toBe(7);
    expect(r.heightAt(1e6, 0)).toBe(7);
  });

  it('真实地形的地图不进任务流程，但按名字找得到', () => {
    expect(MAPS.some((m) => m.real)).toBe(false);
    expect(REAL_MAPS).toContain(GRAND_CANYON);
    expect(getMap('grandcanyon')).toBe(GRAND_CANYON);
  });

  it('数据文件不用下载软件会拦截的后缀（.bin、.gz 这些请求到不了网页，只收到一个空的 204）', () => {
    const def = GRAND_CANYON.real!;
    const files = [...def.levels.flatMap((l) => [l.heights, l.image]), def.trees ?? '', def.strata?.image ?? '', def.aux ?? '', def.scatter ?? ''];
    for (const f of files) {
      expect(f).not.toMatch(/\.(bin|gz|gzip|zip|7z|rar|tar|exe|iso|img|tif|tiff)$/i);
      // Windows 的保留设备名：带后缀也不行，Git 打不开，别人也检出不了
      expect(f).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)\./i);
    }
  });

  it('三层网格互相对齐：里面一层的边落在外面一层最细的块的边上，块才能整块跳过', () => {
    const [a, b, c] = GRAND_CANYON.real!.levels;
    const patch = (l: RealLevelDef) => (64 * l.size) / (l.res - 1);
    expect(a.size / 2 / patch(b)).toBe(Math.round(a.size / 2 / patch(b)));
    expect(b.size / 2 / patch(c)).toBe(Math.round(b.size / 2 / patch(c)));
    for (const l of [a, b, c]) expect(Math.log2(l.res - 1)).toBe(Math.round(Math.log2(l.res - 1)));
  });
});
