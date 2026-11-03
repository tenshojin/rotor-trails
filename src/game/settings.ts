// 游戏设置（带默认值与校验）与画质预设。

import type { AssistId } from '../config/flight';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'strafeLeft'
  | 'strafeRight'
  | 'hover'
  | 'boost'
  | 'center'
  | 'pause'
  | 'view'
  | 'nav'
  | 'mapRange'
  | 'lookLeft'
  | 'lookRight'
  | 'lookUp'
  | 'lookDown';

export const ACTION_LABEL: Record<Action, string> = {
  forward: '前倾加速',
  back: '后倾减速 / 后退',
  left: '左转',
  right: '右转',
  up: '爬升（增加升力）',
  down: '下降（减小升力）',
  strafeLeft: '向左平移',
  strafeRight: '向右平移',
  hover: '悬停辅助 开/关',
  boost: '使用动力增强',
  center: '视角回正',
  pause: '暂停',
  view: '切换座舱/追尾视角',
  nav: '切换导航目标 / 分岔推荐路线',
  mapRange: '切换地图范围',
  lookLeft: '向左看（无鼠标锁定时）',
  lookRight: '向右看',
  lookUp: '向上看',
  lookDown: '向下看',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  // 爬升/下降各用一个普通键：不用 Ctrl（按住 W 时再按 Ctrl 就是 Ctrl+W，浏览器会直接关闭页面）
  up: ['Space'],
  down: ['KeyC'],
  strafeLeft: ['KeyQ'],
  strafeRight: ['KeyE'],
  hover: ['KeyH'],
  boost: ['ShiftLeft', 'ShiftRight'],
  center: ['KeyZ'],
  pause: ['Escape', 'KeyP'],
  view: ['KeyV'],
  nav: ['KeyN'],
  mapRange: ['KeyM'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
};

export type QualityId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  label: string;
  pixelRatio: number;
  shadows: boolean;
  /** 每层阴影贴图的边长（共 4 层） */
  shadowSize: number;
  /** 地形参与投影的距离（米） */
  shadowRange: number;
  treeNear: number;
  treeFar: number;
  terrainLod: number;
  rainDensity: number;
  envSize: number;
  /** 地形照片材质的分辨率 */
  terrainTex: number;
  /** 多重采样抗锯齿（后期处理管线里的采样数，0 = 关闭后期、直接渲染） */
  msaa: number;
  /** 泛光（强光、太阳、水面反光的光晕） */
  bloom: boolean;
  /** 屏幕空间环境光遮蔽（接触阴影） */
  ao: boolean;
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  low: { label: '低', pixelRatio: 0.8, shadows: false, shadowSize: 512, shadowRange: 0, treeNear: 260, treeFar: 1300, terrainLod: 0.7, rainDensity: 0.35, envSize: 64, terrainTex: 0, msaa: 0, bloom: false, ao: false },
  medium: { label: '中', pixelRatio: 1, shadows: true, shadowSize: 1024, shadowRange: 600, treeNear: 380, treeFar: 2000, terrainLod: 1, rainDensity: 0.65, envSize: 128, terrainTex: 1024, msaa: 4, bloom: false, ao: false },
  high: { label: '高', pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowRange: 1200, treeNear: 520, treeFar: 2900, terrainLod: 1.35, rainDensity: 1, envSize: 256, terrainTex: 1024, msaa: 4, bloom: true, ao: false },
  ultra: { label: '极高', pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRange: 2000, treeNear: 700, treeFar: 3600, terrainLod: 1.7, rainDensity: 1, envSize: 256, terrainTex: 1024, msaa: 4, bloom: true, ao: false },
};

export interface Settings {
  mouseSensitivity: number;
  invertY: boolean;
  invertX: boolean;
  fov: number;
  shake: number;
  headMotion: boolean;
  motionBlur: boolean;
  lightning: boolean;
  quality: QualityId;
  renderScale: number;
  volMaster: number;
  volEngine: number;
  volAmbience: number;
  volAlerts: number;
  assist: AssistId;
  speedUnit: 'kmh' | 'kt' | 'ms';
  hudOpacity: number;
  hints: boolean;
  bindings: Record<Action, string[]>;
}

export function defaultSettings(): Settings {
  return {
    mouseSensitivity: 1,
    invertY: false,
    invertX: false,
    fov: 72,
    shake: 0.5,
    headMotion: true,
    motionBlur: false,
    lightning: true,
    quality: 'medium',
    renderScale: 1,
    volMaster: 0.8,
    volEngine: 0.8,
    volAmbience: 0.7,
    volAlerts: 0.8,
    assist: 'standard',
    speedUnit: 'kmh',
    hudOpacity: 1,
    hints: true,
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : d);

/**
 * v1 存档 → v2：旧默认键位“下降 = 左 Ctrl / X、视角回正 = C”改为“下降 = C、视角回正 = Z”。
 * 只改动仍是旧默认值的条目；玩家自己改过的键位保持不变，新键已被其他操作占用时也不改。
 */
export function upgradeLegacyBindings(rawSettings: unknown): unknown {
  if (!rawSettings || typeof rawSettings !== 'object') return rawSettings;
  const b = (rawSettings as Record<string, unknown>).bindings;
  if (!b || typeof b !== 'object') return rawSettings;
  const bind = { ...(b as Record<string, unknown>) };
  const same = (v: unknown, codes: string[]) => Array.isArray(v) && v.length === codes.length && codes.every((c, i) => v[i] === c);
  const usedElsewhere = (code: string, except: string[]) =>
    Object.entries(bind).some(([k, v]) => !except.includes(k) && Array.isArray(v) && v.includes(code));
  if (same(bind.down, ['ControlLeft', 'KeyX']) && !usedElsewhere('KeyC', ['down', 'center'])) {
    bind.down = ['KeyC'];
    if (same(bind.center, ['KeyC']) && !usedElsewhere('KeyZ', ['center'])) bind.center = ['KeyZ'];
    else if (same(bind.center, ['KeyC'])) delete bind.center; // 回到默认（Z），避免与下降键冲突
  }
  return { ...(rawSettings as Record<string, unknown>), bindings: bind };
}

/** 校验并补全（存档损坏或版本变化时保证得到合法设置）。 */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (r.bindings && typeof r.bindings === 'object') {
    for (const k of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      const v = (r.bindings as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0) bindings[k] = v.slice(0, 3) as string[];
    }
  }
  return {
    mouseSensitivity: num(r.mouseSensitivity, 0.1, 4, d.mouseSensitivity),
    invertY: bool(r.invertY, d.invertY),
    invertX: bool(r.invertX, d.invertX),
    fov: num(r.fov, 50, 100, d.fov),
    shake: num(r.shake, 0, 1, d.shake),
    headMotion: bool(r.headMotion, d.headMotion),
    motionBlur: bool(r.motionBlur, d.motionBlur),
    lightning: bool(r.lightning, d.lightning),
    quality: pick(r.quality, ['low', 'medium', 'high', 'ultra'] as const, d.quality),
    renderScale: num(r.renderScale, 0.5, 1, d.renderScale),
    volMaster: num(r.volMaster, 0, 1, d.volMaster),
    volEngine: num(r.volEngine, 0, 1, d.volEngine),
    volAmbience: num(r.volAmbience, 0, 1, d.volAmbience),
    volAlerts: num(r.volAlerts, 0, 1, d.volAlerts),
    assist: pick(r.assist, ['novice', 'standard', 'challenge'] as const, d.assist),
    speedUnit: pick(r.speedUnit, ['kmh', 'kt', 'ms'] as const, d.speedUnit),
    hudOpacity: num(r.hudOpacity, 0.3, 1, d.hudOpacity),
    hints: bool(r.hints, d.hints),
    bindings,
  };
}

/** 按键代码的可读名称 */
export function keyName(code: string): string {
  const map: Record<string, string> = {
    Space: '空格',
    ControlLeft: '左 Ctrl',
    ControlRight: '右 Ctrl',
    ShiftLeft: '左 Shift',
    ShiftRight: '右 Shift',
    AltLeft: '左 Alt',
    AltRight: '右 Alt',
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Enter: '回车',
    Tab: 'Tab',
    Backspace: '退格',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘 ' + code.slice(6);
  return code;
}
