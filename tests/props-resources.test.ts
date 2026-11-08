import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { PropsView, getGlowTexture } from '../src/render/propsView';
import { getRockReliefTexture, makeStrataTexture } from '../src/render/terrainMacro';
import { getNoiseTexture } from '../src/render/textures';
import { TRAINING } from '../src/maps/training';
import type { WorldData } from '../src/world/worldgen';
import type { RockFormDef } from '../src/world/rockForm';
import type { ModelLib } from '../src/render/modelLib';

vi.mock('../src/render/terrainMacro', async () => {
  const { Texture } = await import('three/webgpu');
  const relief = new Texture();
  return { getRockReliefTexture: () => relief, makeStrataTexture: vi.fn(() => new Texture()) };
});
vi.mock('../src/render/textures', async () => {
  const { Texture } = await import('three/webgpu');
  const noise = new Texture();
  return { getNoiseTexture: () => noise };
});

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop: vi.fn() }), fillRect: vi.fn() }) }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fixture() {
  const libraryGeometry = new THREE.BoxGeometry(1, 1, 1);
  const libraryMaterial = new THREE.MeshStandardMaterial();
  const template = new THREE.Mesh(libraryGeometry, libraryMaterial);
  template.updateMatrixWorld();
  const library: ModelLib = { templates: new Map([['fixture', template]]), dispose: vi.fn() };
  const world = {
    map: { ...TRAINING, rockForm: { dip: [0, 0], waves: [], y0: 0, y1: 100 } as unknown as RockFormDef },
    builder: {
      models: [{ name: 'fixture', pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }],
      batches: new Map(),
      anchors: [
        ...Array.from({ length: 3 }, (_, i) => ({ type: 'windsock', pos: [i * 10, 5, 0], rotY: 0, s: 1 })),
        ...Array.from({ length: 2 }, (_, i) => ({ type: 'flag', pos: [i * 10, 6, 10], rotY: 0, s: 1, p: { color: 'jp' } })),
        { type: 'blink', pos: [0, 8, 20], rotY: 0, s: 1 },
        { type: 'beacon', pos: [10, 8, 20], rotY: 0, s: 1 },
      ],
    },
  } as unknown as WorldData;
  const detail = new THREE.DataArrayTexture(new Uint8Array(20), 1, 1, 5);
  const view = new PropsView(world, library, detail);
  return { view, detail, library, libraryGeometry, libraryMaterial };
}

function watch(resource: { addEventListener(type: 'dispose', listener: () => void): void }) {
  const disposed = vi.fn();
  resource.addEventListener('dispose', disposed);
  return disposed;
}

describe('prop view resource ownership', () => {
  it('releases shared windsock geometry/material, each flag geometry, and each beacon material once', () => {
    const { view, detail, libraryGeometry, libraryMaterial } = fixture();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    view.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
        geometries.add(mesh.geometry);
        materials.add(mesh.material as THREE.Material);
      }
      if ((object as THREE.Sprite).isSprite) materials.add((object as THREE.Sprite).material);
    });
    // 三个风向袋：布各一份（会变形），钢圈支架共用一份；布和支架各一种材质。每面旗子一份几何体。
    expect(geometries.size).toBe(6);
    expect(materials.size).toBe(5);
    const observers = [...geometries, ...materials].map(watch);
    view.dispose();
    view.dispose();
    for (const disposed of observers) expect(disposed).toHaveBeenCalledOnce();
    expect(view.group.children).toHaveLength(0);
    detail.dispose();
    libraryGeometry.dispose();
    libraryMaterial.dispose();
  });

  it('disposes map-specific strata textures while retaining shared atlases and library geometry', () => {
    const { view, detail, library, libraryGeometry, libraryMaterial } = fixture();
    const atlas = vi.mocked(makeStrataTexture).mock.results[0].value as THREE.Texture;
    const ownDisposed = watch(atlas);
    const shared = [detail, getGlowTexture(), getNoiseTexture(), getRockReliefTexture(), libraryGeometry, libraryMaterial];
    const sharedObservers = shared.map(watch);
    const instance = view.group.children.find((object) => (object as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    const instanceDisposed = watch(instance);
    view.dispose();
    expect(ownDisposed).toHaveBeenCalledOnce();
    expect(instanceDisposed).toHaveBeenCalledOnce();
    expect(library.dispose).not.toHaveBeenCalled();
    for (const disposed of sharedObservers) expect(disposed).not.toHaveBeenCalled();
    shared.forEach((resource, i) => resource.removeEventListener('dispose', sharedObservers[i]));
    detail.dispose();
    libraryGeometry.dispose();
    libraryMaterial.dispose();
  });
});
