import { describe, expect, it } from 'vitest';
import type { MapDef } from '../src/maps/types';
import { HeightBuilder } from '../src/sim/terrain';
import { generateWorld } from '../src/world/worldgen';
import { scatterTrees, TREE_SPECS, TREE_TYPES } from '../src/world/vegetation';
import type { Footprint } from '../src/world/propBuilder';
import { FLAT } from './testmap';

function smallMap(): MapDef {
  return {
    ...FLAT, size: 512, res: 33, erosion: undefined, rockForm: undefined, rivers: undefined,
    props: [], pads: [], nodes: [], legs: [], pickups: [],
    vegetation: [{ type: 'emergent', density: 1600, scale: [1, 1] }],
  };
}

describe('世界生成边界与数据隔离', () => {
  it('树冠跨过空间格边界时仍避开建筑占地', () => {
    const map = smallMap();
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    const initial = scatterTrees(map, terrain, hb.surface, []);
    const footprints: Footprint[] = [];
    for (let i = 0; i < initial.count; i++) {
      const boundary = Math.round(initial.x[i] / 32) * 32;
      const distance = initial.x[i] - boundary;
      if (Math.abs(distance) < 6 && Math.abs(distance) > 0.3) {
        // 占地自身不跨格；只有候选树冠跨到占地所在格。
        footprints.push({ x: boundary - Math.sign(distance) * 0.2, z: initial.z[i], r: 0.1 });
      }
    }
    expect(footprints.length).toBeGreaterThan(0);
    const trees = scatterTrees(map, terrain, hb.surface, footprints);
    const overlaps: number[] = [];
    for (let i = 0; i < trees.count; i++) {
      const crown = TREE_SPECS[TREE_TYPES[trees.type[i]]].crownR * trees.s[i] * 0.7;
      if (footprints.some((f) => Math.hypot(trees.x[i] - f.x, trees.z[i] - f.z) < crown + f.r - 1e-4)) overlaps.push(i);
    }
    expect(overlaps).toEqual([]);
  });

  it('林子到地图边上一片片稀下去，稀掉的树还记在树冠图里', () => {
    const map = smallMap();
    map.size = 2048;
    map.vegetation = [{ type: 'emergent', density: 120, scale: [1, 1] }];
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    const trees = scatterTrees(map, terrain, hb.surface, []);
    const edge = (x: number, z: number) => terrain.half - Math.max(Math.abs(x), Math.abs(z));
    let outer = 0;
    let inner = 0;
    for (let i = 0; i < trees.count; i++) {
      const e = edge(trees.x[i], trees.z[i]);
      if (e < 70) outer++;
      else if (e > 400 && e < 470) inner++;
    }
    // 同样 70 m 宽的一圈：越靠外周长越长，树却少得多
    expect(outer).toBeLessThan(inner * 0.5);
    expect(trees.ghosts!.length / 4).toBeGreaterThan(50);
    expect(trees.ghosts!.length % 4).toBe(0);
  });

  it('稀掉的只有边上的树：地图中间的树一棵不变', () => {
    const map = smallMap();
    map.size = 4096;
    map.vegetation = [{ type: 'emergent', density: 60, scale: [1, 1] }];
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    const a = scatterTrees(map, terrain, hb.surface, []);
    const b = scatterTrees({ ...map, seed: map.seed }, terrain, hb.surface, []);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    for (let i = 0; i < a.ghosts!.length; i += 4) {
      expect(terrain.half - Math.max(Math.abs(a.ghosts![i]), Math.abs(a.ghosts![i + 1]))).toBeLessThanOrEqual(620);
    }
  });

  it('地图外面那一圈：只种高的，越往外越稀，地图中间的树一棵不变', () => {
    const map = smallMap();
    map.size = 2048;
    map.vegetation = [{ type: 'emergent', density: 150, scale: [1, 1] }, { type: 'shrub', density: 300, scale: [1, 1] }];
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    const plain = scatterTrees(map, terrain, hb.surface, []);
    const ringed = scatterTrees({ ...map, fringe: 600 }, terrain, hb.surface, []);
    const outside = (t: typeof ringed, i: number): number => Math.max(Math.abs(t.x[i]), Math.abs(t.z[i])) - terrain.half;
    let near = 0;
    let far = 0;
    for (let i = 0; i < ringed.count; i++) {
      const d = outside(ringed, i);
      if (d <= 0) continue;
      expect(TREE_TYPES[ringed.type[i]]).toBe('emergent');
      if (d < 200) near++;
      else if (d > 450) far++;
    }
    expect(near).toBeGreaterThan(far * 2);
    expect(far).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < plain.count; i++) expect(outside(plain, i)).toBeLessThanOrEqual(0);
    const middle = (t: typeof ringed): number[] => {
      const out: number[] = [];
      for (let i = 0; i < t.count; i++) if (outside(t, i) < -400) out.push(t.x[i], t.z[i]);
      return out.sort((a, b) => a - b);
    };
    expect(middle(ringed)).toEqual(middle(plain));
  });

  it('远景地面抬到树冠高度的地方，那一圈树种在抬之前的地面上', () => {
    const map = smallMap();
    map.size = 1024;
    map.vegetation = [{ type: 'emergent', density: 150, scale: [1, 1] }];
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    const low = scatterTrees({ ...map, fringe: 300 }, terrain, hb.surface, []);
    const sunk = scatterTrees({ ...map, fringe: 300, farCanopy: () => 20 }, terrain, hb.surface, []);
    expect(sunk.count).toBe(low.count);
    let moved = 0;
    for (let i = 0; i < low.count; i++) if (low.y[i] - sunk.y[i] > 10) moved++;
    expect(moved).toBeGreaterThan(0);
  });

  it('散布网格的末格不会把树种到地图边界外', () => {
    const map = smallMap();
    map.size = 256;
    map.vegetation = [{ type: 'pine', density: 10, scale: [1, 1] }];
    const hb = new HeightBuilder(map.size, map.res);
    const terrain = hb.build();
    for (let seed = 1; seed <= 30; seed++) {
      const trees = scatterTrees({ ...map, seed }, terrain, hb.surface, []);
      for (let i = 0; i < trees.count; i++) {
        expect(Math.abs(trees.x[i]), `seed ${seed}, x`).toBeLessThanOrEqual(terrain.half - 30);
        expect(Math.abs(trees.z[i]), `seed ${seed}, z`).toBeLessThanOrEqual(terrain.half - 30);
      }
    }
  });

  it('自动高度与绑定补给只改本次世界，重新生成会重新计算', async () => {
    const map = smallMap();
    map.vegetation = [];
    map.pads = [{ ...FLAT.pads[0], pos: [0, 0.4, 200], style: 'platform' }];
    map.nodes = [{ id: 'auto', pos: [0, 10, 0], radius: 30, autoAlt: 20 }];
    map.legs = [{ to: 'land', paths: [{ id: 'main', label: '', detail: '', tag: 'main', nodes: ['auto'] }] }];
    map.mission = { ...FLAT.mission, main: [{ ...FLAT.mission.main[0], approach: [0, 40, -200] }] };
    map.pickups = [{ id: 'boost', kind: 'boost', node: 'auto', pos: [99, 99, 99] }];
    map.buildTerrain = (b) => { b.fill(() => 100); };
    const high = await generateWorld(map, false);
    expect(high.map.nodes[0].pos[1]).toBe(120);
    expect(high.map.pickups[0].pos).toEqual(high.map.nodes[0].pos);
    expect(map.nodes[0].pos).toEqual([0, 10, 0]);
    expect(map.pickups[0].pos).toEqual([99, 99, 99]);
    map.buildTerrain = (b) => { b.fill(() => 0); };
    const low = await generateWorld(map, false);
    expect(low.map.nodes[0].pos[1]).toBeLessThan(40);
    expect(high.map.nodes[0].pos[1]).toBe(120);
    expect(low.map.pickups[0].pos).toEqual(low.map.nodes[0].pos);
  });
});
