// 地形渲染：按块（64 格）分级 LOD，近处使用与碰撞完全一致的全分辨率三角网格；
// 着色器见 terrainShader.ts（照片材质 8 层混合，按坡度/高度/掩码）。

import * as THREE from 'three/webgpu';
import type { BiomeDef, MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import type { TerrainLayers } from './terrainLayers';
import { makeTerrainMaterial, makeWetUniform, type TerrainUniforms } from './terrainShader';
import { getNoiseTexture } from './textures';
import { getRockReliefTexture } from './terrainMacro';

const CH = 64;
const LOD_STEPS = [1, 2, 4, 8];

export type { TerrainUniforms };

function col(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

export function makeTerrainUniforms(map: MapDef, surfaceTex: THREE.Texture, forestTex: THREE.Texture, macroTex: THREE.Texture, layers: TerrainLayers | null = null): TerrainUniforms {
  const B: BiomeDef = map.biome;
  const strata = B.strataColors ?? [B.rock, B.rock2, B.dirt, B.sand];
  return {
    noise: getNoiseTexture(),
    surface: surfaceTex,
    forest: forestTex,
    macro: macroTex,
    relief: getRockReliefTexture(),
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
    uWet: makeWetUniform(),
  };
}

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  lod: number;
  center: THREE.Vector3;
  minY: number;
  maxY: number;
}

export class TerrainView {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardNodeMaterial;
  private hf: Heightfield;
  private chunks: Chunk[] = [];
  private cache = new Map<string, THREE.BufferGeometry>();
  private indexByLod: THREE.BufferAttribute[] = [];
  private nChunks: number;
  lodScale = 1;
  shadowRange = 300;
  private far: THREE.Mesh | null = null;

  constructor(map: MapDef, hf: Heightfield, uniforms: TerrainUniforms) {
    this.hf = hf;
    this.material = makeTerrainMaterial(uniforms);
    this.nChunks = Math.round((hf.res - 1) / CH);
    for (let l = 0; l < LOD_STEPS.length; l++) this.indexByLod.push(this.buildIndex(CH / LOD_STEPS[l]));
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
        const mesh = new THREE.Mesh(this.geometry(cx, cz, 3), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ cx, cz, mesh, lod: 3, center, minY, maxY });
      }
    }
    this.far = this.buildFar(map);
    if (this.far) this.group.add(this.far);
  }

  private buildIndex(n: number): THREE.BufferAttribute {
    const idx: number[] = [];
    const v = (i: number, j: number) => j * (n + 1) + i;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        // 与 Rapier 一致的对角线：(x1,z0)-(x0,z1)
        idx.push(v(i, j), v(i, j + 1), v(i + 1, j));
        idx.push(v(i + 1, j), v(i, j + 1), v(i + 1, j + 1));
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
    g.setIndex(this.indexByLod[lod]);
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
        c.mesh.geometry = this.geometry(c.cx, c.cz, want);
        c.lod = want;
      }
      c.mesh.castShadow = d < this.shadowRange && c.lod <= 1;
      // 较粗的地形块离镜头至少几百米，不会落进最近两层阴影（图层 1）；最细的一级带图层 0 + 2
      c.mesh.layers.mask = c.lod >= 1 ? 1 << 1 : (1 << 0) | (1 << 2);
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

  /** 地图外围远景（不碰撞）：边缘高度向外延伸并逐渐过渡到 farTerrain。 */
  private buildFar(map: MapDef): THREE.Mesh | null {
    const hf = this.hf;
    const S = hf.size;
    const extent = S * (map.farExtent ?? 1.6);
    const step = map.farExtent ? 128 : 96;
    const n = Math.ceil((extent * 2) / step);
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const heightAt = (x: number, z: number) => {
      const cx = Math.max(-hf.half, Math.min(hf.half, x));
      const cz = Math.max(-hf.half, Math.min(hf.half, z));
      const edge = hf.heightAt(cx, cz);
      const out = Math.max(Math.abs(x) - hf.half, Math.abs(z) - hf.half, 0);
      const t = Math.min(1, out / 900);
      const farH = map.farTerrain ? map.farTerrain(x, z) : edge;
      return edge + (farH - edge) * t * t * (3 - 2 * t) - 2 - Math.min(6, out * 0.02);
    };
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const x = -extent + i * step;
        const z = -extent + j * step;
        pos.push(x, heightAt(x, z), z);
        const e = step;
        const nx = heightAt(x - e, z) - heightAt(x + e, z);
        const nz = heightAt(x, z - e) - heightAt(x, z + e);
        const l = Math.hypot(nx, 2 * e, nz);
        nor.push(nx / l, (2 * e) / l, nz / l);
      }
    const inner = hf.half - step * 0.5;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x0 = -extent + i * step;
        const z0 = -extent + j * step;
        if (x0 > -inner && x0 + step < inner && z0 > -inner && z0 + step < inner) continue;
        const a = j * (n + 1) + i;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = false;
    return m;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
    for (const c of this.chunks) c.mesh.geometry = new THREE.BufferGeometry();
    this.far?.geometry.dispose();
    this.material.dispose();
  }
}
