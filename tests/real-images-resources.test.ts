import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { loadRealImages } from '../src/render/realImages';
import type { RealTerrainDef } from '../src/maps/types';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const def = { base: 'real/', levels: [{ image: 'one.webp' }, { image: 'two.webp' }] } as RealTerrainDef;

describe('aerial imagery batch ownership', () => {
  it('releases successful textures even when they arrive after a failed sibling', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    const texture = new THREE.Texture<HTMLImageElement>();
    const dispose = vi.spyOn(texture, 'dispose');
    let resolve!: (t: THREE.Texture<HTMLImageElement>) => void;
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = loadRealImages(def, 4);
    const check = expect(pending).rejects.toThrow('offline');
    await Promise.resolve();
    resolve(texture);
    await check;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('preserves ordered successful images and transfers ownership to the map', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    const images = [new THREE.Texture<HTMLImageElement>(), new THREE.Texture<HTMLImageElement>()];
    const disposes = images.map((t) => vi.spyOn(t, 'dispose'));
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValueOnce(images[0]).mockResolvedValueOnce(images[1]);
    expect(await loadRealImages(def, 4)).toEqual(images);
    for (const t of images) { expect(t.flipY).toBe(false); expect(t.anisotropy).toBe(4); }
    for (const dispose of disposes) expect(dispose).not.toHaveBeenCalled();
    images.forEach((t) => t.dispose());
  });
});
