// 体积云用的三维噪声（64³，三个方向都可无缝平铺），启动时在 CPU 上生成一次：
//   R：Perlin-Worley（Perlin fbm 被反相 Worley 重新映射）——积云“菜花”状的大形状；
//   G：三层反相 Worley fbm（中频）——侵蚀云的边缘；
//   B：三层反相 Worley fbm（高频）——更细的絮状边缘；
//   A：Perlin fbm——低频起伏。
// 做法参照 Schneider《The Real-time Volumetric Cloudscapes of Horizon Zero Dawn》（SIGGRAPH 2015）。

import * as THREE from 'three/webgpu';

const N = 64;
let cache: THREE.Data3DTexture | null = null;

function hash3(x: number, y: number, z: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** 可平铺的 Worley（到最近特征点的距离，0..~1），cells = 每个方向的格子数 */
function worley(px: number, py: number, pz: number, cells: number, seed: number): number {
  const x = px * cells;
  const y = py * cells;
  const z = pz * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const wx = ((cx % cells) + cells) % cells;
        const wy = ((cy % cells) + cells) % cells;
        const wz = ((cz % cells) + cells) % cells;
        const fx = cx + hash3(wx, wy, wz, seed);
        const fy = cy + hash3(wx, wy, wz, seed + 1);
        const fz = cz + hash3(wx, wy, wz, seed + 2);
        const d = (fx - x) ** 2 + (fy - y) ** 2 + (fz - z) ** 2;
        if (d < best) best = d;
      }
  return Math.min(1, Math.sqrt(best));
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 可平铺的梯度噪声（-1..1），period = 每个方向的格子数 */
function perlin(px: number, py: number, pz: number, period: number, seed: number): number {
  const x = px * period;
  const y = py * period;
  const z = pz * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const grad = (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => {
    const wx = ((cx % period) + period) % period;
    const wy = ((cy % period) + period) % period;
    const wz = ((cz % period) + period) % period;
    const h = Math.floor(hash3(wx, wy, wz, seed) * 12);
    // 12 个立方体棱方向
    const g = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ][h];
    return g[0] * dx + g[1] * dy + g[2] * dz;
  };
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(grad(ix, iy, iz, fx, fy, fz), grad(ix + 1, iy, iz, fx - 1, fy, fz), u);
  const x10 = lerp(grad(ix, iy + 1, iz, fx, fy - 1, fz), grad(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u);
  const x01 = lerp(grad(ix, iy, iz + 1, fx, fy, fz - 1), grad(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u);
  const x11 = lerp(grad(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), grad(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

const remap = (v: number, lo: number, hi: number, nlo: number, nhi: number) => nlo + ((v - lo) / (hi - lo)) * (nhi - nlo);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function getCloudNoise3D(): THREE.Data3DTexture {
  if (cache) return cache;
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) / N;
        const py = (y + 0.5) / N;
        const pz = (z + 0.5) / N;
        // Perlin fbm（3 层，周期 4/8/16）
        const pf = perlin(px, py, pz, 4, 1) * 0.6 + perlin(px, py, pz, 8, 2) * 0.28 + perlin(px, py, pz, 16, 3) * 0.12;
        const p01 = clamp01(pf * 0.75 + 0.5);
        // 反相 Worley fbm（低 / 中 / 高三档频率）
        const w1 = 1 - worley(px, py, pz, 4, 11);
        const w2 = 1 - worley(px, py, pz, 8, 12);
        const w3 = 1 - worley(px, py, pz, 16, 13);
        const w4 = 1 - worley(px, py, pz, 32, 14);
        const wLow = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        const wMid = w2 * 0.625 + w3 * 0.25 + w4 * 0.125;
        const wHigh = w3 * 0.75 + w4 * 0.25;
        // Perlin-Worley：用低频 Worley 把 Perlin 重新映射，得到成团的“菜花”状
        const pw = clamp01(remap(p01, wLow - 1, 1, 0, 1));
        const i = (z * N * N + y * N + x) * 4;
        data[i] = Math.round(pw * 255);
        data[i + 1] = Math.round(clamp01(wMid) * 255);
        data[i + 2] = Math.round(clamp01(wHigh) * 255);
        data[i + 3] = Math.round(p01 * 255);
      }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cache = t;
  return t;
}
