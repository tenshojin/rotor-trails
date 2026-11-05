import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TRAINING } from '../src/maps/training';
import { loadTerrainLayers } from '../src/render/terrainLayers';
import { loadDetailTextures } from '../src/render/detailTextures';
import { loadRockRelief, getRockReliefTexture } from '../src/render/terrainMacro';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function canvasDocument(read: () => { data: Uint8ClampedArray }): void {
  vi.stubGlobal('document', {
    baseURI: 'https://example.test/rotor/',
    createElement: () => ({ getContext: () => ({ drawImage: vi.fn(), getImageData: read }) }),
  });
}

describe('texture load recovery', () => {
  it('closes failed relief decodes, retries, and updates the existing fallback texture in place', async () => {
    canvasDocument(() => { throw new Error('pixel read failed'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal('fetch', fetch);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close })));
    await loadRockRelief();
    expect(close).toHaveBeenCalledOnce();
    const fallback = getRockReliefTexture();
    const version = fallback.version;
    const pixels = new Uint8ClampedArray(2 * 2 * 4).fill(127);
    canvasDocument(() => ({ data: pixels }));
    await loadRockRelief();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(getRockReliefTexture()).toBe(fallback);
    expect(fallback.image.data).toEqual(new Uint8Array(pixels));
    expect(fallback.version).toBeGreaterThan(version);
    await loadRockRelief();
    expect(fetch).toHaveBeenCalledTimes(2);
    fallback.dispose();
  });

  it('retries a transient terrain manifest failure, then closes all decoded images', async () => {
    canvasDocument(() => ({ data: new Uint8ClampedArray(2 * 2 * 4) }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let manifests = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) {
        manifests++;
        return manifests === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({}) };
      }
      return { ok: true, blob: async () => new Blob() };
    }));
    const images: { close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      const image = { close: vi.fn() };
      images.push(image);
      return image;
    }));
    expect(await loadTerrainLayers('japan', TRAINING.biome, 2)).toBeNull();
    const layers = await loadTerrainLayers('japan', TRAINING.biome, 2);
    expect(layers?.color.image.data?.length).toBe(2 * 2 * 4 * 8);
    expect(manifests).toBe(2);
    expect(images).toHaveLength(16);
    for (const image of images) expect(image.close).toHaveBeenCalledOnce();
    layers?.color.dispose();
    layers?.normal.dispose();
  });

  it('frees partially built terrain arrays when canvas pixel extraction fails', async () => {
    canvasDocument(() => { throw new Error('cannot read image'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}), blob: async () => new Blob() })));
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    expect(await loadTerrainLayers('japan', TRAINING.biome, 2)).toBeNull();
    expect(close).toHaveBeenCalledTimes(16);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('retries failed detail textures and keeps the successful shared atlas cached', async () => {
    canvasDocument(() => ({ data: new Uint8ClampedArray(512 * 512 * 4) }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
    expect(await loadDetailTextures()).toBeNull();
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const atlas = await loadDetailTextures();
    expect(atlas?.image.depth).toBe(5);
    expect(await loadDetailTextures()).toBe(atlas);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(close).toHaveBeenCalledTimes(5);
    atlas?.dispose();
  });
});
