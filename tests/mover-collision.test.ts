// 撞得上：会动的船（以前是虚的，穿过去不受伤）、只放了模型的道具（路灯、高杆灯、停着的车、鸟居的横梁）、
// 细杆子（风向袋、旗杆）。
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { ContactReport } from '../src/sim/physics';
import { sessionFor, worldFor } from './helpers';

describe('撞得上', () => {
  it('朝开过来的渡轮撞过去：有接触、会受伤', async () => {
    const s = await sessionFor(getMap('japan'));
    const ferry = s.world.movers.find((m) => m.kind === 'vessel' && m.model === 'ferry_jp')!;
    expect(ferry).toBeDefined();
    expect(ferry.shapes.length).toBeGreaterThan(3);
    // 一秒以后渡轮在哪：从它横着 30 米外，以 30 m/s 朝那一点冲过去（甲板以上 4 米：撞上层建筑）
    const P = new Vector3();
    const Q = new Quaternion();
    ferry.pose(s.t + 1, P, Q);
    const side = new Vector3(0, 0, 1).applyQuaternion(Q).setY(0).normalize();
    const H = P.clone().addScaledVector(side, 30);
    H.y = P.y + 6;
    const dir = P.clone().sub(H).setY(0).normalize();
    s.teleport(H.x, H.y, H.z, (Math.atan2(dir.x, -dir.z) * 180) / Math.PI, 30);
    const hits: ContactReport[] = [];
    for (let i = 0; i < 120 && s.state === 'running'; i++) {
      s.step();
      hits.push(...s.contacts.filter((c) => c.tag.id === 'vessel'));
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(s.damage.durability).toBeLessThan(100);
    s.dispose();
  });

  it('只放了模型的道具也有碰撞箱，细杆子是实心的', async () => {
    const w = await worldFor(getMap('japan'));
    const ids = new Set(w.colliders.map((c) => c.tag.id));
    for (const id of ['light_mast', 'street_lamp', 'car_white', 'kei_truck', 'bollard', 'forklift', 'pallets_a', 'fish_boxes']) expect(ids.has(id)).toBe(true);
    // 每块坪边上的风向袋杆子：细圆柱
    const pad = w.map.pads.find((p) => p.style === 'ground')!;
    const s = pad.size;
    const r = Math.hypot(s / 2 + 3, s / 2 + 3);
    const poles = w.colliders.filter((c) => c.kind === 'cyl' && c.r < 0.12 && Math.abs(Math.hypot(c.c[0] - pad.pos[0], c.c[2] - pad.pos[2]) - r) < 1.5);
    expect(poles.length).toBeGreaterThan(0);
  });
});
