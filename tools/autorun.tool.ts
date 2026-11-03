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
  const r = runAutopilot(s, Number(process.env.MAXT ?? 1500), { pathPref, trace: Number(process.env.TRACE ?? 0) || undefined, traceFrom: Number(process.env.TRACE_FROM ?? 0) });
  console.log(`[${id}] paths=${JSON.stringify(pathPref)} completed=${r.completed} crashed=${r.crashed} simTime=${r.time.toFixed(0)}s (${(r.time / 60).toFixed(1)} min) durability=${r.durability.toFixed(0)} collisions=${r.collisions} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('objectives:', r.objectives.join(' | '));
  for (const l of r.log.slice(-Number(process.env.LOGN ?? 40))) console.log(`  ${l.t}s [${l.phase}] ${l.note}`);
  console.log('final pos', s.body.pos.toArray().map((v) => v.toFixed(0)).join(','), 'agl', s.agl.toFixed(1), 'nav', s.nav.info.label, s.nav.info.mode);
  const tel = s.flight.telemetry;
  console.log(
    `gear cnt=${s.gear.contactCount} wos=${s.gear.weightOnSkids.toFixed(2)} settledT=${s.settledTime.toFixed(1)} pad=${s.settledPad} surf=${s.gear.surface?.kind}:${s.gear.surface?.padId} v=${s.body.vel.length().toFixed(2)} w=${s.body.angVel.length().toFixed(3)} hover=${tel.hover} coll=${tel.collective.toFixed(2)} pitch=${((tel.pitch * 180) / Math.PI).toFixed(1)} roll=${((tel.roll * 180) / Math.PI).toFixed(1)} landing=${JSON.stringify(s.mission.current()?.landing)} lastTD=${JSON.stringify(s.lastTouchdown?.metrics)}`,
  );
  s.dispose();
});
