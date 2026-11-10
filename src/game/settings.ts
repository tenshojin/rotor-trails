// 游戏设置（带默认值与校验）与画质预设。

import type { AssistId } from '../config/flight';
import type { LangSetting } from '../i18n';
import { tr } from '../i18n';

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
  forward: tr('前倾加速'),
  back: tr('后倾减速 / 后退'),
  left: tr('左转'),
  right: tr('右转'),
  up: tr('爬升（增加升力）'),
  down: tr('下降（减小升力）'),
  strafeLeft: tr('向左平移'),
  strafeRight: tr('向右平移'),
  hover: tr('悬停辅助 开/关'),
  boost: tr('使用动力增强'),
  center: tr('视角回正'),
  pause: tr('暂停'),
  view: tr('切换视角：座舱 / 追尾 / 电影镜头（休闲模式）'),
  nav: tr('切换导航目标 / 分岔推荐路线'),
  mapRange: tr('切换地图范围'),
  hud: tr('HUD 显示（自动 / 完整 / 隐藏）'),
  cruise: tr('自动巡航 开/关（休闲模式）'),
  trim: tr('配平：把现在的杆位设成中立点（超仿真）'),
  photo: tr('截图（存成图片，不带 HUD）'),
  lookLeft: tr('向左看（无鼠标锁定时）'),
  lookRight: tr('向右看'),
  lookUp: tr('向上看'),
  lookDown: tr('向下看'),
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
  low: { label: tr('低'), pixelRatio: 0.8, shadows: false, shadowSize: 512, shadowRange: 0, treeNear: 280, treeFar: 1500, terrainLod: 0.75, rainDensity: 0.35, envSize: 64, terrainTex: 0, hiRing: 0, msaa: 0, bloom: false, ao: false },
  medium: { label: tr('中'), pixelRatio: 1, shadows: true, shadowSize: 1024, shadowRange: 800, treeNear: 420, treeFar: 2600, terrainLod: 1.15, rainDensity: 0.65, envSize: 128, terrainTex: 1024, hiRing: 6, msaa: 4, bloom: false, ao: true },
  high: { label: tr('高'), pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowRange: 1600, treeNear: 600, treeFar: 4200, terrainLod: 1.7, rainDensity: 1, envSize: 256, terrainTex: 1024, hiRing: 8, msaa: 4, bloom: true, ao: true },
  ultra: { label: tr('极高（Ultra）'), pixelRatio: 2, shadows: true, shadowSize: 4096, shadowRange: 2800, treeNear: 850, treeFar: 6000, terrainLod: 2.6, rainDensity: 1, envSize: 256, terrainTex: 1024, hiRing: 8, msaa: 4, bloom: true, ao: true },
};

export interface Settings {
  /** 鼠标转头的灵敏度；手机、平板上是手指拖动转头的灵敏度 */
  mouseSensitivity: number;
  /** 手柄右摇杆转头的速度（和鼠标分开：同一个人鼠标调快了，摇杆不一定也要快） */
  padSensitivity: number;
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
  /** 界面语言：auto = 跟随浏览器（见 i18n/index.ts 的 pickLang）。换了要重新加载才生效 */
  lang: LangSetting;
  bindings: Record<Action, string[]>;
}

export function defaultSettings(): Settings {
  return {
    mouseSensitivity: 1,
    padSensitivity: 1,
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
    lang: 'auto',
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
    padSensitivity: num(r.padSensitivity, 0.3, 2.5, d.padSensitivity),
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
    lang: pick(r.lang, ['auto', 'zh', 'en', 'ja'] as const, d.lang),
    bindings,
  };
}

/** 按键代码的可读名称 */
const KEY_NAMES: Record<string, string> = {
    Space: tr('空格'),
    ControlLeft: tr('左 Ctrl'),
    ControlRight: tr('右 Ctrl'),
    ShiftLeft: tr('左 Shift'),
    ShiftRight: tr('右 Shift'),
    AltLeft: tr('左 Alt'),
    AltRight: tr('右 Alt'),
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Enter: tr('回车'),
    Tab: 'Tab',
    Backspace: tr('退格'),
};

/** 手机、平板上提示里写的是屏幕上的摇杆和按键 */
const TOUCH_NAMES: Record<string, string> = {
  KeyW: tr('右摇杆上推'),
  KeyS: tr('右摇杆下拉'),
  KeyA: tr('左摇杆左推'),
  KeyD: tr('左摇杆右推'),
  KeyQ: tr('右摇杆左推'),
  KeyE: tr('右摇杆右推'),
  Space: tr('左摇杆上推'),
  ShiftLeft: tr('左摇杆下拉'),
  ShiftRight: tr('左摇杆下拉'),
  KeyH: tr('悬停'),
  KeyC: tr('增强'),
  KeyZ: tr('回正'),
  KeyV: tr('视角'),
  KeyJ: tr('巡航'),
  KeyN: tr('导航'),
  Escape: tr('暂停'),
  KeyP: tr('暂停'),
};
let touchNames = false;
export function useTouchNames(on: boolean): void {
  touchNames = on;
}
/** 这个键在手机、平板上有没有对应的摇杆或屏幕按键（没有的话操作说明里不写它） */
export function onTouchScreen(code: string): boolean {
  return code in TOUCH_NAMES;
}

/** 正在用手柄时，提示里写手柄上的键（Xbox 的叫法，PS 手柄同样的位置）。按动作找，改过键也对得上 */
const PAD_NAMES: Partial<Record<Action, string>> = {
  forward: tr('左摇杆上推'),
  back: tr('左摇杆下拉'),
  left: tr('左摇杆左推'),
  right: tr('左摇杆右推'),
  up: 'RT',
  down: 'LT',
  strafeLeft: 'LB',
  strafeRight: 'RB',
  hover: 'A',
  boost: 'B',
  view: 'X',
  center: 'Y',
  pause: tr('菜单键'),
  cruise: tr('视图键'),
  nav: tr('十字键上'),
  hud: tr('十字键下'),
  mapRange: tr('十字键左右'),
  photo: tr('按下右摇杆'),
  trim: tr('按下左摇杆'),
  lookLeft: tr('右摇杆'),
  lookRight: tr('右摇杆'),
  lookUp: tr('右摇杆'),
  lookDown: tr('右摇杆'),
};
let padBindings: (() => Record<Action, string[]>) | null = null;
/** 玩家拿起手柄时传入当前键位（按代码找到动作），放下手柄、碰键盘鼠标时传 null */
export function usePadNames(bindings: (() => Record<Action, string[]>) | null): void {
  padBindings = bindings;
}
export function padNamesOn(): boolean {
  return padBindings !== null;
}

/** 提示里写的按键名：用手柄时是手柄上的键，触屏上是屏幕按键，否则是键盘键名 */
/** HUD 的速度单位：1 m/s 是多少、单位怎么写。HUD、导航和教学里的速度都按它换算 */
export const SPEED_K = { kmh: 3.6, kt: 1.9438, ms: 1 } as const;
export const SPEED_U = { kmh: 'km/h', kt: 'kt', ms: 'm/s' } as const;

/** 把 m/s 写成选定的单位，取整，和 HUD 上的读数一个写法（11 m/s → “40 km/h”、“21 kt”、“11 m/s”） */
export function speedText(metersPerSecond: number, unit: Settings['speedUnit']): string {
  return `${Math.round(metersPerSecond * SPEED_K[unit])} ${SPEED_U[unit]}`;
}

export function keyName(code: string): string {
  if (padBindings) {
    const b = padBindings();
    for (const a of Object.keys(b) as Action[]) if (b[a].includes(code) && PAD_NAMES[a]) return PAD_NAMES[a]!;
  }
  return keyLabel(code);
}

/** 键盘（触屏上是屏幕按键）的名字，不随手柄切换：改键页、操作说明里的键盘表用它 */
export function keyLabel(code: string): string {
  if (touchNames && TOUCH_NAMES[code]) return TOUCH_NAMES[code];
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return tr('小键盘 ') + code.slice(6);
  return code;
}
