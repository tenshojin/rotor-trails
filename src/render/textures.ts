// 程序化纹理（无需外部素材）：可平铺噪声、地表掩码、植被密度、小地图地形晕渲。

import * as THREE from 'three';
import { hash2i } from '../core/noise';
import type { MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import type { FlowMap } from '../world/flow';
import type { TreeSet } from '../world/vegetation';

/** 周期性值噪声（可无缝平铺）。 */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const p = (a: number) => ((a % period) + period) % period;
  const a = hash2i(p(xi), p(yi), seed);
  const b = hash2i(p(xi + 1), p(yi), seed);
  const c = hash2i(p(xi), p(yi + 1), seed);
  const d = hash2i(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function tileFbm(x: number, y: number, basePeriod: number, octaves: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += amp * tileNoise(x * f, y * f, period, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
    period *= 2;
  }
  return s / norm;
}

let noiseTex: THREE.DataTexture | null = null;

/** 256² 可平铺噪声：R = 大尺度分形，G = 细节分形，B = 细胞状斑点，A = 高频颗粒。 */
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * 8;
      const v = (y / N) * 8;
      const r = tileFbm(u, v, 8, 5, 3);
      const g = tileFbm(u * 4, v * 4, 32, 4, 9);
      let cell = 0;
      {
        const cu = (x / N) * 16;
        const cv = (y / N) * 16;
        const ci = Math.floor(cu);
        const cj = Math.floor(cv);
        let best = 9;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = ci + di;
            const jj = cj + dj;
            const px = ii + hash2i(((ii % 16) + 16) % 16, ((jj % 16) + 16) % 16, 5);
            const py = jj + hash2i(((ii % 16) + 16) % 16, ((jj % 16) + 16) % 16, 6);
            const d = Math.hypot(cu - px, cv - py);
            if (d < best) best = d;
          }
        cell = Math.min(1, best);
      }
      const a = hash2i(x, y, 11);
      const i = (y * N + x) * 4;
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(cell * 255);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

/** 地表掩码纹理（与高度场同分辨率，线性过滤）。 */
export function makeSurfaceTexture(surface: Uint8Array, res: number): THREE.DataTexture {
  const t = new THREE.DataTexture(surface, res, res, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** 植被密度（512²）：森林地面变暗、远景替代。R = 树冠覆盖度，G = 汇流（水系，见 world/flow.ts）。 */
export function makeForestTexture(trees: TreeSet, size: number, flow: FlowMap | null = null): THREE.DataTexture {
  const N = 512;
  const acc = new Float32Array(N * N);
  // 蓝通道：真的种了树的地方（红通道还算上地图边稀下去的那些）
  const live = new Float32Array(N * N);
  const k = N / size;
  const splat = (tx: number, tz: number, ts: number, t: number, real = 1): void => {
    if (t === 8 || t === 10) return; // 灌木、石块
    const cx = (tx + size / 2) * k;
    const cz = (tz + size / 2) * k;
    // 雨林林冠树（模型树冠半径约 12.5 m）的林下地面范围更大，树冠之间看下去是阴暗的林地而不是草坪
    const r = Math.max(1.5, (t === 2 || t === 3 ? 24 : 8.5) * ts * k);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(N - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r));
    const z1 = Math.min(N - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, z - cz) / r;
        if (d < 1) {
          acc[z * N + x] += (1 - d) * 0.7;
          live[z * N + x] += (1 - d) * 0.7 * real;
        }
      }
  };
  for (let i = 0; i < trees.count; i++) splat(trees.x[i], trees.z[i], trees.s[i], trees.type[i]);
  const g = trees.ghosts;
  if (g) for (let i = 0; i + 3 < g.length; i += 4) splat(g[i], g[i + 1], g[i + 2], g[i + 3], 0);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = Math.min(1, acc[i]);
    data[i * 4] = Math.round(v * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, live[i]) * 255);
    data[i * 4 + 3] = 255;
  }
  if (flow) {
    for (let z = 0; z < N; z++) {
      const fz = Math.min(flow.n - 1, Math.round(((z + 0.5) / N) * (flow.n - 1)));
      for (let x = 0; x < N; x++) {
        const fx = Math.min(flow.n - 1, Math.round(((x + 0.5) / N) * (flow.n - 1)));
        data[(z * N + x) * 4 + 1] = flow.data[fz * flow.n + fx];
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 水深纹理（512²）：R = 归一化深度（0..25 m）。 */
export function makeWaterDepthTexture(terrain: Heightfield, level: number): THREE.DataTexture {
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const wx = -terrain.half + ((x + 0.5) / N) * terrain.size;
      const wz = -terrain.half + ((z + 0.5) / N) * terrain.size;
      const d = Math.max(0, Math.min(1, (level - terrain.heightAt(wx, wz)) / 25));
      const i = (z * N + x) * 4;
      data[i] = Math.round(d * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * 地表高度图（体积雾用：贴地的薄雾按“离地高度”变淡）。水面处取水面高度；
 * 半浮点 RGBA（WebGPU 下可线性过滤），R = 高度（米）。
 */
export function makeGroundHeightTexture(terrain: Heightfield, waterLevel: number | null, N = 256): THREE.DataTexture {
  const data = new Uint16Array(N * N * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const wx = -terrain.half + ((x + 0.5) / N) * terrain.size;
      const wz = -terrain.half + ((z + 0.5) / N) * terrain.size;
      const h = Math.max(terrain.heightAt(wx, wz), waterLevel ?? -Infinity);
      const i = (z * N + x) * 4;
      data[i] = THREE.DataUtils.toHalfFloat(h);
      data[i + 3] = one;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function hexRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** 小地图的配色：水按深浅，陆地按沙滩、草、林、岩、雪，再乘上高度和山坡的明暗。地图里面、外面的远景用同一套，接缝看不出来 */
function minimapPainter(map: MapDef, minH: number, maxH: number): (h: number, slope: number, gx: number, gz: number, forest: number) => [number, number, number] {
  const B = map.biome;
  const grass = hexRgb(B.grass);
  const rock = hexRgb(B.rock);
  const snow = hexRgb(B.snow);
  const sand = hexRgb(B.sand);
  const forestC = hexRgb(B.forestFloor);
  const water = hexRgb(B.waterDeep);
  const shallow = hexRgb(B.waterShallow);
  const span = Math.max(1, maxH - Math.min(minH, map.waterLevel ?? minH));
  return (h, slope, gx, gz, forest) => {
    if (map.waterLevel !== null && h < map.waterLevel) {
      const d = Math.min(1, (map.waterLevel - h) / 15);
      return [shallow[0] + (water[0] - shallow[0]) * d, shallow[1] + (water[1] - shallow[1]) * d, shallow[2] + (water[2] - shallow[2]) * d];
    }
    const shade = Math.max(0.35, Math.min(1.25, 0.85 - (gx * 0.6 + gz * 0.8)));
    const t = Math.min(1.4, Math.max(0, (h - minH) / span));
    let c: [number, number, number] = h < B.beachTop ? [...sand] : [...grass];
    const f = Math.min(1, forest);
    c = [c[0] + (forestC[0] - c[0]) * f, c[1] + (forestC[1] - c[1]) * f, c[2] + (forestC[2] - c[2]) * f];
    if (slope > B.rockSlope) c = [...rock];
    if (h > B.snowLine && slope < 0.55) c = [...snow];
    const k = (0.9 + t * 0.25) * shade;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
}

/** 小地图底图：地形晕渲 + 水体 + 森林，返回 canvas。 */
export function makeMinimapCanvas(map: MapDef, terrain: Heightfield, trees: TreeSet, N = 512): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(N, N);
  const forest = new Float32Array(N * N);
  const k = N / map.size;
  for (let i = 0; i < trees.count; i++) {
    const x = Math.floor((trees.x[i] + map.size / 2) * k);
    const z = Math.floor((trees.z[i] + map.size / 2) * k);
    if (x >= 0 && z >= 0 && x < N && z < N) forest[z * N + x] += 0.25;
  }
  const paint = minimapPainter(map, terrain.minH, terrain.maxH);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const wx = -terrain.half + ((x + 0.5) / N) * terrain.size;
      const wz = -terrain.half + ((z + 0.5) / N) * terrain.size;
      const h = terrain.heightAt(wx, wz);
      const e = terrain.cell * 2;
      const gx = (terrain.heightAt(wx + e, wz) - terrain.heightAt(wx - e, wz)) / (e * 2);
      const gz = (terrain.heightAt(wx, wz + e) - terrain.heightAt(wx, wz - e)) / (e * 2);
      const c = paint(h, terrain.slopeAt(wx, wz), gx, gz, forest[z * N + x]);
      const i = (z * N + x) * 4;
      img.data[i] = Math.min(255, c[0]);
      img.data[i + 1] = Math.min(255, c[1]);
      img.data[i + 2] = Math.min(255, c[2]);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * 小地图的外圈：地图外面的远景地形（飞不过去，但看得见）。座舱的导航仪、平板先画它，再把地图本身盖在中间：
 * 飞到地图边上，旁边不再是一片空白。高度用现成的远景网格（水面倒影、山影也是它），不多算一遍。
 * minH / maxH 用地图里面的，颜色才接得上
 */
export function makeMinimapOuter(map: MapDef, far: { h: Float32Array; res: number; size: number }, minH: number, maxH: number): HTMLCanvasElement {
  const R = far.res;
  const cv = document.createElement('canvas');
  cv.width = cv.height = R;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(R, R);
  const paint = minimapPainter(map, minH, maxH);
  const cell = far.size / R;
  const H = (x: number, z: number): number => far.h[Math.min(R - 1, Math.max(0, z)) * R + Math.min(R - 1, Math.max(0, x))];
  for (let z = 0; z < R; z++)
    for (let x = 0; x < R; x++) {
      const gx = (H(x + 1, z) - H(x - 1, z)) / (2 * cell);
      const gz = (H(x, z + 1) - H(x, z - 1)) / (2 * cell);
      const c = paint(H(x, z), 1 - 1 / Math.hypot(gx, 1, gz), gx, gz, 0);
      const i = (z * R + x) * 4;
      img.data[i] = Math.min(255, c[0]);
      img.data[i + 1] = Math.min(255, c[1]);
      img.data[i + 2] = Math.min(255, c[2]);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return cv;
}
