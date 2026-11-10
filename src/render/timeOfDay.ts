// 时段：白天（地图默认的日照）/ 清晨 / 黄昏 / 夜晚。只影响画面（太阳位置、光色与亮度、晨雾），不影响飞行与任务。
// 清晨、黄昏的太阳只有 6~8° 高：阳光穿过很厚的大气，变暖、变弱，影子拉得很长，
// 体积雾里的光束（丁达尔效应）在这时最明显；清晨谷地与林间另有一层晨雾。
// 夜晚：太阳换成月亮（同一盏方向光，阴影、山影、水面的碎光都照常工作，只是暗得多、偏蓝）。

import type { MapDef } from '../maps/types';
import { tr } from '../i18n';

export type TimeOfDay = 'day' | 'dawn' | 'dusk' | 'night';

export const TIME_OF_DAY: Record<TimeOfDay, { label: string; desc: string }> = {
  day: { label: tr('白天'), desc: tr('地图默认的日照。') },
  dawn: { label: tr('清晨'), desc: tr('日出后不久：低角度的阳光，谷地与林间有晨雾，光束最明显。') },
  dusk: { label: tr('黄昏'), desc: tr('日落前：暖色斜阳、长长的影子，云底被染成橙红。') },
  night: { label: tr('夜晚'), desc: tr('月光下飞行：星空、水面上的月光、城镇灯火，靠仪表和着陆灯。') },
};

export function isTimeOfDay(v: unknown): v is TimeOfDay {
  return v === 'day' || v === 'dawn' || v === 'dusk' || v === 'night';
}

/** 该时段的太阳方位角 / 高度角（度；方位角从北顺时针，与 MapDef.sun 相同） */
export function sunFor(map: MapDef, tod: TimeOfDay): [number, number] {
  if (tod === 'dawn') return map.sunDawn ?? [96, 7.5];
  if (tod === 'dusk') return map.sunDusk ?? [264, 6.5];
  // 月亮挂在太阳对面偏一点的地方，高度适中：山有影子，水面有一条月光
  if (tod === 'night') return [(map.sun[0] + 150) % 360, 31];
  return map.sun;
}
