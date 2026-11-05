import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { loadBitmapBatch } from '../src/render/bitmapBatch';
import { disposeTextures } from '../src/render/disposeTextures';
import { buildPost } from '../src/render/post';
import type { SunShadows } from '../src/render/sunShadows';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('decoded texture ownership', () => {
  it('closes successful decodes even when a sibling fails before they finish', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/rotor/' });
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    let finish!: (response: Response) => void;
    const slow = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('slow.webp')
      ? slow : Promise.resolve({ ok: false, status: 503 })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => image));
    const batch = loadBitmapBatch(['failed.webp', 'slow.webp']);
    const result = expect(batch).rejects.toThrow('HTTP 503');
    finish({ ok: true, blob: async () => new Blob() } as Response);
    await result;
    expect(image.close).toHaveBeenCalledOnce();
  });

  it('keeps successful images open until their pixel data is copied by the caller', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/rotor/' });
    const images = [{ close: vi.fn() }, { close: vi.fn() }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(images[0]).mockResolvedValueOnce(images[1]));
    expect(await loadBitmapBatch(['color.webp', 'normal.webp'])).toEqual(images);
    for (const image of images) expect(image.close).not.toHaveBeenCalled();
  });

  it('releases shared GLTF images once while disposing each owned GPU texture', () => {
    const image = { close: vi.fn() };
    const a = new THREE.Texture(image as unknown as ImageBitmap);
    const b = a.clone();
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    a.addEventListener('dispose', disposeA);
    b.addEventListener('dispose', disposeB);
    disposeTextures([a, a, b]);
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(image.close).toHaveBeenCalledOnce();
  });
});

describe('post processing ownership', () => {
  it('releases the final pipeline material and the implicit FXAA input target', () => {
    const renderer = { toneMapping: THREE.NeutralToneMapping, outputColorSpace: THREE.SRGBColorSpace } as THREE.WebGPURenderer;
    const shadows = { light: new THREE.DirectionalLight() } as SunShadows;
    const post = buildPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), shadows, { quality: 'low', rayTracing: false });
    const pipeline = post.pipeline as unknown as { _quadMesh: THREE.QuadMesh; outputNode: { textureNode: THREE.RTTNode } };
    const materialDisposed = vi.fn();
    const inputDisposed = vi.fn();
    (pipeline._quadMesh.material as THREE.Material).addEventListener('dispose', materialDisposed);
    pipeline.outputNode.textureNode.renderTarget!.addEventListener('dispose', inputDisposed);
    post.dispose();
    post.dispose();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(inputDisposed).toHaveBeenCalledOnce();
  });
});
