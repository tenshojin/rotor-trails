import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { NavView } from '../src/render/navView';
import { RainFx, CloudLayer, LightningBolt } from '../src/render/weatherFx';
import { getGlowTexture } from '../src/render/propsView';
import { getNoiseTexture } from '../src/render/textures';
import { TRAINING } from '../src/maps/training';
import type { GameSession } from '../src/sim/session';

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
afterEach(() => vi.restoreAllMocks());

describe('闪电的形状', () => {
  it('从云底打到地面，有分叉，面片都在缓冲里，亮度跟着闪光走', () => {
    const b = new LightningBolt();
    b.update(0.5);
    expect(b.mesh.visible).toBe(false);
    const cam = new THREE.Vector3(0, 200, 0);
    b.strike(cam, new THREE.Vector3(0, 0, -1), 2000, 900, 3000, () => 10);
    b.update(0.5);
    expect(b.mesh.visible).toBe(true);
    const pos = b.mesh.geometry.getAttribute('position');
    const quads = (b.mesh.geometry.drawRange.count ?? 0) / 6;
    expect(quads).toBeGreaterThan(64);
    expect(quads).toBeLessThanOrEqual(192);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < quads * 4; i++) {
      lo = Math.min(lo, pos.getY(i));
      hi = Math.max(hi, pos.getY(i));
      expect(Number.isFinite(pos.getX(i))).toBe(true);
    }
    expect(hi).toBeGreaterThan(850);
    expect(lo).toBeLessThan(30);
    b.update(0);
    expect(b.mesh.visible).toBe(false);
    b.dispose();
  });

  it('打在镜头前方，不是身后', () => {
    const b = new LightningBolt();
    const cam = new THREE.Vector3();
    for (let n = 0; n < 40; n++) {
      b.strike(cam, new THREE.Vector3(0, 0, -1), 2000, 900, 3000, () => 0);
      expect(b.mesh.geometry.getAttribute('position').getZ(0)).toBeLessThan(0);
    }
    b.dispose();
  });
});

function watch(resource: { addEventListener(type: 'dispose', listener: () => void): void }) {
  const dispose = vi.fn();
  resource.addEventListener('dispose', dispose);
  return dispose;
}

describe('world effect resource ownership', () => {
  it('releases shared drone resources and smoke once without releasing global sprite geometry or textures', () => {
    const nav = new NavView({ ...TRAINING, pickups: [
      { id: 'a', kind: 'boost', pos: [0, 10, 0] }, { id: 'b', kind: 'shield', pos: [10, 10, 0] },
    ] }, false);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const sprites = new Set<THREE.BufferGeometry>();
    nav.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        geometries.add(mesh.geometry);
        materials.add(mesh.material as THREE.Material);
      }
      if ((object as THREE.Sprite).isSprite) {
        sprites.add((object as THREE.Sprite).geometry);
        materials.add((object as THREE.Sprite).material);
      }
    });
    // 无人机：机架、桨盘、吊舱三个合并几何体，所有无人机共用（另外三个是航点光环、箭头和烟幕）
    expect(geometries.size).toBe(6);
    const owned = [...geometries, ...materials].map(watch);
    const shared = [...sprites, getGlowTexture(), getNoiseTexture()];
    const borrowed = shared.map(watch);
    nav.dispose();
    nav.dispose();
    owned.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    borrowed.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    expect(nav.group.children).toHaveLength(0);
    shared.forEach((resource, i) => resource.removeEventListener('dispose', borrowed[i]));
  });

  it('disposes the rain instance buffer along with its geometry and material', () => {
    const rain = new RainFx(32);
    const observers = [rain.mesh, rain.mesh.geometry, rain.mesh.material as THREE.Material].map(watch);
    rain.dispose();
    rain.dispose();
    observers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
  });

  it('renders planar transparent effects in one pass while retaining visibility from both sides', () => {
    const clouds = new CloudLayer(1000);
    const nav = new NavView({ ...TRAINING, pickups: [{ id: 'a', kind: 'boost', pos: [0, 10, 0] }] }, false);
    const materials = new Set<THREE.Material>();
    for (const root of [clouds.group, nav.group]) root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      if (mat.transparent && mat.side === THREE.DoubleSide) materials.add(mat);
    });
    expect(materials.size).toBe(10); // seven cloud planes, chevron, rotor disc, smoke
    materials.forEach((material) => expect(material.forceSinglePass).toBe(true));
    clouds.dispose();
    nav.dispose();
  });
});

describe('navigation update', () => {
  it('retains arrow positions across a corner without mutating waypoint data or the camera', () => {
    const nav = new NavView({ ...TRAINING, pickups: [] }, false);
    nav.guides = true;
    const preview = [{ pos: [160, 10, 0], radius: 20 }, { pos: [160, 10, -160], radius: 20 }];
    const session = {
      nav: { info: { preview, mode: 'route' } }, state: 'running', groundSpeed: 0, t: 1,
      mission: { current: () => null }, pickupsTaken: new Set(),
      wind: { sample: (_x: number, _y: number, _z: number, _t: number, out: THREE.Vector3) => out.set(0, 0, 0) },
    } as unknown as GameSession;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    nav.update(session, 1, camera.position, camera);
    const arrows = (nav as unknown as { chevrons: THREE.Mesh[] }).chevrons;
    expect(arrows.filter((arrow) => arrow.visible).map((arrow) => arrow.position.toArray())).toEqual([
      [40, 10, 0], [80, 10, 0], [120, 10, 0], [160, 10, -40], [160, 10, -80], [160, 10, -120],
    ]);
    expect(camera.position.toArray()).toEqual([0, 10, 0]);
    expect(preview.map((point) => point.pos)).toEqual([[160, 10, 0], [160, 10, -160]]);
    nav.dispose();
  });
});
