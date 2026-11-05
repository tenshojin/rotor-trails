// 本地存档（localStorage，带版本号）：设置、地图完成记录、最佳评价、已完成的可选任务。
// 存储不可用或数据损坏时安全回退为默认值（并备份损坏数据），绝不阻止游戏启动。

import type { MapId } from '../maps/types';
import { defaultSettings, sanitizeSettings, upgradeLegacyBindings, type Settings } from './settings';

export const SAVE_KEY = 'rotorTrails.save';
/** v2：默认键位调整（下降键由 Ctrl/X 改为 C，视角回正由 C 改为 Z） */
export const SAVE_VERSION = 2;

export interface MapRecord {
  completed: boolean;
  bestScore: number;
  bestRating: string;
  optionalDone: string[];
  runs: number;
  /** 最快通关用时（秒）——仅记录，不参与评分 */
  bestTime: number | null;
}

export interface SaveData {
  version: number;
  settings: Settings;
  maps: Partial<Record<MapId, MapRecord>>;
  tutorialDone: boolean;
  /** 学完的课（序号） */
  lessonsDone: number[];
}

function defaults(): SaveData {
  return { version: SAVE_VERSION, settings: defaultSettings(), maps: {}, tutorialDone: false, lessonsDone: [] };
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
  d.settings = sanitizeSettings(version < 2 ? upgradeLegacyBindings(o.settings) : o.settings);
  d.tutorialDone = o.tutorialDone === true;
  if (Array.isArray(o.lessonsDone)) d.lessonsDone = [...new Set(o.lessonsDone.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 32))];
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
  private storage: StorageLike | null;

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
      this.warning = '浏览器本地存储不可用：本次游戏的设置与进度不会被保存。';
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
      this.warning = '浏览器本地存储不可用：无法读取进度，本次游戏不会覆盖原存档。';
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
      if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
        // Reading compatible fields is useful, but an older client must never
        // downgrade the version or delete fields that it does not understand.
        this.storage = null;
        this.available = false;
        this.warning = '存档来自更新版本：已读取兼容的设置与进度，本次游戏不会覆盖原存档。';
      }
    } catch {
      try {
        st.setItem(SAVE_KEY + '.corrupt', raw);
        this.warning = '检测到损坏的存档，已恢复为默认设置（原数据已备份）。';
      } catch {
        this.warning = '检测到损坏的存档，已恢复为默认设置；原数据备份失败，暂不覆盖原存档。';
        this.storage = null;
        this.available = false;
      }
      this.data = defaults();
    }
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify({ ...this.data, version: SAVE_VERSION }));
      this.available = true;
      if (this.warning === '保存失败（存储空间已满或被禁止）。') this.warning = null;
      return true;
    } catch {
      this.available = false;
      this.warning = '保存失败（存储空间已满或被禁止）。';
      return false;
    }
  }

  record(map: MapId): MapRecord {
    let r = this.data.maps[map];
    if (!r) {
      r = { completed: false, bestScore: 0, bestRating: '', optionalDone: [], runs: 0, bestTime: null };
      this.data.maps[map] = r;
    }
    return r;
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
