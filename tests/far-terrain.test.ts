import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import { farRiverLine, polylineDist, smoothPath } from '../src/maps/routeUtil';

describe('地图外的远景', () => {
  it('到折线的距离，离得太远直接跳过', () => {
    const path: Array<[number, number]> = [[0, 0], [100, 0], [100, 100]];
    expect(polylineDist(path, 50, 30, 200)).toBeCloseTo(30);
    expect(polylineDist(path, 130, 50, 200)).toBeCloseTo(30);
    expect(polylineDist(path, 5000, 0, 200)).toBe(Infinity);
  });

  it('圆滑的路径从头走到尾，穿过每个控制点', () => {
    const ctrl: Array<[number, number]> = [[0, 0], [300, 100], [600, -80], [900, 40]];
    const p = smoothPath(ctrl, 50);
    expect(p[0]).toEqual([0, 0]);
    expect(p.at(-1)).toEqual([900, 40]);
    for (const [x, z] of ctrl) expect(polylineDist(p, x, z, 10)).toBeLessThan(1e-6);
    for (let i = 0; i + 1 < p.length; i++) expect(Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1])).toBeLessThan(90);
  });

  it('加了弯的路径起点不偏，后面确实弯了', () => {
    const p = smoothPath([[0, 0], [1000, 0], [2000, 0]], 50, 60);
    expect(p[0][0]).toBeCloseTo(0);
    expect(p[0][1]).toBeCloseTo(0);
    expect(Math.max(...p.map((q) => Math.abs(q[1])))).toBeGreaterThan(30);
  });

  it('地图外的河跟着远景地形下沉', () => {
    const pts = farRiverLine([[2000, 0], [2600, 0]], 4096, 100, 10);
    expect(pts[0][2]).toBeCloseTo(98);
    expect(pts.at(-1)![2]).toBeLessThan(pts[0][2]);
    expect(pts.at(-1)![2]).toBeGreaterThanOrEqual(92);
    expect(pts.at(-1)![0]).toBeCloseTo(2600);
  });

  it('峡谷出了地图还在往前走，两边是高原', () => {
    const far = getMap('canyon').farTerrain!;
    expect(far(-2600, 1340)).toBeLessThan(160);
    expect(far(2620, -1230)).toBeLessThan(160);
    expect(far(-2600, 1800)).toBeGreaterThan(280);
  });

  it('峡谷的河接得上：地图外的河从地图里的河头尾开始', () => {
    const map = getMap('canyon');
    const main = map.rivers![0].pts;
    const [west, east] = map.farRivers!;
    expect(west.pts.at(-1)).toEqual(main[0]);
    expect(east.pts[0]).toEqual(main.at(-1));
  });

  it('峡湾尽头的河谷出了地图继续往内陆走，两边是高原', () => {
    const far = getMap('fjord').farTerrain!;
    expect(far(2320, -720)).toBeLessThan(140);
    expect(far(2320, 500)).toBeGreaterThan(380);
  });

  it('峡湾的陆地在远景网格到头之前沉进海里', () => {
    const far = getMap('fjord').farTerrain!;
    for (const [x, z] of [[0, 15000], [0, -15000], [15500, 0], [15000, 15000]]) expect(far(x, z)).toBeLessThan(0);
  });

  it('雨林的大河流出地图，外面的地面在树冠高度', () => {
    const far = getMap('amazon').farTerrain!;
    expect(far(-3050, 520)).toBeLessThan(0);
    expect(far(3100, -280)).toBeLessThan(0);
    expect(far(-3050, 1500)).toBeGreaterThan(25);
  });
});
