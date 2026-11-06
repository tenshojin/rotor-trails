// 真实地形的航拍影像：每层一张 WebP，第一行是北边。
import * as THREE from 'three/webgpu';
import type { RealTerrainDef } from '../maps/types';
import type { RealData } from '../world/realData';
import type { FarGrid } from './sunMap';

export async function loadRealImages(def: RealTerrainDef, anisotropy: number): Promise<THREE.Texture[]> {
  const loader = new THREE.TextureLoader();
  return Promise.all(
    def.levels.map(async (l) => {
      const t = await loader.loadAsync(new URL(def.base + l.image, document.baseURI).href);
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    }),
  );
}

/** 岩层色表：一行像素，左边低、右边高 */
export async function loadStrata(def: RealTerrainDef): Promise<THREE.Texture | null> {
  if (!def.strata) return null;
  const t = await new THREE.TextureLoader().loadAsync(new URL(def.base + def.strata.image, document.baseURI).href);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  // 细的层理写在贴图里，远处靠 mipmap 平均掉
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 辅助图：不是颜色，不做 sRGB 转换 */
export async function loadAux(def: RealTerrainDef, file = def.aux): Promise<THREE.Texture | null> {
  if (!file) return null;
  const t = await new THREE.TextureLoader().loadAsync(new URL(def.base + file, document.baseURI).href);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 最外一层的高程给阳光算山影：太阳低的时候光是从几十公里外的山背后过来的 */
export function realFarGrid(real: RealData): FarGrid {
  const g = real.levels[real.levels.length - 1];
  return { h: g.data, res: g.res, size: g.size };
}
