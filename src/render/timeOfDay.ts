// 时段：白天（地图默认的日照）/ 清晨 / 黄昏。只影响画面（太阳位置、光色与亮度、晨雾），不影响飞行与任务。
// 清晨、黄昏的太阳只有 6~8° 高：阳光穿过很厚的大气，变暖、变弱，影子拉得很长，
// 体积雾里的光束（丁达尔效应）在这时最明显；清晨谷地与林间另有一层晨雾。

import type { MapDef } from '../maps/types';

export type TimeOfDay = 'day' | 'dawn' | 'dusk';

export const TIME_OF_DAY: Record<TimeOfDay, { label: string; desc: string }> = {
  day: { label: '白天', desc: '地图默认的日照。' },
  dawn: { label: '清晨', desc: '日出后不久：低角度的阳光，谷地与林间有晨雾，光束最明显。' },
  dusk: { label: '黄昏', desc: '日落前：暖色斜阳、长长的影子，云底被染成橙红。' },
};

export function isTimeOfDay(v: unknown): v is TimeOfDay {
  return v === 'day' || v === 'dawn' || v === 'dusk';
}

/** 该时段的太阳方位角 / 高度角（度；方位角从北顺时针，与 MapDef.sun 相同） */
export function sunFor(map: MapDef, tod: TimeOfDay): [number, number] {
  if (tod === 'dawn') return map.sunDawn ?? [96, 7.5];
  if (tod === 'dusk') return map.sunDusk ?? [264, 6.5];
  return map.sun;
}
