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
}

function defaults(): SaveData {
  return { version: SAVE_VERSION, settings: defaultSettings(), maps: {}, tutorialDone: false };
}

function sanitizeRecord(r: unknown): MapRecord | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  return {
    completed: o.completed === true,
    bestScore: typeof o.bestScore === 'number' && Number.isFinite(o.bestScore) ? o.bestScore : 0,
    bestRating: typeof o.bestRating === 'string' ? o.bestRating.slice(0, 2) : '',
    optionalDone: Array.isArray(o.optionalDone) ? o.optionalDone.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    runs: typeof o.runs === 'number' && Number.isFinite(o.runs) ? Math.max(0, Math.floor(o.runs)) : 0,
    bestTime: typeof o.bestTime === 'number' && Number.isFinite(o.bestTime) ? o.bestTime : null,
  };
}

/** 迁移旧版本存档并校验。 */
export function migrate(raw: unknown): SaveData {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === 'number' ? o.version : 0;
  if (version > SAVE_VERSION) {
    // 来自更新版本的存档：尽量读取兼容字段
  }
  d.settings = sanitizeSettings(version < 2 ? upgradeLegacyBindings(o.settings) : o.settings);
  d.tutorialDone = o.tutorialDone === true;
  if (o.maps && typeof o.maps === 'object') {
    for (const [k, v] of Object.entries(o.maps as Record<string, unknown>)) {
      const rec = sanitizeRecord(v);
      if (rec) d.maps[k as MapId] = rec;
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
  private storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    let st: StorageLike | null = null;
    try {
      st = storage !== undefined ? storage : window.localStorage;
      if (st) {
        const probe = '__rt_probe';
        st.setItem(probe, '1');
      }
    } catch {
      st = null;
    }
    this.storage = st;
    if (!st) {
      this.available = false;
      this.warning = '浏览器本地存储不可用：本次游戏的设置与进度不会被保存。';
      this.data = defaults();
      return;
    }
    let raw: string | null = null;
    try {
      raw = st.getItem(SAVE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      this.data = defaults();
      return;
    }
    try {
      this.data = migrate(JSON.parse(raw));
    } catch {
      this.warning = '检测到损坏的存档，已恢复为默认设置（原数据已备份）。';
      try {
        st.setItem(SAVE_KEY + '.corrupt', raw);
      } catch {
        /* 忽略 */
      }
      this.data = defaults();
    }
  }

  save(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify({ ...this.data, version: SAVE_VERSION }));
      return true;
    } catch {
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
    r.runs++;
    r.completed = true;
    const best = score > r.bestScore;
    if (best) {
      r.bestScore = score;
      r.bestRating = rating;
    }
    for (const id of optionalIds) if (!r.optionalDone.includes(id)) r.optionalDone.push(id);
    if (r.bestTime === null || time < r.bestTime) r.bestTime = time;
    this.save();
    return best;
  }
}
