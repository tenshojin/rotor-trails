import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { WorldView } from '../src/render/worldView';
import { buildPost } from '../src/render/post';
import { sceneDepthNode } from '../src/render/mirror';
import { defaultSettings, QUALITY } from '../src/game/settings';
import type { WeatherParams } from '../src/sim/weather';

vi.mock('../src/render/post', async (original) => {
  const actual = await original<typeof import('../src/render/post')>();
  return { ...actual, buildPost: vi.fn(() => ({ dispose: vi.fn(), hdr: () => null, fog: null, pipeline: {} })) };
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture() {
  const settings = { ...defaultSettings(), quality: 'high' as const };
  vi.stubGlobal('window', { devicePixelRatio: 2, innerWidth: 1280, innerHeight: 720 });
  const camera = new THREE.PerspectiveCamera(72);
  const renderer = { setDrawingBufferSize: vi.fn(), shadowMap: {}, domElement: { clientWidth: 1280, clientHeight: 720 } };
  const sun = { setShadows: vi.fn(), updateFrustums: vi.fn() };
  const sky = { setVolumetric: vi.fn() };
  const view: WorldView = Object.assign(Object.create(WorldView.prototype), {
    scene: new THREE.Scene(), settings, ready: true, rig: { camera }, renderer, sun, sky, lightning: {},
    nav: { guides: false }, terrain: { lodScale: 0, shadowRange: 0 }, trees: { quality: {} }, props: { lodScale: 0 },
    water: { ssr: { value: 0 } }, rivers: { ssr: { value: 0 } }, world: null,
    // 人眼适应：WebGPU 上在 CPU 适应，后期不乘显卡上的曝光
    eye: { gpuNode: null },
  });
  view.applySettings(settings);
  return { view, settings, camera, renderer, sun, sky };
}

describe('render settings invalidation', () => {
  it('does no render rebuild, resize, shadow work or environment bake for audio/input/UI changes', () => {
    const f = fixture();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    Object.assign(f.sky, { mesh: new THREE.Mesh(geometry, material), material, beginEnvBake: () => () => {} });
    const target = new THREE.CubeRenderTarget(16);
    const pmrem = { fromScene: vi.fn(() => target) };
    Object.assign(f.view, { pmrem, envRT: null });
    const internal = f.view as unknown as { updateEnv(weather: WeatherParams, time: number): void };
    const weather = { overcast: 0, rain: 0, visibility: 20000 } as WeatherParams;
    internal.updateEnv(weather, 1);
    for (let i = 0; i < 20; i++) {
      f.view.applySettings({ ...f.settings, volMaster: i / 20, assist: 'novice', hints: false, hudOpacity: 0.7,
        bindings: { ...f.settings.bindings, center: ['KeyX'] } });
      internal.updateEnv(weather, 10 + i * 3);
    }
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    expect(f.sun.setShadows).toHaveBeenCalledOnce();
    expect(f.sun.updateFrustums).toHaveBeenCalledOnce();
    expect(f.sky.setVolumetric).toHaveBeenCalledOnce();
    expect(buildPost).toHaveBeenCalledOnce();
    expect(pmrem.fromScene).toHaveBeenCalledOnce();
    target.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('changes FOV and shadow bounds without reallocating the drawing buffer or rebuilding post effects', () => {
    const f = fixture();
    f.view.applySettings({ ...f.settings, fov: 90 });
    expect(f.camera.fov).toBe(90);
    expect(f.camera.projectionMatrix.elements).toEqual(new THREE.PerspectiveCamera(90, 1280 / 720).projectionMatrix.elements);
    expect(f.sun.updateFrustums).toHaveBeenCalledTimes(2);
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    expect(f.sun.setShadows).toHaveBeenCalledOnce();
    expect(buildPost).toHaveBeenCalledOnce();
  });

  it('detects settings mutated in place, and only reapplies the corresponding render features', () => {
    const f = fixture();
    f.settings.navGuides = true;
    f.settings.lightning = false;
    f.view.applySettings(f.settings);
    expect(f.view.nav!.guides).toBe(true);
    expect(f.view.lightning.enabled).toBe(false);
    expect(buildPost).toHaveBeenCalledOnce();
    f.settings.rayTracing = true;
    f.view.applySettings(f.settings);
    expect(buildPost).toHaveBeenCalledTimes(2);
    // 水面的倒影和光线追踪无关：关掉它，山和云就从水里消失了
    expect(f.view.water!.ssr.value).toBe(1);
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    expect(f.sun.setShadows).toHaveBeenCalledOnce();
    f.settings.renderScale = 0.75;
    f.view.applySettings(f.settings);
    // 画布还是屏幕分辨率，场景按 75% 画，由时间超分还原：只重建后期管线
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    expect(buildPost).toHaveBeenCalledTimes(3);
    expect(vi.mocked(buildPost).mock.lastCall?.[4]).toMatchObject({ upscale: 0.75 });
  });

  it('forces the current quality onto newly constructed map objects without recreating an unchanged post graph', () => {
    const f = fixture();
    const sky = { setVolumetric: vi.fn() };
    Object.assign(f.view, {
      sky, nav: { guides: false }, terrain: { lodScale: 0, shadowRange: 0 }, trees: { quality: {} }, props: { lodScale: 0 },
      water: { ssr: { value: 0 } }, rivers: { ssr: { value: 0 } },
    });
    f.view.applySettings(f.settings, true);
    expect(f.view.terrain!.lodScale).toBe(QUALITY.high.terrainLod);
    expect(f.view.terrain!.shadowRange).toBe(QUALITY.high.shadowRange);
    expect(f.view.trees!.quality.near).toBe(QUALITY.high.treeNear);
    expect(f.view.props!.lodScale).toBe(QUALITY.high.terrainLod);
    expect(f.view.water!.ssr.value).toBe(1);
    expect(sky.setVolumetric).toHaveBeenCalledWith(40);
    expect(buildPost).toHaveBeenCalledOnce();
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
  });

  it('rechecks display DPR on a resize event and coalesces size/DPR changes into one update', () => {
    const f = fixture();
    f.view.resize();
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    window.devicePixelRatio = 1;
    f.view.resize();
    expect(f.renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(1280, 720, 1);
    expect(f.sun.updateFrustums).toHaveBeenCalledOnce();
    window.devicePixelRatio = 2;
    f.renderer.domElement.clientWidth = 1440;
    f.view.resize();
    expect(f.renderer.setDrawingBufferSize).toHaveBeenCalledTimes(3);
    expect(f.renderer.setDrawingBufferSize).toHaveBeenLastCalledWith(1440, 720, 1.5);
    expect(f.sun.updateFrustums).toHaveBeenCalledTimes(2);
  });

  it('keeps the current post graph alive if replacement construction fails, and retries the same configuration', () => {
    const f = fixture();
    const current = vi.mocked(buildPost).mock.results[0].value as ReturnType<typeof buildPost>;
    const failure = new Error('effect construction failed');
    vi.mocked(buildPost).mockImplementationOnce(() => { throw failure; });
    const next = { ...f.settings, motionBlur: true };
    expect(() => f.view.applySettings(next)).toThrow(failure);
    expect(current.dispose).not.toHaveBeenCalled();
    f.view.applySettings(next);
    expect(buildPost).toHaveBeenCalledTimes(3);
    expect(current.dispose).toHaveBeenCalledOnce();
  });
});

describe('shared depth copies', () => {
  it('shares each depth format without reusing a non-reversed texture for a reversed renderer', () => {
    const standard = sceneDepthNode(false);
    const reversed = sceneDepthNode(true);
    expect(standard).not.toBe(reversed);
    expect(standard.value.type).toBe(THREE.UnsignedIntType);
    expect(reversed.value.type).toBe(THREE.FloatType);
    expect(sceneDepthNode(false)).toBe(standard);
    expect(sceneDepthNode(true)).toBe(reversed);
  });
});

// WebGL2 的着色器只能同步编译，一个几百毫秒：一帧全编完会卡死半分钟（2026-11-11 Linux 卡顿那一轮查到的）。
// 分批编译：每帧只新编一部分，编不完的这一帧先不画；一帧下来一个都没推迟就是编完了
describe('WebGL2 分批编译', () => {
  function webglView() {
    const made: string[] = [];
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const data = new Map<string, { pipeline?: unknown }>();
    const pipelines = {
      get: (ro: string) => {
        if (!data.has(ro)) data.set(ro, {});
        return data.get(ro)!;
      },
      // 原来的 getForRender：没有管线就“编译”（假装要 100 毫秒）
      getForRender(ro: string) {
        const d = pipelines.get(ro);
        if (d.pipeline === undefined) {
          clock += 100;
          made.push(ro);
          d.pipeline = { ro };
        }
        return d.pipeline;
      },
    };
    const original = pipelines.getForRender;
    const view = Object.assign(Object.create(WorldView.prototype), {
      renderer: { _pipelines: pipelines, backend: { isWebGPUBackend: false } },
      frames: 0,
      compiling: false,
    }) as WorldView;
    const frame = (objects: string[]) => {
      for (const ro of objects) pipelines.getForRender(ro);
      view.frames++;
    };
    return { view, pipelines, original, made, frame, ready: (ro: string) => pipelines.get(ro).pipeline !== undefined };
  }

  it('每帧只新编一部分，编不完的下一帧再编；一帧下来没有推迟的就是编完了，之后换回原来的函数', async () => {
    const t = webglView();
    const objects = Array.from({ length: 10 }, (_, i) => `o${i}`);
    const compiled = t.view.parallelCompile();
    let done = false;
    const all = compiled().then(() => (done = true));
    t.frame(objects);
    // 预算 250 ms，一个 100 ms：第一帧编了 3 个（第三个编完已经超了），其余推迟、这一帧不画
    expect(t.made.length).toBe(3);
    expect(t.ready('o3')).toBe(false);
    expect(t.view.compiledPrograms).toBe(3);
    t.frame(objects);
    t.frame(objects);
    t.frame(objects);
    expect(t.made.length).toBe(10);
    await Promise.resolve();
    expect(done).toBe(false);
    // 这一帧一个都没推迟：下一帧开头就算编完了
    t.frame(objects);
    await all;
    expect(done).toBe(true);
    expect(t.pipelines.getForRender).toBe(t.original);
    expect(t.view.compiledPrograms).toBe(10);
  });

  it('共用同一条管线的物体只算一次', () => {
    const t = webglView();
    const shared = { ro: 'shared' };
    const make = t.pipelines.getForRender;
    t.pipelines.getForRender = (ro: string) => (ro.startsWith('s') ? shared : make(ro));
    const compiled = t.view.parallelCompile();
    t.frame(['s1', 's2', 's3', 'a']);
    expect(t.view.compiledPrograms).toBe(2);
    compiled.cancel();
  });
});
