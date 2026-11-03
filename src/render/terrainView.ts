// 地形渲染：按块（64 格）分级 LOD，近处使用与碰撞完全一致的全分辨率三角网格；
// 着色器按坡度/高度/掩码混合沙滩、草地、裸土、岩石（含岩层条带）、积雪与森林地面。

import * as THREE from 'three';
import type { BiomeDef, MapDef } from '../maps/types';
import type { Heightfield } from '../sim/terrain';
import { getNoiseTexture } from './textures';

const CH = 64;
const LOD_STEPS = [1, 2, 4, 8];

export interface TerrainUniforms {
  [k: string]: THREE.IUniform;
}

function col(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

export function makeTerrainUniforms(map: MapDef, surfaceTex: THREE.Texture, forestTex: THREE.Texture): TerrainUniforms {
  const B: BiomeDef = map.biome;
  const strata = B.strataColors ?? [B.rock, B.rock2, B.dirt, B.sand];
  return {
    uNoise: { value: getNoiseTexture() },
    uSurface: { value: surfaceTex },
    uForest: { value: forestTex },
    uMapSize: { value: map.size },
    uSand: { value: col(B.sand) },
    uGrass: { value: col(B.grass) },
    uGrass2: { value: col(B.grass2) },
    uDirt: { value: col(B.dirt) },
    uRock: { value: col(B.rock) },
    uRock2: { value: col(B.rock2) },
    uSnow: { value: col(B.snow) },
    uForestFloor: { value: col(B.forestFloor) },
    uStrataA: { value: col(strata[0]) },
    uStrataB: { value: col(strata[1]) },
    uStrataC: { value: col(strata[2]) },
    uStrataD: { value: col(strata[3] ?? strata[0]) },
    uStrata: { value: B.strata },
    uBeachTop: { value: B.beachTop },
    uSnowLine: { value: B.snowLine },
    uRockSlope: { value: B.rockSlope },
    uWet: { value: 0 },
    uWaterLevel: { value: map.waterLevel ?? -9999 },
  };
}

/** 给 MeshStandardMaterial 注入地形着色。 */
export function patchTerrainMaterial(mat: THREE.MeshStandardMaterial, uniforms: TerrainUniforms): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uNoise;
uniform sampler2D uSurface;
uniform sampler2D uForest;
uniform float uMapSize;
uniform vec3 uSand, uGrass, uGrass2, uDirt, uRock, uRock2, uSnow, uForestFloor;
uniform vec3 uStrataA, uStrataB, uStrataC, uStrataD;
uniform float uStrata, uBeachTop, uSnowLine, uRockSlope, uWet, uWaterLevel;
float tRough = 0.95;
float tBump = 0.0;
vec3 strataColor(float y) {
  float t = fract(y / 46.0);
  float b = fract(y / 11.0);
  vec3 c = mix(uStrataA, uStrataB, smoothstep(0.15, 0.35, t));
  c = mix(c, uStrataC, smoothstep(0.45, 0.6, t));
  c = mix(c, uStrataD, smoothstep(0.75, 0.9, t));
  return c * (0.88 + 0.24 * b);
}
vec3 terrainAlbedo() {
  vec3 n = normalize(vWNrm);
  float slope = 1.0 - n.y;
  float h = vWPos.y;
  vec2 muv = vWPos.xz / uMapSize + 0.5;
  vec4 surf = texture2D(uSurface, muv);
  float forest = texture2D(uForest, muv).r;
  float n1 = texture2D(uNoise, vWPos.xz * 0.0021).r;
  float n2 = texture2D(uNoise, vWPos.xz * 0.019).g;
  float n3 = texture2D(uNoise, vWPos.xz * 0.045 + 0.37).g;
  vec3 c = mix(uGrass, uGrass2, smoothstep(0.35, 0.65, n1));
  c = mix(c, uForestFloor, clamp(forest * 1.3, 0.0, 0.85));
  float sandW = 1.0 - smoothstep(uBeachTop - 0.5, uBeachTop + 2.0, h + (n2 - 0.5) * 2.5);
  sandW = max(sandW, surf.r);
  c = mix(c, uSand, sandW);
  c = mix(c, uDirt, surf.g * 0.9);
  // 三平面采样的岩石细节
  vec3 an = abs(n);
  an /= (an.x + an.y + an.z);
  float rx = texture2D(uNoise, vWPos.zy * 0.045).g;
  float rz = texture2D(uNoise, vWPos.xy * 0.045).g;
  float ry = texture2D(uNoise, vWPos.xz * 0.045).g;
  float rk = rx * an.x + rz * an.z + ry * an.y;
  vec3 rock = mix(uRock, uRock2, smoothstep(0.3, 0.7, rk));
  if (uStrata > 0.0) rock = mix(rock, strataColor(h + (n1 - 0.5) * 18.0), uStrata * (0.6 + 0.4 * an.x + 0.4 * an.z));
  float rockW = smoothstep(uRockSlope - 0.07, uRockSlope + 0.06, slope + (n1 - 0.5) * 0.14);
  c = mix(c, rock, rockW);
  float snowW = smoothstep(uSnowLine - 50.0, uSnowLine + 30.0, h + (n1 - 0.5) * 90.0) * (1.0 - smoothstep(0.42, 0.62, slope));
  snowW = max(snowW, surf.a * (1.0 - smoothstep(0.55, 0.8, slope)));
  c = mix(c, uSnow, snowW);
  // 水下：变暗偏蓝绿
  float under = smoothstep(uWaterLevel + 0.3, uWaterLevel - 2.0, h);
  c = mix(c, c * vec3(0.55, 0.7, 0.72), under);
  float wet = uWet * (1.0 - snowW);
  c *= mix(1.0, 0.68, wet);
  c *= 0.86 + 0.28 * n2;
  c *= 0.93 + 0.14 * n3;
  tRough = mix(mix(0.96, 0.88, rockW), 0.55, wet * 0.7);
  tRough = mix(tRough, 0.7, snowW);
  tBump = mix(0.25, 1.0, rockW) * (1.0 - snowW * 0.6);
  return c;
}`,
      )
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= terrainAlbedo();')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tRough;')
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  float hb = texture2D(uNoise, vWPos.xz * 0.05).g * 0.6 + texture2D(uNoise, vWPos.xz * 0.17 + 0.5).g * 0.4;
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(hb);
  float dhy = dFdy(hb);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * 1.2 * tBump);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
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
  readonly material: THREE.MeshStandardMaterial;
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
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    patchTerrainMaterial(this.material, uniforms);
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
    const extent = S * 1.6;
    const step = 96;
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
