// 路上跑的车：不出路、不钻地、到头掉头、模型没加载到就没有车
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { getMap } from '../src/maps/index';
import type { RoadCarsDef } from '../src/maps/types';
import type { ModelLib } from '../src/render/modelLib';
import { RoadCars } from '../src/render/roadCars';

vi.mock('../src/render/modelLib', async (original) => ({
  ...(await original<typeof import('../src/render/modelLib')>()),
  instanceModel: () => [],
}));

const lib = (names: string[]) => ({ templates: new Map(names.map((n) => [n, {}])) }) as unknown as ModelLib;
const flat = (): number => 3;

describe('路上的车', () => {
  const road: RoadCarsDef = { pts: [[0, 0], [300, 0]], models: ['a', 'b'], speed: 10 };

  it('模型没有就不开车', () => {
    const c = new RoadCars([road], lib([]), flat);
    expect(c.position(0)).toBeNull();
  });

  it('来回开，不离开路，走在自己的一侧', () => {
    const c = new RoadCars([road], lib(['a', 'b']), flat);
    const sides = new Set<number>();
    let minX = 1e9;
    let maxX = -1e9;
    for (let i = 0; i < 30 * 200; i++) {
      c.update(1 / 30, 0);
      const p = c.position(0)!;
      expect(Math.abs(p.z)).toBeCloseTo(1.7, 3);
      expect(p.y).toBe(3);
      sides.add(Math.sign(p.z));
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    expect(sides.size).toBe(2);
    expect(minX).toBeLessThan(20);
    expect(maxX).toBeGreaterThan(280);
  });

  it('车头朝着走的方向', () => {
    const c = new RoadCars([road], lib(['a']), flat);
    const root = (c.group.children[0] as THREE.Group);
    const a = c.position(0)!.clone();
    c.update(0.5, 0);
    const b = c.position(0)!;
    const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    expect(nose.dot(b.clone().sub(a).normalize())).toBeGreaterThan(0.98);
  });

  it('日本的两条路都在图里，模型也都有名字', () => {
    const map = getMap('japan');
    expect(map.roadCars?.length).toBeGreaterThan(0);
    for (const r of map.roadCars ?? []) {
      expect(r.models.length).toBeGreaterThan(0);
      for (const [x, z] of r.pts) {
        expect(Math.abs(x)).toBeLessThan(map.size / 2);
        expect(Math.abs(z)).toBeLessThan(map.size / 2);
      }
    }
  });
});
