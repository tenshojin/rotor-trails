// 地形渲染：按块（64 格）分级 LOD，近处使用与碰撞完全一致的全分辨率三角网格；
// 着色器见 terrainShader.ts（照片材质 8 层混合，按坡度/高度/掩码）。
// 地形块合成三批（BatchedMesh）提交：以前每块一个网格，一张图 256 块，three.js 每提交一个物体都有固定开销，
// 主线程每帧光地形就要一两毫秒。三批：近景（LOD0，进最近两层和第三层阴影）、中景（LOD1，只进第三层阴影）、
// 远景（LOD2/3，不投影）。每批按槽位预留顶点（一个槽位放一块地形一个细节级别的几何），块换级时写进新一级的空槽位；
// 每块仍单独做视锥剔除，近处的块由近到远画（地形着色器重，少画被挡住的像素）。

import * as THREE from 'three/webgpu';
import type { BiomeDef, MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import { farHeightAt } from '../world/farHeight';
import type { TerrainLayers } from './terrainLayers';
import { makeTerrainMaterial, makeWetUniform, type TerrainUniforms } from './terrainShader';
import { TERRAIN_SHADOW_LAYER } from './sunShadows';
import { getNoiseTexture } from './textures';
import { getRockReliefTexture, makeStrataTexture } from './terrainMacro';

const CH = 64;
const LOD_STEPS = [1, 2, 4, 8];
/** 槽位按极高画质（细节系数 2.6）的切换距离留：换到哪一档画质都够用 */
const MAX_LOD_SCALE = 2.6;

/** 一块 n×n 格的地形（带四条裙边）的顶点数、索引数 */
const chunkVerts = (n: number) => (n + 1) * (n + 1) + 4 * (n + 1);
const chunkIndices = (n: number) => n * n * 6 + 4 * n * 6;

interface Slot {
  batch: ChunkBatch;
  geo: number;
  inst: number;
}

/** 一批地形块：count 个槽位，每个槽位预留一块地形的顶点和索引，一个实例 */
class ChunkBatch {
  readonly mesh: THREE.BatchedMesh;
  private readonly free: Slot[] = [];

  constructor(material: THREE.Material, count: number, verts: number, indices: number, cast: boolean, layers: number) {
    const m = new THREE.BatchedMesh(count, count * verts, count * indices, material);
    m.perObjectFrustumCulled = true;
    m.sortObjects = true;
    // 整批的包围球会随槽位里的块变，不用它：每块自己剔除
    m.frustumCulled = false;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.layers.mask = layers;
    m.matrixAutoUpdate = false;
    // 占位几何（只为了按格式开出槽位）：三个点，属性与地形块一致
    const ph = new THREE.BufferGeometry();
    ph.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    ph.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    ph.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    for (let i = 0; i < count; i++) {
      const geo = m.addGeometry(ph, verts, indices);
      const inst = m.addInstance(geo);
      m.setVisibleAt(inst, false);
      this.free.push({ batch: this, geo, inst });
    }
    ph.dispose();
    this.mesh = m;
  }

  /** 把一块地形的几何放进一个空槽位；槽位用完了返回 null（这块先留在原来的级别） */
  take(g: THREE.BufferGeometry): Slot | null {
    const s = this.free.pop();
    if (!s) return null;
    this.mesh.setGeometryAt(s.geo, g);
    this.mesh.setVisibleAt(s.inst, true);
    return s;
  }

  release(s: Slot): void {
    this.mesh.setVisibleAt(s.inst, false);
    this.free.push(s);
  }

  get freeCount(): number {
    return this.free.length;
  }
}

export type { TerrainUniforms };

function col(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

/** 树冠图边缘一圈的平均值（只算陆地：一半是海的地图边，外面的陆地不会因此少一半林子） */
function edgeForest(t: THREE.Texture, land: (u: number, v: number) => boolean): number {
  const img = t.image as { data: Uint8Array; width: number; height: number };
  const n = img.width;
  const m = img.height;
  const w = 14;
  let sum = 0;
  let cnt = 0;
  for (let y = 0; y < m; y++)
    for (let x = 0; x < n; x++) {
      if (x >= w && x < n - w && y >= w && y < m - w) continue;
      if (!land((x + 0.5) / n, (y + 0.5) / m)) continue;
      sum += img.data[(y * n + x) * 4];
      cnt++;
    }
  return cnt ? sum / cnt / 255 : 0;
}

export function makeTerrainUniforms(map: MapDef, hf: Heightfield, surfaceTex: THREE.Texture, forestTex: THREE.Texture, macroTex: THREE.Texture, layers: TerrainLayers | null = null): TerrainUniforms {
  const B: BiomeDef = map.biome;
  const strata = B.strataColors ?? [B.rock, B.rock2, B.dirt, B.sand];
  return {
    noise: getNoiseTexture(),
    surface: surfaceTex,
    forest: forestTex,
    macro: macroTex,
    wash: B.wash === undefined ? null : col(B.wash),
    relief: getRockReliefTexture(map.rockForm?.massive),
    layers,
    mapSize: map.size,
    sand: col(B.sand),
    grass: col(B.grass),
    grass2: col(B.grass2),
    dirt: col(B.dirt),
    rock: col(B.rock),
    rock2: col(B.rock2),
    snow: col(B.snow),
    forestFloor: col(B.forestFloor),
    fringe: map.fringe ?? 0,
    forestFar: map.fringe ? 0.95 : 1.3 * edgeForest(forestTex, (u, v) => map.waterLevel === null || hf.heightAt((u - 0.5) * map.size, (v - 0.5) * map.size) > map.waterLevel + 1),
    strataA: col(strata[0]),
    strataB: col(strata[1]),
    strataC: col(strata[2]),
    strataD: col(strata[3] ?? strata[0]),
    strata: B.strata,
    paved: !!map.pavedMask,
    beachTop: B.beachTop,
    snowLine: B.snowLine,
    rockSlope: B.rockSlope,
    waterLevel: map.waterLevel ?? -9999,
    grassy: B.grassy ?? 1,
    uWet: makeWetUniform(),
    rockForm: map.rockForm ?? null,
    strataLUT: map.rockForm ? makeStrataTexture(map.rockForm) : null,
  };
}

interface Chunk {
  cx: number;
  cz: number;
  /** 当前所在的槽位（哪一批、哪个实例） */
  slot: Slot | null;
  lod: number;
  center: THREE.Vector3;
  minY: number;
  maxY: number;
}

export class TerrainView {
  readonly group = new THREE.Group();
  material: THREE.MeshStandardNodeMaterial;
  private hf: Heightfield;
  private chunks: Chunk[] = [];
  private cache = new Map<string, THREE.BufferGeometry>();
  private indexByLod: THREE.BufferAttribute[] = [];
  private nChunks: number;
  /** 近景、中景、远景三批（下标 = 细节级别，LOD3 和 LOD2 同一批） */
  private batches: ChunkBatch[] = [];
  lodScale = 1;
  shadowRange = 300;
  private far: THREE.Mesh | null = null;

  constructor(map: MapDef, hf: Heightfield, private readonly uniforms: TerrainUniforms) {
    this.hf = hf;
    this.material = makeTerrainMaterial(uniforms);
    this.nChunks = Math.round((hf.res - 1) / CH);
    for (let l = 0; l < LOD_STEPS.length; l++) this.indexByLod.push(this.buildIndex(CH / LOD_STEPS[l]));
    // 各批的槽位数：相机在任何位置时，这一级（加 10% 滞后）范围里最多有几块
    const cs = CH * hf.cell;
    const total = this.nChunks * this.nChunks;
    const within = (r: number) => {
      const k = Math.ceil(r / cs) + 1;
      let n = 0;
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) if (Math.hypot(Math.max(0, Math.abs(i) - 1), Math.max(0, Math.abs(j) - 1)) * cs < r) n++;
      return Math.min(total, n + 4);
    };
    const t0 = 360 * MAX_LOD_SCALE * 1.1;
    const near = (1 << 2) | (1 << TERRAIN_SHADOW_LAYER);
    this.batches = [
      new ChunkBatch(this.material, within(t0), chunkVerts(CH), chunkIndices(CH), true, near),
      new ChunkBatch(this.material, within(t0 * 2.4), chunkVerts(CH / 2), chunkIndices(CH / 2), true, 1 << TERRAIN_SHADOW_LAYER),
      new ChunkBatch(this.material, total, chunkVerts(CH / 4), chunkIndices(CH / 4), false, 1 << 1),
    ];
    for (const b of this.batches) this.group.add(b.mesh);
    for (let cz = 0; cz < this.nChunks; cz++) {
      for (let cx = 0; cx < this.nChunks; cx++) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (let iz = cz * CH; iz <= (cz + 1) * CH; iz += 4)
          for (let ix = cx * CH; ix <= (cx + 1) * CH; ix += 4) {
            const h = hf.grid(ix, iz);
            if (h < minY) minY = h;
            if (h > maxY) maxY = h;
          }
        const center = new THREE.Vector3(-hf.half + (cx + 0.5) * CH * hf.cell, (minY + maxY) / 2, -hf.half + (cz + 0.5) * CH * hf.cell);
        // 一开始都是最粗的一级（远景批），update 里按距离换细
        const slot = this.batches[2].take(this.geometry(cx, cz, 3));
        this.chunks.push({ cx, cz, slot, lod: 3, center, minY, maxY });
      }
    }
    this.far = this.buildFar(map);
    if (this.far) this.group.add(this.far);
  }

  /** Rebuild only the shared shader when switching photo textures on or off.
   * Geometry, LOD caches and the physical heightfield remain untouched.
   * The caller owns and releases the texture arrays after this swap.
   */
  setLayers(layers: TerrainLayers | null): void {
    if (layers === this.uniforms.layers) return;
    const next = makeTerrainMaterial({ ...this.uniforms, layers });
    const previous = this.material;
    this.material = next;
    this.uniforms.layers = layers;
    for (const b of this.batches) b.mesh.material = next;
    if (this.far) this.far.material = next;
    previous.dispose();
  }

  /**
   * h：给出时按高差选每个方格的对角线（走高差小的那条）。网格粗了以后，崖边用固定对角线会是一排锯齿，
   * 对角线顺着崖线走才是一条线。最细一级不用（要和物理地形的三角形一致）。
   */
  private buildIndex(n: number, h?: (k: number) => number): THREE.BufferAttribute {
    const idx: number[] = [];
    const v = (i: number, j: number) => j * (n + 1) + i;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = v(i, j);
        const b = v(i + 1, j);
        const c = v(i, j + 1);
        const d = v(i + 1, j + 1);
        if (h && Math.abs(h(a) - h(d)) < Math.abs(h(b) - h(c))) {
          idx.push(a, c, d);
          idx.push(a, d, b);
        } else {
          // 与 Rapier 一致的对角线：(x1,z0)-(x0,z1)
          idx.push(a, c, b);
          idx.push(b, c, d);
        }
      }
    // 裙边：每条边的顶点向下复制一份
    const base = (n + 1) * (n + 1);
    const edges: number[][] = [];
    const top: number[] = [];
    const bottom: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i <= n; i++) {
      top.push(v(i, 0));
      bottom.push(v(i, n));
      left.push(v(0, i));
      right.push(v(n, i));
    }
    edges.push(top, bottom, left, right);
    let s = base;
    edges.forEach((e, k) => {
      for (let i = 0; i < n; i++) {
        const a = e[i];
        const b = e[i + 1];
        const a2 = s + i;
        const b2 = s + i + 1;
        if (k === 0 || k === 3) idx.push(a, b, b2, a, b2, a2);
        else idx.push(a, b2, b, a, a2, b2);
      }
      s += n + 1;
    });
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }

  private geometry(cx: number, cz: number, lod: number): THREE.BufferGeometry {
    const key = `${cx}_${cz}_${lod}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const hf = this.hf;
    const step = LOD_STEPS[lod];
    const n = CH / step;
    const verts = (n + 1) * (n + 1) + 4 * (n + 1);
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const ox = cx * CH;
    const oz = cz * CH;
    let k = 0;
    const put = (ix: number, iz: number, dy: number) => {
      const h = hf.grid(ix, iz);
      pos[k * 3] = -hf.half + ix * hf.cell;
      pos[k * 3 + 1] = h - dy;
      pos[k * 3 + 2] = -hf.half + iz * hf.cell;
      const s = Math.max(1, step);
      const nx = hf.grid(ix - s, iz) - hf.grid(ix + s, iz);
      const nz = hf.grid(ix, iz - s) - hf.grid(ix, iz + s);
      const ny = 2 * s * hf.cell;
      const l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l;
      nor[k * 3 + 1] = ny / l;
      nor[k * 3 + 2] = nz / l;
      k++;
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) put(ox + i * step, oz + j * step, 0);
    const drop = 6 + step * 4;
    for (let i = 0; i <= n; i++) put(ox + i * step, oz, drop);
    for (let i = 0; i <= n; i++) put(ox + i * step, oz + CH, drop);
    for (let i = 0; i <= n; i++) put(ox, oz + i * step, drop);
    for (let i = 0; i <= n; i++) put(ox + CH, oz + i * step, drop);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(lod === 0 ? this.indexByLod[0] : this.buildIndex(n, (q) => pos[q * 3 + 1]));
    g.computeBoundingSphere();
    this.cache.set(key, g);
    return g;
  }

  /** 每帧调用：按距离选择 LOD（带滞后），每帧最多新建若干块几何。 */
  update(cam: THREE.Vector3): void {
    let builds = 0;
    const t0 = 360 * this.lodScale;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(cam.x - c.center.x) - CH * this.hf.cell * 0.5);
      const dz = Math.max(0, Math.abs(cam.z - c.center.z) - CH * this.hf.cell * 0.5);
      const dy = Math.max(0, cam.y - c.maxY) * 0.5;
      const d = Math.hypot(dx, dz, dy);
      let want = d < t0 ? 0 : d < t0 * 2.4 ? 1 : d < t0 * 5 ? 2 : 3;
      if (want > c.lod && d < (want === 1 ? t0 : want === 2 ? t0 * 2.4 : t0 * 5) * 1.1) want = c.lod;
      if (want !== c.lod) {
        const key = `${c.cx}_${c.cz}_${want}`;
        if (!this.cache.has(key)) {
          if (builds >= 3) continue;
          builds++;
        }
        // 换到新一级那一批的空槽位（槽位按最远的切换距离留够了；万一用完，这块先留在原来的级别）
        const slot = this.batches[Math.min(2, want)].take(this.geometry(c.cx, c.cz, want));
        if (!slot) continue;
        if (c.slot) c.slot.batch.release(c.slot);
        c.slot = slot;
        c.lod = want;
      }
      // 投影：LOD0 进最近两层和第三层阴影，LOD1 只进第三层，LOD2/3 不投影（三批各自的图层，见构造函数）。
      // 地形只进前三层阴影：最远一层里只有镜头附近的地形块投影，影子落到一两公里外的山坡上是一条条古怪的直线。
      // 山的大影子由山影贴图负责（见 sunMap.ts）。阴影范围外的块由阴影相机的视锥剔掉。
    }
    // 回收：远处的高精度块
    if (this.cache.size > 900) {
      for (const [key, g] of this.cache) {
        const [cx, cz, lod] = key.split('_').map(Number);
        const ch = this.chunks[cz * this.nChunks + cx];
        if (lod < 3 && ch.lod !== lod) {
          g.dispose();
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * 地图外围远景（不碰撞）：边缘高度向外延伸并逐渐过渡到 farTerrain。
   * 网格线靠近地图的地方密（约 24 m）、越远越稀（每格放大一点），这样几公里外的山也有山脊和岩棱，
   * 而不是 100 多米一格的光滑馒头；总顶点数比等距网格还少。
   */
  private buildFar(map: MapDef): THREE.Mesh | null {
    const hf = this.hf;
    const extent = hf.size * (map.farExtent ?? 6);
    const heightAt = (x: number, z: number) => farHeightAt(map, hf, x, z);
    const rich = !!map.farTerrain;
    const inner: number[] = [];
    const innerStep = rich ? 32 : 64;
    for (let x = -hf.half; x <= hf.half + 1e-3; x += innerStep) inner.push(x);
    const outer: number[] = [];
    let d = rich ? 24 : 48;
    let x = hf.half;
    while (x < extent) {
      x += d;
      // 离地图两三公里以内细一些，再往外是几乎看不清的远山和地平线
      d *= x < hf.half + 2600 ? (rich ? 1.02 : 1.05) : 1.07;
      outer.push(x);
    }
    const xs = [...outer.map((v) => -v).reverse(), ...inner, ...outer];
    const n = xs.length;
    // 网格的外缘收成圆的：方的话飞高了能看到地平线上有四个角
    const edgeR = xs[n - 1];
    const fold = (v: number, w: number): number => {
      const r = Math.hypot(v, w);
      return r > edgeR ? (v * edgeR) / r : v;
    };
    const H = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = heightAt(fold(xs[i], xs[j]), fold(xs[j], xs[i]));
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(n - 1, j + 1);
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(n - 1, i + 1);
        const k = (j * n + i) * 3;
        pos[k] = fold(xs[i], xs[j]);
        pos[k + 1] = H[j * n + i];
        pos[k + 2] = fold(xs[j], xs[i]);
        const gx = (H[j * n + i1] - H[j * n + i0]) / (xs[i1] - xs[i0]);
        const gz = (H[j1 * n + i] - H[j0 * n + i]) / (xs[j1] - xs[j0]);
        const l = 1 / Math.hypot(gx, 1, gz);
        nor[k] = -gx * l;
        nor[k + 1] = l;
        nor[k + 2] = -gz * l;
      }
    }
    const idx: number[] = [];
    const lim = hf.half - innerStep * 0.5;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        if (xs[i] > -lim && xs[i + 1] < lim && xs[j] > -lim && xs[j + 1] < lim) continue;
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    // 远景本来落不进阴影范围，但开着接收阴影才能和近处地形共用一份着色器（这么大的着色器多一个变体要多编译好几秒）
    m.receiveShadow = true;
    return m;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
    for (const b of this.batches) b.mesh.dispose();
    for (const c of this.chunks) c.slot = null;
    this.far?.geometry.dispose();
    this.material.dispose();
  }
}
