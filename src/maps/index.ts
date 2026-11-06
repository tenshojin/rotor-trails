// 地图注册表。每次只构建选中的一张地图（地形/道具/植被按需生成，切换时释放）。

import type { MapDef, MapId } from './types';
import { TRAINING } from './training';
import { JAPAN } from './japan';
import { CANYON } from './canyon';
import { AMAZON } from './amazon';
import { FJORD_MAP } from './fjord';
import { HIMALAYA } from './himalaya';
import { GRAND_CANYON } from './grandcanyon';

export const MAPS: MapDef[] = [TRAINING, JAPAN, CANYON, AMAZON, FJORD_MAP, HIMALAYA];

/** 真实地形的地图：只有休闲飞行，数据要联网下载，不进任务流程 */
export const REAL_MAPS: MapDef[] = [GRAND_CANYON];

export function registerMap(m: MapDef): void {
  if (!MAPS.find((x) => x.id === m.id)) MAPS.push(m);
}

export function getMap(id: MapId): MapDef {
  const m = MAPS.find((x) => x.id === id) ?? REAL_MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`地图不存在：${id}`);
  return m;
}

export const CAMPAIGN: MapId[] = ['japan', 'canyon', 'amazon', 'fjord', 'himalaya'];
