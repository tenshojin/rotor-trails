// 坠毁之后残骸是真的掉下去的，停在地上；重来之后一切照常
import { Vector3 } from 'three';
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

  it('从检查点继续：飞机回到坪上，耐久不多掉', async () => {
    const map = getMap('japan');
    const world = await worldFor(map);
    const s = await GameSession.create(world, map.weathers[0].id, 'novice', false);
    for (let i = 0; i < 30; i++) s.step();
    s.drainEvents();
    expect(s.restoreOptions().length).toBeGreaterThan(0);
    const full = s.restoreOptions()[0];
    expect(full.durability).toBe(100);
    s.hoverAt(s.body.pos.x + 150, 60, s.body.pos.z + 200, 0);
    for (let i = 0; i < 60; i++) s.step();
    crash(s);
    for (let i = 0; i < 300; i++) s.step();
    s.restoreCheckpoint(full.index, 'exact');
    expect(s.state).toBe('running');
    expect(s.damage.durability).toBe(100);
    const events: string[] = [];
    for (let i = 0; i < 120; i++) {
      s.step();
      for (const e of s.drainEvents()) events.push(JSON.stringify(e).slice(0, 120));
    }
    expect(s.damage.durability, events.join(' | ')).toBe(100);
    s.dispose();
  });

  it('贴地撞毁之后从检查点继续：不会平白掉一截耐久', async () => {
    const map = getMap('japan');
    const world = await worldFor(map);
    const s = await GameSession.create(world, map.weathers[0].id, 'novice', false);
    for (let i = 0; i < 30; i++) s.step();
    const full = s.restoreOptions()[0];
    s.hoverAt(s.body.pos.x + 40, 12, s.body.pos.z + 40, 0);
    // 机头朝下扎进去：坠毁前最后的姿态读数是大角度，恢复之后不能拿它当“接地姿态”
    s.body.quat.setFromAxisAngle(new Vector3(1, 0, 0), -0.5);
    s.damage.durability = 3;
    s.body.vel.set(14, -22, 8);
    s.phys.writeBody(s.body);
    for (let i = 0; i < 300 && s.state === 'running'; i++) s.step();
    expect(s.state).toBe('crashed');
    expect(Math.abs(s.flight.telemetry.pitch)).toBeGreaterThan(0.2);
    for (let i = 0; i < 120; i++) s.step();
    s.drainEvents();
    s.restoreCheckpoint(full.index, 'exact');
    expect(Math.abs(s.flight.telemetry.pitch)).toBeLessThan(0.1);
    const seen: string[] = [];
    for (let i = 0; i < 180; i++) {
      s.step();
      for (const e of s.drainEvents()) seen.push(e.type);
    }
    expect(s.state).toBe('running');
    expect(seen).not.toContain('touchdown');
    expect(s.damage.durability).toBe(100);
    s.dispose();
  });

  it('起点检查点记得飞机停在坪上：安全恢复也放回地面，不是悬在 25 米高', async () => {
    const map = getMap('japan');
    const world = await worldFor(map);
    const s = await GameSession.create(world, map.weathers[0].id, 'novice', false);
    const y0 = s.body.pos.y;
    const full = s.restoreOptions()[0];
    for (let i = 0; i < 30; i++) s.step();
    s.hoverAt(s.body.pos.x + 150, 60, s.body.pos.z + 200, 0);
    crash(s);
    s.restoreCheckpoint(full.index, 'safe');
    expect(s.body.pos.y).toBeCloseTo(y0, 1);
    expect(s.flight.hoverOn).toBe(false);
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
