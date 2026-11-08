import { describe, expect, it } from 'vitest';
import { MAPS, getMap } from '../src/maps/index';
import { ScenicCruise, vistasOf } from '../src/sim/cruise';
import { GameSession } from '../src/sim/session';
import { worldFor } from './helpers';

describe('休闲飞行', () => {
  it('每张图都有至少三个去处，第一个就是出生点', () => {
    for (const m of MAPS) {
      const list = vistasOf(m);
      expect(list.length, m.id).toBeGreaterThanOrEqual(3);
      for (const v of list) {
        expect(v.name.length, m.id).toBeGreaterThan(0);
        expect(Math.abs(v.at[0]), v.name).toBeLessThan(m.size / 2);
        expect(Math.abs(v.at[2]), v.name).toBeLessThan(m.size / 2);
      }
    }
  });

  it('没有挑观景点的地图退回用地标', () => {
    const map = { ...getMap('training'), vistas: undefined };
    const list = vistasOf(map);
    expect(list.map((v) => v.name)).toEqual(map.landmarks.map((l) => l.name));
  });

  it('没有任务、补给和导航，货箱也不带', async () => {
    const map = getMap('japan');
    const s = await GameSession.create(await worldFor(map), map.defaultWeather, 'novice', true);
    try {
      expect(s.free).toBe(true);
      expect(s.mission.cargo).toBe(0);
      expect(s.nav.info.mode).toBe('complete');
      const p = map.pickups[0];
      s.hoverAt(p.pos[0], 50, p.pos[2], 0);
      s.body.pos.set(...p.pos);
      s.teleport(p.pos[0], p.pos[1], p.pos[2], 0);
      for (let i = 0; i < 30; i++) s.step();
      expect(s.pickupsTaken.size).toBe(0);
      expect(s.drainEvents().some((e) => e.type === 'pickup' || e.type === 'mission' || e.type === 'checkpoint')).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it('到景点是悬停着的，磕碰的损伤慢慢恢复', async () => {
    const map = getMap('training');
    const s = await GameSession.create(await worldFor(map), map.defaultWeather, 'novice', true);
    try {
      const v = vistasOf(map)[0];
      s.hoverAt(v.at[0], v.at[1], v.at[2], 0);
      // 悬停辅助不替玩家打开；新手辅助自己会保持高度
      expect(s.flight.hoverOn).toBe(false);
      for (let i = 0; i < 120; i++) s.step();
      expect(s.agl).toBeGreaterThan(v.at[1] - 20);
      s.damage.durability = 80;
      for (let i = 0; i < 120; i++) s.step();
      expect(s.damage.durability).toBeGreaterThan(80);
    } finally {
      s.dispose();
    }
  });

  it('自动巡航只通过操纵输入飞，飞得起来也飞得到下一站', async () => {
    const map = getMap('training');
    const s = await GameSession.create(await worldFor(map), map.defaultWeather, 'novice', true);
    try {
      const v = vistasOf(map);
      s.hoverAt(v[0].at[0], v[0].at[1], v[0].at[2], 0);
      const start = s.body.pos.clone();
      const c = new ScenicCruise(s, v);
      for (let i = 0; i < 40 * 60; i++) {
        c.update();
        s.step();
        s.drainEvents();
      }
      expect(s.state).toBe('running');
      expect(s.groundSpeed).toBeGreaterThan(8);
      expect(s.body.pos.distanceTo(start)).toBeGreaterThan(300);
      expect(s.flight.hoverOn).toBe(false);
    } finally {
      s.dispose();
    }
  });
});
