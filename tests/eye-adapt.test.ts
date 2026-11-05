import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { EyeAdapt } from '../src/render/eyeAdapt';

function pendingRead(eye: EyeAdapt): { complete: () => void; sample: () => void } {
  let resolve!: (pixels: Uint8Array) => void;
  const pixels = new Promise<Uint8Array>((r) => { resolve = r; });
  const renderer = { getRenderTarget: () => null, setRenderTarget: vi.fn(), readRenderTargetPixelsAsync: () => pixels } as unknown as THREE.WebGPURenderer;
  const quad = (eye as unknown as { quad: THREE.QuadMesh }).quad;
  quad.render = vi.fn();
  const tex = new THREE.Texture();
  return {
    complete: () => resolve(new Uint8Array(64 * 4).fill(128)),
    sample: () => { for (let i = 0; i < 5; i++) eye.sample(renderer, tex); },
  };
}

describe('exposure readback lifetime', () => {
  it('ignores a readback from before a map or lighting transition', async () => {
    const eye = new EyeAdapt();
    const read = pendingRead(eye);
    read.sample();
    eye.snap();
    read.complete();
    await Promise.resolve();
    expect(eye.luma).toBe(0);
    expect(eye.value).toBe(1);
    eye.dispose();
  });

  it('ignores a readback that completes after disposal', async () => {
    const eye = new EyeAdapt();
    const read = pendingRead(eye);
    read.sample();
    eye.dispose();
    read.complete();
    await Promise.resolve();
    expect(eye.luma).toBe(0);
  });

  it('still applies a current, successful exposure readback', async () => {
    const eye = new EyeAdapt();
    const read = pendingRead(eye);
    read.sample();
    read.complete();
    await Promise.resolve();
    expect(eye.luma).toBeGreaterThan(0);
    expect(eye.value).not.toBe(1);
    eye.dispose();
  });
});
