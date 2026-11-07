// 天气：参数化的天气状态 + 平滑过渡。天气决定能见度、降水、云、光照、风场基础参数。
// 渲染层（天空/雾/雨/闪电）、音频层（雨声/风声）和仿真层（风）都读取同一份 WeatherParams。

import { clamp, lerp, wrap360 } from '../core/math';
import type { WindProfile } from './wind';

export type WeatherKind = 'clear' | 'lightRain' | 'storm' | 'fog' | 'lowCloud' | 'wind' | 'snow';

export interface WeatherParams {
  /** 降水强度 0..1（0.35 左右为小雨，1 为暴雨） */
  rain: number;
  /** 下雪（0..1） */
  snow: number;
  /** 能见度（m） */
  visibility: number;
  /** 天空云量 0..1 */
  cloudCover: number;
  /** 阴天程度 0..1：天空变灰、阳光减弱 */
  overcast: number;
  /** 低云层密度 0..1 与高度（世界 y） */
  lowCloud: number;
  cloudBase: number;
  cloudTop: number;
  /** 闪电频率 0..1 */
  lightning: number;
  /** 地表湿润 0..1 */
  wetness: number;
  windDirFrom: number;
  windSpeed: number;
  gustAmp: number;
  turbulence: number;
  zoneScale: number;
}

export interface WeatherPreset {
  id: string;
  label: string;
  kind: WeatherKind;
  desc: string;
  params: WeatherParams;
  /** 动态天气：按主线任务进度切换到其他预设 */
  schedule?: Array<{ afterObjective: number; to: string; duration: number }>;
}

export function makeWeather(base: Partial<WeatherParams>): WeatherParams {
  return {
    rain: 0,
    snow: 0,
    visibility: 9000,
    cloudCover: 0.25,
    overcast: 0,
    lowCloud: 0,
    cloudBase: 600,
    cloudTop: 800,
    lightning: 0,
    wetness: 0,
    windDirFrom: 270,
    windSpeed: 4,
    gustAmp: 1,
    turbulence: 0.3,
    zoneScale: 1,
    ...base,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = wrap360(b - a + 180) - 180;
  return wrap360(a + d * t);
}

const WEATHER_FIELDS = Object.keys(makeWeather({})) as Array<keyof WeatherParams>;

function validateWeather(params: WeatherParams): void {
  if (WEATHER_FIELDS.some((field) => !Number.isFinite(params[field]))) throw new RangeError('天气参数必须是有限数值');
  if (params.visibility <= 0) throw new RangeError('天气能见度必须大于零');
}

export function lerpWeather(a: WeatherParams, b: WeatherParams, t: number, out: WeatherParams): WeatherParams {
  out.rain = lerp(a.rain, b.rain, t);
  out.snow = lerp(a.snow, b.snow, t);
  // 能见度按对数插值，过渡更自然
  out.visibility = Math.exp(lerp(Math.log(a.visibility), Math.log(b.visibility), t));
  out.cloudCover = lerp(a.cloudCover, b.cloudCover, t);
  out.overcast = lerp(a.overcast, b.overcast, t);
  out.lowCloud = lerp(a.lowCloud, b.lowCloud, t);
  out.cloudBase = lerp(a.cloudBase, b.cloudBase, t);
  out.cloudTop = lerp(a.cloudTop, b.cloudTop, t);
  out.lightning = lerp(a.lightning, b.lightning, t);
  out.wetness = lerp(a.wetness, b.wetness, t);
  out.windDirFrom = lerpAngle(a.windDirFrom, b.windDirFrom, t);
  out.windSpeed = lerp(a.windSpeed, b.windSpeed, t);
  out.gustAmp = lerp(a.gustAmp, b.gustAmp, t);
  out.turbulence = lerp(a.turbulence, b.turbulence, t);
  out.zoneScale = lerp(a.zoneScale, b.zoneScale, t);
  return out;
}

export interface WeatherSnapshot {
  presetId: string;
  from: WeatherParams;
  to: WeatherParams;
  t: number;
  duration: number;
  scheduleIndex: number;
  activeLabel: string;
}

export class WeatherState {
  readonly presets: WeatherPreset[];
  preset: WeatherPreset;
  current: WeatherParams;
  private from: WeatherParams;
  private to: WeatherParams;
  private t = 1;
  private duration = 1;
  private scheduleIndex = 0;
  /** 当前（或正在过渡到的）天气名称 */
  activeLabel: string;
  /** 刚刚开始一次天气变化时置位（界面提示用） */
  changed: string | null = null;

  constructor(presets: WeatherPreset[], presetId: string) {
    if (!presets.length) throw new Error('地图缺少天气预设');
    for (const preset of presets) validateWeather(preset.params);
    this.presets = presets;
    this.preset = presets.find((p) => p.id === presetId) ?? presets[0];
    this.current = { ...this.preset.params };
    this.from = { ...this.preset.params };
    this.to = { ...this.preset.params };
    this.activeLabel = this.preset.label;
  }

  get transitioning(): boolean {
    return this.t < 1;
  }

  transitionTo(id: string, duration: number): void {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return;
    if (!Number.isFinite(duration)) throw new RangeError('天气过渡时长必须是有限数值');
    validateWeather(p.params);
    this.from = { ...this.current };
    this.to = { ...p.params };
    this.t = 0;
    this.duration = Math.max(0.1, duration);
    this.activeLabel = p.label;
    this.changed = p.label;
  }

  /** objectivesDone：已完成的主线任务数，用于动态天气的触发。 */
  update(dt: number, objectivesDone: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    const sch = this.preset.schedule;
    if (sch && this.scheduleIndex < sch.length && objectivesDone >= sch[this.scheduleIndex].afterObjective) {
      const s = sch[this.scheduleIndex];
      this.scheduleIndex++;
      this.transitionTo(s.to, s.duration);
    }
    if (this.t < 1) {
      this.t = clamp(this.t + dt / this.duration, 0, 1);
      const e = this.t * this.t * (3 - 2 * this.t);
      lerpWeather(this.from, this.to, e, this.current);
    }
  }

  windProfile(): WindProfile {
    const c = this.current;
    return { dirFrom: c.windDirFrom, speed: c.windSpeed, gustAmp: c.gustAmp, zoneScale: c.zoneScale, turbulence: c.turbulence };
  }

  snapshot(): WeatherSnapshot {
    return {
      presetId: this.preset.id,
      from: { ...this.from },
      to: { ...this.to },
      t: this.t,
      duration: this.duration,
      scheduleIndex: this.scheduleIndex,
      activeLabel: this.activeLabel,
    };
  }

  restore(s: WeatherSnapshot): void {
    this.preset = this.presets.find((p) => p.id === s.presetId) ?? this.preset;
    this.from = { ...s.from };
    this.to = { ...s.to };
    this.t = s.t;
    this.duration = s.duration;
    this.scheduleIndex = s.scheduleIndex;
    this.activeLabel = s.activeLabel;
    const e = this.t * this.t * (3 - 2 * this.t);
    lerpWeather(this.from, this.to, e, this.current);
    this.changed = null;
  }
}
