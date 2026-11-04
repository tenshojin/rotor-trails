// 水力侵蚀：在地形生成的最后一步，模拟大量雨滴沿山坡往下流，带走高处的土石、在低处放下。
// 噪声和样条做出来的山壁是光滑的曲面，雨水冲刷之后才有真实的沟壑、山脊和冲积扇。
// 做法参照 Hans Theobald Beyer 的液滴侵蚀；随机数按地图种子固定，同一张地图每次生成的结果相同（物理和渲染用同一份）。

import { Perlin2, Rng } from '../core/noise';

export interface ErosionOptions {
  droplets: number;
  /** 一滴水最多走多少步 */
  life?: number;
  /** 水面高度：流到水面以下就停 */
  waterLevel?: number | null;
  /** 0..1 的保护图（0 = 不改动，用来保护停机坪、村落的平地）；缺省全部可改 */
  mask?: Float32Array;
}

const INERTIA = 0.08;
const CAPACITY = 5;
const MIN_CAP = 0.002;
const ERODE = 0.32;
const DEPOSIT = 0.22;
const EVAPORATE = 0.018;
const GRAVITY = 5;
const RADIUS = 2;

/** 高度按这个比例缩小后再算（米）：让坡度落在算法常用的数值范围里 */
const HEIGHT_UNIT = 240;

export function erode(data: Float32Array, res: number, seed: number, o: ErosionOptions): void {
  const rng = new Rng(seed * 13 + 5);
  const life = o.life ?? 36;
  const mask = o.mask;
  const water = (o.waterLevel ?? -1e9) / HEIGHT_UNIT;
  const h = new Float32Array(data.length);
  for (let i = 0; i < h.length; i++) h[i] = data[i] / HEIGHT_UNIT;
  // 陡坡先加一层不规则的起伏：完全光滑的坡面上，水流只会排成一排等距的平行槽，看上去像窗帘的褶子
  const pn = new Perlin2(seed + 3);
  const perturb = new Float32Array(data.length);
  // 岩性：陡坡上只有软弱带（节理、破碎带）才冲得出沟，整块的硬岩冲不动。
  // 否则满山都是一样深、一样宽的沟，看上去像窗帘的褶
  const weak = new Float32Array(data.length).fill(1);
  const steep = new Float32Array(data.length);
  for (let y = 1; y < res - 1; y++)
    for (let x = 1; x < res - 1; x++) {
      const i = y * res + x;
      const s = Math.hypot(h[i + 1] - h[i - 1], h[i + res] - h[i - res]);
      const k = Math.min(1, Math.max(0, (s - 0.012) / 0.03));
      if (k <= 0) continue;
      const zone = pn.fbm(x / 58 + 11, y / 58 - 7, 3);
      const open = Math.min(1, Math.max(0, (zone - 0.02) / 0.3));
      weak[i] = 1 - k * (1 - (0.06 + 0.94 * open * open));
      steep[i] = k;
      const warp = pn.noise(x / 37, y / 37) * 26;
      perturb[i] = k * (pn.fbm((x + warp) / 44, (y - warp) / 19, 3) * 0.05 + pn.fbm((x - warp) / 11, (y + warp) / 7, 2) * 0.014);
    }
  for (let i = 0; i < h.length; i++) h[i] += perturb[i] * (mask ? mask[i] : 1);
  // 笔刷：侵蚀时把取走的量分摊到周围几格，否则会挖出一格宽的尖沟
  const bx: number[] = [];
  const by: number[] = [];
  const bw: number[] = [];
  let sum = 0;
  for (let y = -RADIUS; y <= RADIUS; y++)
    for (let x = -RADIUS; x <= RADIUS; x++) {
      const d = Math.hypot(x, y);
      if (d > RADIUS + 0.2) continue;
      const w = 1 - d / (RADIUS + 1);
      bx.push(x);
      by.push(y);
      bw.push(w);
      sum += w;
    }
  for (let i = 0; i < bw.length; i++) bw[i] /= sum;
  const lim = res - 2 - RADIUS;
  for (let n = 0; n < o.droplets; n++) {
    let x = RADIUS + 1 + rng.float() * (res - 2 * RADIUS - 4);
    let y = RADIUS + 1 + rng.float() * (res - 2 * RADIUS - 4);
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let wat = 1;
    let sed = 0;
    for (let step = 0; step < life; step++) {
      const ix = x | 0;
      const iy = y | 0;
      const u = x - ix;
      const v = y - iy;
      const i = iy * res + ix;
      const h00 = h[i];
      const h10 = h[i + 1];
      const h01 = h[i + res];
      const h11 = h[i + res + 1];
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const hc = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      // 方向上加一点随机摆动：水流会分岔、汇合，沟壑才像树枝，而不是一排平行的槽
      const wig = 0.35 * Math.hypot(gx, gy);
      dx = dx * INERTIA - gx * (1 - INERTIA) + (rng.float() - 0.5) * wig;
      dy = dy * INERTIA - gy * (1 - INERTIA) + (rng.float() - 0.5) * wig;
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) break;
      dx /= l;
      dy /= l;
      x += dx;
      y += dy;
      if (x < RADIUS + 1 || y < RADIUS + 1 || x >= lim || y >= lim) break;
      const jx = x | 0;
      const jy = y | 0;
      const a = x - jx;
      const b = y - jy;
      const j = jy * res + jx;
      const hn = h[j] * (1 - a) * (1 - b) + h[j + 1] * a * (1 - b) + h[j + res] * (1 - a) * b + h[j + res + 1] * a * b;
      const dh = hn - hc;
      const cap = Math.max(-dh * speed * wat * CAPACITY, MIN_CAP);
      if (sed > cap || dh > 0) {
        const put = dh > 0 ? Math.min(dh, sed) : (sed - cap) * DEPOSIT;
        sed -= put;
        const k = mask ? mask[i] : 1;
        h[i] += put * (1 - u) * (1 - v) * k;
        h[i + 1] += put * u * (1 - v) * k;
        h[i + res] += put * (1 - u) * v * k;
        h[i + res + 1] += put * u * v * k;
      } else {
        const take = Math.min((cap - sed) * ERODE, -dh) * weak[i];
        for (let k = 0; k < bw.length; k++) {
          const p = (iy + by[k]) * res + ix + bx[k];
          h[p] -= take * bw[k] * (mask ? mask[p] : 1);
        }
        sed += take;
      }
      if (hn < water) break;
      speed = Math.sqrt(Math.max(0, speed * speed - dh * GRAVITY));
      wat *= 1 - EVAPORATE;
    }
  }
  // 变化量平滑一下：液滴留下的是一格一格的毛刺，堆积的沙土本来也该是圆缓的（堆积处抹得更多）
  const n = data.length;
  let d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = h[i] * HEIGHT_UNIT - data[i];
  const raw = d;
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(n);
    for (let y = 1; y < res - 1; y++)
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        o[i] = (d[i] * 4 + (d[i - 1] + d[i + 1] + d[i - res] + d[i + res]) * 2 + d[i - res - 1] + d[i - res + 1] + d[i + res - 1] + d[i + res + 1]) / 16;
      }
    d = o;
  }
  // 陡坡上再抹掉三四格宽的细沟：岩壁上留下的应该是少数几条大冲沟，而不是一排等距的细槽
  let wide = d;
  for (let pass = 0; pass < 5; pass++) {
    const o = wide.slice();
    for (let y = 1; y < res - 1; y++)
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        o[i] = (wide[i] * 4 + (wide[i - 1] + wide[i + 1] + wide[i - res] + wide[i + res]) * 2 + wide[i - res - 1] + wide[i - res + 1] + wide[i + res - 1] + wide[i + res + 1]) / 16;
      }
    wide = o;
  }
  for (let i = 0; i < n; i++) {
    const k = mask ? mask[i] : 1;
    const dep = raw[i] > 0 ? 1 : 0.55;
    const fine = raw[i] + (d[i] - raw[i]) * dep;
    data[i] += (fine + (wide[i] - fine) * steep[i]) * k;
  }
}
