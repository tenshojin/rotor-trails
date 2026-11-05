import { describe, expect, it } from 'vitest';
import type { MissionDef } from '../src/maps/types';
import { MissionRuntime, gradeLanding, type MissionContext, type MissionEvent } from '../src/sim/mission';

const context = (t: number): MissionContext => ({ t, dt: 1 / 60, pos: { x: 0, y: 50, z: 0 }, speed: 0, skidY: 48, settledPad: null, touchdown: null, airborne: true });

describe('任务查询与恢复', () => {
  it('着陆记录的检查点副本不与当前任务或恢复后的任务共享可变数据', () => {
    const mission = new MissionRuntime({ startCargo: 0, optional: [], main: [{
      id: 'land', kind: 'land', title: '', detail: '', padId: 'A', dwell: 1, approach: [0, 30, 0],
    }] });
    const landing = gradeLanding(0.5, 0, 0, 0, 10);
    mission.main[0].landing = landing;
    mission.finalLanding = landing;
    mission.landings.push(landing);
    const checkpoint = mission.snapshot();
    landing.score = 0;
    landing.reasons.push('later mutation');
    expect(checkpoint.finalLanding?.score).toBe(100);
    expect(checkpoint.main[0].landing?.reasons).toEqual([]);
    expect(checkpoint.landings[0].reasons).toEqual([]);
    mission.restore(checkpoint);
    mission.finalLanding!.score = 10;
    mission.main[0].landing!.reasons.push('restored mutation');
    mission.landings[0].reasons.push('restored list mutation');
    expect(checkpoint.finalLanding?.score).toBe(100);
    expect(checkpoint.main[0].landing?.reasons).toEqual([]);
    expect(checkpoint.landings[0].reasons).toEqual([]);
  });

  it.each([Number.NaN, Infinity, -Infinity])('无效着陆观测 %s 不能获得安全着陆与有效分数', (invalid) => {
    for (let field = 0; field < 5; field++) {
      const args: [number, number, number, number, number] = [0.5, 0, 0, 0, 10];
      args[field] = invalid;
      const landing = gradeLanding(...args);
      expect(landing.safe).toBe(false);
      expect(landing.grade).toBe('unsafe');
      expect(landing.score).toBe(0);
      expect(landing.reasons.length).toBeGreaterThan(0);
    }
  });

  it('查询巡查目标不改变任务状态，推进由固定仿真步负责', () => {
    const mission = new MissionRuntime({ startCargo: 0, optional: [], main: [{
      id: 'inspect', kind: 'inspect', title: '', detail: '', approach: [0, 50, 0], maxSpeed: 20,
      points: [{ pos: [1000, 50, 0], radius: 20, label: '终点' }],
      route: [[0, 50, 0], [100, 50, 0], [1000, 50, 0]],
    }] });
    const current = mission.current()!;
    const ctx = context(0);
    const before = mission.snapshot();
    for (let i = 0; i < 3; i++) mission.goalOf(current, ctx.pos);
    expect(mission.snapshot()).toEqual(before);
    mission.update(ctx, () => 10, () => [0, 0, 0], []);
    expect(current.routeIdx).toBe(1);
    expect(mission.goalOf(current, ctx.pos)).toEqual([100, 50, 0]);
    mission.locked = true;
    ctx.pos.x = 100;
    mission.update(ctx, () => 10, () => [0, 0, 0], []);
    mission.goalOf(current, ctx.pos);
    expect(current.routeIdx).toBe(1);
  });

  it('回到较早检查点后，后续停机坪提示仍能立即触发', () => {
    const def: MissionDef = { startCargo: 0, optional: [], main: ['A', 'B'].map((padId) => ({
      id: padId, kind: 'land', title: padId, detail: '', padId, dwell: 1, approach: [0, 40, 0],
    })) };
    const mission = new MissionRuntime(def);
    const snapshot = mission.snapshot();
    const ctx = context(100);
    ctx.touchdown = { padId: 'B', metrics: gradeLanding(0.5, 0, 0, 0, 10) };
    const events: MissionEvent[] = [];
    mission.update(ctx, () => 10, () => [0, 0, 0], events);
    expect(events.some((e) => e.type === 'lockedPad')).toBe(true);
    mission.restore(snapshot);
    ctx.t = 1;
    events.length = 0;
    mission.update(ctx, () => 10, () => [0, 0, 0], events);
    expect(events.some((e) => e.type === 'lockedPad')).toBe(true);
  });
});
