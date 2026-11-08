// 远处小东西画不画：按画面上的像素算（长焦、高分辨率画得更远），不足 1 个像素不画，超过 1.4 个再画
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { bigEnough, pixelSize, SCREEN, updateScreenScale } from '../src/render/screenSize';
import { NavView } from '../src/render/navView';
import { TRAINING } from '../src/maps/training';

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

afterEach(() => {
  updateScreenScale(new THREE.PerspectiveCamera(72), 900);
});

describe('远处小东西画不画', () => {
  it('像素比例随视角和画面高度', () => {
    const cam = new THREE.PerspectiveCamera(72);
    updateScreenScale(cam, 900);
    // 72° 视角、900 像素高：1 米远处 1 米长约 619 像素
    expect(SCREEN.pxPerMeter).toBeCloseTo(900 / (2 * Math.tan((36 * Math.PI) / 180)), 6);
    // 2.8 m 长的风向袋在 1.3 km 外约 1.3 个像素
    expect(pixelSize(2.8, 1300)).toBeCloseTo(1.33, 1);
    updateScreenScale(cam, 2160);
    expect(pixelSize(2.8, 1300)).toBeCloseTo(3.2, 1);
    updateScreenScale(new THREE.PerspectiveCamera(8), 900);
    expect(pixelSize(2.8, 1300)).toBeGreaterThan(13);
  });

  it('不足 1 个像素不画，超过 1.4 个像素再画，中间保持原样', () => {
    updateScreenScale(new THREE.PerspectiveCamera(72), 900);
    const at = (px: number) => (2.8 * SCREEN.pxPerMeter) / px;
    expect(bigEnough(true, 2.8, at(0.9))).toBe(false);
    expect(bigEnough(false, 2.8, at(1.2))).toBe(false);
    expect(bigEnough(true, 2.8, at(1.2))).toBe(true);
    expect(bigEnough(false, 2.8, at(1.5))).toBe(true);
  });

  it('补给无人机：机架、桨盘、吊舱三个网格放在一个组里（远了整组不画），信标灯单独', () => {
    const nav = new NavView({ ...TRAINING, pickups: [{ id: 'a', kind: 'boost', pos: [0, 10, 0] }, { id: 'b', kind: 'repair', pos: [5, 10, 0] }] }, false);
    const drones = nav.group.children.filter((o) => o.children.some((c) => (c as THREE.Sprite).isSprite));
    expect(drones).toHaveLength(2);
    for (const d of drones) {
      const body = d.children.find((c) => !(c as THREE.Sprite).isSprite)!;
      expect(body.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(3);
    }
    // 两架无人机共用机架和桨盘的几何体
    const geo = (d: THREE.Object3D, i: number) => ((d.children[0].children[i] as THREE.Mesh).geometry);
    expect(geo(drones[0], 0)).toBe(geo(drones[1], 0));
    expect(geo(drones[0], 1)).toBe(geo(drones[1], 1));
    nav.dispose();
  });
});
