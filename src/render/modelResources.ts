import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';
import { disposeTextures } from './disposeTextures';

/** Capture an exclusively owned loaded model before replacing materials or moving
 * its children. Never traverse the eventual scene parent: it can also contain
 * borrowed objects (including Sprite's globally shared geometry).
 */
export function modelResources(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as Texture)?.isTexture) textures.add(value as Texture);
    }
  });
  return {
    geometries, materials, textures,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      disposeTextures(textures);
      geometries.clear();
      materials.clear();
      textures.clear();
    },
  };
}
