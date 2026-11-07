// 地形的“大尺度”信息。高度图一格 4 米，山坡在光照下是光滑的曲面；真实的山看上去粗粝，靠的是几十米尺度的沟壑、
// 山脊、岩层。这里准备两张图：
//   · 地形宏观图（每张地图一张，由高度场算出）：R = 小尺度凹凸（约 12 m），G = 大尺度凹凸（约 60 m），B = 天空可见度，
//     A = 平滑后的坡度（岩石与草地的分界用它，否则分界线会沿着 4 米网格的三角形走成锯齿）。
//     凹处（沟、谷）偏暗，凸处（山脊）偏亮，山谷深处环境光更少——明暗跟着地形走，而不是一团团随机噪声。
//   · 岩石浮雕图（全局一张，可平铺）：脊状分形噪声的法线与高度，三平面投影到岩壁上，给光滑的山体加出棱角。

import * as THREE from 'three/webgpu';
import type { Heightfield } from '../sim/terrain';
import { layerTable, type RockFormDef } from '../world/rockForm';

function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[row + Math.min(n - 1, Math.max(0, i))];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = s / w;
      s += src[row + Math.min(n - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(n - 1, Math.max(0, i)) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = s / w;
      s += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
  return out;
}

const DIRS: Array<[number, number]> = [[1, 0], [0.71, 0.71], [0, 1], [-0.71, 0.71], [-1, 0], [-0.71, -0.71], [0, -1], [0.71, -0.71]];
const REACH = [3, 8, 20, 44];

export function makeTerrainMacroTexture(t: Heightfield): THREE.DataTexture {
  const n = t.res;
  const h = t.data;
  // 两次盒式模糊接近高斯
  const small = boxBlur(boxBlur(h, n, 2), n, 2);
  const big = boxBlur(boxBlur(h, n, 8), n, 7);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const c1 = Math.max(-1, Math.min(1, (small[i] - h[i]) / 2.5));
      const c2 = Math.max(-1, Math.min(1, (big[i] - small[i]) / 14));
      // 天空可见度：八个方向上最高的地平线仰角
      let occ = 0;
      const h0 = h[i];
      for (const [dx, dy] of DIRS) {
        let m = 0;
        for (const r of REACH) {
          const px = x + Math.round(dx * r);
          const py = y + Math.round(dy * r);
          if (px < 0 || py < 0 || px >= n || py >= n) break;
          const s = (h[py * n + px] - h0) / (r * t.cell);
          if (s > m) m = s;
        }
        occ += m / Math.sqrt(1 + m * m);
      }
      const sky = 1 - occ / DIRS.length;
      const o = i * 4;
      data[o] = Math.round((c1 * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((c2 * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(sky * 255);
      const xl = Math.max(0, x - 1);
      const xr = Math.min(n - 1, x + 1);
      const yl = Math.max(0, y - 1);
      const yr = Math.min(n - 1, y + 1);
      const sx = (small[y * n + xr] - small[y * n + xl]) / ((xr - xl) * t.cell);
      const sy = (small[yr * n + x] - small[yl * n + x]) / ((yr - yl) * t.cell);
      data[o + 3] = Math.round((1 - 1 / Math.sqrt(1 + sx * sx + sy * sy)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 地层表贴图：一行像素，横坐标是地层坐标（y0..y1）。每层一个底色，
 * 层内叠上细碎的纹层（风化程度不同，深浅不一），层与层的接触面有一条深色的线——这是岩壁上最抢眼的横向线条。
 * A 通道是硬度。
 */
export function makeStrataTexture(d: RockFormDef): THREE.DataTexture {
  const W = 4096;
  const data = new Uint8Array(W * 4);
  const T = layerTable(d);
  const c = new THREE.Color();
  const span = d.y1 - d.y0;
  for (let i = 0; i < W; i++) {
    const y = d.y0 + ((i + 0.5) / W) * span;
    const L = T.at[Math.min(T.at.length - 1, Math.max(0, (y - d.y0) | 0))];
    const b = d.bands[T.band[L]];
    const u = (y - T.start[L]) / (T.end[L] - T.start[L]);
    c.setHex(b.c, THREE.SRGBColorSpace);
    // 纹层：几个频率不同的层状起伏（硬层薄、软层厚一些）
    const f1 = Math.sin(y * 1.9 + L * 2.1);
    const f2 = Math.sin(y * 0.73 + L * 0.7);
    const f3 = Math.sin(y * 4.3 + L * 5.3);
    const lam = 1 + 0.07 * f1 + 0.09 * f2 + 0.04 * f3;
    // 接触面：层底略深（上一层风化下来的物质盖住了它），层顶略浅
    const edge = 1 - 0.24 * (1 - Math.min(1, u * (T.end[L] - T.start[L]) / 1.6)) + 0.08 * u;
    const k = lam * edge;
    const o = i * 4;
    // 按 sRGB 字节存（贴图声明成 sRGB，读出来是线性值）
    data[o] = Math.min(255, Math.round(lin2s(c.r * k) * 255));
    data[o + 1] = Math.min(255, Math.round(lin2s(c.g * k) * 255));
    data[o + 2] = Math.min(255, Math.round(lin2s(c.b * k) * 255));
    data[o + 3] = Math.round(b.hard * 255);
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function lin2s(v: number): number {
  const x = Math.max(0, v);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 可平铺的值噪声（period：格子数） */
function vnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(ix), w(iy), seed);
  const b = hash(w(ix + 1), w(iy), seed);
  const c = hash(w(ix), w(iy + 1), seed);
  const d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

let relief: THREE.DataTexture | null = null;
let reliefLoading: Promise<void> | null = null;
let reliefBlock: THREE.DataTexture | null = null;
let blockLoading: Promise<void> | null = null;

/** 加载岩石浮雕图（tools/prep_relief.py 烘焙）。地形和岩石道具建材质之前调用 */
export function loadRockRelief(): Promise<void> {
  reliefLoading ??= fetchRockRelief().then((loaded) => {
    if (!loaded) reliefLoading = null;
  });
  return reliefLoading;
}

/** 块状的岩石（花岗岩、片麻岩）用的浮雕图：没有层理，是一块块的平面和节理。只有这种地图才要；加载失败就用层状的那张 */
export function loadBlockRelief(): Promise<void> {
  blockLoading ??= fetchRelief('textures/rock_relief_block.webp')
    .then((r) => {
      reliefBlock = reliefTexture(r.data, r.width);
    })
    .catch((e: unknown) => {
      console.warn('块状岩石浮雕图加载失败，改用层状的：', e);
      blockLoading = null;
    });
  return blockLoading;
}

async function fetchRelief(file: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const r = await fetch(new URL(file, document.baseURI).href);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
  try {
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    return { data: new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer), width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

async function fetchRockRelief(): Promise<boolean> {
  try {
    const { data, width, height } = await fetchRelief('textures/rock_relief.webp');
    // A previous attempt may already have supplied a procedural fallback to
    // materials. Keep that shared Texture object alive when retrying the image.
    if (relief) {
      // The baked map is larger than the fallback; free the old GPU allocation
      // before uploading the new dimensions through the same Texture object.
      relief.dispose();
      relief.image = { data, width, height };
      relief.needsUpdate = true;
    } else relief = reliefTexture(data, width);
    return true;
  } catch (e) {
    console.warn('岩石浮雕图加载失败，改用程序生成：', e);
    return false;
  }
}

function reliefTexture(data: Uint8Array, n: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function getRockReliefTexture(massive = false): THREE.DataTexture {
  if (massive && reliefBlock) return reliefBlock;
  if (relief) return relief;
  const N = 512;
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // 脊状分形：每层取 1 - |2n - 1| 得到尖锐的棱线，上一层的值调制下一层（棱线上细节多，谷里平滑）
      let f = 0;
      let amp = 0.55;
      let per = 6;
      let w = 1;
      for (let o = 0; o < 6; o++) {
        const r = 1 - Math.abs(2 * vnoise(u, v, per, 11 + o) - 1);
        const s = r * r * w;
        f += s * amp;
        w = Math.min(1, s * 1.8 + 0.25);
        amp *= 0.52;
        per *= 2;
      }
      H[y * N + x] = f;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of H) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const data = new Uint8Array(N * N * 4);
  const at = (x: number, y: number) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 9;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 9;
      const l = 1 / Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      data[i] = Math.round((-dx * l * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * l * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((H[y * N + x] - lo) / (hi - lo)) * 255);
      data[i + 3] = 0;
    }
  }
  relief = reliefTexture(data, N);
  return relief;
}
