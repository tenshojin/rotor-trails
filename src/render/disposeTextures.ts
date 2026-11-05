import type { Texture } from 'three';

/** Release both GPU textures and GLTFLoader's decoded ImageBitmaps.
 * Materials and cloned textures can share one image, so close each image once.
 * Only use this for a library that owns its images, never borrowed global textures.
 */
export function disposeTextures(textures: Iterable<Texture>): void {
  const images = new Set<ImageBitmap>();
  for (const texture of new Set(textures)) {
    texture.dispose();
    const image: unknown = texture.source.data;
    if (image && typeof (image as ImageBitmap).close === 'function') images.add(image as ImageBitmap);
  }
  for (const image of images) image.close();
}
