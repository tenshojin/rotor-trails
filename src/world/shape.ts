// 地形成形：地图自己的地形函数 → 压平地面停机坪 → 河流下切 → 雨水侵蚀 → 岩体造型 → 河道 → 最后的地表。
// 生成世界（worldgen.ts）时在主线程上做，也在后台线程（workers/gen.worker.ts）里做：两边是同一份代码，结果逐位相同。
// 这个文件和它引用的模块都不能 import three.js：后台线程的脚本会把它们整个打包进去。

import type { MapDef } from '../maps/types';
import { rimWobble, type HeightBuilder } from '../sim/terrain';
import { dissect } from './fluvial';
import { erode } from './erosion';
import { applyRockForm } from './rockForm';
import { carveRiver, settleRiver } from './river';

/** 成形中耗时的两步：加载界面上分别写出来 */
export type ShapeStage = 'dissect' | 'erode';

/** 生成要改写的几样（自动航点高度、补给绑定、河道高程）先复制一份，不写回共享的地图配方 */
export function cloneMapForGen(map: MapDef): MapDef {
  return {
    ...map,
    nodes: map.nodes.map((node) => ({ ...node, pos: [...node.pos] })),
    pickups: map.pickups.map((pickup) => ({ ...pickup, pos: [...pickup.pos] })),
    rivers: map.rivers?.map((river) => ({ ...river, pts: river.pts.map((p): [number, number, number, number] => [p[0], p[1], p[2], p[3]]) })),
  };
}

/** 侵蚀的保护图：停机坪、空地、村落和建筑的平地不动（0），往外渐变到 1 */
function protectMask(map: MapDef): Float32Array {
  const r = map.res;
  const cell = map.size / (r - 1);
  const half = map.size / 2;
  const mask = new Float32Array(r * r).fill(1);
  const wob = map.rockForm ? 0.4 : 0;
  const spot = (x: number, z: number, rad: number, blend: number): void => {
    const R = rad * (1 + wob) + blend;
    const x0 = Math.max(0, Math.floor((x - R + half) / cell));
    const x1 = Math.min(r - 1, Math.ceil((x + R + half) / cell));
    const z0 = Math.max(0, Math.floor((z - R + half) / cell));
    const z1 = Math.min(r - 1, Math.ceil((z + R + half) / cell));
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix * cell - half - x;
        const dz = iz * cell - half - z;
        const t = Math.min(1, Math.max(0, (Math.hypot(dx, dz) - rad * (1 + wob * rimWobble(x, z, Math.atan2(dz, dx)))) / blend));
        const k = iz * r + ix;
        mask[k] = Math.min(mask[k], t * t * (3 - 2 * t));
      }
  };
  for (const p of map.pads) spot(p.pos[0], p.pos[2], p.size * 1.3 + 12, 40);
  for (const [x, z, rad] of map.clearings) spot(x, z, rad, 40);
  for (const p of map.props) {
    if (!p.ground) continue;
    spot(p.pos[0], p.pos[2], Number(p.p?.r ?? 22) + 8, 30);
  }
  return mask;
}

/**
 * 在 hb 上把地形做完（真实地形先把测绘高度写进 hb 再调用）。stage 在耗时的步骤之前调用：
 * 主线程上用它刷新加载界面、让出一下；后台线程里用它把进度发回去。会改 map.rivers 的河道高程（map 要是 cloneMapForGen 的副本）。
 */
export async function shapeTerrain(map: MapDef, hb: HeightBuilder, stage?: (s: ShapeStage) => void | Promise<void>): Promise<void> {
  map.buildTerrain(hb);
  // 地面停机坪：压平地形（坪面略高于地面）
  for (const p of map.pads) {
    if (p.style === 'ground') {
      hb.flatten(p.pos[0], p.pos[2], p.size * 0.72, p.pos[1] - 0.45, 18);
      hb.paintCircle(1, p.pos[0], p.pos[2], p.size * 0.8, 8, 0.8);
      hb.paintCircle(2, p.pos[0], p.pos[2], p.size * 0.8 + 6, 6, 1);
    }
  }
  const protection = map.erosion || map.dissect || map.rockForm || map.rivers?.length ? protectMask(map) : undefined;
  if (map.dissect) {
    await stage?.('dissect');
    dissect(hb.data, map.res, { ...map.dissect, size: map.size, waterLevel: map.waterLevel, mask: protection, seed: map.seed });
  }
  if (map.erosion) {
    await stage?.('erode');
    erode(hb.data, map.res, map.seed, { droplets: map.erosion, waterLevel: map.waterLevel, mask: protection });
  }
  if (map.rockForm) applyRockForm(hb.data, map.res, map.size, map.rockForm, protection!);
  if (map.rivers) {
    for (const r of map.rivers) {
      settleRiver(hb, r);
      carveRiver(hb, r, protection!);
    }
  }
  map.paintFinal?.(hb);
}
