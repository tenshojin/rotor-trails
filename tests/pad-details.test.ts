import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { PadDetails } from '../src/render/padDetails';
import { loadGltf } from '../src/render/gltf';
import { TRAINING } from '../src/maps/training';

vi.mock('../src/render/gltf', () => ({ loadGltf: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.mocked(loadGltf).mockReset(); });

function model(names = ['lamp_housing', 'lamp_lens', 'tie_ring']) {
  const scene = new THREE.Group();
  for (const name of names) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
    mesh.name = name;
    scene.add(mesh);
  }
  return { scene } as unknown as GLTF;
}

function watch(resources: THREE.Object3D[]) {
  return resources.flatMap((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    return [mesh.geometry, mesh.material].map((resource) => {
      const dispose = vi.fn();
      resource.addEventListener('dispose', dispose);
      return dispose;
    });
  });
}

describe('helipad fixture asset ownership', () => {
  it('late decoding after map unload disposes the asset without reattaching anything', async () => {
    let finish!: (gltf: GLTF) => void;
    vi.mocked(loadGltf).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const detail = new PadDetails(TRAINING);
    const fallbackDisposed = watch(detail.group.children);
    const gltf = model();
    const assetDisposed = watch(gltf.scene.children);
    detail.dispose();
    finish(gltf);
    await detail.ready;
    expect(detail.group.children).toHaveLength(0);
    expect(detail.loaded).toBe(false);
    for (const disposed of [...fallbackDisposed, ...assetDisposed]) expect(disposed).toHaveBeenCalledOnce();
  });

  it('valid model replaces the fallback with exactly three batches and keeps current lamp brightness', async () => {
    let finish!: (gltf: GLTF) => void;
    vi.mocked(loadGltf).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const detail = new PadDetails(TRAINING);
    const fallbackDisposed = watch(detail.group.children);
    detail.update(1);
    const gltf = model();
    const assetDisposed = watch(gltf.scene.children);
    finish(gltf);
    await detail.ready;
    expect(detail.loaded).toBe(true);
    expect(detail.group.children).toHaveLength(3);
    expect(detail.group.children.every((m) => (m as THREE.InstancedMesh).isInstancedMesh)).toBe(true);
    const lens = detail.group.getObjectByName('lamp_lens') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(lens.material.emissiveIntensity).toBeCloseTo(2.32);
    for (const disposed of fallbackDisposed) expect(disposed).toHaveBeenCalledOnce();
    for (const disposed of assetDisposed) expect(disposed).not.toHaveBeenCalled();
    detail.dispose();
    detail.dispose();
    for (const disposed of assetDisposed) expect(disposed).toHaveBeenCalledOnce();
  });

  it('malformed model releases decoded resources and retains the working built-in fixtures', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gltf = model(['lamp_housing']);
    const assetDisposed = watch(gltf.scene.children);
    vi.mocked(loadGltf).mockResolvedValueOnce(gltf);
    const detail = new PadDetails(TRAINING);
    await detail.ready;
    expect(detail.loaded).toBe(false);
    expect(detail.group.children).toHaveLength(3);
    for (const disposed of assetDisposed) expect(disposed).toHaveBeenCalledOnce();
    detail.dispose();
  });
});
