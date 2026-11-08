// 绕场飞的轻型飞机：航线在图里、不钻地，飞得顺，转弯时坡度压在转弯的那一边；天气不好不飞
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { ModelLib } from '../src/render/modelLib';
import { Traffic } from '../src/render/traffic';
import { PlaneMover } from '../src/sim/movers';
import { worldFor } from './helpers';

const lib = { templates: new Map() } as unknown as ModelLib;
const ear = new THREE.Vector3(0, 12, 140);

function plane(): PlaneMover {
  return new PlaneMover(getMap('training').traffic!);
}

describe('绕场飞的飞机', () => {
  it('整条航线在地图里，离地够高，只有通场的时候才低', async () => {
    const map = getMap('training');
    const world = await worldFor(map);
    const m = plane();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    let lowest = 1e9;
    let top = 0;
    for (let i = 0; i < 6000; i++) {
      m.pose(i / 30, p, q);
      expect(Math.abs(p.x)).toBeLessThan(map.size / 2);
      expect(Math.abs(p.z)).toBeLessThan(map.size / 2);
      lowest = Math.min(lowest, p.y - world.ctx.ground(p.x, p.z));
      top = Math.max(top, p.y);
    }
    expect(lowest).toBeGreaterThan(6);
    expect(lowest).toBeLessThan(30);
    expect(top).toBeGreaterThan(180);
  });

  it('每一帧走的距离都差不多，绕完一圈接得上', () => {
    const m = plane();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const last = new THREE.Vector3();
    m.pose(0, last, q);
    for (let i = 1; i < 7000; i++) {
      m.pose(i / 60, p, q);
      const d = p.distanceTo(last);
      expect(d).toBeGreaterThan((m.speed / 60) * 0.6);
      expect(d).toBeLessThan((m.speed / 60) * 1.4);
      last.copy(p);
    }
  });

  it('机头朝飞的方向，右转压右坡度', () => {
    const m = plane();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const forward = new THREE.Vector3();
    const last = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3();
    let banked = 0;
    m.pose(0, last, q);
    for (let i = 1; i < 6000; i++) {
      m.pose(i / 60, p, q);
      dir.copy(p).sub(last).normalize();
      last.copy(p);
      forward.set(0, 0, -1).applyQuaternion(q);
      expect(forward.dot(dir)).toBeGreaterThan(0.97);
      // 航线是顺时针绕的（从上往下看）：转弯都是右转，右翼朝下
      up.set(1, 0, 0).applyQuaternion(q);
      if (up.y < -0.2) banked++;
      expect(up.y).toBeLessThan(0.25);
    }
    expect(banked).toBeGreaterThan(200);
  });

  it('耳朵听得到它过来和走远，天气不好就不飞', () => {
    const t = new Traffic(plane(), lib);
    t.update(1, 1 / 60, 0, true, ear);
    t.update(1 + 1 / 60, 1 / 60, 0, true, ear);
    expect(t.sound.dist).toBeLessThan(3000);
    expect(Math.abs(t.sound.closing)).toBeLessThan(80);
    t.update(1 + 2 / 60, 1 / 60, 0, false, ear);
    expect(t.sound.dist).toBe(1e5);
    expect(PlaneMover.flies({ rain: 0.5, snow: 0, visibility: 9000 })).toBe(false);
    expect(PlaneMover.flies({ rain: 0, snow: 0, visibility: 1500 })).toBe(false);
    expect(PlaneMover.flies({ rain: 0, snow: 0, visibility: 9000 })).toBe(true);
    t.dispose();
  });
});
