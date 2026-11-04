// 山影：分层阴影只覆盖镜头周围 2.6 km，再往外山就不投影了，黄昏时远处的山谷还是亮堂堂的，树也一样；
// 而且阴影贴图里的树叶、地形不够细时，远处的影子是糊的。这里在加载地图时算一张“阴影高度图”：
// 沿太阳方向从地图一边扫到另一边，记下每个位置头顶上被山挡住的光线到了多高——低于这个高度就在山影里。
//
// 查询只要一次纹理读取，而且是三维的：直升机飞到山影上面就回到阳光里。地面、水面、树、建筑、座舱都用它。
// 太阳在一局里不动，所以只算一次。

import * as THREE from 'three/webgpu';
import { float, Fn, mix, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { Heightfield } from '../sim/terrain';

const empty = new THREE.DataTexture(new Uint16Array([0, 0, 0, 0]), 2, 2, THREE.RedFormat, THREE.HalfFloatType);
empty.magFilter = THREE.LinearFilter;
empty.minFilter = THREE.LinearFilter;
empty.needsUpdate = true;

const heightTex = texture(empty);
const mapSize = uniform(1);
const active = uniform(0);
/** 阴影边缘的软硬（米，竖直方向）：太阳越低，同样的高度差在地面上拉得越长 */
const SOFT = 7;

let current: THREE.DataTexture | null = null;

/** 算出“沿太阳方向传过来的阴影面高度”（只看上游，不含这一格自己的地形） */
export function bakeShadowHeights(t: Heightfield, sunDir: THREE.Vector3): Float32Array {
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
  for (let k = 0; k < n; k++) {
    const u = start - dir * k;
    for (let v = 0; v < n; v++) {
      const i = idx(u, v);
      if (k === 0) {
        S[i] = h[i];
        continue;
      }
      const f = Math.min(n - 1.001, Math.max(0, v + off));
      const v0 = f | 0;
      const w = f - v0;
      const up = S[idx(u + dir, v0)] * (1 - w) + S[idx(u + dir, v0 + 1)] * w - drop;
      U[i] = up;
      S[i] = up > h[i] ? up : h[i];
    }
  }
  return U;
}

/** 换地图或换时段时调用 */
export function setSunMap(t: Heightfield, sunDir: THREE.Vector3): void {
  const n = t.res;
  const U = bakeShadowHeights(t, sunDir);
  const half = new Uint16Array(n * n);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(U[i]);
  const tex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
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
  active.value = 1;
}

export function clearSunMap(): void {
  active.value = 0;
  heightTex.value = empty;
  current?.dispose();
  current = null;
}

/** p（世界坐标）能不能被太阳照到：1 = 照得到，0 = 在山影里。只算地图范围内的山 */
export const terrainSun = Fn(([pIn]: [THREE.Node<'vec3'>]) => {
  const p = vec3(pIn);
  const uv = p.xz.div(mapSize).add(0.5);
  const inside = step(uv.x.sub(0.5).abs(), float(0.5)).mul(step(uv.y.sub(0.5).abs(), float(0.5)));
  const s = heightTex.sample(vec2(uv)).level(float(0)).r;
  return mix(float(1), smoothstep(s.sub(SOFT * 2), s, p.y), inside.mul(active));
});
