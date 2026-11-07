// 绕场飞的轻型飞机：航线在图里、不钻地，飞得顺，转弯时坡度压在转弯的那一边
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { ModelLib } from '../src/render/modelLib';
import { Traffic } from '../src/render/traffic';
import { worldFor } from './helpers';

const lib = { templates: new Map() } as unknown as ModelLib;
const ear = new THREE.Vector3(0, 12, 140);

function flyer(): { t: Traffic; root: THREE.Object3D } {
  const def = getMap('training').traffic!;
  const t = new Traffic(def, lib);
  return { t, root: t.group.children[0] };
}

describe('绕场飞的飞机', () => {
  it('整条航线在地图里，离地够高，只有通场的时候才低', async () => {
    const map = getMap('training');
    const world = await worldFor(map);
    const { t, root } = flyer();
    let lowest = 1e9;
    let top = 0;
    for (let i = 0; i < 6000; i++) {
      t.update(1 / 30, 0, true, ear);
      const p = root.position;
      expect(Math.abs(p.x)).toBeLessThan(map.size / 2);
      expect(Math.abs(p.z)).toBeLessThan(map.size / 2);
      lowest = Math.min(lowest, p.y - world.ctx.ground(p.x, p.z));
      top = Math.max(top, p.y);
    }
    expect(lowest).toBeGreaterThan(6);
    expect(lowest).toBeLessThan(30);
    expect(top).toBeGreaterThan(180);
    t.dispose();
  });

  it('每一帧走的距离都差不多，绕完一圈接得上', () => {
    const { t, root } = flyer();
    const speed = getMap('training').traffic!.speed;
    const last = root.position.clone();
    for (let i = 0; i < 7000; i++) {
      t.update(1 / 60, 0, true, ear);
      const d = root.position.distanceTo(last);
      expect(d).toBeGreaterThan((speed / 60) * 0.6);
      expect(d).toBeLessThan((speed / 60) * 1.4);
      last.copy(root.position);
    }
    t.dispose();
  });

  it('机头朝飞的方向，右转压右坡度', () => {
    const { t, root } = flyer();
    const forward = new THREE.Vector3();
    const last = root.position.clone();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3();
    let banked = 0;
    for (let i = 0; i < 6000; i++) {
      t.update(1 / 60, 0, true, ear);
      dir.copy(root.position).sub(last).normalize();
      last.copy(root.position);
      forward.set(0, 0, -1).applyQuaternion(root.quaternion);
      if (i > 2) expect(forward.dot(dir)).toBeGreaterThan(0.97);
      // 航线是顺时针绕的（从上往下看）：转弯都是右转，右翼朝下
      up.set(1, 0, 0).applyQuaternion(root.quaternion);
      if (up.y < -0.2) banked++;
      expect(up.y).toBeLessThan(0.25);
    }
    expect(banked).toBeGreaterThan(200);
    t.dispose();
  });

  it('耳朵听得到它过来和走远，天气不好就不飞', () => {
    const { t } = flyer();
    t.update(1 / 60, 0, true, ear);
    t.update(1 / 60, 0, true, ear);
    expect(t.sound.dist).toBeLessThan(3000);
    expect(Math.abs(t.sound.closing)).toBeLessThan(80);
    t.update(1 / 60, 0, false, ear);
    expect(t.sound.dist).toBe(1e5);
    t.dispose();
  });
});
