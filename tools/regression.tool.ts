// Cross-platform route/weather acceptance suite. Unlike the exploratory
// autorun tool, failed completion or collisions fail the process and CI.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { runAutopilot } from '../src/sim/autopilot';
import { sessionFor } from '../tests/helpers';

const maps: MapId[] = ['japan', 'canyon', 'amazon', 'fjord', 'himalaya'];
const weather: Array<[MapId, string]> = [
  ['japan', 'rain'], ['japan', 'breeze'], ['canyon', 'gusty'], ['canyon', 'windy'],
  ['amazon', 'rain'], ['amazon', 'storm'], ['amazon', 'dynamic'], ['fjord', 'fog'],
  ['fjord', 'crosswind'], ['himalaya', 'lowcloud'], ['himalaya', 'windy'],
];
const cases: Array<{ map: MapId; weather: string; paths: number[] }> = [];
const mode = process.env.REGRESSION_MODE ?? 'all';
if (!['all', 'clear', 'weather'].includes(mode)) throw new Error('REGRESSION_MODE must be all, clear or weather');
if (mode !== 'weather') for (const map of maps) for (const paths of [[0, 0], [1, 1], [0, 1], [1, 0]]) cases.push({ map, weather: 'clear', paths });
if (mode !== 'clear') for (const [map, preset] of weather) for (const paths of [[0, 0], [1, 1]]) cases.push({ map, weather: preset, paths });

describe('all campaign routes and weather', () => {
  for (const c of cases) it(`${c.map} / ${c.weather} / ${c.paths.join('-')}`, async () => {
    const map = getMap(c.map);
    const pathPref: Record<number, number> = {};
    let choice = 0;
    map.legs.forEach((leg, i) => { if (leg.paths.length > 1) pathPref[i] = c.paths[choice++] ?? 0; });
    const session = await sessionFor(map, 'standard', c.weather);
    try {
      const result = runAutopilot(session, 1500, { pathPref });
      mkdirSync('tmp/acceptance', { recursive: true });
      writeFileSync(`tmp/acceptance/${c.map}_${c.weather}_${c.paths.join('-')}.json`, JSON.stringify({ ...c, ...result }, null, 2));
      expect(result.completed, 'main objectives must complete').toBe(true);
      expect(result.crashed, 'helicopter must remain operable').toBe(false);
      expect(result.collisions, 'reference route must clear obstacles').toBe(0);
      expect(result.durability, 'collision-free route should preserve airframe').toBe(100);
    } finally {
      session.dispose();
    }
  });
});
