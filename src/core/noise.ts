// 确定性随机数与程序化噪声（Perlin 梯度噪声、分形噪声、山脊噪声、值噪声）。
// 所有地图都由固定种子生成，保证每次加载、每台机器上的地形与道具完全一致。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** 近似正态分布（均值 0，标准差 1）。 */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

/** 整数哈希，返回 [0,1)。 */
export function hash2i(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3i(x: number, y: number, z: number, seed = 0): number {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 2246822519) ^
    Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GRAD2 = new Float32Array([
  1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
]);

/** 二维 Perlin 梯度噪声，输出约在 [-1, 1]。 */
export class Perlin2 {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const X = xf & 255;
    const Y = yf & 255;
    x -= xf;
    y -= yf;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const p = this.perm;
    const aa = (p[p[X] + Y] & 7) * 2;
    const ab = (p[p[X] + Y + 1] & 7) * 2;
    const ba = (p[p[X + 1] + Y] & 7) * 2;
    const bb = (p[p[X + 1] + Y + 1] & 7) * 2;
    const g = GRAD2;
    const n00 = g[aa] * x + g[aa + 1] * y;
    const n10 = g[ba] * (x - 1) + g[ba + 1] * y;
    const n01 = g[ab] * x + g[ab + 1] * (y - 1);
    const n11 = g[bb] * (x - 1) + g[bb + 1] * (y - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  /** 分形布朗运动。 */
  fbm(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(fx, fy);
      norm += amp;
      amp *= gain;
      // 每层轻微旋转，避免网格方向的痕迹
      const nx = fx * 1.6 * (lacunarity / 2) - fy * 1.2 * (lacunarity / 2);
      const ny = fx * 1.2 * (lacunarity / 2) + fy * 1.6 * (lacunarity / 2);
      fx = nx + 17.13;
      fy = ny - 9.71;
    }
    return sum / norm;
  }

  /** 山脊噪声，输出 [0, 1]，山脊处接近 1。 */
  ridged(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5, sharpness = 2): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let weight = 1;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(fx, fy));
      n = Math.pow(n, sharpness);
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 1.6));
      sum += amp * n;
      norm += amp;
      amp *= gain;
      const nx = fx * 1.6 * (lacunarity / 2) - fy * 1.2 * (lacunarity / 2);
      const ny = fx * 1.2 * (lacunarity / 2) + fy * 1.6 * (lacunarity / 2);
      fx = nx + 31.7;
      fy = ny + 5.3;
    }
    return sum / norm;
  }
}

/** 一维平滑值噪声，用于随时间连续变化的量（阵风、天气漂移）。输出 [-1, 1]。 */
export function smoothNoise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash2i(i, 0, seed) * 2 - 1;
  const b = hash2i(i + 1, 0, seed) * 2 - 1;
  return a + (b - a) * u;
}

/** 三维平滑值噪声，输出 [-1, 1]。 */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c000 = hash3i(xi, yi, zi, seed);
  const c100 = hash3i(xi + 1, yi, zi, seed);
  const c010 = hash3i(xi, yi + 1, zi, seed);
  const c110 = hash3i(xi + 1, yi + 1, zi, seed);
  const c001 = hash3i(xi, yi, zi + 1, seed);
  const c101 = hash3i(xi + 1, yi, zi + 1, seed);
  const c011 = hash3i(xi, yi + 1, zi + 1, seed);
  const c111 = hash3i(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 2 - 1;
}
