// 物理大气：按 Hillaire 2020（"A Scalable and Production Ready Sky and Atmosphere Rendering Technique"）的做法
// 算三张查找表——透过率、多次散射、从地面看到的天空。虚幻 5、Bevy 用的都是这一套。
// 空气里三样东西：瑞利散射（天蓝）、米氏散射（气溶胶，太阳周围发白）、臭氧吸收（黄昏天顶的那一点蓝紫）。
//
// 以前的天空是 Preetham 1999 的拟合公式，再开方调色：天色好看但不是亮度，环境光、雾、阳光的颜色各调各的。
// 现在天空的亮度是真的按“太阳照度 = 1”算出来的，阳光颜色、环境光、远处的霾都从这同一份结果里取。
//
// 太阳在一局里不动，这几张表在 CPU 上算一次就够了（换时段时重算），不需要计算着色器。这个文件不依赖渲染器，能在测试里直接跑。

/** 地球半径 / 大气顶（千米） */
const RG = 6360;
const RT = 6460;
const H_TOP = Math.sqrt(RT * RT - RG * RG);
/** 散射、吸收系数（1/千米，RGB） */
const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3];
const BETA_M = 3.996e-3;
const ABS_M = 0.444e-3;
const OZONE = [0.65e-3, 1.881e-3, 0.085e-3];
const SCALE_R = 8;
const SCALE_M = 1.2;
const MIE_G = 0.8;

const T_W = 256;
const T_H = 64;
const M_N = 32;
/** 天空表：方位只存半圈（天空左右对称），高度角按平方分布（地平线附近细） */
export const SKY_W = 96;
export const SKY_H = 128;
const T_STEPS = 40;
const M_STEPS = 20;
const S_STEPS = 32;
const M_DIRS = 8;
const SKY_CHROMA = 0.74;

export interface SkyParams {
  /** 气溶胶的多少（1 = 干净的晴天，2~4 = 有霾） */
  haze: number;
  /** 地面反照率（RGB），天空下半部分和地面反上来的光用 */
  albedo: [number, number, number];
  /** 看天的高度（千米，海拔） */
  altitude: number;
}

function rayTop(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + RT * RT;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, d)));
}

/** 从半径 r、余弦 mu 出发，碰到地面的距离；碰不到返回 -1 */
function rayGround(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + RG * RG;
  if (d < 0 || mu >= 0) return -1;
  return -r * mu - Math.sqrt(d);
}

function miePhase(c: number): number {
  const g2 = MIE_G * MIE_G;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + c * c))) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * c, 1.5));
}

const rayleighPhase = (c: number): number => (3 / (16 * Math.PI)) * (1 + c * c);

export class SkyModel {
  /** 天空表：RGBA 浮点（A 不用），第 y 行第 x 列 */
  readonly sky = new Float32Array(SKY_W * SKY_H * 4);
  private readonly trans = new Float32Array(T_W * T_H * 3);
  private readonly ms = new Float32Array(M_N * M_N * 3);
  private sunX = 1;
  private sunY = 0;
  private haze = 1;
  private altitude = 0.3;
  private albedo: [number, number, number] = [0.15, 0.15, 0.15];
  private madeFor = '';
  private readonly tv = [0, 0, 0];

  /** 算一次：sinEl = 太阳高度角的正弦 */
  update(sinEl: number, p: SkyParams): void {
    this.haze = p.haze;
    this.albedo = p.albedo;
    this.altitude = p.altitude;
    this.sunY = sinEl;
    this.sunX = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    const key = `${p.haze}_${p.albedo.join()}`;
    if (key !== this.madeFor) {
      this.madeFor = key;
      this.bakeTransmittance();
      this.bakeMultiScatter();
    }
    this.bakeSky();
  }

  /** 这个高度上的消光系数（三通道写进 out） */
  private extinction(h: number, out: number[]): void {
    const dr = Math.exp(-h / SCALE_R);
    const dm = Math.exp(-h / SCALE_M) * this.haze;
    const dz = Math.max(0, 1 - Math.abs(h - 25) / 15);
    for (let c = 0; c < 3; c++) out[c] = dr * BETA_R[c] + dm * (BETA_M + ABS_M) + dz * OZONE[c];
  }

  private bakeTransmittance(): void {
    const e = [0, 0, 0];
    for (let y = 0; y < T_H; y++) {
      const rho = (H_TOP * (y + 0.5)) / T_H;
      const r = Math.sqrt(rho * rho + RG * RG);
      for (let x = 0; x < T_W; x++) {
        const dMin = RT - r;
        const dMax = rho + H_TOP;
        const d = dMin + ((x + 0.5) / T_W) * (dMax - dMin);
        const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d)));
        const dt = d / T_STEPS;
        let o0 = 0;
        let o1 = 0;
        let o2 = 0;
        for (let i = 0; i < T_STEPS; i++) {
          const t = (i + 0.5) * dt;
          const h = Math.sqrt(t * t + 2 * r * mu * t + r * r) - RG;
          this.extinction(h, e);
          o0 += e[0] * dt;
          o1 += e[1] * dt;
          o2 += e[2] * dt;
        }
        const k = (y * T_W + x) * 3;
        this.trans[k] = Math.exp(-o0);
        this.trans[k + 1] = Math.exp(-o1);
        this.trans[k + 2] = Math.exp(-o2);
      }
    }
  }

  /** 从半径 r 沿余弦 mu 到大气顶的透过率（写进 out），被地面挡住时是 0 */
  private transmittance(r: number, mu: number, out: number[]): void {
    if (rayGround(r, mu) >= 0) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    const rho = Math.sqrt(Math.max(0, r * r - RG * RG));
    const d = rayTop(r, mu);
    const dMin = RT - r;
    const dMax = rho + H_TOP;
    const fx = Math.min(T_W - 1.001, Math.max(0, ((d - dMin) / (dMax - dMin)) * T_W - 0.5));
    const fy = Math.min(T_H - 1.001, Math.max(0, (rho / H_TOP) * T_H - 0.5));
    const ix = fx | 0;
    const iy = fy | 0;
    const u = fx - ix;
    const v = fy - iy;
    const a = (iy * T_W + ix) * 3;
    const b = a + T_W * 3;
    const T = this.trans;
    for (let c = 0; c < 3; c++) out[c] = (T[a + c] * (1 - u) + T[a + 3 + c] * u) * (1 - v) + (T[b + c] * (1 - u) + T[b + 3 + c] * u) * v;
  }

  private bakeMultiScatter(): void {
    const e = [0, 0, 0];
    const ts = [0, 0, 0];
    const dirs: Array<[number, number, number]> = [];
    for (let i = 0; i < M_DIRS; i++)
      for (let j = 0; j < M_DIRS; j++) {
        const th = (2 * Math.PI * (i + 0.5)) / M_DIRS;
        const ph = Math.acos(1 - (2 * (j + 0.5)) / M_DIRS);
        dirs.push([Math.cos(th) * Math.sin(ph), Math.sin(th) * Math.sin(ph), Math.cos(ph)]);
      }
    const iso = 1 / (4 * Math.PI);
    const L = [0, 0, 0];
    const F = [0, 0, 0];
    const tv = [1, 1, 1];
    for (let y = 0; y < M_N; y++) {
      const r = RG + 0.01 + ((RT - RG - 0.02) * (y + 0.5)) / M_N;
      for (let x = 0; x < M_N; x++) {
        const muS = (2 * (x + 0.5)) / M_N - 1;
        const sx = Math.sqrt(Math.max(0, 1 - muS * muS));
        L[0] = L[1] = L[2] = F[0] = F[1] = F[2] = 0;
        for (const [dx, dy, dz] of dirs) {
          // 观察点在 (0, 0, r)，太阳在 x-z 平面里
          const mu = dz;
          const g = rayGround(r, mu);
          const tMax = g >= 0 ? g : rayTop(r, mu);
          const dt = tMax / M_STEPS;
          tv[0] = tv[1] = tv[2] = 1;
          for (let i = 0; i < M_STEPS; i++) {
            const t = (i + 0.5) * dt;
            const px = dx * t;
            const py = dy * t;
            const pz = r + dz * t;
            const rr = Math.sqrt(px * px + py * py + pz * pz);
            const h = rr - RG;
            this.extinction(h, e);
            const dr = Math.exp(-h / SCALE_R);
            const dm = Math.exp(-h / SCALE_M) * this.haze;
            this.transmittance(rr, (px * sx + pz * muS) / rr, ts);
            for (let c = 0; c < 3; c++) {
              const sc = dr * BETA_R[c] + dm * BETA_M;
              const st = Math.exp(-e[c] * dt);
              const k = (1 - st) / Math.max(e[c], 1e-9);
              L[c] += tv[c] * sc * ts[c] * iso * k;
              F[c] += tv[c] * sc * k;
              tv[c] *= st;
            }
          }
          if (g >= 0) {
            const px = dx * tMax;
            const py = dy * tMax;
            const pz = r + dz * tMax;
            const rr = Math.sqrt(px * px + py * py + pz * pz);
            const nl = Math.max(0, (px * sx + pz * muS) / rr);
            this.transmittance(rr, nl, ts);
            for (let c = 0; c < 3; c++) L[c] += tv[c] * ts[c] * nl * (this.albedo[c] / Math.PI);
          }
        }
        const n = dirs.length;
        const k = (y * M_N + x) * 3;
        for (let c = 0; c < 3; c++) {
          const l2 = L[c] / n;
          const f = F[c] / n;
          this.ms[k + c] = l2 / Math.max(1e-4, 1 - f);
        }
      }
    }
  }

  private multiScatter(r: number, muS: number, out: number[]): void {
    const fx = Math.min(M_N - 1.001, Math.max(0, ((muS + 1) / 2) * M_N - 0.5));
    const fy = Math.min(M_N - 1.001, Math.max(0, ((r - RG) / (RT - RG)) * M_N - 0.5));
    const ix = fx | 0;
    const iy = fy | 0;
    const u = fx - ix;
    const v = fy - iy;
    const a = (iy * M_N + ix) * 3;
    const b = a + M_N * 3;
    const T = this.ms;
    for (let c = 0; c < 3; c++) out[c] = (T[a + c] * (1 - u) + T[a + 3 + c] * u) * (1 - v) + (T[b + c] * (1 - u) + T[b + 3 + c] * u) * v;
  }

  /** 方位 az（相对太阳的角度，0 = 朝太阳）、高度角 el 方向的天空亮度（太阳照度 = 1），写进 out */
  private integrate(az: number, el: number, out: number[]): void {
    const r0 = RG + this.altitude;
    const dx = Math.cos(el) * Math.cos(az);
    const dy = Math.cos(el) * Math.sin(az);
    const dz = Math.sin(el);
    const cosT = dx * this.sunX + dz * this.sunY;
    const pR = rayleighPhase(cosT);
    const pM = miePhase(cosT);
    const g = rayGround(r0, dz);
    const tMax = g >= 0 ? g : rayTop(r0, dz);
    const e = [0, 0, 0];
    const ts = [0, 0, 0];
    const mt = [0, 0, 0];
    const tv = this.tv;
    tv[0] = tv[1] = tv[2] = 1;
    out[0] = out[1] = out[2] = 0;
    let tPrev = 0;
    for (let i = 0; i < S_STEPS; i++) {
      // 步子按平方长：近处的空气最浓
      const f = (i + 1) / S_STEPS;
      const t1 = tMax * f * f;
      const dt = t1 - tPrev;
      const t = tPrev + dt * 0.5;
      tPrev = t1;
      const px = dx * t;
      const py = dy * t;
      const pz = r0 + dz * t;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      const h = Math.max(0, rr - RG);
      this.extinction(h, e);
      const dr = Math.exp(-h / SCALE_R);
      const dm = Math.exp(-h / SCALE_M) * this.haze;
      const muS = (px * this.sunX + pz * this.sunY) / rr;
      this.transmittance(rr, muS, ts);
      this.multiScatter(rr, muS, mt);
      for (let c = 0; c < 3; c++) {
        const sr = dr * BETA_R[c];
        const sm = dm * BETA_M;
        const S = (sr * pR + sm * pM) * ts[c] + (sr + sm) * mt[c];
        const st = Math.exp(-e[c] * dt);
        out[c] += (tv[c] * (S - S * st)) / Math.max(e[c], 1e-9);
        tv[c] *= st;
      }
    }
    if (g >= 0) {
      const pz = r0 + dz * tMax;
      const px = dx * tMax;
      const py = dy * tMax;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      const nl = Math.max(0, (px * this.sunX + pz * this.sunY) / rr);
      this.transmittance(rr, nl, ts);
      for (let c = 0; c < 3; c++) out[c] += tv[c] * ts[c] * nl * (this.albedo[c] / Math.PI);
    }
  }

  private bakeSky(): void {
    const o = [0, 0, 0];
    for (let y = 0; y < SKY_H; y++) {
      const s = (2 * (y + 0.5)) / SKY_H - 1;
      const el = Math.sign(s) * s * s * (Math.PI / 2);
      for (let x = 0; x < SKY_W; x++) {
        const az = (Math.PI * (x + 0.5)) / SKY_W;
        this.integrate(az, el, o);
        const k = (y * SKY_W + x) * 4;
        // 只算三个波长，蓝得比真实的连续光谱艳：往亮度收一点（阳光的颜色也是同样的道理，见 sky.ts）
        const l = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
        this.sky[k] = l + (o[0] - l) * SKY_CHROMA;
        this.sky[k + 1] = l + (o[1] - l) * SKY_CHROMA;
        this.sky[k + 2] = l + (o[2] - l) * SKY_CHROMA;
        this.sky[k + 3] = 1;
      }
    }
  }

  /** 从表里取（和着色器的取法一样）：相对太阳的方位 az、高度角 el 方向的亮度 */
  radiance(az: number, el: number, out: number[]): number[] {
    const s = Math.sign(el) * Math.sqrt(Math.abs(el) / (Math.PI / 2));
    const fy = Math.min(SKY_H - 1.001, Math.max(0, ((s + 1) / 2) * SKY_H - 0.5));
    const fx = Math.min(SKY_W - 1.001, Math.max(0, (Math.abs(az) / Math.PI) * SKY_W - 0.5));
    const ix = fx | 0;
    const iy = fy | 0;
    const u = fx - ix;
    const v = fy - iy;
    const a = (iy * SKY_W + ix) * 4;
    const b = a + SKY_W * 4;
    const T = this.sky;
    for (let c = 0; c < 3; c++) out[c] = (T[a + c] * (1 - u) + T[a + 4 + c] * u) * (1 - v) + (T[b + c] * (1 - u) + T[b + 4 + c] * u) * v;
    return out;
  }

  /** 阳光穿过大气后还剩多少（RGB） */
  sunTransmittance(out: number[]): number[] {
    this.transmittance(RG + this.altitude, this.sunY, out);
    return out;
  }

  /** 朝上的平面接到的天光（太阳照度 = 1） */
  skyIrradiance(out: number[]): number[] {
    out[0] = out[1] = out[2] = 0;
    const o = [0, 0, 0];
    const NA = 12;
    const NE = 8;
    for (let i = 0; i < NA; i++)
      for (let j = 0; j < NE; j++) {
        const az = (Math.PI * (i + 0.5)) / NA;
        const el = ((Math.PI / 2) * (j + 0.5)) / NE;
        this.radiance(az, el, o);
        const w = Math.sin(el) * Math.cos(el) * ((2 * Math.PI) / NA) * (Math.PI / 2 / NE);
        for (let c = 0; c < 3; c++) out[c] += o[c] * w;
      }
    return out;
  }
}
