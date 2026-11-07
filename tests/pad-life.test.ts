// 停机坪上的地勤：朝他飞过去他才举手，飞机压过来他弯腰，货送到了堆在坪边
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import { PadLife } from '../src/render/padLife';
import type { GameSession } from '../src/sim/session';

const map = getMap('japan');
const pad = map.pads[1];

interface Crew {
  pad: { id: string };
  x: number;
  y: number;
  z: number;
  wave: number;
  duck: number;
}

function fake(x: number, y: number, z: number, targetId: string | null, done: string[] = []): GameSession {
  const land = (id: string, status: string) => ({ status, def: { kind: 'land', cargo: 'unload', padId: id } });
  return {
    body: { pos: { x, y, z } },
    mission: {
      current: () => (targetId ? { def: { kind: 'land', padId: targetId } } : null),
      main: done.map((id) => land(id, 'done')),
      optional: [],
    },
  } as unknown as GameSession;
}

function run(life: PadLife, s: GameSession, seconds = 3): void {
  for (let t = 0; t < seconds; t += 1 / 30) life.update(s, t, 1 / 30);
}

describe('停机坪上的地勤', () => {
  it('每块坪一个人，站在坪的范围里、旋翼打不到的角上', () => {
    const life = new PadLife(map);
    const crew = (life as unknown as { crew: Crew[] }).crew;
    expect(crew).toHaveLength(map.pads.length);
    map.pads.forEach((p, i) => {
      const d = Math.hypot(crew[i].x - p.pos[0], crew[i].z - p.pos[2]);
      expect(d).toBeGreaterThan(5.5);
      expect(d).toBeLessThan(p.size * 0.72);
    });
  });

  it('是这一站才举手，别的坪不理你', () => {
    const life = new PadLife(map);
    const crew = (life as unknown as { crew: Crew[] }).crew;
    const c = crew.find((k) => k.pad.id === pad.id)!;
    const other = crew.find((k) => k.pad.id !== pad.id)!;
    run(life, fake(c.x + 90, c.y + 40, c.z, pad.id));
    expect(c.wave).toBeGreaterThan(0.9);
    expect(other.wave).toBeLessThan(0.05);
    run(life, fake(c.x + 2000, c.y + 40, c.z, pad.id));
    expect(c.wave).toBeLessThan(0.05);
  });

  it('飞机压到头顶，风打过来他弯腰；走了就直起来', () => {
    const life = new PadLife(map);
    const c = (life as unknown as { crew: Crew[] }).crew[0];
    run(life, fake(c.x + 8, c.y + 6, c.z, null));
    expect(c.duck).toBeGreaterThan(0.5);
    run(life, fake(c.x + 200, c.y + 6, c.z, null), 4);
    expect(c.duck).toBeLessThan(0.05);
  });

  it('卸了货堆在坪上，重来之后就没了', () => {
    const life = new PadLife(map);
    const crates = (life as unknown as { crates: { count: number } }).crates;
    expect(crates.count).toBe(0);
    life.update(fake(0, 100, 0, null, [pad.id]), 0, 1 / 30);
    expect(crates.count).toBe(3);
    life.update(fake(0, 100, 0, null, []), 0, 1 / 30);
    expect(crates.count).toBe(0);
  });
});
