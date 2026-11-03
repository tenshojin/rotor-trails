// 地图注册表。每次只构建选中的一张地图（地形/道具/植被按需生成，切换时释放）。

import type { MapDef, MapId } from './types';
import { TRAINING } from './training';
import { JAPAN } from './japan';

export const MAPS: MapDef[] = [TRAINING, JAPAN];

export function registerMap(m: MapDef): void {
  if (!MAPS.find((x) => x.id === m.id)) MAPS.push(m);
}

export function getMap(id: MapId): MapDef {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`地图不存在：${id}`);
  return m;
}

export const CAMPAIGN: MapId[] = ['japan', 'canyon', 'amazon', 'fjord', 'himalaya'];
