// 在区域内寻找适合建平台的点（平整度代价最小）：
// MAP=himalaya BOX=600,-1700,1900,0 HMIN=2100 HMAX=2400 npx vitest run --config vitest.tools.config.ts tools/crests.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { generateWorld } from '../src/world/worldgen';

it('crests', async () => {
  const map = getMap((process.env.MAP ?? 'himalaya') as MapId);
  const [x0, z0, x1, z1] = (process.env.BOX ?? '600,-1700,1900,0').split(',').map(Number);
  const hMin = Number(process.env.HMIN ?? -1e9);
  const hMax = Number(process.env.HMAX ?? 1e9);
  const R = Number(process.env.R ?? 30);
  const w = await generateWorld(map, false);
  const T = w.terrain;
  const pts: Array<{ x: number; z: number; h: number; med: number; cost: number; rough: number }> = [];
  for (let x = x0; x <= x1; x += 20)
    for (let z = z0; z <= z1; z += 20) {
      const hs: number[] = [T.heightAt(x, z)];
      for (const r of [R * 0.5, R])
        for (let a = 0; a < 12; a++) hs.push(T.heightAt(x + Math.cos((a / 12) * Math.PI * 2) * r, z + Math.sin((a / 12) * Math.PI * 2) * r));
      const sorted = [...hs].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      if (med < hMin || med > hMax) continue;
      const cost = hs.reduce((s, h) => s + Math.abs(h - med), 0) / hs.length;
      pts.push({ x, z, h: hs[0], med, cost, rough: sorted[sorted.length - 1] - sorted[0] });
    }
  pts.sort((a, b) => a.cost - b.cost);
  console.log(`best sites (R=${R}, median in [${hMin},${hMax}]):`);
  for (const p of pts.slice(0, 15)) console.log(`  (${p.x},${p.z}) h=${p.h.toFixed(0)} median=${p.med.toFixed(0)} meanDev=${p.cost.toFixed(1)} range=${p.rough.toFixed(0)}`);
});
