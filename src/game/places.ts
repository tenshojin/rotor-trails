// 休闲飞行的地名：飞到一个地方，屏幕上淡入地名和一句话，去过的记进存档。
// 地标在暂停菜单里跳不过去，要飞去：菜单写着在哪个方向、多远，点一下让自动巡航飞过去。

import type { MapDef } from '../maps/types';
import { PLACE_NOTES } from '../maps/placeNotes';

export interface Place {
  name: string;
  note: string;
  x: number;
  z: number;
  /** 进了这个半径就算到了 */
  r: number;
}

const VISTA_R = 300;
const LANDMARK_R = 420;

/** 这张图上的地方：地标和景点按名字合并 */
export function placesOf(map: MapDef): Place[] {
  const notes = PLACE_NOTES[map.id] ?? {};
  const out = new Map<string, Place>();
  for (const l of map.landmarks) out.set(l.name, { name: l.name, note: notes[l.name] ?? '', x: l.pos[0], z: l.pos[2], r: LANDMARK_R });
  for (const v of map.vistas ?? []) {
    const p = out.get(v.name);
    // 同名的景点是看这个地标的机位，跳到那里也算到了
    if (p) p.r = Math.max(p.r, Math.hypot(v.at[0] - p.x, v.at[2] - p.z) + 60);
    else out.set(v.name, { name: v.name, note: notes[v.name] ?? '', x: v.at[0], z: v.at[2], r: VISTA_R });
  }
  return [...out.values()];
}

/** 一趟飞行里每个地方只报一次，同时进了两个地方先报近的 */
export class PlaceWatcher {
  private readonly told = new Set<string>();

  constructor(readonly places: readonly Place[]) {}

  arrive(x: number, z: number): Place | null {
    let best: Place | null = null;
    let nearest = 1;
    for (const p of this.places) {
      if (this.told.has(p.name)) continue;
      const k = Math.hypot(x - p.x, z - p.z) / p.r;
      if (k < nearest) {
        nearest = k;
        best = p;
      }
    }
    if (best) this.told.add(best.name);
    return best;
  }
}

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

/** “东北 1.2 公里”：世界里 -z 是北 */
export function directionTo(x: number, z: number, p: Place): string {
  const dx = p.x - x;
  const dz = p.z - z;
  const d = Math.hypot(dx, dz);
  const i = Math.round(Math.atan2(dx, -dz) / (Math.PI / 4));
  const far = d < 950 ? `${Math.max(10, Math.round(d / 10) * 10)} 米` : `${(d / 1000).toFixed(1)} 公里`;
  return `${COMPASS[((i % 8) + 8) % 8]} ${far}`;
}
