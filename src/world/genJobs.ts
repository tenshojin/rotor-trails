// 后台线程（workers/gen.worker.ts）里做的活：生成世界时最占主线程的几样纯计算。
// 主线程用不了后台线程时，worldgen.ts 和 render/ 下面走的是同一份代码（shape.ts、flow.ts、terrainMacroData.ts），结果逐位相同。
// 这个文件和它引用的模块都不能 import three.js（后台线程的脚本会把它们整个打包进去）。

import type { MapDef } from '../maps/types';
import { HeightBuilder } from '../sim/terrain';
import { makeFlowMap, type FlowMap } from './flow';
import { cloneMapForGen, shapeTerrain, type ShapeStage } from './shape';
import { terrainMacroData } from './terrainMacroData';

/** 成形好的地形，加上紧接着要算的水系图和地形宏观图 */
export interface ShapedTerrain {
  /** 高度（HeightBuilder.data） */
  data: Float32Array;
  /** 地表掩码（HeightBuilder.surface）：之后布置道具时还要往上画路面、院子 */
  surface: Uint8Array;
  rimWobble: number;
  /** 每条河的河道点（成形时按地面定下了高程） */
  rivers: Array<Array<[number, number, number, number]>> | null;
  flow: FlowMap;
  /** 地形宏观图的像素（render/terrainMacro.ts） */
  macro: Uint8Array;
}

/** 程序生成的地图（真实地形要下载测绘数据，不在这里做） */
export async function shapeJob(map: MapDef, stage?: (s: ShapeStage) => void | Promise<void>): Promise<ShapedTerrain> {
  if (map.real) throw new Error('真实地形不在后台线程里成形');
  const m = cloneMapForGen(map);
  const hb = new HeightBuilder(m.size, m.res);
  await shapeTerrain(m, hb, stage);
  const terrain = hb.build();
  return {
    data: hb.data,
    surface: hb.surface,
    rimWobble: hb.rimWobble,
    rivers: m.rivers?.map((r) => r.pts) ?? null,
    flow: makeFlowMap(terrain, m.waterLevel),
    macro: terrainMacroData(terrain),
  };
}

/** 发回主线程时直接移交（不复制）的内存块 */
export function shapedBuffers(r: ShapedTerrain): ArrayBuffer[] {
  return [r.data.buffer, r.surface.buffer, r.flow.data.buffer, r.macro.buffer] as ArrayBuffer[];
}
