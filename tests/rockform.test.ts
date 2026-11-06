import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { riverLine, PathSampler } from '../src/maps/routeUtil';
import { bakeShadowHeights } from '../src/render/sunMap';
import { HeightBuilder } from '../src/sim/terrain';
import { applyRockForm, layerTable, randomBands, strataWarp, type RockFormDef } from '../src/world/rockForm';

const def: RockFormDef = {
  y0: 0,
  y1: 400,
  dip: [0.01, 0],
  waves: [[0.01, 0, 2, 0]],
  bench: 1,
  slope: [0.3, 0.6],
  tint: 1,
  bands: [
    { t: 30, hard: 1, c: 0xaa5533 },
    { t: 20, hard: 0.1, c: 0x886644 },
  ],
};

describe('岩层', () => {
  it('地层表覆盖全部高度，层与层首尾相接', () => {
    const T = layerTable(def);
    expect(T.start[0]).toBe(0);
    for (let i = 1; i < T.start.length; i++) expect(T.start[i]).toBeCloseTo(T.end[i - 1], 5);
    expect(T.end[T.end.length - 1]).toBeGreaterThanOrEqual(400);
    expect(T.band[1]).toBe(1);
    expect(T.band[2]).toBe(0);
  });

  it('地层面的偏移含倾斜和起伏', () => {
    expect(strataWarp(def, 100, 0)).toBeCloseTo(1 + 2 * Math.sin(1), 5);
  });

  it('陡坡改成崖和台，平地不动', () => {
    const res = 129;
    const size = 512;
    const data = new Float32Array(res * res);
    // 左半边是平地，右半边是 1:1 的坡
    for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) data[z * res + x] = x < 64 ? 40 : 40 + (x - 64) * 4;
    const before = data.slice();
    applyRockForm(data, res, size, { ...def, dip: [0, 0], waves: [] });
    const row = 64 * res;
    expect(data[row + 20]).toBe(before[row + 20]);
    // 同一道坡上坡度不再一样：出现了比原来更陡和更缓的段
    let steep = 0;
    let flat = 0;
    for (let x = 72; x < 120; x++) {
      const s = (data[row + x + 1] - data[row + x]) / 4;
      if (s > 1.4) steep++;
      if (s < 0.6) flat++;
    }
    expect(steep).toBeGreaterThan(3);
    expect(flat).toBeGreaterThan(3);
  });

  it('随机地层的厚度在给定范围内', () => {
    for (const b of randomBands(5, 40, [0x444444], [8, 50])) {
      expect(b.t).toBeGreaterThanOrEqual(8);
      expect(b.t).toBeLessThanOrEqual(50);
    }
  });
});

describe('山影', () => {
  it('高墙背阳的一侧在影子里，影子长度符合太阳高度', () => {
    const res = 129;
    const b = new HeightBuilder(512, res);
    b.fill((x) => (x > -8 && x < 8 ? 100 : 0));
    const t = b.build();
    // 太阳在 +x 方向，高度角 45°：墙高 100 米，影子往 -x 方向约 100 米长
    const sun = new THREE.Vector3(1, 1, 0).normalize();
    const U = bakeShadowHeights(t, sun);
    const at = (x: number) => U[64 * res + Math.round((x + 256) / t.cell)];
    expect(at(-40)).toBeGreaterThan(0);
    expect(at(-120)).toBeLessThan(0);
    // 向阳的一侧没有影子
    expect(at(60)).toBeLessThan(0);
  });
});

describe('地图外的山影', () => {
  it('太阳低的时候，地图外的山也挡光（否则阳光穿过雪山照进峡湾）', () => {
    const res = 129;
    const b = new HeightBuilder(512, res);
    b.fill(() => 0);
    const t = b.build();
    // 太阳在 +x 方向，高度角约 11°；地图外 x = 600 m 起是一道 300 m 高的山
    const sun = new THREE.Vector3(1, 0.2, 0).normalize();
    const R = 64;
    const size = 2048;
    const h = new Float32Array(R * R);
    for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) h[z * R + x] = ((x + 0.5) / R - 0.5) * size > 600 ? 300 : 0;
    const mid = 64 * res + 64;
    expect(bakeShadowHeights(t, sun)[mid]).toBeLessThan(0);
    expect(bakeShadowHeights(t, sun, { h, res: R, size })[mid]).toBeGreaterThan(0);
  });

  it('斜着照进来的光从侧边进地图时，一样算上外面的山', () => {
    const res = 129;
    const b = new HeightBuilder(512, res);
    b.fill(() => 0);
    const t = b.build();
    const sun = new THREE.Vector3(1, 0.3, 0.8).normalize();
    const R = 64;
    const size = 2048;
    const h = new Float32Array(R * R);
    for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) h[z * R + x] = ((z + 0.5) / R - 0.5) * size > 500 ? 500 : 0;
    const U = bakeShadowHeights(t, sun, { h, res: R, size });
    // 地图的 +z 边上，外面的山就在头顶
    expect(U[(res - 2) * res + 20]).toBeGreaterThan(0);
  });
});

describe('河流', () => {
  it('河线绕开圆形禁区，并按下游方向排列', () => {
    const P = new PathSampler([
      [0, 0],
      [1000, 0],
    ]);
    const pts = riverLine(
      P,
      0,
      1000,
      20,
      () => 0,
      (s) => s * 0.01,
      () => 8,
      [[500, 0, 40]],
    );
    expect(pts[0][2]).toBeGreaterThan(pts[pts.length - 1][2]);
    for (const p of pts) expect(Math.hypot(p[0] - 500, p[1])).toBeGreaterThan(28);
  });
});
