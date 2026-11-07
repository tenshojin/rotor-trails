// 坠毁之后残骸是真的掉下去的，停在地上；重来之后一切照常
import { beforeAll, describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import { initPhysics } from '../src/sim/physics';
import { GameSession } from '../src/sim/session';
import { worldFor } from './helpers';

async function airborne(): Promise<GameSession> {
  const map = getMap('training');
  const world = await worldFor(map);
  const s = await GameSession.create(world, map.weathers[0].id, 'novice', true);
  s.hoverAt(0, 80, 0, 0);
  return s;
}

function crash(s: GameSession): void {
  s.damage.durability = 0;
  s.step();
  expect(s.state).toBe('crashed');
}

describe('残骸', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('空中坠毁：不会定在半空，掉到地上停住', async () => {
    const s = await airborne();
    const y0 = s.body.pos.y;
    crash(s);
    let peak = 0;
    for (let i = 0; i < 60 * 7; i++) {
      s.step();
      peak = Math.max(peak, Math.abs(s.body.vel.y));
    }
    const ground = s.world.ctx.ground(s.body.pos.x, s.body.pos.z);
    expect(s.body.pos.y).toBeLessThan(y0 - 40);
    expect(s.body.pos.y - ground).toBeLessThan(2);
    expect(s.body.pos.y - ground).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(10);
    const q = s.body.quat;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 4);
    s.dispose();
  });

  it('停稳了就不再动，画面的插值也不抖', async () => {
    const s = await airborne();
    crash(s);
    for (let i = 0; i < 60 * 9; i++) s.step();
    const a = s.body.pos.clone();
    s.step();
    expect(s.body.pos.distanceTo(a)).toBeLessThan(1e-3);
    expect(s.prev.pos.distanceTo(s.body.pos)).toBeLessThan(1e-3);
    s.dispose();
  });

  it('坠毁不算时间、不发新的事件', async () => {
    const s = await airborne();
    crash(s);
    s.drainEvents();
    const t = s.t;
    for (let i = 0; i < 120; i++) s.step();
    expect(s.t).toBe(t);
    expect(s.drainEvents()).toEqual([]);
    s.dispose();
  });
});
