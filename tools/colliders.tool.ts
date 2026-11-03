// 列出某点附近的碰撞体：MAP=amazon AT=-1738,369 R=40 npx vitest run --config vitest.tools.config.ts tools/colliders.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { generateWorld } from '../src/world/worldgen';

it('colliders near', async () => {
  const map = getMap((process.env.MAP ?? 'amazon') as MapId);
  const [x, z] = (process.env.AT ?? '0,0').split(',').map(Number);
  const r = Number(process.env.R ?? 40);
  const w = await generateWorld(map, false);
  for (const c of w.colliders) {
    const d = Math.hypot(c.c[0] - x, c.c[2] - z);
    if (d > r) continue;
    console.log(`${c.kind} tag=${c.tag.kind}:${c.tag.id ?? ''}${c.tag.padId ?? ''} c=(${c.c.map((v) => v.toFixed(1)).join(',')}) ${'h' in c ? 'h=' + c.h.map((v) => v.toFixed(1)).join(',') : ''} ${'r' in c ? 'r=' + c.r.toFixed(1) : ''} ${'hh' in c ? 'hh=' + c.hh.toFixed(1) : ''} d=${d.toFixed(0)}`);
  }
});
