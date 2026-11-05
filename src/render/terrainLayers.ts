// 地形照片材质（Poly Haven CC0，见 tools/prep_terrain.py）：每张地图 8 层——
// 草地、草地 2、林地、沙/河岸、泥土、岩石、岩石 2、积雪——打包成两张纹理数组（颜色；法线 XY + 粗糙度）。
// 加载失败时返回 null，地形着色退回程序化配色。

import * as THREE from 'three';
import type { BiomeDef, MapId } from '../maps/types';
import { loadBitmapBatch } from './bitmapBatch';

export const SLOTS = 8;

const DEFAULT = ['aerial_grass_rock', 'rocky_terrain_02', 'forest_ground_04', 'coast_sand_01', 'brown_mud_02', 'cliff_side', 'mossy_rock', 'snow_field_aerial'];
const BY_MAP: Partial<Record<MapId, string[]>> = {
  canyon: ['dry_ground_01', 'cracked_red_ground', 'gravelly_sand', 'gravelly_sand', 'cracked_red_ground', 'cliff_side', 'rock_face', 'snow_field_aerial'],
  amazon: ['rocky_terrain_02', 'aerial_grass_rock', 'forest_leaves_02', 'brown_mud_02', 'red_laterite_soil_stones', 'cliff_side', 'mossy_rock', 'snow_field_aerial'],
  fjord: ['rocky_terrain_02', 'aerial_grass_rock', 'forest_ground_04', 'gravelly_sand', 'brown_mud_02', 'cliff_side', 'rock_face', 'snow_field_aerial'],
  himalaya: ['rocky_terrain_02', 'aerial_rocks_02', 'forest_ground_04', 'gravelly_sand', 'gravelly_sand', 'cliff_side', 'aerial_rocks_02', 'snow_field_aerial'],
};

/** 各层向地图原有配色靠拢的程度（保留照片的明暗细节，色相取地图配色） */
const TINT_K = [0.72, 0.6, 0.6, 0.6, 0.55, 0.86, 0.7, 0.55];

export interface TerrainLayers {
  color: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  tiles: number[];
  /** 各层平均颜色的亮度（线性） */
  meanLum: number[];
  biome: THREE.Color[];
  tintK: number[];
}

type Manifest = Record<string, { mean: number[]; tile: number }>;
let manifestP: Promise<Manifest> | null = null;

function url(p: string): string {
  return new URL(p, document.baseURI).href;
}

function arrayTexture(size: number, srgb: boolean): { tex: THREE.DataArrayTexture; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4 * SLOTS);
  const tex = new THREE.DataArrayTexture(data, size, size, SLOTS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return { tex, data };
}

export async function loadTerrainLayers(mapId: MapId, biome: BiomeDef, size: number): Promise<TerrainLayers | null> {
  let images: ImageBitmap[] = [];
  let color: THREE.DataArrayTexture | null = null;
  let normal: THREE.DataArrayTexture | null = null;
  try {
    manifestP ??= fetch(url('textures/terrain/manifest.json'))
      .then((r) => {
        if (!r.ok) throw new Error('manifest HTTP ' + r.status);
        return r.json() as Promise<Manifest>;
      })
      .catch((error) => {
        // A temporary failure must not force every later map to use fallback art.
        manifestP = null;
        throw error;
      });
    const manifest = await manifestP;
    const ids = BY_MAP[mapId] ?? DEFAULT;
    const unique = [...new Set(ids)];
    const imgs = new Map<string, [ImageBitmap, ImageBitmap]>();
    images = await loadBitmapBatch(unique.flatMap((id) => [`textures/terrain/${id}_c.webp`, `textures/terrain/${id}_n.webp`]));
    unique.forEach((id, i) => imgs.set(id, [images[i * 2], images[i * 2 + 1]]));
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const C = arrayTexture(size, true);
    color = C.tex;
    const N = arrayTexture(size, false);
    normal = N.tex;
    const layer = size * size * 4;
    ids.forEach((id, i) => {
      const [c, n] = imgs.get(id)!;
      g.drawImage(c, 0, 0, size, size);
      C.data.set(g.getImageData(0, 0, size, size).data, i * layer);
      g.drawImage(n, 0, 0, size, size);
      N.data.set(g.getImageData(0, 0, size, size).data, i * layer);
    });
    C.tex.needsUpdate = true;
    N.tex.needsUpdate = true;
    const lum = (m: number[]) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    const hex = [biome.grass, biome.grass2, biome.forestFloor, biome.sand, biome.dirt, biome.rock, biome.rock2, biome.snow];
    return {
      color: C.tex,
      normal: N.tex,
      tiles: ids.map((id) => manifest[id]?.tile ?? 8),
      meanLum: ids.map((id) => Math.max(0.01, lum(manifest[id]?.mean ?? [0.2, 0.2, 0.2]))),
      biome: hex.map((h) => new THREE.Color().setHex(h)),
      tintK: TINT_K,
    };
  } catch (e) {
    color?.dispose();
    normal?.dispose();
    console.warn('地形照片材质加载失败，使用程序化配色：', e);
    return null;
  } finally {
    for (const image of images) image.close();
  }
}
