// 世界生成：地形 → 停机坪 → 道具（渲染几何 + 碰撞体）→ 植被。仿真与渲染共用同一份结果。

import { Rng } from '../core/noise';
import type { MapDef, PadDef } from '../maps/types';
import { HeightBuilder, type Heightfield } from '../sim/terrain';
import { PropBuilder, type ColliderSpec } from './propBuilder';
import { buildPad, type PropCtx } from './props/common';
import { PROP_FNS } from './props/index';
import { scatterTrees, type TreeSet } from './vegetation';

export interface WorldData {
  map: MapDef;
  terrain: Heightfield;
  surface: Uint8Array;
  builder: PropBuilder;
  colliders: ColliderSpec[];
  trees: TreeSet;
  pads: Map<string, PadDef>;
  ctx: PropCtx;
}

export type ProgressFn = (p: number, label: string) => void;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function generateWorld(map: MapDef, withMesh: boolean, progress?: ProgressFn): Promise<WorldData> {
  progress?.(0.05, '生成地形');
  await tick();
  const hb = new HeightBuilder(map.size, map.res);
  map.buildTerrain(hb);
  // 地面停机坪：压平地形（坪面略高于地面）
  for (const p of map.pads) {
    if (p.style === 'ground') {
      hb.flatten(p.pos[0], p.pos[2], p.size * 0.72, p.pos[1] - 0.45, 18);
      hb.paintCircle(1, p.pos[0], p.pos[2], p.size * 0.8, 8, 0.8);
      hb.paintCircle(2, p.pos[0], p.pos[2], p.size * 0.8 + 6, 6, 1);
    }
  }
  const terrain = hb.build();
  progress?.(0.45, '布置建筑与停机坪');
  await tick();
  const waterLevel = map.waterLevel;
  const ctx: PropCtx = {
    terrain,
    waterLevel,
    ground: (x, z) => Math.max(terrain.heightAt(x, z), waterLevel ?? -Infinity),
  };
  const B = new PropBuilder(withMesh);
  const pads = new Map<string, PadDef>();
  for (const p of map.pads) {
    pads.set(p.id, p);
    buildPad(B, p, ctx);
  }
  const rng = new Rng(map.seed * 31 + 5);
  for (const d of map.props) {
    const fn = PROP_FNS[d.type];
    if (!fn) throw new Error(`未知道具类型：${d.type}`);
    const y = d.ground ? terrain.heightAt(d.pos[0], d.pos[2]) + d.pos[1] : d.pos[1];
    B.at(d.pos[0], y, d.pos[2], d.rotY ?? 0, d.s ?? 1);
    B.defaultTag = { kind: 'structure', id: d.type };
    fn(B, d, rng, ctx);
  }
  progress?.(0.65, '种植植被');
  await tick();
  const trees = scatterTrees(map, terrain, hb.surface, B.footprints);
  progress?.(0.8, '完成');
  return { map, terrain, surface: hb.surface, builder: B, colliders: B.colliders, trees, pads, ctx };
}
