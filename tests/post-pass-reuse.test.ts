// 后期管线重建时复用场景通道：three.js 给每个渲染上下文都建一套物体的绘制数据，换新的场景通道旧的那套不会释放，
// 以前每改一次动态模糊、景深、体积雾就漏几百个统一缓冲。只有多渲染目标的格式变了（低画质 ↔ 其他、光线追踪）才换新的
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildPost, disposeSharedPass } from '../src/render/post';
import type { SunShadows } from '../src/render/sunShadows';

const renderer = { toneMapping: THREE.NeutralToneMapping, outputColorSpace: THREE.SRGBColorSpace } as THREE.WebGPURenderer;
const shadows = { light: new THREE.DirectionalLight() } as SunShadows;

afterEach(() => {
  disposeSharedPass();
  delete (globalThis as { __postDebug?: unknown }).__postDebug;
});

describe('后期管线重建时复用场景通道', () => {
  it('同样的格式连续重建：同一个场景通道，旧管线释放时不释放它', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const a = buildPost(renderer, scene, camera, shadows, { quality: 'low', rayTracing: false });
    const texA = a.hdr();
    let disposed = 0;
    texA!.addEventListener('dispose', () => disposed++);
    a.dispose();
    const b = buildPost(renderer, scene, camera, shadows, { quality: 'low', rayTracing: false, motionBlur: true });
    expect(b.hdr()).toBe(texA);
    b.dispose();
    expect(disposed).toBe(0);
  });

  it('改渲染分辨率也复用同一个通道', () => {
    (globalThis as { __postDebug?: unknown }).__postDebug = { ao: false, traa: false, bloom: false, contact: false };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const a = buildPost(renderer, scene, camera, shadows, { quality: 'medium', rayTracing: false, volumetric: false, upscale: 1 });
    const b = buildPost(renderer, scene, camera, shadows, { quality: 'medium', rayTracing: false, volumetric: false, upscale: 0.8 });
    expect(b.hdr()).toBe(a.hdr());
    a.dispose();
    b.dispose();
  });

  it('多渲染目标的格式变了（低画质 → 中画质）才换新通道', () => {
    (globalThis as { __postDebug?: unknown }).__postDebug = { ao: false, traa: false, bloom: false, contact: false };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const low = buildPost(renderer, scene, camera, shadows, { quality: 'low', rayTracing: false });
    const mid = buildPost(renderer, scene, camera, shadows, { quality: 'medium', rayTracing: false, volumetric: false });
    expect(mid.hdr()).not.toBe(low.hdr());
    low.dispose();
    mid.dispose();
  });
});
