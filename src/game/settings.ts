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
  | 'hud'
  | 'cruise'
  | 'trim'
  | 'photo'
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
  hud: 'HUD 显示（自动 / 完整 / 隐藏）',
  cruise: '自动巡航 开/关（休闲模式）',
  trim: '配平：把现在的杆位设成中立点（超仿真）',
  photo: '截图（存成图片，不带 HUD）',
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
  down: ['ShiftLeft', 'ShiftRight'],
  strafeLeft: ['KeyQ'],
  strafeRight: ['KeyE'],
  hover: ['KeyH'],
  boost: ['KeyC'],
  center: ['KeyZ'],
  pause: ['Escape', 'KeyP'],
  view: ['KeyV'],
  nav: ['KeyN'],
  mapRange: ['KeyM'],
  hud: ['KeyU'],
  cruise: ['KeyJ'],
  trim: ['KeyT'],
  photo: ['KeyF'],
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
  /** 真实地形 30 厘米影像的环形贴图一边放几块（0 = 不用）：一块 160 米，清晰的半径约 (块数 - 1) × 80 米 */
  hiRing: number;
  /** 抗锯齿：低 = FXAA，中及以上 = TRAA 时间抗锯齿（数值只用于判断是否开启，叶片用 alpha-to-coverage） */
  msaa: number;
  /** 泛光（强光、太阳、水面反光的光晕） */
  bloom: boolean;
  /** 屏幕空间环境光遮蔽（GTAO；光线追踪开启时由 SSGI 取代） */
  ao: boolean;
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  low: { label: '低', pixelRatio: 0.8, shadows: false, shadowSize: 512, shadowRange: 0, treeNear: 260, treeFar: 1300, terrainLod: 0.7, rainDensity: 0.35, envSize: 64, terrainTex: 0, hiRing: 0, msaa: 0, bloom: false, ao: false },
  medium: { label: '中', pixelRatio: 1, shadows: true, shadowSize: 1024, shadowRange: 600, treeNear: 380, treeFar: 2000, terrainLod: 1, rainDensity: 0.65, envSize: 128, terrainTex: 1024, hiRing: 6, msaa: 4, bloom: false, ao: true },
  high: { label: '高', pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowRange: 1200, treeNear: 520, treeFar: 2900, terrainLod: 1.35, rainDensity: 1, envSize: 256, terrainTex: 1024, hiRing: 8, msaa: 4, bloom: true, ao: true },
  ultra: { label: '极高（Ultra）', pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRange: 2000, treeNear: 700, treeFar: 3600, terrainLod: 2.1, rainDensity: 1, envSize: 256, terrainTex: 1024, hiRing: 8, msaa: 4, bloom: true, ao: true },
};

export interface Settings {
  mouseSensitivity: number;
  invertY: boolean;
  invertX: boolean;
  fov: number;
  /** 座舱视点居中程度：0 = 右侧机长座位（真实位置），1 = 机身中线 */
  viewCenter: number;
  shake: number;
  headMotion: boolean;
  motionBlur: boolean;
  /** 场景里显示三维航线标记（光环与箭头）；默认关闭，方向由 HUD 的目标菱形与屏幕边缘箭头指示 */
  navGuides: boolean;
  /** 人眼适应：明暗变化时曝光慢慢调整 */
  eyeAdapt: boolean;
  lightning: boolean;
  quality: QualityId;
  /** 画质由游戏决定：按显卡选档，帧率长期撑不住时自动降一档。玩家自己改过画质就关掉 */
  autoQuality: boolean;
  /** 光线追踪（屏幕空间：全局光照 + 反射 + 接触阴影），任意画质都可以单独开关 */
  rayTracing: boolean;
  /** 体积雾与光束（丁达尔效应），中及以上画质生效 */
  volumetric: boolean;
  renderScale: number;
  volMaster: number;
  volEngine: number;
  volAmbience: number;
  volAlerts: number;
  volMusic: number;
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
    viewCenter: 0.5,
    shake: 0.5,
    headMotion: true,
    motionBlur: false,
    navGuides: false,
    eyeAdapt: true,
    lightning: true,
    quality: 'medium',
    autoQuality: true,
    rayTracing: false,
    volumetric: true,
    renderScale: 1,
    volMaster: 0.8,
    volEngine: 0.8,
    volAmbience: 0.7,
    volAlerts: 0.8,
    volMusic: 0.55,
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

/** Unknown/IME key events have no usable physical key and must not replace a binding. */
export const isBindingCode = (value: unknown): value is string => typeof value === 'string' && value !== 'Unidentified' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(value);

/**
 * v1 存档 → v2：旧默认键位“下降 = 左 Ctrl / X、视角回正 = C”改为“下降 = C、视角回正 = Z”。
 * 只改动仍是旧默认值的条目；玩家自己改过的键位保持不变，新键已被其他操作占用时也不改。
 */
/**
 * v3 存档 → v4：旧默认键位“下降 = C、动力增强 = Shift”互换。
 * 两项都还是旧默认值才换；玩家自己改过的不动，这两个键被别的操作占着时也不动。
 */
export function upgradeDescendBindings(rawSettings: unknown): unknown {
  if (!rawSettings || typeof rawSettings !== 'object') return rawSettings;
  const b = (rawSettings as Record<string, unknown>).bindings;
  if (!b || typeof b !== 'object') return rawSettings;
  const bind = { ...(b as Record<string, unknown>) };
  const same = (v: unknown, codes: string[]) => Array.isArray(v) && v.length === codes.length && codes.every((c, i) => v[i] === c);
  const shift = ['ShiftLeft', 'ShiftRight'];
  const taken = Object.entries(bind).some(([k, v]) => k !== 'down' && k !== 'boost' && Array.isArray(v) && v.some((c) => c === 'KeyC' || shift.includes(c as string)));
  if (same(bind.down, ['KeyC']) && same(bind.boost, shift) && !taken) {
    bind.down = shift;
    bind.boost = ['KeyC'];
  }
  return { ...(rawSettings as Record<string, unknown>), bindings: bind };
}

export function upgradeLegacyBindings(rawSettings: unknown): unknown {
  if (!rawSettings || typeof rawSettings !== 'object') return rawSettings;
  const b = (rawSettings as Record<string, unknown>).bindings;
  if (!b || typeof b !== 'object') return rawSettings;
  const bind = { ...(b as Record<string, unknown>) };
  const same = (v: unknown, codes: string[]) => Array.isArray(v) && v.length === codes.length && codes.every((c, i) => v[i] === c);
  const usedElsewhere = (code: string, except: string[]) =>
    Object.entries(bind).some(([k, v]) => !except.includes(k) && Array.isArray(v) && v.includes(code));
  if (same(bind.down, ['ControlLeft', 'KeyX']) && !usedElsewhere('KeyC', ['down', 'center']) &&
      (!same(bind.center, ['KeyC']) || !usedElsewhere('KeyZ', ['center']))) {
    bind.down = ['KeyC'];
    if (same(bind.center, ['KeyC']) && !usedElsewhere('KeyZ', ['center'])) bind.center = ['KeyZ'];
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
      if (Array.isArray(v) && v.length > 0 && v.every(isBindingCode)) {
        bindings[k] = [...new Set(v as string[])].slice(0, 3);
      }
    }
  }
  return {
    mouseSensitivity: num(r.mouseSensitivity, 0.1, 4, d.mouseSensitivity),
    invertY: bool(r.invertY, d.invertY),
    invertX: bool(r.invertX, d.invertX),
    fov: num(r.fov, 50, 100, d.fov),
    viewCenter: num(r.viewCenter, 0, 1, d.viewCenter),
    shake: num(r.shake, 0, 1, d.shake),
    headMotion: bool(r.headMotion, d.headMotion),
    motionBlur: bool(r.motionBlur, d.motionBlur),
    navGuides: bool(r.navGuides, d.navGuides),
    eyeAdapt: bool(r.eyeAdapt, d.eyeAdapt),
    lightning: bool(r.lightning, d.lightning),
    quality: pick(r.quality, ['low', 'medium', 'high', 'ultra'] as const, d.quality),
    autoQuality: bool(r.autoQuality, d.autoQuality),
    rayTracing: bool(r.rayTracing, d.rayTracing),
    volumetric: bool(r.volumetric, d.volumetric),
    renderScale: num(r.renderScale, 0.5, 1, d.renderScale),
    volMaster: num(r.volMaster, 0, 1, d.volMaster),
    volEngine: num(r.volEngine, 0, 1, d.volEngine),
    volAmbience: num(r.volAmbience, 0, 1, d.volAmbience),
    volAlerts: num(r.volAlerts, 0, 1, d.volAlerts),
    volMusic: num(r.volMusic, 0, 1, d.volMusic),
    assist: pick(r.assist, ['novice', 'standard', 'challenge', 'sim'] as const, d.assist),
    speedUnit: pick(r.speedUnit, ['kmh', 'kt', 'ms'] as const, d.speedUnit),
    hudOpacity: num(r.hudOpacity, 0.3, 1, d.hudOpacity),
    hints: bool(r.hints, d.hints),
    bindings,
  };
}

/** 按键代码的可读名称 */
const KEY_NAMES: Record<string, string> = {
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

/** 手机、平板上提示里写的是屏幕上的摇杆和按键 */
const TOUCH_NAMES: Record<string, string> = {
  KeyW: '右摇杆上推',
  KeyS: '右摇杆下拉',
  KeyA: '左摇杆左推',
  KeyD: '左摇杆右推',
  KeyQ: '右摇杆左推',
  KeyE: '右摇杆右推',
  Space: '左摇杆上推',
  ShiftLeft: '左摇杆下拉',
  ShiftRight: '左摇杆下拉',
  KeyH: '悬停',
  KeyC: '增强',
  KeyZ: '回正',
  KeyV: '视角',
  KeyJ: '巡航',
  Escape: '暂停',
  KeyP: '暂停',
};
let touchNames = false;
export function useTouchNames(on: boolean): void {
  touchNames = on;
}

export function keyName(code: string): string {
  if (touchNames && TOUCH_NAMES[code]) return TOUCH_NAMES[code];
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘 ' + code.slice(6);
  return code;
}
