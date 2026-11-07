// 拍照模式的机位：进出、不钻地、不出图、镜头和焦距的范围
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, PHOTO_FOV } from '../src/render/cameraRig';
import { fovOfLens, lensOfFov } from '../src/ui/photoPanel';

const floor = (): number => 100;
const still = { x: 0, y: 0, z: 0 };
const heli = new THREE.Vector3(0, 120, 0);
const level = new THREE.Quaternion();

function rig(): CameraRig {
  const r = new CameraRig(16 / 9);
  r.camera.position.set(0, 121, 0);
  return r;
}

describe('拍照模式的机位', () => {
  it('从座舱进来先走到机身斜后方，看着直升机', () => {
    const r = rig();
    r.enterPhoto(heli, level, floor);
    expect(r.mode).toBe('photo');
    expect(r.camera.position.distanceTo(heli)).toBeGreaterThan(10);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(r.camera.quaternion);
    const to = heli.clone().sub(r.camera.position).normalize();
    expect(look.dot(to)).toBeGreaterThan(0.99);
  });

  it('机身贴着山的时候，机位不在地下', () => {
    const r = rig();
    r.enterPhoto(heli, level, () => 150);
    expect(r.camera.position.y).toBeGreaterThan(150);
  });

  it('离开之后回到进来之前的视角', () => {
    const r = rig();
    r.setMode('chase');
    r.enterPhoto(heli, level, floor);
    r.leavePhoto();
    expect(r.mode).toBe('chase');
  });

  it('往下走到地面就停住，不钻下去', () => {
    const r = rig();
    r.enterPhoto(heli, level, floor);
    for (let i = 0; i < 400; i++) r.movePhoto(0.05, { x: 0, y: -1, z: 0 }, [0, 0], true, 5000, floor);
    expect(r.camera.position.y).toBeGreaterThanOrEqual(100.7);
    expect(r.camera.position.y).toBeLessThan(101);
  });

  it('走不出地图', () => {
    const r = rig();
    r.enterPhoto(heli, level, floor);
    r.movePhoto(0.05, still, [Math.PI / 2 - 0.3, 0], false, 500, floor);
    for (let i = 0; i < 600; i++) r.movePhoto(0.05, { x: 0, y: 0, z: 1 }, [0, 0], true, 500, floor);
    expect(Math.abs(r.camera.position.x)).toBeLessThanOrEqual(500);
    expect(Math.abs(r.camera.position.z)).toBeLessThanOrEqual(500);
  });

  it('朝前走跟着镜头的俯仰：低头就往下', () => {
    const r = rig();
    r.enterPhoto(heli, level, floor);
    r.camera.position.set(0, 500, 0);
    r.movePhoto(0.05, still, [0, 0.8], false, 5000, floor);
    const y = r.camera.position.y;
    for (let i = 0; i < 40; i++) r.movePhoto(0.05, { x: 0, y: 0, z: 1 }, [0, 0], false, 5000, floor);
    expect(r.camera.position.y).toBeLessThan(y - 10);
  });

  it('不按键就不动（速度慢慢停下来）', () => {
    const r = rig();
    r.enterPhoto(heli, level, floor);
    for (let i = 0; i < 20; i++) r.movePhoto(0.05, { x: 1, y: 0, z: 0 }, [0, 0], false, 5000, floor);
    for (let i = 0; i < 100; i++) r.movePhoto(0.05, still, [0, 0], false, 5000, floor);
    const p = r.camera.position.clone();
    r.movePhoto(0.05, still, [0, 0], false, 5000, floor);
    expect(r.camera.position.distanceTo(p)).toBeLessThan(0.001);
  });

  it('长焦的时候转得慢', () => {
    const wide = rig();
    const tele = rig();
    for (const [r, fov] of [[wide, 60], [tele, 8]] as const) {
      r.enterPhoto(heli, level, floor);
      r.photoFov = fov;
    }
    const q0 = wide.camera.quaternion.clone();
    wide.movePhoto(0.016, still, [0.1, 0], false, 5000, floor);
    const a = wide.camera.quaternion.angleTo(q0);
    const q1 = tele.camera.quaternion.clone();
    tele.movePhoto(0.016, still, [0.1, 0], false, 5000, floor);
    expect(tele.camera.quaternion.angleTo(q1)).toBeLessThan(a / 4);
  });

  it('焦距和视角互换，14 到 300 mm 正好是机位的视角范围', () => {
    expect(lensOfFov(fovOfLens(50))).toBeCloseTo(50, 6);
    expect(fovOfLens(14)).toBeLessThan(PHOTO_FOV[1] + 1);
    expect(fovOfLens(300)).toBeGreaterThan(PHOTO_FOV[0] - 0.1);
  });
});
