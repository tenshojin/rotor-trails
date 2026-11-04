// 岩层：真实的岩壁不是一整块光滑的坡，而是一层层硬岩和软岩叠起来的——
// 硬层风化得慢，立成陡崖，顶上留一条窄窄的平台；软层风化得快，退成缓坡。同一层绕着山走一圈，高度几乎不变。
//
// 这里按地层表（从下往上每层的厚度、硬度、颜色）把陡坡改成“崖—台—坡”交替的剖面，
// 颜色在着色器里按同一张表查（见 terrainShader.ts 的 strataLUT）——层线和台阶对得上，并且绕山连续。
// 地层可以倾斜、缓缓起伏：起伏用几个正弦波相加，CPU 和着色器算出来的结果完全一样，不用额外的贴图。

import { smoothstep } from '../core/math';
import { Perlin2, Rng } from '../core/noise';

export interface RockBand {
  /** 厚度（米） */
  t: number;
  /** 硬度 0..1：硬层成陡崖，软层成缓坡 */
  hard: number;
  /** 颜色（sRGB 十六进制） */
  c: number;
}

export interface RockFormDef {
  /** 地层表，从下往上（到头之后循环） */
  bands: RockBand[];
  /** 最底层底面的高度 */
  y0: number;
  /** 查找表覆盖到的高度 */
  y1: number;
  /** 地层倾斜：每米水平距离抬高多少（x、z 两个方向） */
  dip: [number, number];
  /** 地层起伏：每项 [x 方向波数, z 方向波数, 振幅（米）, 相位] */
  waves: Array<[number, number, number, number]>;
  /** 台阶化的程度 0..1 */
  bench: number;
  /** 坡度（高差 / 水平距离）从多少开始、到多少完全起作用 */
  slope: [number, number];
  /** 岩层颜色盖过照片材质颜色的程度 0..1 */
  tint: number;
  /** 岩架和缓坡上的碎屑有多少是上方岩层风化下来的（0 = 不改地表颜色；有植被的地方用 0） */
  debris?: number;
  /** 最陡的坡度（高差 / 水平距离）：比这更陡的地方岩石站不住，会塌下来 */
  talus?: number;
  /**
   * 岩壁的平面形状：把地形在水平方向上扭一扭，每项 [幅度（米）, 尺度（米）]。
   * 岩壁的走向因此有进有退（支墩和凹龛），而不是一整面光滑的弧；平地不受影响。
   */
  warp?: Array<[number, number]>;
}

/** 地层面相对水平面的偏移（米）：世界高度 y 处的地层坐标 = y + strataWarp(x, z) */
export function strataWarp(d: RockFormDef, x: number, z: number): number {
  let w = d.dip[0] * x + d.dip[1] * z;
  for (const [kx, kz, a, p] of d.waves) w += a * Math.sin(kx * x + kz * z + p);
  return w;
}

/** 把地层表展开成“每米属于哪一层”的表（地层坐标 y0..y1） */
export function layerTable(d: RockFormDef): { start: Float32Array; end: Float32Array; hard: Float32Array; band: Int32Array; at: Int32Array } {
  const start: number[] = [];
  const end: number[] = [];
  const hard: number[] = [];
  const band: number[] = [];
  let y = d.y0;
  let i = 0;
  while (y < d.y1) {
    const b = d.bands[i % d.bands.length];
    start.push(y);
    end.push(y + b.t);
    hard.push(b.hard);
    band.push(i % d.bands.length);
    y += b.t;
    i++;
  }
  const n = Math.ceil(d.y1 - d.y0) + 1;
  const at = new Int32Array(n);
  let k = 0;
  for (let m = 0; m < n; m++) {
    const yy = d.y0 + m;
    while (k < end.length - 1 && end[k] <= yy) k++;
    at[m] = k;
  }
  return { start: new Float32Array(start), end: new Float32Array(end), hard: new Float32Array(hard), band: new Int32Array(band), at };
}

/** 硬层的剖面：前 r 这一段陡直地爬升（崖），剩下的一小段几乎是平的（崖顶的平台） */
function bandProfile(u: number, hard: number): number {
  const r = 0.34;
  const b = 0.1;
  const g = u < r ? (1 - b) * (u / r) : 1 - b + (b * (u - r)) / (1 - r);
  return u + (g - u) * hard;
}

export function applyRockForm(data: Float32Array, res: number, size: number, d: RockFormDef, mask?: Float32Array): void {
  const cell = size / (res - 1);
  const half = size / 2;
  const T = layerTable(d);
  if (d.talus) slump(data, res, d.talus * cell, mask);
  if (d.warp) warpPlan(data, res, cell, d.warp, mask);
  // 用平滑过的高度算坡度：单格的毛刺不算陡坡
  const sm = blur3(blur3(data, res), res);
  const delta = new Float32Array(data.length);
  for (let z = 1; z < res - 1; z++) {
    const wz = z * cell - half;
    for (let x = 1; x < res - 1; x++) {
      const i = z * res + x;
      const sl = Math.hypot(sm[i + 1] - sm[i - 1], sm[i + res] - sm[i - res]) / (2 * cell);
      const k = smoothstep(d.slope[0], d.slope[1], sl) * d.bench * (mask ? mask[i] : 1);
      if (k <= 0.002) continue;
      const w = strataWarp(d, x * cell - half, wz);
      const y = data[i] + w;
      const m = (y - d.y0) | 0;
      if (m < 0 || m >= T.at.length) continue;
      const L = T.at[m];
      const y0 = T.start[L];
      const y1 = T.end[L];
      const u = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      delta[i] = (y0 + (y1 - y0) * bandProfile(u, T.hard[L]) - y) * k;
    }
  }
  // 变化量抹一下：一格 4 米，层线的折角落在格子中间时不会出现一格宽的锯齿
  const soft = blur3(delta, res);
  for (let i = 0; i < data.length; i++) data[i] += delta[i] * 0.55 + soft[i] * 0.45;
}

/** 崩塌：相邻两格的高差超过 maxDiff 就把多出来的部分往低处挪（几十遍之后尖刺变成站得住的陡壁） */
function slump(data: Float32Array, res: number, maxDiff: number, mask?: Float32Array): void {
  for (let pass = 0; pass < 36; pass++) {
    for (let z = 1; z < res - 1; z++) {
      for (let x = 1; x < res - 1; x++) {
        const i = z * res + x;
        const k = mask ? mask[i] : 1;
        if (k <= 0) continue;
        const h = data[i];
        let lo = i + 1;
        if (data[i - 1] < data[lo]) lo = i - 1;
        if (data[i + res] < data[lo]) lo = i + res;
        if (data[i - res] < data[lo]) lo = i - res;
        const diff = h - data[lo] - maxDiff;
        if (diff > 0) {
          const m = diff * 0.5 * k * (mask ? mask[lo] : 1);
          data[i] -= m;
          data[lo] += m;
        }
      }
    }
  }
}

function warpPlan(data: Float32Array, res: number, cell: number, warp: Array<[number, number]>, mask?: Float32Array): void {
  const pn = new Perlin2(7151);
  const src = data.slice();
  for (let z = 1; z < res - 1; z++) {
    for (let x = 1; x < res - 1; x++) {
      const i = z * res + x;
      const k = mask ? mask[i] : 1;
      if (k <= 0) continue;
      let wx = 0;
      let wz = 0;
      for (const [a, p] of warp) {
        const u = (x * cell) / p;
        const v = (z * cell) / p;
        wx += a * pn.noise(u, v);
        wz += a * pn.noise(u + 31.7, v - 17.3);
      }
      const fx = Math.min(res - 1.001, Math.max(0, x + (wx * k) / cell));
      const fz = Math.min(res - 1.001, Math.max(0, z + (wz * k) / cell));
      const ix = fx | 0;
      const iz = fz | 0;
      const a = fx - ix;
      const b = fz - iz;
      const j = iz * res + ix;
      data[i] = (src[j] * (1 - a) + src[j + 1] * a) * (1 - b) + (src[j + res] * (1 - a) + src[j + res + 1] * a) * b;
    }
  }
}

function blur3(src: Float32Array, n: number): Float32Array {
  const out = src.slice();
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      out[i] = (src[i] * 4 + (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 2 + src[i - n - 1] + src[i - n + 1] + src[i + n - 1] + src[i + n + 1]) / 16;
    }
  return out;
}

/** 按调色板随机排出一叠地层（挪威片麻岩、喜马拉雅变质岩这种没有固定层序的岩体） */
export function randomBands(seed: number, n: number, palette: number[], thick: [number, number]): RockBand[] {
  const rng = new Rng(seed);
  const out: RockBand[] = [];
  for (let i = 0; i < n; i++) {
    const h = rng.float();
    out.push({
      t: thick[0] + (thick[1] - thick[0]) * rng.float() ** 1.6,
      hard: h < 0.3 ? 0.15 : 0.55 + 0.45 * rng.float(),
      c: palette[Math.floor(rng.float() * palette.length)],
    });
  }
  return out;
}
