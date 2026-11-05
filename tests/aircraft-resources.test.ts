import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HeliModel } from '../src/render/heliModel';
import { Cockpit } from '../src/render/cockpit';
import { loadGltf } from '../src/render/gltf';
import { getGlowTexture } from '../src/render/propsView';
import { getNoiseTexture } from '../src/render/textures';

vi.mock('../src/render/gltf', () => ({ loadGltf: vi.fn() }));
vi.mock('../src/render/propsView', async () => {
  const { Texture } = await import('three/webgpu');
  const glow = new Texture();
  return { getGlowTexture: () => glow };
});
vi.mock('../src/render/textures', async () => {
  const { Texture } = await import('three/webgpu');
  const noise = new Texture();
  return { getNoiseTexture: () => noise };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function watch(resource: { addEventListener(type: 'dispose', listener: () => void): void }) {
  const disposed = vi.fn();
  resource.addEventListener('dispose', disposed);
  return disposed;
}

function loadedModel() {
  const close = vi.fn();
  const image = { close };
  const map = new THREE.Texture(image as never);
  const emissiveMap = new THREE.Texture(image as never);
  const material = new THREE.MeshStandardMaterial({ map, emissiveMap });
  const geometry = new THREE.BoxGeometry();
  const scene = new THREE.Group();
  for (const name of ['ext_body', 'main_rotor', 'tail_rotor']) {
    const group = new THREE.Group();
    group.name = name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name === 'main_rotor' ? 'blades_fixture' : 'fixture';
    group.add(mesh);
    scene.add(group);
  }
  return { gltf: { scene } as unknown as GLTF, geometry, material, map, emissiveMap, close };
}

beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('aircraft exterior lifetime', () => {
  it('releases a late model once without resurrecting a disposed aircraft', async () => {
    const pending = deferred<GLTF>();
    vi.mocked(loadGltf).mockReturnValueOnce(pending.promise);
    const heli = new HeliModel();
    const asset = loadedModel();
    const observers = [asset.geometry, asset.material, asset.map, asset.emissiveMap].map(watch);
    heli.dispose();
    pending.resolve(asset.gltf);
    await heli.ready;
    heli.dispose();
    expect(heli.extLoaded).toBe(false);
    expect(heli.root.children).toHaveLength(0);
    observers.forEach((disposed) => expect(disposed).toHaveBeenCalledOnce());
    expect(asset.close).toHaveBeenCalledOnce();
  });

  it('owns only its meshes and GLTF resources, leaving attached cockpit and shared sprites intact', async () => {
    const asset = loadedModel();
    vi.mocked(loadGltf).mockResolvedValueOnce(asset.gltf);
    const heli = new HeliModel();
    const procedural = heli as unknown as { blades: THREE.Mesh };
    const ownGeometryDisposed = watch(procedural.blades.geometry);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    heli.root.add(cockpit);
    const sprite = new THREE.Sprite();
    const borrowed = [cockpit.geometry, cockpit.material, sprite.geometry, getGlowTexture()];
    const borrowedObservers = borrowed.map(watch);
    const assetObservers = [asset.geometry, asset.material, asset.map, asset.emissiveMap].map(watch);
    await heli.ready;
    heli.setCockpitView(false);
    heli.update(1, 1 / 60, 0.1);
    expect(procedural.blades.visible).toBe(false);
    expect(heli.root.getObjectByName('blades_fixture')?.visible).toBe(true);
    heli.dispose();
    heli.dispose();
    expect(ownGeometryDisposed).toHaveBeenCalledOnce();
    assetObservers.forEach((disposed) => expect(disposed).toHaveBeenCalledOnce());
    borrowedObservers.forEach((disposed) => expect(disposed).not.toHaveBeenCalled());
    expect(asset.close).toHaveBeenCalledOnce();
    borrowed.forEach((resource, i) => resource.removeEventListener('dispose', borrowedObservers[i]));
    cockpit.geometry.dispose();
    cockpit.material.dispose();
    sprite.material.dispose();
  });

  it('reclaims a malformed model and keeps the procedural rotor available', async () => {
    const asset = loadedModel();
    asset.gltf.scene.getObjectByName('tail_rotor')!.name = 'missing';
    vi.mocked(loadGltf).mockResolvedValueOnce(asset.gltf);
    const disposed = watch(asset.geometry);
    const heli = new HeliModel();
    await heli.ready;
    expect(heli.extLoaded).toBe(false);
    expect(disposed).toHaveBeenCalledOnce();
    expect(asset.close).toHaveBeenCalledOnce();
    heli.setCockpitView(false);
    heli.update(1, 1 / 60, 0.1);
    expect((heli as unknown as { blades: THREE.Mesh }).blades.visible).toBe(true);
    heli.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
});

describe('cockpit lifetime', () => {
  it('cleans up a successful AO load when the model fails', async () => {
    const ao = new THREE.Texture<HTMLImageElement>();
    const disposed = watch(ao);
    const pending = deferred<THREE.Texture<HTMLImageElement>>();
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockReturnValueOnce(pending.promise);
    vi.mocked(loadGltf).mockRejectedValueOnce(new Error('model failed'));
    const cockpit = new Cockpit();
    await Promise.resolve();
    pending.resolve(ao);
    await cockpit.ready;
    cockpit.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(cockpit.loaded).toBe(false);
  });

  it('cleans up model and AO results that arrive after disposal', async () => {
    const asset = loadedModel();
    const pending = deferred<GLTF>();
    const ao = new THREE.Texture<HTMLImageElement>();
    vi.mocked(loadGltf).mockReturnValueOnce(pending.promise);
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValueOnce(ao);
    const observers = [asset.geometry, asset.material, asset.map, asset.emissiveMap, ao].map(watch);
    const cockpit = new Cockpit();
    cockpit.dispose();
    pending.resolve(asset.gltf);
    await cockpit.ready;
    expect(cockpit.loaded).toBe(false);
    expect(cockpit.root.children).toHaveLength(0);
    observers.forEach((disposed) => expect(disposed).toHaveBeenCalledOnce());
    expect(asset.close).toHaveBeenCalledOnce();
  });

  it('releases source materials once after conversion and all texture channels on disposal', async () => {
    const asset = loadedModel();
    const ao = new THREE.Texture<HTMLImageElement>();
    vi.mocked(loadGltf).mockResolvedValueOnce(asset.gltf);
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValueOnce(ao);
    const materialDisposed = watch(asset.material);
    const observers = [asset.geometry, asset.map, asset.emissiveMap, ao].map(watch);
    const noiseDisposed = watch(getNoiseTexture());
    const cockpit = new Cockpit();
    await cockpit.ready;
    expect(cockpit.loaded).toBe(true);
    expect(materialDisposed).toHaveBeenCalledOnce();
    observers.forEach((disposed) => expect(disposed).not.toHaveBeenCalled());
    cockpit.dispose();
    cockpit.dispose();
    expect(materialDisposed).toHaveBeenCalledOnce();
    observers.forEach((disposed) => expect(disposed).toHaveBeenCalledOnce());
    expect(asset.close).toHaveBeenCalledOnce();
    expect(noiseDisposed).not.toHaveBeenCalled();
    getNoiseTexture().removeEventListener('dispose', noiseDisposed);
  });
});
