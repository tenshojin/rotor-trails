// 休闲模式验收：每张地图、每个景点都能安全到达，自动巡航飞 8 分钟不撞东西。
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { ScenicCruise, vistasOf } from '../src/sim/cruise';
import { GameSession } from '../src/sim/session';
import { worldFor } from '../tests/helpers';

const MAPS: MapId[] = ['training', 'japan', 'canyon', 'amazon', 'fjord', 'himalaya'];

describe('休闲飞行', () => {
  for (const id of MAPS) {
    it(`${id}：景点和自动巡航`, async () => {
      const map = getMap(id);
      const world = await worldFor(map);
      const s = await GameSession.create(world, map.defaultWeather, 'novice', true);
      try {
        const vistas = vistasOf(map);
        expect(vistas.length).toBeGreaterThanOrEqual(3);
        for (const v of vistas) {
          const heading = (Math.atan2(v.look[0] - v.at[0], -(v.look[1] - v.at[2])) * 180) / Math.PI;
          s.hoverAt(v.at[0], v.at[1], v.at[2], heading);
          for (let i = 0; i < 180; i++) {
            s.step();
            s.drainEvents();
          }
          expect(s.state, `${v.name} 悬停`).toBe('running');
          expect(s.agl, `${v.name} 高度`).toBeGreaterThan(15);
          expect(s.damage.collisions, `${v.name} 碰撞`).toBe(0);
        }
        s.hoverAt(vistas[0].at[0], vistas[0].at[1], vistas[0].at[2], 0);
        const cruise = new ScenicCruise(s, vistas);
        let minAgl = Infinity;
        let far = 0;
        const start = s.body.pos.clone();
        for (let i = 0; i < 480 * 60; i++) {
          cruise.update();
          s.step();
          s.drainEvents();
          if (s.state !== 'running') break;
          if (s.t > 8) minAgl = Math.min(minAgl, s.agl);
          far = Math.max(far, s.body.pos.distanceTo(start));
        }
        console.log(`${id}: 景点 ${vistas.length} 个，巡航 ${s.t.toFixed(0)} s，最低离地 ${minAgl.toFixed(0)} m，最远 ${far.toFixed(0)} m，碰撞 ${s.damage.collisions} 次`);
        expect(s.state).toBe('running');
        expect(s.damage.collisions).toBe(0);
        expect(far).toBeGreaterThan(400);
      } finally {
        s.dispose();
      }
    });
  }
});
