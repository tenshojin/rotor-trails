import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { WorldView } from '../src/render/worldView';
import { EYE_DEFAULT } from '../src/render/eyeAdapt';
import { setSunMap } from '../src/render/sunMap';
import { TRAINING as training } from '../src/maps/training';
import { defaultSettings } from '../src/game/settings';
import type { WorldData } from '../src/world/worldgen';

vi.mock('../src/render/sunMap', async (original) => {
  const actual = await original<typeof import('../src/render/sunMap')>();
  return { ...actual, setSunMap: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Exercise resource transitions without requiring a GPU or a browser canvas. */
function emptyView(): WorldView {
  return Object.assign(Object.create(WorldView.prototype) as WorldView, {
    scene: new THREE.Scene(),
    settings: { ...defaultSettings(), quality: 'high' },
    mapTextures: [],
    cockpit: { minimap: null },
    early: null,
    terrainVersion: 0,
    terrainTexSize: 0,
    terrainRefresh: null,
  });
}

describe('same-map time changes', () => {
  it('updates the camera lens before recalculating cascaded shadow bounds', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const view = emptyView();
    const camera = new THREE.PerspectiveCamera(72);
    const frustums = vi.fn(() => expect(camera.fov).toBe(100));
    Object.assign(view, {
      rig: { camera }, ready: false, lightning: {},
      renderer: { setDrawingBufferSize: vi.fn(), shadowMap: {}, domElement: { clientWidth: 1280, clientHeight: 720 } },
      sun: { setShadows: vi.fn(), updateFrustums: frustums },
    });
    view.applySettings({ ...defaultSettings(), fov: 100 });
    expect(frustums).toHaveBeenCalledOnce();
    const expected = new THREE.PerspectiveCamera(100, 1280 / 720);
    expect(camera.projectionMatrix.elements).toEqual(expected.projectionMatrix.elements);
  });

  it('updates mountain shadows, exposure, cloud history and the night landing lamp together', () => {
    const view = emptyView();
    const sky = { sunDir: new THREE.Vector3(0, 1, 0), dayK: 0.2, setSun: vi.fn(), setNight: vi.fn(), clouds: { reset: vi.fn() } };
    const eye = { snap: vi.fn(), setMax: vi.fn() };
    Object.assign(view, { sky, eye, world: { map: training, terrain: {} }, sun: { csm: {} }, tod: 'day' });
    view.setTimeOfDay('night');
    const lamp = view.scene.children.find((o) => (o as THREE.SpotLight).isSpotLight)!;
    expect(lamp).toBeDefined();
    expect(eye.setMax).toHaveBeenLastCalledWith(3.6);
    expect(setSunMap).toHaveBeenCalledTimes(1);
    expect(sky.clouds.reset).toHaveBeenCalledOnce();
    view.setTimeOfDay('night');
    expect(view.scene.children.filter((o) => (o as THREE.SpotLight).isSpotLight)).toHaveLength(1);
    expect(setSunMap).toHaveBeenCalledTimes(1);
    const disposed = vi.fn();
    lamp.addEventListener('dispose', disposed);
    view.setTimeOfDay('day');
    expect(view.scene.children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledOnce();
    expect(eye.setMax).toHaveBeenLastCalledWith(EYE_DEFAULT.max);
    expect(setSunMap).toHaveBeenCalledTimes(2);
  });
});

describe('map resource lifecycle', () => {
  it('observes asynchronous renderer cleanup failure after unsuccessful initialization', async () => {
    const view = emptyView();
    const failure = new Error('initialization failed');
    const resource = () => ({ dispose: vi.fn() });
    Object.assign(view, {
      unload: vi.fn(), heli: resource(), cockpit: resource(), rain: resource(), eye: resource(),
      sun: resource(), renderer: { dispose: vi.fn().mockRejectedValue(failure) },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    view.dispose();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('渲染器资源释放失败：', failure);
  });

  it('unload releases a prefetch that resolves later and clears stale scene references', async () => {
    const view = emptyView();
    let finish!: (value: { color: THREE.Texture; normal: THREE.Texture }) => void;
    const layers = new Promise<{ color: THREE.Texture; normal: THREE.Texture }>((resolve) => { finish = resolve; });
    const disposeLib = vi.fn();
    const color = new THREE.Texture();
    const normal = new THREE.Texture();
    const disposeColor = vi.fn();
    const disposeNormal = vi.fn();
    color.addEventListener('dispose', disposeColor);
    normal.addEventListener('dispose', disposeNormal);
    Object.assign(view, { early: { layers, lib: Promise.resolve({ dispose: disposeLib }) }, minimap: {}, terrainUniforms: {} });
    view.scene.environment = new THREE.Texture();
    view.unload();
    finish({ color, normal });
    await layers;
    expect(disposeColor).toHaveBeenCalledOnce();
    expect(disposeNormal).toHaveBeenCalledOnce();
    expect(disposeLib).toHaveBeenCalledOnce();
    expect(view.scene.environment).toBeNull();
    expect(view.minimap).toBeNull();
    expect(view.terrainUniforms).toBeNull();
  });

  it('reclaims matched prefetched assets when world construction fails before adoption', async () => {
    const view = emptyView();
    const color = new THREE.Texture();
    const normal = new THREE.Texture();
    const disposeColor = vi.fn();
    const disposeLib = vi.fn();
    color.addEventListener('dispose', disposeColor);
    Object.assign(view, { early: { id: training.id, texSize: 1024, layers: Promise.resolve({ color, normal }), lib: Promise.resolve({ dispose: disposeLib }) } });
    await expect(view.load({ map: training } as WorldData, () => { throw new Error('construction failed'); })).rejects.toThrow('construction failed');
    expect(disposeColor).toHaveBeenCalledOnce();
    expect(disposeLib).toHaveBeenCalledOnce();
    expect(view.world).toBeNull();
  });
});

describe('shader compilation recovery', () => {
  it('rejects WebGPU validation errors even when the backend compile promise resolves', async () => {
    const pipeline = {};
    const data = { pipeline: {}, error: false };
    const getForRender = vi.fn((_ro: unknown, promises: Promise<void>[]) => {
      promises.push(Promise.resolve().then(() => { data.error = true; }));
      return pipeline;
    });
    const draw = vi.fn();
    const pipelines = { getForRender };
    const backend = { isWebGPUBackend: true, get: vi.fn(() => data), draw };
    const view = emptyView();
    Object.assign(view, { renderer: { _pipelines: pipelines, backend } });
    const done = view.parallelCompile();
    pipelines.getForRender({}, undefined as unknown as Promise<void>[]);
    await expect(done()).rejects.toThrow('着色器编译失败');
    expect(pipelines.getForRender).toBe(getForRender);
    expect(backend.draw).toBe(draw);
    expect(backend.get).toHaveBeenCalledOnce();
  });

  it('can synchronously restore draw hooks while an outstanding compile remains unsettled', async () => {
    let resolve!: () => void;
    const compile = new Promise<void>((done) => { resolve = done; });
    const getForRender = vi.fn((_ro: unknown, promises: Promise<void>[]) => { promises.push(compile); });
    const draw = vi.fn();
    const pipelines = { getForRender };
    const backend = { isWebGPUBackend: true, get: () => ({ pipeline: {} }), draw };
    const view = emptyView();
    Object.assign(view, { renderer: { _pipelines: pipelines, backend } });
    const done = view.parallelCompile();
    pipelines.getForRender({}, undefined as unknown as Promise<void>[]);
    const completed = vi.fn();
    const waiting = done().then(completed);
    done.cancel();
    done.cancel();
    expect(pipelines.getForRender).toBe(getForRender);
    expect(backend.draw).toBe(draw);
    expect(completed).not.toHaveBeenCalled();
    resolve();
    await waiting;
    expect(completed).toHaveBeenCalledOnce();
  });

  it('restores the normal draw path after a rejected compile and permits repeated cleanup', async () => {
    const failure = new Error('shader rejected');
    const getForRender = vi.fn((_ro: unknown, promises: Promise<void>[]) => { promises.push(Promise.reject(failure)); });
    const draw = vi.fn();
    const pipelines = { getForRender };
    const backend = { isWebGPUBackend: true, get: () => ({ pipeline: {} }), draw };
    const view = emptyView();
    Object.assign(view, { renderer: { _pipelines: pipelines, backend } });
    const done = view.parallelCompile();
    pipelines.getForRender({}, undefined as unknown as Promise<void>[]);
    // Compilation can reject several frames before the app awaits warm-up.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(done()).rejects.toBe(failure);
    expect(pipelines.getForRender).toBe(getForRender);
    expect(backend.draw).toBe(draw);
    await expect(done()).rejects.toBe(failure);
  });
});
