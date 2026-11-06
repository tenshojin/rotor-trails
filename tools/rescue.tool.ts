// 救援任务验收：真实地形数据，自动驾驶用和玩家一样的操纵输入把每一趟飞完。
// 运行：npx vitest run --config vitest.tools.config.ts tools/rescue.tool.ts --silent=false
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GRAND_CANYON } from '../src/maps/grandcanyon';
import { runAutopilot } from '../src/sim/autopilot';
import { GameSession } from '../src/sim/session';
import { generateWorld, type WorldData } from '../src/world/worldgen';

let world: WorldData;

beforeAll(async () => {
  // 游戏是用 fetch 从网站上取数据的，这里直接读磁盘上同一份文件
  vi.stubGlobal('document', { baseURI: 'http://local/' });
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public/${new URL(url).pathname.slice(1)}`)));
  world = await generateWorld(GRAND_CANYON, false);
}, 120000);

afterAll(() => vi.unstubAllGlobals());

describe('救援任务：自动驾驶飞完全程', () => {
  for (const def of GRAND_CANYON.rescues!) {
    it(def.title, async () => {
      const s = await GameSession.create(world, 'clear', 'standard', false, def);
      try {
        const r = runAutopilot(s, 60 * 90, { cruise: 55 });
        console.log(`${def.title}: 用时 ${(r.time / 60).toFixed(1)} 分钟，飞了 ${(s.stats.distance / 1000).toFixed(1)} 公里，耐久 ${r.durability.toFixed(0)}，碰撞 ${r.collisions}，伤员 ${s.rescue!.results.map((v) => Math.round(v)).join('/')}`);
        if (!r.completed) console.log(r.log.slice(-12).map((l) => `${l.t} ${l.phase} ${l.note}`).join('\n'));
        expect(r.completed, r.objectives.join(' ')).toBe(true);
        expect(r.crashed).toBe(false);
        expect(r.collisions).toBe(0);
      } finally {
        s.dispose();
      }
    }, 600000);
  }
});
