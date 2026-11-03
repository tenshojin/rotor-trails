// 打印某点周围的高度网格：MAP=himalaya AT=-900,420 R=300 STEP=50
import { it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { generateWorld } from '../src/world/worldgen';

it('height grid', async () => {
  const map = getMap((process.env.MAP ?? 'himalaya') as MapId);
  const [x0, z0] = (process.env.AT ?? '0,0').split(',').map(Number);
  const R = Number(process.env.R ?? 300);
  const st = Number(process.env.STEP ?? 50);
  const w = await generateWorld(map, false);
  const rows: string[] = [];
  rows.push('z\\x ' + Array.from({ length: (2 * R) / st + 1 }, (_, i) => String(x0 - R + i * st).padStart(6)).join(''));
  for (let z = z0 - R; z <= z0 + R; z += st) {
    let row = String(z).padStart(5) + ' ';
    for (let x = x0 - R; x <= x0 + R; x += st) row += String(Math.round(w.terrain.heightAt(x, z))).padStart(6);
    rows.push(row);
  }
  console.log(rows.join('\n'));
  const nodes = map.nodes.filter((n) => Math.hypot(n.pos[0] - x0, n.pos[2] - z0) < R * 1.5).map((n) => `${n.id}:(${n.pos.join(',')})`);
  console.log(nodes.join('  '));
});
