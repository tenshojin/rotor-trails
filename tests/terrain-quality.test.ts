import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { WorldView } from '../src/render/worldView';
import { TerrainView, type TerrainUniforms } from '../src/render/terrainView';
import { loadTerrainLayers, type TerrainLayers } from '../src/render/terrainLayers';
import { TRAINING } from '../src/maps/training';
import { defaultSettings, type QualityId } from '../src/game/settings';
import { Heightfield } from '../src/sim/terrain';
import type { WorldData } from '../src/world/worldgen';

vi.mock('../src/render/terrainLayers', () => ({ loadTerrainLayers: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function layers(): TerrainLayers {
  return {
    color: new THREE.DataArrayTexture(new Uint8Array(32), 1, 1, 8),
    normal: new THREE.DataArrayTexture(new Uint8Array(32), 1, 1, 8),
    tiles: Array(8).fill(8), meanLum: Array(8).fill(0.2), biome: Array.from({ length: 8 }, () => new THREE.Color()), tintK: Array(8).fill(0.6),
  };
}

function uniforms(): TerrainUniforms {
  const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const color = new THREE.Color(0.2, 0.3, 0.1);
  return {
    noise: tex, surface: tex, forest: tex, wash: null, macro: tex, relief: tex, layers: null, mapSize: 64,
    sand: color, grass: color, grass2: color, dirt: color, rock: color, rock2: color, snow: color, forestFloor: color,
    forestFar: 0, strataA: color, strataB: color, strataC: color, strataD: color, strata: 0, paved: false,
    fringe: 0,
    beachTop: 2, snowLine: 4000, rockSlope: 0.4, waterLevel: 0, grassy: 1, uWet: uniform(0), rockForm: null, strataLUT: null,
  };
}

function viewFixture() {
  const data = uniforms();
  const terrain = {
    group: new THREE.Group(), dispose: vi.fn(),
    setLayers: vi.fn((value: TerrainLayers | null) => { data.layers = value; }),
  };
  const view: WorldView = Object.assign(Object.create(WorldView.prototype) as WorldView, {
    scene: new THREE.Scene(), world: { map: TRAINING }, terrain, terrainUniforms: data,
    settings: { ...defaultSettings(), quality: 'low' }, ready: false,
    rig: { camera: new THREE.PerspectiveCamera() },
    renderer: { shadowMap: {} }, sun: { setShadows: vi.fn(), updateFrustums: vi.fn() }, lightning: {}, resize: vi.fn(),
    cockpit: { minimap: null }, mapTextures: [], terrainTexSize: 0, terrainVersion: 0, terrainRefresh: null,
  });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const select = (quality: QualityId) => view.applySettings({ ...defaultSettings(), quality });
  const pending = () => (view as unknown as { terrainRefresh: Promise<void> | null }).terrainRefresh;
  return { view, terrain, data, select, pending };
}

afterEach(() => vi.unstubAllGlobals());

describe('terrain quality changes', () => {
  it('upgrades a map first loaded on low without rebuilding its geometry or flight world', async () => {
    const f = viewFixture();
    const world = f.view.world;
    const photo = layers();
    vi.mocked(loadTerrainLayers).mockResolvedValue(photo);
    f.select('high');
    await f.pending();
    expect(f.terrain.setLayers).toHaveBeenCalledWith(photo);
    expect(f.view.world).toBe(world);
    expect(f.data.layers).toBe(photo);
    f.select('medium');
    f.select('ultra');
    expect(loadTerrainLayers).toHaveBeenCalledTimes(1);
    const disposed = vi.fn();
    photo.color.addEventListener('dispose', disposed);
    f.select('low');
    expect(f.data.layers).toBeNull();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('discards a slow upgrade if low quality is selected before it completes', async () => {
    const f = viewFixture();
    let finish!: (value: TerrainLayers) => void;
    vi.mocked(loadTerrainLayers).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    f.select('high');
    const pending = f.pending();
    f.select('low');
    const photo = layers();
    const disposed = vi.fn();
    photo.color.addEventListener('dispose', disposed);
    finish(photo);
    await pending;
    expect(f.data.layers).toBeNull();
    expect(f.terrain.setLayers).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('ignores an older failed request without clearing or duplicating the replacement request', async () => {
    const f = viewFixture();
    let first!: (value: TerrainLayers | null) => void;
    let second!: (value: TerrainLayers | null) => void;
    vi.mocked(loadTerrainLayers)
      .mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    f.select('high');
    const stale = f.pending();
    f.select('low');
    f.select('medium');
    const current = f.pending();
    first(null);
    await stale;
    expect(f.pending()).toBe(current);
    f.select('high');
    expect(loadTerrainLayers).toHaveBeenCalledTimes(2);
    const photo = layers();
    second(photo);
    await current;
    expect(f.data.layers).toBe(photo);
    f.select('ultra');
    expect(loadTerrainLayers).toHaveBeenCalledTimes(2);
    f.select('low');
  });

  it('keeps the latest successful textures when an older upgrade completes afterwards', async () => {
    const f = viewFixture();
    let first!: (value: TerrainLayers) => void;
    vi.mocked(loadTerrainLayers).mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
    f.select('high');
    const stale = f.pending();
    f.select('low');
    const photo = layers();
    vi.mocked(loadTerrainLayers).mockResolvedValueOnce(photo);
    f.select('medium');
    await f.pending();
    const old = layers();
    const disposed = vi.fn();
    old.color.addEventListener('dispose', disposed);
    first(old);
    await stale;
    expect(f.data.layers).toBe(photo);
    expect(disposed).toHaveBeenCalledOnce();
    expect((f.view as unknown as { terrainTexSize: number }).terrainTexSize).toBe(1024);
    f.select('low');
  });

  it('never applies old-map texture results after unloading and replacing a map', async () => {
    const f = viewFixture();
    let finish!: (value: TerrainLayers) => void;
    vi.mocked(loadTerrainLayers).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    f.select('high');
    const pending = f.pending();
    f.view.unload();
    f.view.world = { map: TRAINING } as WorldData;
    const photo = layers();
    const disposed = vi.fn();
    photo.normal.addEventListener('dispose', disposed);
    finish(photo);
    await pending;
    expect(f.terrain.setLayers).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('keeps the working fallback if the new textures cannot load', async () => {
    const f = viewFixture();
    vi.mocked(loadTerrainLayers).mockResolvedValue(null);
    f.select('medium');
    await f.pending();
    expect(f.terrain.setLayers).not.toHaveBeenCalled();
    expect(f.data.layers).toBeNull();
    vi.mocked(loadTerrainLayers).mockResolvedValue(layers());
    f.select('medium');
    await f.pending();
    expect(f.data.layers).not.toBeNull();
    expect(loadTerrainLayers).toHaveBeenCalledTimes(2);
  });

  it('swaps the material on near and far terrain while keeping every geometry and wetness uniform', () => {
    const data = uniforms();
    const hf = new Heightfield(64, 65, new Float32Array(65 * 65));
    const terrain = new TerrainView({ ...TRAINING, size: 64, farExtent: 1, farTerrain: undefined }, hf, data);
    const geometries = terrain.group.children.map((o) => (o as THREE.Mesh).geometry);
    const material = terrain.material;
    const disposed = vi.fn();
    material.addEventListener('dispose', disposed);
    const photo = layers();
    terrain.setLayers(photo);
    expect(data.layers).toBe(photo);
    expect(terrain.material).not.toBe(material);
    expect(disposed).toHaveBeenCalledOnce();
    expect(terrain.group.children.map((o) => (o as THREE.Mesh).geometry)).toEqual(geometries);
    expect(terrain.group.children.every((o) => (o as THREE.Mesh).material === terrain.material)).toBe(true);
    terrain.dispose();
    photo.color.dispose();
    photo.normal.dispose();
    data.noise.dispose();
  });
});
