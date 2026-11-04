// 地图数据的校验和：改生成算法的性能时用它确认结果一字不差。npx vitest run --config vitest.tools.config.ts tools/genhash.tool.ts --silent=false
import { it } from 'vitest';
import { getMap } from '../src/maps';
import { generateWorld } from '../src/world/worldgen';

const fnv = (b: Uint8Array): string => {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return (h >>> 0).toString(16);
};

it('hash', async () => {
  for (const id of ['japan', 'fjord', 'canyon', 'himalaya', 'amazon'] as const) {
    const w = await generateWorld(getMap(id), false);
    console.log(id, fnv(new Uint8Array(w.terrain.data.buffer)), fnv(w.surface), w.trees.count);
  }
});
