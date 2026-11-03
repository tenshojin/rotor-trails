// 风场：持续风（缓慢摆动）+ 随风平移的连续阵风 + 局部风区（峡谷/山口通道风、周期性阵风区、上升/下沉气流）。
// 风只通过“相对空气速度”影响飞机（见 flight.ts），这里只给出空气运动速度。
// 所有变化都是时间和空间上连续的确定性函数：同一时间同一地点的风完全可预测、可复现。

import { Vector3 } from 'three';
import { DEG, clamp, smoothstep } from '../core/math';
import { hash2i, smoothNoise1, valueNoise3 } from '../core/noise';

export interface WindProfile {
  /** 风的来向（度，气象惯例：270 = 西风，吹向东） */
  dirFrom: number;
  speed: number;
  /** 连续阵风幅度（m/s） */
  gustAmp: number;
  /** 局部风区强度倍率（天气决定） */
  zoneScale: number;
  /** 湍流（小尺度扰动）幅度（m/s） */
  turbulence: number;
}

export interface WindZoneDef {
  id: string;
  name: string;
  /** 胶囊形区域：线段 a-b、半径、羽化宽度（m） */
  a: [number, number];
  b: [number, number];
  radius: number;
  feather: number;
  yMin?: number;
  yMax?: number;
  kind: 'channel' | 'gust' | 'lift';
  /** channel：通道风来向与风速（会把基础风扭转到通道方向） */
  dirFrom?: number;
  speed?: number;
  /** gust：周期性阵风（可预测的节奏） */
  gust?: { amp: number; period: number; phase?: number; dirFrom?: number };
  /** lift：垂直气流（m/s，正 = 上升） */
  vertical?: number;
}

export interface WindInfo {
  speed: number;
  dirFrom: number;
  vertical: number;
  /** 当前阵风强度（m/s） */
  gust: number;
  zone: string | null;
  /** 即将到来的阵风（秒），null 表示近期没有 */
  gustIn: number | null;
  gustDirFrom: number;
}

const _w = new Vector3();
const _info = new Vector3();

/** 方向（来向，度）→ 空气运动方向单位向量 */
export function windVector(dirFrom: number, speed: number, out: Vector3): Vector3 {
  const to = (dirFrom + 180) * DEG;
  return out.set(Math.sin(to) * speed, 0, -Math.cos(to) * speed);
}

/** 周期性阵风包络：0..1。爬升 → 保持 → 衰减 → 平静，节奏固定，强度每周期略有不同。 */
export function gustEnvelope(t: number, period: number, phase: number, seed: number): number {
  const u = (t + phase) / period;
  const cycle = Math.floor(u);
  const p = u - cycle;
  const amp = 0.8 + 0.3 * hash2i(cycle, 7, seed);
  let e = 0;
  if (p < 0.12) e = smoothstep(0, 0.12, p);
  else if (p < 0.3) e = 1;
  else if (p < 0.5) e = 1 - smoothstep(0.3, 0.5, p);
  return e * amp;
}

/** 距离下一次阵风开始的时间（秒）。 */
export function timeToNextGust(t: number, period: number, phase: number): number {
  const u = (t + phase) / period;
  const p = u - Math.floor(u);
  return (1 - p) * period;
}

export class WindField {
  profile: WindProfile;
  readonly zones: WindZoneDef[];
  private ground: (x: number, z: number) => number;
  private seed: number;

  constructor(profile: WindProfile, zones: WindZoneDef[], ground: (x: number, z: number) => number, seed: number) {
    this.profile = { ...profile };
    this.zones = zones;
    this.ground = ground;
    this.seed = seed;
  }

  zoneWeight(z: WindZoneDef, x: number, y: number, zz: number): number {
    const ax = z.a[0];
    const az = z.a[1];
    const dx = z.b[0] - ax;
    const dz = z.b[1] - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (zz - az) * dz) / len2 : 0;
    t = clamp(t, 0, 1);
    const d = Math.hypot(ax + dx * t - x, az + dz * t - zz);
    let w = 1 - smoothstep(z.radius, z.radius + z.feather, d);
    if (w <= 0) return 0;
    if (z.yMin !== undefined) w *= smoothstep(z.yMin - 60, z.yMin, y);
    if (z.yMax !== undefined) w *= 1 - smoothstep(z.yMax, z.yMax + 80, y);
    return w;
  }

  /** 世界坐标处的空气速度（m/s）。 */
  sample(x: number, y: number, z: number, t: number, out: Vector3): Vector3 {
    const P = this.profile;
    const dir = P.dirFrom + 12 * smoothNoise1(t / 85, this.seed);
    const spd = P.speed * (1 + 0.1 * smoothNoise1(t / 55, this.seed + 1));
    // 近地边界层：贴地风弱，高处风强
    const agl = Math.max(2, y - this.ground(x, z));
    const prof = clamp(Math.pow(agl / 30, 0.16), 0.55, 1.4);
    windVector(dir, spd * prof, out);
    // 随风平移的连续阵风（空间相关、时间连续）
    if (P.gustAmp > 0 || P.turbulence > 0) {
      const L = 260;
      const ux = out.x * t;
      const uz = out.z * t;
      const n1 = valueNoise3((x - ux) / L, (z - uz) / L, t / 9, this.seed + 3);
      const n2 = valueNoise3((x - ux) / L + 11.3, (z - uz) / L - 4.1, t / 7, this.seed + 4);
      const along = P.gustAmp * Math.max(0, n1 * 1.2 + 0.25);
      const across = P.gustAmp * 0.45 * n2;
      const toRad = (dir + 180) * DEG;
      const fx = Math.sin(toRad);
      const fz = -Math.cos(toRad);
      out.x += fx * along - fz * across;
      out.z += fz * along + fx * across;
      if (P.turbulence > 0) {
        const s = 40;
        out.x += P.turbulence * valueNoise3(x / s, y / s, t * 0.9, this.seed + 5);
        out.y += P.turbulence * 0.5 * valueNoise3(x / s + 3, y / s, t * 0.9, this.seed + 6);
        out.z += P.turbulence * valueNoise3(x / s, y / s + 7, t * 0.9, this.seed + 7);
      }
    }
    // 局部风区
    for (const zone of this.zones) {
      const w = this.zoneWeight(zone, x, y, z) * Math.min(1, P.zoneScale * 1.2);
      if (w <= 0) continue;
      const k = P.zoneScale;
      if (zone.kind === 'channel' && zone.dirFrom !== undefined && zone.speed !== undefined) {
        windVector(zone.dirFrom, zone.speed * k * prof, _w);
        out.x += (_w.x - out.x) * w * 0.85;
        out.z += (_w.z - out.z) * w * 0.85;
      } else if (zone.kind === 'gust' && zone.gust) {
        const g = zone.gust.amp * k * gustEnvelope(t, zone.gust.period, zone.gust.phase ?? 0, this.seed + zone.id.length);
        windVector(zone.gust.dirFrom ?? dir, g * w, _w);
        out.add(_w);
      } else if (zone.kind === 'lift' && zone.vertical !== undefined) {
        out.y += zone.vertical * k * w;
      }
    }
    return out;
  }

  info(x: number, y: number, z: number, t: number): WindInfo {
    // 注意：sample() 内部会使用 _w 作为临时向量，这里必须用独立的输出向量
    const w = this.sample(x, y, z, t, _info);
    const speed = Math.hypot(w.x, w.z);
    const toDeg = Math.atan2(w.x, -w.z) / DEG;
    let dirFrom = toDeg + 180;
    dirFrom = ((dirFrom % 360) + 360) % 360;
    let zone: string | null = null;
    let best = 0.25;
    let gust = 0;
    let gustIn: number | null = null;
    let gustDir = dirFrom;
    for (const zd of this.zones) {
      const w = this.zoneWeight(zd, x, y, z);
      if (w > best) {
        best = w;
        zone = zd.name;
      }
      if (zd.kind === 'gust' && zd.gust && w > 0.2) {
        const g = zd.gust.amp * this.profile.zoneScale * gustEnvelope(t, zd.gust.period, zd.gust.phase ?? 0, this.seed + zd.id.length) * w;
        gust = Math.max(gust, g);
        const tn = timeToNextGust(t, zd.gust.period, zd.gust.phase ?? 0);
        if (tn < 3 && (gustIn === null || tn < gustIn)) {
          gustIn = tn;
          gustDir = zd.gust.dirFrom ?? dirFrom;
        }
      }
    }
    gust = Math.max(gust, this.profile.gustAmp * 0.5);
    return { speed, dirFrom, vertical: w.y, gust, zone, gustIn, gustDirFrom: gustDir };
  }
}
