// 自动驾驶试飞：MAP=japan PATHS=0,1 npx vitest run --config vitest.tools.config.ts tools/autorun.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { runAutopilot } from '../src/sim/autopilot';
import { sessionFor } from '../tests/helpers';

it('autorun', async () => {
  const id = (process.env.MAP ?? 'japan') as MapId;
  const prefs = (process.env.PATHS ?? '').split(',').filter(Boolean).map(Number);
  const map = getMap(id);
  const pathPref: Record<number, number> = {};
  map.legs.forEach((l, i) => {
    if (l.paths.length > 1) pathPref[i] = prefs.shift() ?? 0;
  });
  const s = await sessionFor(map, (process.env.ASSIST as 'standard') ?? 'standard', process.env.WEATHER);
  const t0 = Date.now();
  const r = runAutopilot(s, Number(process.env.MAXT ?? 1500), { pathPref });
  console.log(`[${id}] paths=${JSON.stringify(pathPref)} completed=${r.completed} crashed=${r.crashed} simTime=${r.time.toFixed(0)}s (${(r.time / 60).toFixed(1)} min) durability=${r.durability.toFixed(0)} collisions=${r.collisions} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('objectives:', r.objectives.join(' | '));
  for (const l of r.log.slice(-40)) console.log(`  ${l.t}s [${l.phase}] ${l.note}`);
  console.log('final pos', s.body.pos.toArray().map((v) => v.toFixed(0)).join(','), 'agl', s.agl.toFixed(1), 'nav', s.nav.info.label, s.nav.info.mode);
  s.dispose();
});
