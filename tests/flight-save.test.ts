// 飞行存档：飞到一半存下来、读回去；存储格子；超仿真的开关；新按键；座舱地图的边界距离
import { beforeAll, describe, expect, it } from 'vitest';
import { GameSession, type SessionSave } from '../src/sim/session';
import { Systems } from '../src/sim/systems';
import { generateWorld, type WorldData } from '../src/world/worldgen';
import { FlightSaves, FLIGHTS_KEY, FLIGHT_FORMAT, RESUME_SLOT, ageText, isFlightSave, mapSig, progressText, slotOf, type FlightSave } from '../src/game/flightSave';
import { DEFAULT_BINDINGS, sanitizeSettings } from '../src/game/settings';
import { edgeDistance, edgeWarn } from '../src/render/instruments';
import { getMap } from '../src/maps/index';
import type { StorageLike } from '../src/game/save';
import { FLAT } from './testmap';

let world: WorldData;
beforeAll(async () => {
  world = await generateWorld(
    {
      ...FLAT,
      size: 1024,
      res: 65,
      props: [],
      pickups: [],
      mission: {
        startCargo: 0,
        optional: [],
        main: [
          { id: 'a', kind: 'land', title: '', detail: '', padId: 'P2', dwell: 2, approach: [0, 30, -400] },
          { id: 'b', kind: 'land', title: '', detail: '', padId: 'S', dwell: 2, approach: [0, 30, 0] },
        ],
      },
    },
    false,
  );
});

/** 存一份再原样读回来：JSON 走一遍，和真的存进浏览器一样 */
const viaJson = (s: SessionSave): SessionSave => JSON.parse(JSON.stringify(s)) as SessionSave;

describe('飞到一半存档、读档', () => {
  it('读回来是存的那一刻：位置、速度、耐久、任务进度、检查点、统计都对，不算一次恢复', async () => {
    const s = await GameSession.create(world, 'calm', 'standard');
    try {
      s.teleport(60, 45, -120, 90, 12);
      for (let i = 0; i < 30; i++) s.step();
      s.damage.durability = 63;
      s.mission.index = 1;
      s.saveCheckpoint('A');
      const save = viaJson(s.saveState());
      const pos = [s.body.pos.x, s.body.pos.y, s.body.pos.z];
      const vel = [s.body.vel.x, s.body.vel.y, s.body.vel.z];
      const t = s.t;
      const distance = s.stats.distance;
      const restores = s.stats.restores;
      // 存完接着乱飞一通
      s.teleport(-300, 80, 200, 0, 30);
      s.damage.durability = 20;
      s.mission.index = 0;
      s.saveCheckpoint('B');
      expect(s.restoreState(save)).toBe(true);
      expect([s.body.pos.x, s.body.pos.y, s.body.pos.z]).toEqual(pos);
      expect([s.body.vel.x, s.body.vel.y, s.body.vel.z]).toEqual(vel);
      expect(s.t).toBe(t);
      expect(s.damage.durability).toBe(63);
      expect(s.mission.index).toBe(1);
      expect(s.checkpoints.map((c) => c.label)).toEqual(save.checkpoints.map((c) => c.label));
      expect(s.checkpoints.at(-1)!.label).toBe('A');
      expect(s.stats.distance).toBe(distance);
      expect(s.stats.restores).toBe(restores);
      expect(s.state).toBe('running');
      // 读完能接着飞，也还能回检查点
      for (let i = 0; i < 60; i++) s.step();
      expect(s.state).toBe('running');
      s.restoreCheckpoint(s.checkpoints.length - 1, 'exact');
      expect(s.damage.durability).toBe(63);
    } finally {
      s.dispose();
    }
  });

  it('存档里检查点最多 8 个：起点加最近的 7 个', async () => {
    const s = await GameSession.create(world, 'calm', 'standard');
    try {
      for (let i = 1; i <= 12; i++) s.saveCheckpoint(`C${i}`, true);
      const cps = s.saveState().checkpoints;
      expect(cps.length).toBe(8);
      expect(cps[0].label).toBe(s.checkpoints[0].label);
      expect(cps.at(-1)!.label).toBe('C12');
    } finally {
      s.dispose();
    }
  });

  it('坏掉的、对不上这张图的存档不读，这一局原样不动', async () => {
    const s = await GameSession.create(world, 'calm', 'standard');
    try {
      const good = viaJson(s.saveState());
      s.teleport(10, 50, 10, 0, 0);
      const wrongMission = viaJson(good);
      wrongMission.snap.mission.main.pop();
      const nan = viaJson(good);
      nan.snap.body.pos = [Number.NaN, 0, 0] as unknown as typeof nan.snap.body.pos;
      const noCheckpoints = { ...viaJson(good), checkpoints: undefined } as unknown as SessionSave;
      for (const bad of [wrongMission, noCheckpoints, null, undefined]) expect(s.restoreState(bad as SessionSave)).toBe(false);
      // NaN 在 JSON 里会变成 null：同样不读
      expect(s.restoreState(viaJson(nan))).toBe(false);
      expect(s.body.pos.x).toBe(10);
      expect(s.restoreState(good)).toBe(true);
    } finally {
      s.dispose();
    }
  });

  it('超仿真：冷舱没启动就存的档，读回来发动机还是停着的', async () => {
    const s = await GameSession.create(world, 'calm', 'sim');
    try {
      expect(s.sys).not.toBeNull();
      expect(s.sys!.lit).toBe(false);
      s.sys!.c.batt = 1;
      s.sys!.fuelKg = 123;
      const save = viaJson(s.saveState());
      expect(save.sys).toBeTruthy();
      s.sys!.setRunning();
      s.sys!.fuelKg = 50;
      expect(s.restoreState(save)).toBe(true);
      expect(s.sys!.lit).toBe(false);
      expect(s.sys!.c.batt).toBe(1);
      expect(s.sys!.c.engMain).toBe(0);
      expect(s.sys!.fuelKg).toBe(123);
    } finally {
      s.dispose();
    }
  });

  it('快飞到地图边上（离看不见的墙 150 米以内还往外飞）就提醒，往回飞不提醒', async () => {
    const s = await GameSession.create(world, 'calm', 'standard');
    try {
      const half = 1024 / 2;
      s.teleport(half - 100, 60, 0, 90, 15);
      s.drainEvents();
      s.step();
      expect(s.drainEvents().some((e) => e.type === 'message' && e.level === 'warn' && e.text === '已到达任务区域边界，请返回')).toBe(true);
      const t = await GameSession.create(world, 'calm', 'standard');
      try {
        t.teleport(half - 100, 60, 0, 270, 15);
        t.drainEvents();
        t.step();
        expect(t.drainEvents().some((e) => e.type === 'message' && e.text === '已到达任务区域边界，请返回')).toBe(false);
      } finally {
        t.dispose();
      }
    } finally {
      s.dispose();
    }
  });
});

describe('超仿真系统的存档', () => {
  it('开关和数值原样回来；旧档里多出来的、类型不对的字段不读', () => {
    const a = new Systems();
    a.setRunning();
    a.fuelKg = 77;
    a.c.ldg = 1;
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    snap.v.notAField = 5;
    snap.v.lit = 'yes';
    const b = new Systems();
    b.restore(snap);
    expect(b.fuelKg).toBe(77);
    // lit 被写坏成了字符串：不读，留着默认值
    expect(b.lit).toBe(false);
    expect(b.n1).toBe(a.n1);
    expect(b.genOnline).toBe(true);
    expect(b.c.ldg).toBe(1);
    expect(b.c.engMain).toBe(2);
    expect((b as unknown as Record<string, unknown>).notAField).toBeUndefined();
  });
});

class MemStorage implements StorageLike {
  m = new Map<string, string>();
  fail = false;
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.fail) throw new Error('quota');
    this.m.set(k, v);
  }
}

function fake(map: string, free: boolean, savedAt: number, auto = false): FlightSave {
  return {
    format: FLIGHT_FORMAT,
    savedAt,
    version: '1.1',
    auto,
    run: { map: map as FlightSave['run']['map'], weather: 'clear', assist: 'standard', free, time: 'day' },
    sig: '1:2:3:4',
    info: { step: 2, total: 4, durability: 86.4 },
    state: {} as SessionSave,
  };
}

describe('存档的格子', () => {
  it('每张图的任务、休闲各一格，离开时自动存的单独一格；最新的那份给“继续飞行”', () => {
    const st = new MemStorage();
    const f = new FlightSaves(st);
    expect(f.put(slotOf('japan', false), fake('japan', false, 1000))).toBe(true);
    expect(f.put(slotOf('japan', true), fake('japan', true, 2000))).toBe(true);
    expect(f.put(RESUME_SLOT, fake('canyon', false, 3000, true))).toBe(true);
    expect(Object.keys(f.all()).sort()).toEqual(['japan/free', 'japan/mission', 'resume']);
    expect(f.latest()?.slot).toBe('resume');
    expect(f.forRun('japan', false)?.save.savedAt).toBe(1000);
    expect(f.forRun('canyon', false)?.slot).toBe('resume');
    expect(f.forRun('canyon', true)).toBeNull();
    f.remove(RESUME_SLOT);
    expect(f.latest()?.slot).toBe('japan/free');
    expect(f.latest((s) => !s.run.free)?.slot).toBe('japan/mission');
  });

  it('存不进去返回 false，原来的不动；读不出来当作没有', () => {
    const st = new MemStorage();
    const f = new FlightSaves(st);
    f.put('japan/mission', fake('japan', false, 1000));
    st.fail = true;
    expect(f.put('japan/mission', fake('japan', false, 5000))).toBe(false);
    expect(f.get('japan/mission')?.savedAt).toBe(1000);
    st.m.set(FLIGHTS_KEY, '{oops');
    expect(f.all()).toEqual({});
    expect(new FlightSaves(null).put('x', fake('japan', false, 1))).toBe(false);
  });

  it('外层不完整、格式不对的存档不认', () => {
    expect(isFlightSave(fake('japan', false, 1))).toBe(true);
    expect(isFlightSave({ ...fake('japan', false, 1), format: 2 })).toBe(false);
    expect(isFlightSave({ ...fake('japan', false, 1), run: { map: 'japan' } })).toBe(false);
    expect(isFlightSave({ ...fake('japan', false, 1), savedAt: Number.NaN })).toBe(false);
    expect(isFlightSave(null)).toBe(false);
  });

  it('菜单上的字：多久以前、任务进度', () => {
    const now = 10_000_000;
    expect(ageText(now - 20_000, now)).toBe('刚刚');
    expect(ageText(now - 3 * 60_000, now)).toBe('3 分钟前');
    expect(ageText(now - 5 * 3600_000, now)).toBe('5 小时前');
    expect(ageText(now - 72 * 3600_000, now)).toBe('3 天前');
    expect(progressText(fake('japan', false, 1))).toBe('任务 2/4 · 耐久 86');
    expect(progressText(fake('japan', true, 1))).toBe('休闲飞行');
  });

  it('地图改过（航点、坪、目标数变了）签名就变', () => {
    const m = getMap('japan');
    expect(mapSig(m)).toBe(mapSig({ ...m }));
    expect(mapSig({ ...m, nodes: m.nodes.slice(1) })).not.toBe(mapSig(m));
  });
});

describe('存档、读档的按键', () => {
  it('默认 K 存档、L 读档，不和别的键撞', () => {
    expect(DEFAULT_BINDINGS.quickSave).toEqual(['KeyK']);
    expect(DEFAULT_BINDINGS.quickLoad).toEqual(['KeyL']);
    const used = Object.entries(DEFAULT_BINDINGS).flatMap(([, v]) => v);
    expect(new Set(used).size).toBe(used.length);
  });

  it('旧存档里玩家已经把 K、L 改给了别的动作：新动作换一个空着的键，不去抢', () => {
    const old = { ...sanitizeSettings({}), bindings: { ...structuredClone(DEFAULT_BINDINGS), boost: ['KeyK'], cruise: ['KeyL'] } } as Record<string, unknown>;
    delete (old.bindings as Record<string, unknown>).quickSave;
    delete (old.bindings as Record<string, unknown>).quickLoad;
    const s = sanitizeSettings(old);
    expect(s.bindings.boost).toEqual(['KeyK']);
    expect(s.bindings.cruise).toEqual(['KeyL']);
    expect(s.bindings.quickSave).toEqual(['KeyO']);
    expect(s.bindings.quickLoad).toEqual(['KeyG']);
  });
});

describe('座舱地图的边界', () => {
  it('离边界的距离和提醒强度', () => {
    expect(edgeDistance(1900, 0, 2048)).toBe(148);
    expect(edgeDistance(-100, 2000, 2048)).toBe(48);
    expect(edgeDistance(3000, 0, 2048)).toBe(-952);
    expect(edgeWarn(600)).toBe(0);
    expect(edgeWarn(250)).toBe(0.5);
    expect(edgeWarn(-10)).toBe(1);
  });
});
