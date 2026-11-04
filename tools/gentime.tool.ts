// 地图生成耗时：npx vitest run --config vitest.tools.config.ts tools/gentime.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps';
import { PROP_FNS } from '../src/world/props';
import { generateWorld } from '../src/world/worldgen';

it('gen', async () => {
  for (const id of ['japan', 'fjord', 'canyon', 'himalaya', 'amazon'] as const) {
    const map = getMap(id);
    let last = performance.now();
    const log: string[] = [];
    const t0 = last;
    // 每种道具花了多久
    const spent = new Map<string, number>();
    const fns = PROP_FNS as Record<string, (...a: unknown[]) => unknown>;
    const saved = { ...fns };
    for (const k of Object.keys(fns)) {
      fns[k] = (...a: unknown[]) => {
        const s = performance.now();
        const r = saved[k](...a);
        spent.set(k, (spent.get(k) ?? 0) + performance.now() - s);
        return r;
      };
    }
    const w = await generateWorld(map, false, (_p, label) => {
      const now = performance.now();
      log.push(`${label}@${Math.round(now - last)}`);
      last = now;
    });
    Object.assign(fns, saved);
    const total = performance.now() - t0;
    const top = [...spent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${Math.round(v)}`);
    console.log(id, Math.round(total), 'ms', log.join(' '), 'trees', w.trees.count, top.join(' '));
  }
});
