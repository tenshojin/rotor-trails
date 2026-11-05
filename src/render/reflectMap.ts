// 倒影场：屏幕空间的倒影只认得画面里的东西，光线一飞出画面（低头看水、山在画面外）水面就映成了天空，
// 真实的倒影却还在；出画面的边界上还会留下一条硬线。这里在加载地图时备两张图，让光线飞出画面后接着在“地形”里走：
//   · 高度图：地形 + 树冠（树是一片片的，比地面高十几米）；
//   · 颜色图：俯视的地表颜色（草、林、沙、岩、雪），A = 天空可见度。
// 打光在着色器里算（法线由高度图差分得到，山影用 sunMap），天气、时段都跟得上。见 mirror.ts。

import * as THREE from 'three/webgpu';
import type { MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import { layerTable } from '../world/rockForm';
import { TREE_SPECS, TREE_TYPES, type TreeSet } from '../world/vegetation';

export interface ReflectField {
  height: THREE.Texture;
  color: THREE.Texture;
  /** 地图边长（米） */
  size: number;
  /** 最高点（米，含树冠） */
  top: number;
}

const COLOR_RES = 512;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lin2s = (v: number): number => {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function makeReflectField(map: MapDef, t: Heightfield, trees: TreeSet, surface: Uint8Array, macro: Uint8Array, forest: Uint8Array): ReflectField {
  const n = t.res;
  // 高度：地形 + 树冠；颜色图上也要记下哪里是树冠（否则光线碰到岸边的树，取到的是树脚下沙滩的颜色）
  const H = new Float32Array(t.data);
  const crowns = new Uint8Array(COLOR_RES * COLOR_RES);
  const cCell = t.size / COLOR_RES;
  for (let i = 0; i < trees.count; i++) {
    const name = TREE_TYPES[trees.type[i]];
    if (name === 'boulder' || name === 'shrub') continue;
    const S = TREE_SPECS[name];
    const top = trees.y[i] + (S.crownY + S.crownRy) * trees.s[i];
    const r = Math.max(1, Math.round((S.crownR * trees.s[i]) / t.cell));
    const cx = Math.round((trees.x[i] + t.half) / t.cell);
    const cz = Math.round((trees.z[i] + t.half) / t.cell);
    for (let z = Math.max(0, cz - r); z <= Math.min(n - 1, cz + r); z++)
      for (let x = Math.max(0, cx - r); x <= Math.min(n - 1, cx + r); x++) {
        const o = z * n + x;
        if (H[o] < top) H[o] = top;
      }
    const r2 = Math.max(1, Math.round((S.crownR * trees.s[i]) / cCell));
    const px = Math.floor((trees.x[i] + t.half) / cCell);
    const pz = Math.floor((trees.z[i] + t.half) / cCell);
    for (let z = Math.max(0, pz - r2); z <= Math.min(COLOR_RES - 1, pz + r2); z++)
      for (let x = Math.max(0, px - r2); x <= Math.min(COLOR_RES - 1, px + r2); x++) crowns[z * COLOR_RES + x] = 1;
  }
  let topH = -Infinity;
  const half = new Uint16Array(n * n);
  for (let i = 0; i < half.length; i++) {
    if (H[i] > topH) topH = H[i];
    half[i] = THREE.DataUtils.toHalfFloat(H[i]);
  }
  const height = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  height.name = 'ReflectHeight';
  height.magFilter = THREE.LinearFilter;
  height.minFilter = THREE.LinearFilter;
  height.generateMipmaps = false;
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
  height.needsUpdate = true;

  // 颜色
  const B = map.biome;
  const col = (hex: number): [number, number, number] => {
    const c = new THREE.Color().setHex(hex);
    return [c.r, c.g, c.b];
  };
  const grass = col(B.grass);
  const grass2 = col(B.grass2);
  const floor = col(B.forestFloor);
  const sand = col(B.sand);
  const dirt = col(B.dirt);
  const rock = col(B.rock);
  const rock2 = col(B.rock2);
  const CANOPY: [number, number, number] = [0.062, 0.1, 0.043];
  const PAVED: [number, number, number] = [0.22, 0.22, 0.21];
  const SNOW: [number, number, number] = [0.8, 0.83, 0.88];
  const form = map.rockForm ?? null;
  const T = form ? layerTable(form) : null;
  const bandCol = form ? form.bands.map((b) => col(b.c)) : [];
  const N = COLOR_RES;
  const data = new Uint8Array(N * N * 4);
  const fN = Math.round(Math.sqrt(forest.length / 4));
  const c: [number, number, number] = [0, 0, 0];
  const lerp = (o: [number, number, number], k: number): void => {
    c[0] += (o[0] - c[0]) * k;
    c[1] += (o[1] - c[1]) * k;
    c[2] += (o[2] - c[2]) * k;
  };
  for (let y = 0; y < N; y++) {
    const u = (y + 0.5) / N;
    const iz = Math.min(n - 1, Math.round(u * (n - 1)));
    for (let x = 0; x < N; x++) {
      const v = (x + 0.5) / N;
      const ix = Math.min(n - 1, Math.round(v * (n - 1)));
      const i = iz * n + ix;
      const h = t.data[i];
      const m = macro[i * 4 + 3] / 255; // 平滑后的坡度（1 - n.y）
      const s = i * 4;
      // 按坡度和高度铺一层层地表，顺序和地形着色器一致
      const g2 = 0.5 + 0.5 * Math.sin(ix * 0.031 + iz * 0.017) * Math.sin(iz * 0.023 - ix * 0.011);
      c[0] = grass[0] + (grass2[0] - grass[0]) * g2;
      c[1] = grass[1] + (grass2[1] - grass[1]) * g2;
      c[2] = grass[2] + (grass2[2] - grass[2]) * g2;
      const f = forest[(Math.min(fN - 1, Math.floor(u * fN)) * fN + Math.min(fN - 1, Math.floor(v * fN))) * 4] / 255;
      lerp(floor, Math.min(0.85, f * 1.3));
      lerp(sand, Math.max(1 - smooth(B.beachTop - 0.5, B.beachTop + 2, h), surface[s] / 255));
      lerp(dirt, (surface[s + 1] / 255) * 0.9);
      if (map.pavedMask) lerp(PAVED, surface[s + 3] / 255);
      const rk = smooth(B.rockSlope - 0.07, B.rockSlope + 0.06, m);
      if (rk > 0) {
        let rc: [number, number, number] = iz % 7 < 4 ? rock : rock2;
        if (T && form) {
          const q = Math.min(T.at.length - 1, Math.max(0, (h - form.y0) | 0));
          rc = bandCol[T.band[T.at[q]]];
        }
        lerp(rc, rk);
      }
      lerp(CANOPY, Math.max(smooth(0.25, 0.75, f) * (1 - rk * 0.6), crowns[y * N + x] * 0.9));
      lerp(SNOW, Math.min(1, smooth(B.snowLine - 50, B.snowLine + 30, h) * (1 - smooth(0.2, 0.4, m)) + smooth(B.snowLine + 500, B.snowLine + 1100, h) * 0.85));
      if (map.pavedMask) lerp(PAVED, (surface[s + 3] / 255) * 0.9);
      const o = (y * N + x) * 4;
      data[o] = Math.round(lin2s(c[0]) * 255);
      data[o + 1] = Math.round(lin2s(c[1]) * 255);
      data[o + 2] = Math.round(lin2s(c[2]) * 255);
      data[o + 3] = macro[i * 4 + 2];
    }
  }
  const color = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  color.name = 'ReflectColor';
  color.colorSpace = THREE.SRGBColorSpace;
  color.magFilter = THREE.LinearFilter;
  color.minFilter = THREE.LinearFilter;
  color.generateMipmaps = false;
  color.wrapS = color.wrapT = THREE.ClampToEdgeWrapping;
  color.needsUpdate = true;
  return { height, color, size: t.size, top: topH + 2 };
}
