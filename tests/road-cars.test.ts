// 路上跑的车：不出路、不钻地、到头掉头、模型没加载到就不画；位置只看时间（物理和画面是同一个位置）
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { getMap } from '../src/maps/index';
import type { RoadCarsDef } from '../src/maps/types';
import type { ModelLib } from '../src/render/modelLib';
import { RoadCars } from '../src/render/roadCars';
import { LANE, roadMovers } from '../src/sim/movers';

vi.mock('../src/render/modelLib', async (original) => ({
  ...(await original<typeof import('../src/render/modelLib')>()),
  instanceModel: () => [],
}));

const lib = (names: string[]) => ({ templates: new Map(names.map((n) => [n, {}])) }) as unknown as ModelLib;
const flat = (): number => 3;

describe('路上的车', () => {
  const road: RoadCarsDef = { pts: [[0, 0], [300, 0]], models: ['a', 'b'], speed: 10 };

  it('车灯白天不画（材质不可见，整个跳过），天黑了才亮', () => {
    const c = new RoadCars(roadMovers([road], flat), lib(['a']));
    const lamps = (c as unknown as { lamps: THREE.SpriteMaterial[] }).lamps;
    c.update(0, 0);
    for (const m of lamps) expect(m.visible).toBe(false);
    c.update(0, 1);
    for (const m of lamps) expect(m.visible && m.opacity > 0.5).toBe(true);
  });

  it('模型没有就不画（碰撞照样有：位置和模型无关）', () => {
    const c = new RoadCars(roadMovers([road], flat), lib([]));
    expect(c.position(0)).toBeNull();
  });

  it('来回开，不离开路，走在自己的一侧', () => {
    const [m] = roadMovers([road], flat);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sides = new Set<number>();
    let minX = 1e9;
    let maxX = -1e9;
    for (let i = 0; i < 30 * 200; i++) {
      m.pose(i / 30, p, q);
      expect(Math.abs(p.z)).toBeCloseTo(LANE, 3);
      expect(p.y).toBe(3);
      sides.add(Math.sign(p.z));
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    expect(sides.size).toBe(2);
    expect(minX).toBeLessThan(20);
    expect(maxX).toBeGreaterThan(280);
  });

  it('车头朝着走的方向，画面上的车就在算出来的位置', () => {
    const movers = roadMovers([road], flat);
    const c = new RoadCars(movers, lib(['a']));
    const root = c.group.children[0] as THREE.Group;
    // （t = 20 时第一辆车正在路上开：不在两头歇着）
    c.update(20, 0);
    const a = c.position(0)!.clone();
    c.update(20.5, 0);
    const b = c.position(0)!;
    const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    expect(nose.dot(b.clone().sub(a).normalize())).toBeGreaterThan(0.98);
    const p = new THREE.Vector3();
    movers[0].pose(20.5, p, new THREE.Quaternion());
    expect(p.distanceTo(b)).toBeLessThan(1e-6);
  });

  it('同一个时刻永远在同一个地方（存档、回检查点都不用记）', () => {
    const [m] = roadMovers([road], flat);
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const t of [0, 7.3, 31.9, 500]) {
      m.pose(t, p1, q);
      m.pose(t, p2, q);
      expect(p1.equals(p2)).toBe(true);
    }
  });

  it('日本的两条路都在图里，模型也都有名字和碰撞箱', async () => {
    const { MODEL_SHAPES } = await import('../src/world/modelShapes');
    const map = getMap('japan');
    expect(map.roadCars?.length).toBeGreaterThan(0);
    for (const r of map.roadCars ?? []) {
      expect(r.models.length).toBeGreaterThan(0);
      for (const m of r.models) expect(MODEL_SHAPES[m]?.length).toBeGreaterThan(0);
      for (const [x, z] of r.pts) {
        expect(Math.abs(x)).toBeLessThan(map.size / 2);
        expect(Math.abs(z)).toBeLessThan(map.size / 2);
      }
    }
  });
});
