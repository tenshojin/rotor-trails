// 飞行存档：飞到一半存下来，下次接着飞。
//   · 玩家自己存（暂停菜单的“存档”、默认 K 键）：每张图的任务、休闲飞行各一格，新存的盖掉旧的。
//   · 离开飞行时自动存（回主菜单、关掉或刷新网页、手机切到后台）：单独一格，不会盖掉玩家自己存的那一格。
//     主菜单的“继续飞行”读的是所有存档里最新的那一份。
// 存在浏览器里，和主存档用同一个存储、不同的键，关掉网页也还在。完整备份同时包含这些飞行槽位。

import type { AssistId } from '../config/flight';
import type { MapDef, MapId } from '../maps/types';
import type { TimeOfDay } from '../render/timeOfDay';
import type { SessionSave } from '../sim/session';
import type { StorageLike } from './save';
import { tr } from '../i18n';
import { isSessionSaveShape } from '../sim/saveValidation';

export const FLIGHTS_KEY = 'rotorTrails.flights';
/** 存档格式：以后改了 SessionSave 的结构就加一，旧格式的存档不读（不会读错） */
export const FLIGHT_FORMAT = 1;
/** 离开飞行时自动存的那一格 */
export const RESUME_SLOT = 'resume';

/** 一整份飞行存档（完整备份里的 flights） */
export interface FlightCollection {
  format: number;
  slots: Record<string, FlightSave>;
}

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
  if (!isObj(v) || v.format !== FLIGHT_FORMAT || typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt < 0 || typeof v.version !== 'string' || typeof v.auto !== 'boolean') return false;
  const r = v.run;
  if (!isObj(r) || typeof r.map !== 'string' || typeof r.weather !== 'string' || !ASSIST_IDS.includes(r.assist as string) || typeof r.free !== 'boolean' || !TIMES.includes(r.time as string)) return false;
  const i = v.info;
  if (!isObj(i) || !Number.isInteger(i.step) || (i.step as number) < 0 || !Number.isInteger(i.total) || (i.total as number) < 0 || typeof i.durability !== 'number' || !Number.isFinite(i.durability) || i.durability < 0 || i.durability > 100) return false;
  return typeof v.sig === 'string' && isObj(v.state);
}

/** 里面的数是不是都正常（没有 NaN、无穷大）。飞行状态出了问题（比如出错的那一帧）才会有，写进 JSON 变成 null，读不回来 */
export function allFinite(v: unknown, depth = 0): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object' || depth > 32) return true;
  for (const x of Array.isArray(v) ? v : Object.values(v)) if (!allFinite(x, depth + 1)) return false;
  return true;
}

/** 这几个名字在 JSON 里会碰到对象的原型，不能当格子名 */
const BAD_SLOTS = ['__proto__', 'prototype', 'constructor'];
const okSlot = (slot: string): boolean => slot.length > 0 && slot.length <= 80 && !BAD_SLOTS.includes(slot);
/** 这一格能不能接着飞：外层完整，里面的飞行状态也完整 */
const restorable = (v: unknown): v is FlightSave => isFlightSave(v) && isSessionSaveShape(v.state);

/** 导入备份时查得严：有一格不对，整份都不收（不会悄悄丢掉其中一格） */
export function isFlightCollection(value: unknown): value is FlightCollection {
  return isObj(value) && value.format === FLIGHT_FORMAT && isObj(value.slots) && Object.entries(value.slots).every(([slot, save]) => okSlot(slot) && restorable(save));
}

export class FlightSaves {
  constructor(private readonly storage: StorageLike | null) {}
  /**
   * 现在不能写的原因：'unreadable' 读存储出错（读都读不了，写了可能盖掉原来的）；
   * 'newer' 存的是更新版本的格式（这个版本看不懂，不能覆盖）。null：正常
   */
  blocked: 'unreadable' | 'newer' | null = null;
  /** 整份读不出来、已经备份到 .corrupt 了（还没被新存的盖掉）。这时导出的备份不算完整：免得导入到别处时把那边的存档清空 */
  private damaged = false;
  /** 这个版本读不了的格子（坏了，或者更新的版本存的）：不显示、不读，写的时候原样留着 */
  private foreign: Record<string, unknown> = Object.create(null);

  get available(): boolean {
    return !!this.storage;
  }

  /** 所有能读的存档（坏掉的、旧格式的、更新版本的跳过，但不删：见 foreign） */
  all(): Record<string, FlightSave> {
    const out: Record<string, FlightSave> = Object.create(null);
    this.blocked = null;
    this.damaged = false;
    this.foreign = Object.create(null);
    if (!this.storage) return out;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(FLIGHTS_KEY);
    } catch {
      this.blocked = 'unreadable';
      return out;
    }
    if (!raw) return out;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* 不是 JSON：下面当作整份坏了 */
    }
    if (isObj(parsed) && typeof parsed.format === 'number' && parsed.format > FLIGHT_FORMAT) {
      this.blocked = 'newer';
      return out;
    }
    if (!isObj(parsed) || parsed.format !== FLIGHT_FORMAT || !isObj(parsed.slots)) {
      // 整份读不出来：和主存档一样，先原样备份一份，再当作没有存档（下次存的时候整份重写）。
      // 备份不了就先不写，免得原来的数据没了
      this.damaged = true;
      try {
        if (this.storage.getItem(FLIGHTS_KEY + '.corrupt') !== raw) this.storage.setItem(FLIGHTS_KEY + '.corrupt', raw);
      } catch {
        this.blocked = 'unreadable';
      }
      return out;
    }
    for (const [slot, save] of Object.entries(parsed.slots)) {
      if (!okSlot(slot)) continue;
      if (isFlightSave(save)) out[slot] = save;
      else this.foreign[slot] = save;
    }
    return out;
  }

  /** 完整备份用：所有还能接着飞的存档。读不了（被禁止、更新版本的）返回 null，导出的备份就只算“进度和设置” */
  snapshot(): FlightCollection | null {
    const all = this.all();
    if (this.blocked || this.damaged) return null;
    const slots: Record<string, FlightSave> = {};
    for (const [slot, save] of Object.entries(all)) if (restorable(save)) slots[slot] = save;
    return { format: FLIGHT_FORMAT, slots };
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
    if (!(slot in all) && !(slot in this.foreign)) return;
    delete all[slot];
    delete this.foreign[slot];
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

  /** 整份写回去（读不懂的格子原样带上）。all 要是刚从 all() 拿的 */
  private write(all: Record<string, FlightSave>): boolean {
    if (!this.storage || this.blocked) return false;
    try {
      this.storage.setItem(FLIGHTS_KEY, JSON.stringify({ format: FLIGHT_FORMAT, slots: { ...this.foreign, ...all } }));
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
