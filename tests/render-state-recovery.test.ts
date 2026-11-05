import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { updateCloudShadowMap } from '../src/render/cloudShadowMap';
import { CLOUD } from '../src/render/sky';
import { VolumetricFogNode } from '../src/render/volumetricFog';

afterEach(() => vi.restoreAllMocks());

describe('offscreen render failure recovery', () => {
  it('restores the scene target when cloud shadow rendering throws', () => {
    const target = new THREE.RenderTarget();
    const renderer = { getRenderTarget: () => target, setRenderTarget: vi.fn() };
    const failure = new Error('shader compile failed');
    vi.spyOn(THREE.QuadMesh.prototype, 'render').mockImplementation(() => { throw failure; });
    const previousOn = CLOUD.on.value;
    CLOUD.on.value = 1;
    try {
      expect(() => updateCloudShadowMap(renderer as unknown as THREE.WebGPURenderer, new THREE.Vector3())).toThrow(failure);
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(target);
    } finally {
      CLOUD.on.value = previousOn;
      target.dispose();
    }
  });

  it.each([true, false])('restores target, MRT and clear state when volumetric fog fails (ready=%s)', (ready) => {
    const target = new THREE.RenderTarget();
    const fogTarget = new THREE.RenderTarget(128, 72);
    const failure = new Error('offscreen failed');
    const fail = () => { throw failure; };
    const mrt = {};
    const draw = () => {};
    let clear = new THREE.Color(0x123456);
    const renderer = {
      autoClear: false, autoClearColor: false, autoClearDepth: false, autoClearStencil: false, opaque: false, transparent: false,
      getSize: (out: THREE.Vector2) => out.set(128, 72), getRenderTarget: () => target,
      getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 2, getRenderObjectFunction: () => draw,
      getPixelRatio: () => 1, getMRT: () => mrt, getClearAlpha: () => 0.4, getScissorTest: () => true,
      getClearColor: (out: THREE.Color) => out.copy(clear),
      setRenderTarget: vi.fn(), setRenderObjectFunction: vi.fn(), setPixelRatio: vi.fn(), setMRT: vi.fn(), setScissorTest: vi.fn(),
      setClearColor: vi.fn((value: THREE.Color | number) => { clear = new THREE.Color(value); }), clear: fail,
    };
    const fields = {
      signature: () => 'fixture', sig: 'fixture', ready, q: { scale: 1 }, rt: fogTarget,
      size: { value: new THREE.Vector2() }, camPos: { value: new THREE.Vector3() }, frameN: { value: 0 },
      camera: new THREE.PerspectiveCamera(), quad: { render: fail },
    };
    // Node's prototype defines TSL swizzle setters (including `rt`), so ordinary
    // assignment on an unconstructed Node would invoke shader assignment logic.
    const fog = Object.create(VolumetricFogNode.prototype) as VolumetricFogNode;
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(fog, key, { value, writable: true });
    const clearCall = vi.spyOn(renderer, 'clear');
    const render = vi.spyOn(fields.quad, 'render');
    expect(() => fog.updateBefore({ renderer } as unknown as THREE.NodeFrame)).toThrow(failure);
    expect(render).toHaveBeenCalledTimes(ready ? 1 : 0);
    expect(clearCall).toHaveBeenCalledTimes(ready ? 0 : 1);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(target, 3, 2);
    expect(renderer.setMRT).toHaveBeenLastCalledWith(mrt);
    expect(renderer.setRenderObjectFunction).toHaveBeenLastCalledWith(draw);
    expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(new THREE.Color(0x123456), 0.4);
    expect(renderer.autoClear).toBe(false);
    expect(renderer.opaque).toBe(false);
    expect(renderer.transparent).toBe(false);
    target.dispose();
    fogTarget.dispose();
  });
});
