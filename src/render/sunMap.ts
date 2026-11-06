// 山影：分层阴影只覆盖镜头周围 2.6 km，再往外山就不投影了，黄昏时远处的山谷还是亮堂堂的，树也一样；
// 而且阴影贴图里的树叶、地形不够细时，远处的影子是糊的。这里在加载地图时算一张“阴影高度图”：
// 沿太阳方向从地图一边扫到另一边，记下每个位置头顶上被山挡住的光线到了多高——低于这个高度就在山影里。
//
// 查询只要一次纹理读取，而且是三维的：直升机飞到山影上面就回到阳光里。地面、水面、树、建筑、座舱都用它。
// 太阳在一局里不动，所以只算一次。

import * as THREE from 'three/webgpu';
import { clamp, float, Fn, max, mix, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl';
import { Perlin2 } from '../core/noise';
import type { Heightfield } from '../sim/terrain';

const empty = new THREE.DataTexture(new Uint16Array([0, 0, 0, 0]), 2, 2, THREE.RedFormat, THREE.HalfFloatType);
empty.magFilter = THREE.LinearFilter;
empty.minFilter = THREE.LinearFilter;
empty.needsUpdate = true;

const heightTex = texture(empty);
const mapSize = uniform(1);
const active = uniform(0);
/** 外面一层的边长（0 = 没有）。真实地形的视野有几十公里：贴图左半边是里层，右半边是外层，还是只占一张贴图的位置 */
const outerSize = uniform(0);
/** 阴影边缘的软硬（米，竖直方向）：太阳越低，同样的高度差在地面上拉得越长 */
const SOFT = 10;
const soft = uniform(SOFT);
const ragged = new Perlin2(907);

let current: THREE.DataTexture | null = null;

/** 地图外面地形的粗网格（见 reflectMap.ts）：太阳低的时候，光是从地图外的山背后照过来的 */
export interface FarGrid {
  h: Float32Array;
  res: number;
  /** 边长（米） */
  size: number;
}

/** 从 (x, z) 朝太阳走，地图外的山在这一点头顶挡到多高 */
function farShade(g: FarGrid, x: number, z: number, sx: number, sz: number, tanEl: number): number {
  const R = g.res;
  const cell = g.size / R;
  let top = -1e4;
  for (let s = cell; ; s += cell) {
    const fx = (x + sx * s) / cell + R / 2 - 0.5;
    const fz = (z + sz * s) / cell + R / 2 - 0.5;
    if (fx < 0 || fz < 0 || fx >= R - 1 || fz >= R - 1) return top;
    const ix = fx | 0;
    const iz = fz | 0;
    const u = fx - ix;
    const v = fz - iz;
    const o = iz * R + ix;
    const h = (g.h[o] * (1 - u) + g.h[o + 1] * u) * (1 - v) + (g.h[o + R] * (1 - u) + g.h[o + R + 1] * u) * v;
    const y = h - s * tanEl;
    if (y > top) top = y;
  }
}

/** 算出“沿太阳方向传过来的阴影面高度”（只看上游，不含这一格自己的地形）。far：地图外的山也算 */
export function bakeShadowHeights(t: Heightfield, sunDir: THREE.Vector3, far: FarGrid | null = null): Float32Array {
  const n = t.res;
  const h = t.data;
  const hl = Math.hypot(sunDir.x, sunDir.z);
  const U = new Float32Array(n * n).fill(-1e4);
  if (hl < 1e-4) return U;
  const sx = sunDir.x / hl;
  const sz = sunDir.z / hl;
  const tanEl = sunDir.y / hl;
  const S = new Float32Array(n * n);
  // 沿主方向一行一行扫：上游点落在上一行（或上一列），在两格之间线性插值
  const alongX = Math.abs(sx) >= Math.abs(sz);
  const a = alongX ? sx : sz;
  const b = alongX ? sz : sx;
  const dir = a > 0 ? 1 : -1;
  const off = b / Math.abs(a);
  const drop = tanEl * t.cell * Math.hypot(1, off);
  const start = a > 0 ? n - 1 : 0;
  const idx = alongX ? (u: number, v: number) => v * n + u : (u: number, v: number) => u * n + v;
  /** 这一格上游已经出了地图：地图外的山挡到多高 */
  const outside = (u: number, v: number): number => {
    if (!far) return -1e4;
    const a0 = u * t.cell - t.half;
    const b0 = v * t.cell - t.half;
    return alongX ? farShade(far, a0, b0, sx, sz, tanEl) : farShade(far, b0, a0, sx, sz, tanEl);
  };
  for (let k = 0; k < n; k++) {
    const u = start - dir * k;
    for (let v = 0; v < n; v++) {
      const i = idx(u, v);
      if (k === 0) {
        U[i] = outside(u, v);
        S[i] = U[i] > h[i] ? U[i] : h[i];
        continue;
      }
      const f = Math.min(n - 1.001, Math.max(0, v + off));
      const v0 = f | 0;
      const w = f - v0;
      let up = S[idx(u + dir, v0)] * (1 - w) + S[idx(u + dir, v0 + 1)] * w - drop;
      if (v + off < 0 || v + off > n - 1) up = Math.max(up, outside(u, v));
      U[i] = up;
      S[i] = up > h[i] ? up : h[i];
    }
  }
  return U;
}

/**
 * 换地图或换时段时调用。outer：地图外面还有一层（真实地形），两层必须一样大。
 * 真实地形的高程本身就是碎的，不用再加碎边
 */
export function setSunMap(t: Heightfield, sunDir: THREE.Vector3, far: FarGrid | null = null, outer: Heightfield | null = null): void {
  const n = t.res;
  const W = outer ? n * 2 : n;
  const half = new Uint16Array(W * n);
  if (outer) {
    const U = bakeShadowHeights(t, sunDir, { h: outer.data, res: outer.res, size: outer.size });
    const V = bakeShadowHeights(outer, sunDir, far);
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        half[z * W + x] = THREE.DataUtils.toHalfFloat(U[z * n + x]);
        half[z * W + n + x] = THREE.DataUtils.toHalfFloat(V[z * n + x]);
      }
  } else {
    const U = bakeShadowHeights(t, sunDir, far);
    // 影子的边缘不是一条尺子画的直线：投影的山脊本身是碎的，高度图一格 4 米又把它抹平了，这里把碎的感觉补回来
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        half[i] = THREE.DataUtils.toHalfFloat(U[i] + ragged.fbm((x * t.cell) / 90, (z * t.cell) / 90, 4) * 26);
      }
  }
  const tex = new THREE.DataTexture(half, W, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.name = 'SunHeight';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  current?.dispose();
  current = tex;
  heightTex.value = tex;
  mapSize.value = t.size;
  outerSize.value = outer ? outer.size : 0;
  soft.value = outer ? 3 : SOFT;
  active.value = 1;
}

export function clearSunMap(): void {
  active.value = 0;
  outerSize.value = 0;
  heightTex.value = empty;
  current?.dispose();
  current = null;
}

/** 查这一点的阴影面高度。x：贴图里的值，y：这一点在不在贴图范围内 */
const shadowHeightAt = (p: THREE.Node<'vec3'>): THREE.Node<'vec2'> => {
  const a = p.xz.div(mapSize).add(0.5);
  const b = p.xz.div(max(outerSize, 1)).add(0.5);
  const inA = step(a.x.sub(0.5).abs(), float(0.5)).mul(step(a.y.sub(0.5).abs(), float(0.5)));
  const hasOuter = step(1, outerSize);
  const inB = step(b.x.sub(0.5).abs(), float(0.5)).mul(step(b.y.sub(0.5).abs(), float(0.5))).mul(hasOuter);
  // 两半贴在一起，取样时别跨过中缝
  const ax = mix(a.x, clamp(a.x, 0.001, 0.999).mul(0.5), hasOuter);
  const uv = mix(vec2(clamp(b.x, 0.001, 0.999).mul(0.5).add(0.5), b.y), vec2(ax, a.y), inA);
  return vec2(heightTex.sample(uv).level(float(0)).r, max(inA, inB));
};

/** p（世界坐标）能不能被太阳照到：1 = 照得到，0 = 在山影里。只算地图范围内的山 */
export const terrainSun = Fn(([pIn]: [THREE.Node<'vec3'>]) => {
  const p = vec3(pIn);
  const q = shadowHeightAt(p).toVar();
  return mix(float(1), smoothstep(q.x.sub(soft.mul(2)), q.x, p.y), q.y.mul(active));
});

/**
 * 同上，给雾里的光束用。地面上的山影边缘清楚，雾里的光经过多次散射，边缘是一大片渐变；
 * 按硬边算的话光束的边界是一个平面，从镜头看就是一条穿过山和水面的直线。
 */
export const terrainSunHaze = Fn(([pIn]: [THREE.Node<'vec3'>]) => {
  const p = vec3(pIn);
  const q = shadowHeightAt(p).toVar();
  return mix(float(1), smoothstep(q.x.sub(190), q.x.add(70), p.y), q.y.mul(active));
});
