// 本地存档（localStorage，带版本号）：设置、地图完成记录、最佳评价、已完成的可选任务。
// 存储不可用或数据损坏时安全回退为默认值（并备份损坏数据），绝不阻止游戏启动。

import type { MapId } from '../maps/types';
import { defaultSettings, sanitizeSettings, upgradeDescendBindings, upgradeLegacyBindings, type Settings } from './settings';
import { tr } from '../i18n';
import { FlightSaves, FLIGHTS_KEY, FLIGHT_FORMAT, isFlightCollection } from './flightSave';

export const SAVE_KEY = 'rotorTrails.save';
/** v2：默认键位调整（下降键由 Ctrl/X 改为 C，视角回正由 C 改为 Z）。
 *  v5：导入完整备份时，进度和飞行存档一起写进这一个键，一次写完（不会只导进去一半）；旧版游戏读到 v5 不会覆盖它 */
export const SAVE_VERSION = 5;
/** 能导入的存档文件最大多大（字节）。正常的完整备份远小于这个 */
export const MAX_BACKUP_BYTES = 10_000_000;

export interface MapRecord {
  completed: boolean;
  bestScore: number;
  bestRating: string;
  optionalDone: string[];
  runs: number;
  /** 最快通关用时（秒）——仅记录，不参与评分 */
  bestTime: number | null;
}

/** 飞行记录（主菜单里看） */
export interface FlightLog {
  /** 离地的总时间（秒） */
  seconds: number;
  landings: number;
  /** 最轻的一次接地：下降速度（m/s） */
  softest: number | null;
  photos: number;
}

export interface SaveData {
  version: number;
  settings: Settings;
  maps: Partial<Record<MapId, MapRecord>>;
  tutorialDone: boolean;
  /** 学完的课（序号） */
  lessonsDone: number[];
  /** 超仿真教学学完的课 */
  simLessonsDone: number[];
  /** 休闲飞行到过的地方（地名） */
  visited: Partial<Record<MapId, string[]>>;
  log: FlightLog;
  /** 提示过的勋章 */
  medals: string[];
}

function defaults(): SaveData {
  return { version: SAVE_VERSION, settings: defaultSettings(), maps: {}, tutorialDone: false, lessonsDone: [], simLessonsDone: [], visited: {}, log: { seconds: 0, landings: 0, softest: null, photos: 0 }, medals: [] };
}

const MAP_IDS: readonly MapId[] = ['training', 'japan', 'canyon', 'amazon', 'fjord', 'himalaya'];
const RATINGS = ['S', 'A', 'B', 'C', 'D'];
const isSaveObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function sanitizeRecord(r: unknown): MapRecord | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  return {
    completed: o.completed === true,
    bestScore: typeof o.bestScore === 'number' && Number.isFinite(o.bestScore) ? Math.max(0, o.bestScore) : 0,
    bestRating: typeof o.bestRating === 'string' && RATINGS.includes(o.bestRating) ? o.bestRating : '',
    optionalDone: Array.isArray(o.optionalDone) ? [...new Set(o.optionalDone.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100))].slice(0, 20) : [],
    runs: typeof o.runs === 'number' && Number.isFinite(o.runs) ? Math.max(0, Math.floor(o.runs)) : 0,
    bestTime: typeof o.bestTime === 'number' && Number.isFinite(o.bestTime) && o.bestTime > 0 ? o.bestTime : null,
  };
}

/** 迁移旧版本存档并校验。 */
export function migrate(raw: unknown): SaveData {
  const d = defaults();
  if (!isSaveObject(raw)) return d;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === 'number' ? o.version : 0;
  if (version > SAVE_VERSION) {
    // 来自更新版本的存档：尽量读取兼容字段
  }
  const legacy = version < 2 ? upgradeLegacyBindings(o.settings) : o.settings;
  d.settings = sanitizeSettings(version < 4 ? upgradeDescendBindings(legacy) : legacy);
  d.tutorialDone = o.tutorialDone === true;
  const lessons = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 32))] : []);
  d.lessonsDone = lessons(o.lessonsDone);
  d.simLessonsDone = lessons(o.simLessonsDone);
  if (Array.isArray(o.medals)) d.medals = [...new Set(o.medals.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 24))];
  if (isSaveObject(o.log)) {
    const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    d.log.seconds = count(o.log.seconds);
    d.log.landings = Math.floor(count(o.log.landings));
    d.log.photos = Math.floor(count(o.log.photos));
    d.log.softest = count(o.log.softest) || null;
  }
  if (isSaveObject(o.visited)) {
    for (const k of [...MAP_IDS, 'grandcanyon'] as MapId[]) {
      const v = Object.hasOwn(o.visited, k) ? o.visited[k] : null;
      if (Array.isArray(v)) d.visited[k] = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 40))];
    }
  }
  if (o.maps && typeof o.maps === 'object') {
    for (const k of MAP_IDS) {
      if (!Object.hasOwn(o.maps, k)) continue;
      const rec = sanitizeRecord((o.maps as Record<string, unknown>)[k]);
      if (rec) d.maps[k] = rec;
    }
  }
  return d;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export class SaveStore {
  data: SaveData;
  available = true;
  warning: string | null = null;
  /** 本机第一次运行（没有任何存档） */
  fresh = false;
  /** 旧存档：重新按显卡选一次画质 */
  requalify = false;
  private storage: StorageLike | null;
  private flightSaves: FlightSaves | null = null;
  /** 坏掉、已经备份过的原存档：存的时候可以盖掉它 */
  private recoveredRaw: string | null = null;
  /** 导入代次：每导入一次换一个新的。别的标签页导入以后就对不上了，这个标签页不能再写（会把刚导入的盖回去） */
  private generation: string | undefined;
  /** 别的标签页导入过存档 */
  private replaced = false;

  constructor(storage?: StorageLike | null) {
    let st: StorageLike | null = null;
    try {
      st = storage !== undefined ? storage : window.localStorage;
    } catch {
      st = null;
    }
    this.storage = st;
    if (!st) {
      this.available = false;
      this.warning = tr('浏览器本地存储不可用：本次游戏的设置与进度不会被保存。');
      this.data = defaults();
      this.fresh = true;
      return;
    }
    let raw: string | null = null;
    try {
      raw = st.getItem(SAVE_KEY);
    } catch {
      // Do not replace an unreadable existing save with fresh defaults.
      this.storage = null;
      this.available = false;
      this.warning = tr('浏览器本地存储不可用：无法读取进度，本次游戏不会覆盖原存档。');
      this.data = defaults();
      return;
    }
    if (raw === null) {
      this.data = defaults();
      this.fresh = true;
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isSaveObject(parsed)) throw new Error('Invalid save root');
      this.data = migrate(parsed);
      this.generation = typeof parsed.saveGeneration === 'string' ? parsed.saveGeneration : undefined;
      // v3 之前新存档以外都停在“中”：那是旧默认值，重新按显卡选一次
      if (typeof parsed.version === 'number' && parsed.version < 3 && this.data.settings.quality === 'medium') this.requalify = true;
      if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
        // Reading compatible fields is useful, but an older client must never
        // downgrade the version or delete fields that it does not understand.
        this.storage = null;
        this.available = false;
        this.warning = tr('存档来自更新版本：已读取兼容的设置与进度，本次游戏不会覆盖原存档。');
      }
    } catch {
      try {
        st.setItem(SAVE_KEY + '.corrupt', raw);
        this.recoveredRaw = raw;
        this.warning = tr('检测到损坏的存档，已恢复为默认设置（原数据已备份）。');
      } catch {
        this.warning = tr('检测到损坏的存档，已恢复为默认设置；原数据备份失败，暂不覆盖原存档。');
        this.storage = null;
        this.available = false;
      }
      this.data = defaults();
    }
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      const current = this.readStored();
      this.storage.setItem(SAVE_KEY, JSON.stringify({ ...this.data, version: SAVE_VERSION, ...(this.generation ? { saveGeneration: this.generation } : {}), ...(current && Object.hasOwn(current, 'flights') ? { flights: current.flights } : {}) }));
      this.recoveredRaw = null;
      this.available = true;
      if (this.warning === tr('保存失败（存储空间已满或被禁止）。')) this.warning = null;
      return true;
    } catch {
      this.available = false;
      this.warning = this.replaced ? tr('别的标签页导入了存档：这里不再保存，刷新页面后再玩。') : tr('保存失败（存储空间已满或被禁止）。');
      return false;
    }
  }

  /** 每次写之前都重新读一遍存着的主存档：别的标签页可能刚导入过（代次对不上就不写），飞行存档也可能放在里面 */
  private readStored(): Record<string, unknown> | null {
    if (!this.storage) throw new Error('Storage unavailable');
    const raw = this.storage.getItem(SAVE_KEY);
    if (raw === null || raw === this.recoveredRaw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSaveObject(parsed) || (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION)) throw new Error('Unreadable save');
    if (parsed.saveGeneration !== this.generation) { this.replaced = true; throw new Error('Save replaced by another tab'); }
    return parsed;
  }

  /** 别的标签页导入了存档（这个标签页再写就会盖掉它）。浏览器的 storage 事件里查 */
  hasExternalReplacement(): boolean {
    try {
      this.readStored();
    } catch {
      /* 换没换，readStored 记在 replaced 上 */
    }
    return this.replaced;
  }

  /**
   * 飞到一半的存档（见 flightSave.ts）。和主存档同一个存储：主存档读不了、不让写的时候它也不写。
   * 平时存在单独的键里（v1～v4 一直这样）；导入过完整备份以后，和进度一起放在主存档里（见 importText），
   * 之后单独的那个键不再读，也不会在删掉存档以后又冒出来
   */
  get flights(): FlightSaves {
    const st = this.storage;
    return (this.flightSaves ??= new FlightSaves(
      st
        ? {
            getItem: (key) => {
              if (key !== FLIGHTS_KEY) return st.getItem(key);
              const current = this.readStored();
              return current && Object.hasOwn(current, 'flights') ? JSON.stringify(current.flights) : st.getItem(FLIGHTS_KEY);
            },
            setItem: (key, value) => {
              if (key !== FLIGHTS_KEY) return st.setItem(key, value);
              const current = this.readStored();
              if (current && Object.hasOwn(current, 'flights')) st.setItem(SAVE_KEY, JSON.stringify({ ...current, flights: JSON.parse(value) }));
              else st.setItem(FLIGHTS_KEY, value);
            },
          }
        : null,
    ));
  }

  record(map: MapId): MapRecord {
    let r = this.data.maps[map];
    if (!r) {
      r = { completed: false, bestScore: 0, bestRating: '', optionalDone: [], runs: 0, bestTime: null };
      this.data.maps[map] = r;
    }
    return r;
  }

  /** 导出：整份存档的文本（JSON）。玩家存成文件，换电脑、换浏览器时再导入 */
  exportText(): string {
    const flights = this.flights.snapshot();
    return JSON.stringify({ game: SAVE_KEY, exportedAt: new Date().toISOString(), ...this.data, version: SAVE_VERSION, ...(flights ? { flights } : {}) }, null, 1);
  }

  /** 这段文本是不是能导入的存档。newer：比这个版本新的游戏导出的，读了会丢东西，不收 */
  static check(text: string): 'ok' | 'invalid' | 'newer' {
    if (text.length > MAX_BACKUP_BYTES) return 'invalid';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'invalid';
    }
    if (!isSaveObject(parsed) || typeof parsed.version !== 'number' || !Number.isFinite(parsed.version) || !isSaveObject(parsed.settings)) return 'invalid';
    if (parsed.game !== undefined && parsed.game !== SAVE_KEY) return 'invalid';
    if (parsed.version > SAVE_VERSION) return 'newer';
    if (Object.hasOwn(parsed, 'flights')) {
      if (isSaveObject(parsed.flights) && typeof parsed.flights.format === 'number' && parsed.flights.format > FLIGHT_FORMAT) return 'newer';
      if (!isFlightCollection(parsed.flights)) return 'invalid';
    }
    return 'ok';
  }

  /** 导入前给玩家看的：通关了几张图、有几份飞行存档、哪天备份的（只看查过的数据）。flightCount 是 null：旧版或者只有进度的备份 */
  static describe(text: string): { completedMaps: number; flightCount: number | null; exportedAt: number | null } | null {
    if (SaveStore.check(text) !== 'ok') return null;
    const parsed = JSON.parse(text);
    const time = typeof parsed.exportedAt === 'string' ? Date.parse(parsed.exportedAt) : NaN;
    return { completedMaps: Object.values(migrate(parsed).maps).filter((m) => m?.completed).length,
      flightCount: parsed.flights ? Object.keys(parsed.flights.slots).length : null,
      exportedAt: Number.isFinite(time) ? time : null };
  }

  /** 导入：和读档走同一套迁移与校验，进度和飞行存档一次写进去。存不进去（存储满了、被禁止）返回 false，现有进度和存档都不动 */
  importText(text: string): boolean {
    if (SaveStore.check(text) !== 'ok' || !this.storage) return false;
    try {
      const parsed = JSON.parse(text);
      const next = migrate(parsed);
      const current = this.readStored();
      // 旧版（只有进度）的备份：这个浏览器里的飞行存档照旧留着
      const flights: unknown = Object.hasOwn(parsed, 'flights') ? parsed.flights : current?.flights;
      const saveGeneration = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      this.storage.setItem(SAVE_KEY, JSON.stringify({ ...next, saveGeneration, ...(flights !== undefined ? { flights } : {}) }));
      this.generation = saveGeneration;
      this.replaced = false;
      this.data = next;
      this.available = true;
      this.warning = null;
      this.fresh = this.requalify = false;
      return true;
    } catch {
      this.available = false;
      this.warning = this.replaced ? tr('别的标签页导入了存档：这里不再保存，刷新页面后再玩。') : tr('保存失败（存储空间已满或被禁止）。');
      return false;
    }
  }

  /** 记下到过的地方，返回是不是第一次来 */
  visit(map: MapId, place: string): boolean {
    const list = (this.data.visited[map] ??= []);
    if (list.includes(place)) return false;
    list.push(place);
    this.save();
    return true;
  }

  /** 记录一次通关结果，返回是否刷新最佳。 */
  recordResult(map: MapId, score: number, rating: string, optionalIds: string[], time: number): boolean {
    const r = this.record(map);
    const first = !r.completed;
    r.runs++;
    r.completed = true;
    score = Number.isFinite(score) ? Math.max(0, score) : 0;
    const best = first || score > r.bestScore;
    if (best) {
      r.bestScore = score;
      r.bestRating = RATINGS.includes(rating) ? rating : '';
    }
    for (const id of optionalIds) if (!r.optionalDone.includes(id)) r.optionalDone.push(id);
    if (Number.isFinite(time) && time > 0 && (r.bestTime === null || time < r.bestTime)) r.bestTime = time;
    this.save();
    return best;
  }
}
