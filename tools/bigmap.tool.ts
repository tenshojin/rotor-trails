// 超大地图验收：读真实地形数据，确认核心区外面能落地、地图边界挡得住。
// 运行：npx vitest run --config vitest.tools.config.ts tools/bigmap.tool.ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GRAND_CANYON } from '../src/maps/grandcanyon';
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

describe('超大地图', () => {
  it('北缘（核心区外 12 公里）：高度接得上，飞机能落在地上', async () => {
    const s = await GameSession.create(world, 'clear', 'standard', true);
    try {
      const [x, z] = [3960, -12440];
      const ground = world.terrain.heightAt(x, z);
      expect(ground).toBeGreaterThan(2450);
      s.teleport(x, ground + 25, z, 0, 0);
      for (let i = 0; i < 60 * 120 && s.gear.contactCount < 3; i++) {
        s.input.vertical = -1;
        s.step();
      }
      s.input.vertical = 0;
      expect(s.gear.contactCount).toBeGreaterThanOrEqual(3);
      expect(s.surfaceBelow).toBe('terrain');
      expect(Math.abs(s.body.pos.y - 1.3 - world.terrain.heightAt(s.body.pos.x, s.body.pos.z))).toBeLessThan(3);
    } finally {
      s.dispose();
    }
  }, 120000);

  it('核心区和外圈交界：高度没有大台阶', () => {
    const edge = world.terrain.half;
    let worst = 0;
    for (let z = -edge + 100; z < edge; z += 100) worst = Math.max(worst, Math.abs(world.terrain.heightAt(edge - 1, z) - world.terrain.heightAt(edge + 1, z)));
    expect(worst).toBeLessThan(40);
  });

  it('地图边上：往外飞被挡在 20 公里处', async () => {
    const s = await GameSession.create(world, 'clear', 'standard', true);
    try {
      const x = 20100;
      s.teleport(x, world.terrain.heightAt(x, 0) + 500, 0, 90, 50);
      let far = 0;
      for (let i = 0; i < 60 * 25; i++) {
        s.input.pitch = 1;
        s.step();
        far = Math.max(far, s.body.pos.x);
      }
      expect(far).toBeGreaterThan(20300);
      expect(far).toBeLessThan(20490);
    } finally {
      s.dispose();
    }
  }, 120000);
});
