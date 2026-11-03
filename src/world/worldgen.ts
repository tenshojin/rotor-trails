// 世界生成：地形 → 停机坪 → 道具（渲染几何 + 碰撞体）→ 植被。仿真与渲染共用同一份结果。

import { Rng } from '../core/noise';
import type { MapDef, PadDef, V3 } from '../maps/types';
import { obstacleTop } from '../sim/routeCheck';
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
    // 地形高度已经定了，这里只往地表掩码（hb.surface，与 world.surface 是同一份）里画路面、院子
    paintPath: (ch, pts, w, f, s = 1) => void hb.paintPath(ch, pts, w, f, s),
    paintCircle: (ch, x, z, r, f, s = 1) => void hb.paintCircle(ch, x, z, r, f, s),
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
  const world: WorldData = { map, terrain, surface: hb.surface, builder: B, colliders: B.colliders, trees, pads, ctx };
  resolveAutoAltitudes(world);
  attachPickupsToNodes(world);
  progress?.(0.8, '完成');
  return world;
}

/** 计算 autoAlt 航点的高度：取前后航段沿线（含两侧 20 m）的最高障碍 + 余量。 */
export function resolveAutoAltitudes(world: WorldData): void {
  const map = world.map;
  if (!map.nodes.some((n) => n.autoAlt !== undefined)) return;
  const maxAlong = (a: V3, b: V3) => {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / 15));
    let m = -Infinity;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      m = Math.max(m, obstacleTop(world, a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, 20));
    }
    return m;
  };
  const nodeMap = new Map(map.nodes.map((n) => [n.id, n] as const));
  const spawn = world.pads.get(map.spawn.padId)!.pos;
  let start: V3 = spawn;
  for (const leg of map.legs) {
    const obj = map.mission.main.find((o) => o.id === leg.to);
    const goal: V3 = obj ? obj.approach : start;
    for (const path of leg.paths) {
      const seq: V3[] = [start, ...path.nodes.map((id) => nodeMap.get(id)!.pos), goal];
      path.nodes.forEach((id, k) => {
        const nd = nodeMap.get(id)!;
        if (nd.autoAlt === undefined) return;
        const i = k + 1;
        const m = Math.max(maxAlong(seq[i - 1], seq[i]), maxAlong(seq[i], seq[i + 1]));
        nd.pos = [nd.pos[0], Math.max(nd.pos[1], Math.round(m + nd.autoAlt)), nd.pos[2]];
        seq[i] = nd.pos;
      });
    }
    start = obj && obj.kind === 'inspect' ? (obj.route ?? obj.points.map((p) => p.pos)).slice(-1)[0] : goal;
  }
}

/** 绑定在航点上的拾取物跟随航点的最终位置（航点可能被 autoAlt 抬高）。 */
function attachPickupsToNodes(world: WorldData): void {
  const map = world.map;
  for (const p of map.pickups) {
    if (!p.node) continue;
    const nd = map.nodes.find((n) => n.id === p.node);
    if (nd) p.pos = [nd.pos[0], nd.pos[1], nd.pos[2]];
  }
}
