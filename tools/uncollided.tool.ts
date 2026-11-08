// 列出摸不到的模型：每张图里每个 Blender 模型实例，脚下（离地 0.5~2 米）有没有碰撞体。
// npx vitest run --config vitest.tools.config.ts tools/uncollided.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import type { ColliderSpec } from '../src/world/propBuilder';
import { generateWorld } from '../src/world/worldgen';

/** 碰撞体的轴对齐包围盒（转过的盒子按外接盒算） */
function aabb(c: ColliderSpec): [number, number, number, number, number, number] {
  const [x, y, z] = c.c;
  if (c.kind === 'box' || c.kind === 'boxq') {
    const r = Math.hypot(c.h[0], c.h[2]);
    const hy = c.kind === 'boxq' ? Math.hypot(c.h[0], c.h[1], c.h[2]) : c.h[1];
    return [x - r, y - hy, z - r, x + r, y + hy, z + r];
  }
  if (c.kind === 'ball') return [x - c.r, y - c.r, z - c.r, x + c.r, y + c.r, z + c.r];
  return [x - c.r, y - c.hh - c.r, z - c.r, x + c.r, y + c.hh + c.r, z + c.r];
}

it('uncollided models', async () => {
  const ids = (process.env.MAPS ?? 'training,japan,fjord,himalaya,amazon,canyon').split(',') as MapId[];
  for (const id of ids) {
    const w = await generateWorld(getMap(id), false);
    const boxes = w.colliders.map(aabb);
    const miss = new Map<string, number>();
    const total = new Map<string, number>();
    for (const m of w.builder.models) {
      total.set(m.name, (total.get(m.name) ?? 0) + 1);
      const [x, y, z] = m.pos;
      const hit = boxes.some((b) => x >= b[0] - 0.3 && x <= b[3] + 0.3 && z >= b[2] - 0.3 && z <= b[5] + 0.3 && y + 2 >= b[1] && y + 0.5 <= b[4]);
      if (!hit) miss.set(m.name, (miss.get(m.name) ?? 0) + 1);
    }
    const lines = [...miss.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ${k}/${total.get(n)}`);
    console.log(`${id}: ${w.builder.models.length} 个模型，${[...miss.values()].reduce((a, b) => a + b, 0)} 个摸不到\n  ${lines.join('\n  ')}`);
  }
}, 600000);
