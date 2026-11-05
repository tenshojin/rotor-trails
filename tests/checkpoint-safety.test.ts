import { beforeAll, describe, expect, it } from 'vitest';
import { GameSession } from '../src/sim/session';
import { generateWorld, type WorldData } from '../src/world/worldgen';
import { FLAT } from './testmap';

let world: WorldData;
beforeAll(async () => {
  world = await generateWorld({
    ...FLAT, size: 512, res: 33, props: [], nodes: [], legs: [], pickups: [],
    pads: [FLAT.pads[0]],
    mission: { startCargo: 0, optional: [], main: [{ id: 'land', kind: 'land', title: '', detail: '', padId: 'S', dwell: 2, approach: [0, 30, 0] }] },
  }, false);
});

describe('安全恢复净空与累计惩罚', () => {
  it('拱下检查点安全恢复不会被抬进上方的结构内部', async () => {
    const withOverhang: WorldData = { ...world, colliders: [
      ...world.colliders,
      { kind: 'box', c: [80, 28, 0], h: [20, 5, 20], rotY: 0, tag: { kind: 'structure' } },
    ] };
    const session = await GameSession.create(withOverhang, 'calm', 'standard');
    try {
      session.teleport(80, 12, 0, 0);
      session.saveCheckpoint('拱下');
      const index = session.checkpoints.length - 1;
      session.teleport(-100, 60, 0, 0);
      session.restoreCheckpoint(index, 'safe');
      expect(session.body.pos.y).toBeGreaterThanOrEqual(33 + 25);
      for (let step = 0; step < 120; step++) session.step();
      expect(session.state).toBe('running');
      expect(session.damage.durability).toBe(100);
      expect(session.damage.collisions).toBe(0);
    } finally { session.dispose(); }
  });

  it('恢复旧检查点不会回退累计恢复次数或安全恢复扣分', async () => {
    const session = await GameSession.create(world, 'calm', 'standard');
    try {
      session.restoreCheckpoint(0, 'safe');
      session.restoreCheckpoint(0, 'safe');
      session.restoreCheckpoint(0, 'exact');
      expect(session.stats.safeRecoveries).toBe(2);
      expect(session.stats.restores).toBe(3);
      expect(session.t).toBe(0);
    } finally { session.dispose(); }
  });
});
