// 座舱小零件（旋钮、开关、指示灯、指针、显示屏、表盘玻璃）单独一个图层：座舱视角和近看时画，
// 从外面看远了（一颗 2.5 cm 的旋钮不到 1.2 个像素）主相机就不画这一层；其他座舱网格照旧在图层 2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Cockpit, COCKPIT_DETAIL_LAYER, EYE } from '../src/render/cockpit';
import { loadGltf } from '../src/render/gltf';

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

function model(names: string[]): GLTF {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.02, 0.02, 0.02);
  const material = new THREE.MeshStandardMaterial();
  for (const name of names) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    scene.add(mesh);
  }
  return { scene } as unknown as GLTF;
}

beforeEach(() => {
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockRejectedValue(new Error('no bake in tests'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function loaded(): Promise<Cockpit> {
  vi.mocked(loadGltf).mockResolvedValueOnce(model(['hs_kn_test', 'led_au_1', 'ndl_alt', 'cockpit_static_1', 'seat_pilot001_1', 'ctl_cyclic001']));
  const cockpit = new Cockpit();
  await cockpit.ready;
  cockpit.root.updateMatrixWorld(true);
  return cockpit;
}

function meshMask(cockpit: Cockpit, name: string): number {
  return (cockpit.root.getObjectByName(name) as THREE.Mesh).layers.mask;
}

/** 镜头放在眼点外 d 米、朝着眼点 */
function cameraAt(d: number, fov = 72): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 30000);
  cam.position.copy(EYE).add(new THREE.Vector3(0, 0, d));
  cam.layers.enable(COCKPIT_DETAIL_LAYER);
  return cam;
}

describe('座舱小零件的图层', () => {
  it('旋钮、指示灯、指针在小零件图层，固定件、座椅、操纵杆还在图层 2', async () => {
    const cockpit = await loaded();
    expect(cockpit.loaded).toBe(true);
    for (const name of ['hs_kn_test', 'led_au_1', 'ndl_alt']) expect(meshMask(cockpit, name)).toBe(1 << COCKPIT_DETAIL_LAYER);
    for (const name of ['cockpit_static_1', 'seat_pilot001_1', 'ctl_cyclic001']) expect(meshMask(cockpit, name)).toBe(1 << 2);
    cockpit.dispose();
  });

  it('座舱视角一直画；外面近看画，远了不画，回到近处再画', async () => {
    const cockpit = await loaded();
    const far = cameraAt(14);
    cockpit.updateDetailLayer(far, 900, true);
    expect(far.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(true);
    // 900 像素高、72° 视角、14 米：一颗 2.5 cm 的旋钮约 1.1 个像素
    cockpit.updateDetailLayer(far, 900, false);
    expect(far.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(false);
    const near = cameraAt(4);
    cockpit.updateDetailLayer(near, 900, false);
    expect(near.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(true);
    cockpit.dispose();
  });

  it('长焦和高分辨率按画面上的像素算：同样 14 米也画', async () => {
    const cockpit = await loaded();
    const tele = cameraAt(14, 10);
    cockpit.updateDetailLayer(tele, 900, false);
    expect(tele.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(true);
    const big = cameraAt(14);
    cockpit.updateDetailLayer(big, 2160, false);
    expect(big.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(true);
    cockpit.dispose();
  });

  it('在门槛附近来回不闪：关掉以后要大到 1.6 个像素才再画', async () => {
    const cockpit = await loaded();
    // 1.4 个像素：从“画着”开始保持画，从“关着”开始保持关
    const d = (0.025 * 900) / (2 * 1.4 * Math.tan((72 * Math.PI) / 360));
    const cam = cameraAt(d);
    cockpit.updateDetailLayer(cam, 900, false);
    expect(cam.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(true);
    cockpit.updateDetailLayer(cameraAt(20), 900, false);
    cockpit.updateDetailLayer(cam, 900, false);
    expect(cam.layers.isEnabled(COCKPIT_DETAIL_LAYER)).toBe(false);
    cockpit.dispose();
  });
});
