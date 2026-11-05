// Exercise both checkpoint modes through the real crash/recovery/mission path,
// on production terrain and weather rather than only a flat unit-test world.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { Autopilot, runAutopilot } from '../src/sim/autopilot';
import { sessionFor } from '../tests/helpers';

const cases: Array<[MapId, string]> = [
  ['training', 'clear'], ['japan', 'rain'], ['canyon', 'gusty'],
  ['amazon', 'dynamic'], ['fjord', 'fog'], ['himalaya', 'windy'],
];

describe('crash and checkpoint recovery on every map', () => {
  for (const [mapId, weather] of cases) for (const mode of ['exact', 'safe'] as const) {
    it(`${mapId} / ${weather} / ${mode}`, async () => {
      const map = getMap(mapId);
      expect(map.weathers.some((preset) => preset.id === weather)).toBe(true);
      const session = await sessionFor(map, 'standard', weather);
      try {
        const pilot = new Autopilot(session);
        // Save after takeoff, while moving; safe mode must brake and stabilise,
        // while exact mode must preserve the stored flight state.
        for (let i = 0; i < 120 * 60 && session.state === 'running'; i++) {
          pilot.update();
          session.step();
          session.drainEvents();
          if (session.t > 10 && session.agl > 20 && session.groundSpeed > 8) break;
        }
        expect(session.state).toBe('running');
        expect(session.agl).toBeGreaterThan(20);
        expect(session.groundSpeed).toBeGreaterThan(8);
        session.saveCheckpoint('恢复验收：空中');
        const index = session.checkpoints.length - 1;
        const savedTime = session.t;
        const savedVelocity = session.body.vel.toArray();
        session.damage.durability = 0;
        session.step();
        expect(session.state).toBe('crashed');
        session.restoreCheckpoint(index, mode);
        expect(session.state).toBe('running');
        expect(session.t).toBe(savedTime);
        expect(session.damage.durability).toBe(100);
        expect(session.body.vel.toArray()).toEqual(mode === 'safe' ? [0, 0, 0] : savedVelocity);
        expect(session.stats.safeRecoveries).toBe(mode === 'safe' ? 1 : 0);
        const result = runAutopilot(session, 1500);
        mkdirSync('tmp/recovery-acceptance', { recursive: true });
        writeFileSync(`tmp/recovery-acceptance/${mapId}_${mode}.json`, JSON.stringify({
          map: mapId, weather, mode, savedTime, ...result,
          restores: session.stats.restores, safeRecoveries: session.stats.safeRecoveries,
        }, null, 2));
        expect(result.completed).toBe(true);
        expect(result.crashed).toBe(false);
        expect(result.collisions).toBe(0);
        expect(result.durability).toBe(100);
        expect([...session.body.pos.toArray(), ...session.body.vel.toArray(), session.agl].every(Number.isFinite)).toBe(true);
      } finally {
        session.dispose();
      }
    });
  }
});
