// 飞行存档：飞到一半存下来，下次接着飞。
//   · 玩家自己存（暂停菜单的“存档”、默认 K 键）：每张图的任务、休闲飞行各一格，新存的盖掉旧的。
//   · 离开飞行时自动存（回主菜单、关掉或刷新网页、手机切到后台）：单独一格，不会盖掉玩家自己存的那一格。
//     主菜单的“继续飞行”读的是所有存档里最新的那一份。
// 存在浏览器里，和主存档用同一个存储、不同的键，关掉网页也还在。导出存档不包括它：它只是“飞到一半”。

import type { AssistId } from '../config/flight';
import type { MapDef, MapId } from '../maps/types';
import type { TimeOfDay } from '../render/timeOfDay';
import type { SessionSave } from '../sim/session';
import type { StorageLike } from './save';
import { tr } from '../i18n';

export const FLIGHTS_KEY = 'rotorTrails.flights';
/** 存档格式：以后改了 SessionSave 的结构就加一，旧格式的存档不读（不会读错） */
export const FLIGHT_FORMAT = 1;
/** 离开飞行时自动存的那一格 */
export const RESUME_SLOT = 'resume';

export interface FlightRun {
  map: MapId;
  weather: string;
  assist: AssistId;
  free: boolean;
  time: TimeOfDay;
}

export interface FlightSave {
  format: number;
  /** 存的时间（毫秒） */
  savedAt: number;
  /** 存档时的游戏版本（只是记一下） */
  version: string;
  /** 离开时自动存的 */
  auto: boolean;
  run: FlightRun;
  /** 地图的样子（航点数、坪数、目标数）：地图改过以后的旧档不读，免得任务进度错位 */
  sig: string;
  /** 存档时的进度（菜单上显示用） */
  info: { step: number; total: number; durability: number };
  state: SessionSave;
}

export const slotOf = (map: MapId, free: boolean): string => `${map}/${free ? 'free' : 'mission'}`;

/** 地图的样子：存档和读档时各算一次，不一样就是地图改过了 */
export function mapSig(m: MapDef): string {
  return `${m.nodes.length}:${m.pads.length}:${m.mission.main.length}:${m.mission.optional.length}`;
}

const ASSIST_IDS = ['novice', 'standard', 'challenge', 'sim'];
const TIMES = ['day', 'dawn', 'dusk', 'night'];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 存档的外层是不是完整（里面的飞行状态由 GameSession.canRestore 再查一遍） */
export function isFlightSave(v: unknown): v is FlightSave {
  if (!isObj(v) || v.format !== FLIGHT_FORMAT || typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return false;
  const r = v.run;
  if (!isObj(r) || typeof r.map !== 'string' || typeof r.weather !== 'string' || !ASSIST_IDS.includes(r.assist as string) || typeof r.free !== 'boolean' || !TIMES.includes(r.time as string)) return false;
  const i = v.info;
  if (!isObj(i) || typeof i.step !== 'number' || typeof i.total !== 'number' || typeof i.durability !== 'number') return false;
  return typeof v.sig === 'string' && isObj(v.state);
}

export class FlightSaves {
  constructor(private readonly storage: StorageLike | null) {}

  get available(): boolean {
    return !!this.storage;
  }

  /** 所有存档（坏掉的、旧格式的跳过） */
  all(): Record<string, FlightSave> {
    const out: Record<string, FlightSave> = {};
    if (!this.storage) return out;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(FLIGHTS_KEY);
    } catch {
      return out;
    }
    if (!raw) return out;
    try {
      const parsed: unknown = JSON.parse(raw);
      const slots = isObj(parsed) && isObj(parsed.slots) ? parsed.slots : {};
      for (const [k, v] of Object.entries(slots)) if (isFlightSave(v)) out[k] = v;
    } catch {
      // 读不出来：当作没有存档。不覆盖，下一次存的时候再整份重写
    }
    return out;
  }

  get(slot: string): FlightSave | null {
    return this.all()[slot] ?? null;
  }

  /** 存进去。存不进去（存储满了、被禁止）返回 false，原来的存档不动 */
  put(slot: string, save: FlightSave): boolean {
    const all = this.all();
    all[slot] = save;
    return this.write(all);
  }

  remove(slot: string): void {
    const all = this.all();
    if (!(slot in all)) return;
    delete all[slot];
    this.write(all);
  }

  /** 最新的一份（可以挑：比如只要还能读的） */
  latest(ok: (s: FlightSave) => boolean = () => true): { slot: string; save: FlightSave } | null {
    let best: { slot: string; save: FlightSave } | null = null;
    for (const [slot, save] of Object.entries(this.all())) if (ok(save) && (!best || save.savedAt > best.save.savedAt)) best = { slot, save };
    return best;
  }

  /** 这张图、这种玩法（任务 / 休闲）最新的一份：自己存的那一格，或者离开时自动存的（如果正好是这张图） */
  forRun(map: MapId, free: boolean, ok: (s: FlightSave) => boolean = () => true): { slot: string; save: FlightSave } | null {
    return this.latest((s) => s.run.map === map && s.run.free === free && ok(s));
  }

  private write(all: Record<string, FlightSave>): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(FLIGHTS_KEY, JSON.stringify({ format: FLIGHT_FORMAT, slots: all }));
      return true;
    } catch {
      return false;
    }
  }
}

/** 多久以前存的：“刚刚”“3 分钟前”“2 小时前”“5 天前” */
export function ageText(savedAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - savedAt) / 60000));
  if (min < 1) return tr('刚刚');
  if (min < 60) return tr`${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 48) return tr`${h} 小时前`;
  return tr`${Math.floor(h / 24)} 天前`;
}

/** 只写到第几个目标：“任务 2/4”（主菜单上地方小，耐久不写），休闲飞行是“休闲飞行” */
export function stepText(save: FlightSave): string {
  return save.run.free ? tr('休闲飞行') : tr`任务 ${Math.min(save.info.step, save.info.total)}/${save.info.total}`;
}

/** 存档时的进度：“任务 2/4 · 耐久 86”，休闲飞行是“休闲飞行” */
export function progressText(save: FlightSave): string {
  if (save.run.free) return tr('休闲飞行');
  return tr`任务 ${Math.min(save.info.step, save.info.total)}/${save.info.total} · 耐久 ${Math.round(save.info.durability)}`;
}
