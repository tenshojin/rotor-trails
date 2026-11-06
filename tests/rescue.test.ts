import { describe, expect, it } from 'vitest';
import { GRAND_CANYON } from '../src/maps/grandcanyon';
import type { PadDef, RescueDef } from '../src/maps/types';
import { MissionRuntime, type MissionEvent } from '../src/sim/mission';
import { HOIST, RescueRuntime, conditionLabel, rescueDistance, rescueMission } from '../src/sim/rescue';
import { computeScore } from '../src/sim/scoring';
import { Heightfield } from '../src/sim/terrain';
import { Navigator } from '../src/sim/nav';
import { SaveStore, migrate } from '../src/game/save';

const pads = new Map(GRAND_CANYON.pads.map((p) => [p.id, p] as const));
const rescues = GRAND_CANYON.rescues!;

describe('救援任务的配置', () => {
  it('四趟任务，从短到长，一趟比一趟难', () => {
    expect(rescues.map((r) => r.id)).toEqual(['plateau', 'rim2rim', 'hance', 'shift']);
    for (let i = 1; i < rescues.length; i++) expect(rescues[i].stars).toBeGreaterThan(rescues[i - 1].stars);
    expect(rescues.at(-1)!.km).toBeGreaterThan(90);
    expect(rescues.at(-1)!.minutes[0]).toBeGreaterThanOrEqual(40);
  });

  it('每一站的坪都存在，都在能飞的范围里', () => {
    const half = GRAND_CANYON.flightSize! / 2;
    for (const r of rescues) {
      expect(pads.get(r.start), r.id).toBeTruthy();
      for (const s of r.stops) {
        const p = pads.get(s.pad);
        expect(p, `${r.id} ${s.pad}`).toBeTruthy();
        expect(Math.abs(p!.pos[0])).toBeLessThan(half - 200);
        expect(Math.abs(p!.pos[2])).toBeLessThan(half - 200);
      }
    }
  });

  it('简报上写的公里数和实际航线对得上', () => {
    for (const r of rescues) expect(Math.abs(rescueDistance(r, pads) / 1000 - r.km) / r.km, r.id).toBeLessThan(0.12);
  });

  it('接人和送人配对：不会没接到人就去交接，最后都回到基地', () => {
    for (const r of rescues) {
      let aboard = 0;
      for (const s of r.stops) {
        if (s.what === 'load' || s.what === 'hoist') aboard++;
        if (s.what === 'unload') aboard--;
        expect(aboard, r.id).toBeGreaterThanOrEqual(0);
      }
      expect(aboard, r.id).toBe(0);
      expect(r.stops.at(-1)!.pad, r.id).toBe('R-base');
    }
  });

  it('变成任务目标：吊运是悬停，别的是落地；调度的话写在说明里', () => {
    const m = rescueMission(rescues.find((r) => r.id === 'hance')!, pads);
    expect(m.main.map((o) => o.kind)).toEqual(['land', 'hover', 'land', 'land', 'land']);
    const h = m.main[1];
    if (h.kind !== 'hover') throw new Error('不是悬停');
    expect(h.cargo).toBe('hoist');
    expect(h.minH).toBe(HOIST.minH);
    expect(h.detail).toContain('岩台');
  });
});

describe('吊运', () => {
  const pad: PadDef = { id: 'a', name: 'a', pos: [0, 100, 0], size: 18, kind: 'delivery', style: 'field' };
  const def: RescueDef = { id: 't', title: 't', summary: '', stars: 1, km: 1, minutes: [1, 2], start: 'a', heading: 0, golden: 10, stops: [{ pad: 'a', task: '吊', radio: '吊运', what: 'hoist' }, { pad: 'a', task: '送', radio: '送', what: 'unload', dwell: 1 }] };
  const ctx = (y: number) => ({ t: 0, dt: 1, pos: { x: 0, y, z: 0 }, speed: 1, skidY: y, settledPad: null, touchdown: null, airborne: true });

  it('悬停够时间，人就上来了；高度不对不算', () => {
    const m = new MissionRuntime(rescueMission(def, new Map([['a', pad]])));
    const ev: MissionEvent[] = [];
    m.update(ctx(100 + HOIST.maxH + 10), () => 9, () => pad.pos, ev);
    expect(m.main[0].progress).toBe(0);
    for (let i = 0; i < HOIST.duration; i++) m.update(ctx(100 + 20), () => 9, () => pad.pos, ev);
    expect(m.cargo).toBe(1);
    expect(ev.some((e) => e.type === 'cargo' && e.action === 'load')).toBe(true);
    expect(m.index).toBe(1);
  });
});

describe('伤员的状况', () => {
  const def = rescues[0];

  it('从接到电话起一直往下走，到黄金时间用完正好见底', () => {
    const r = new RescueRuntime(def);
    r.update(def.golden * 30, false, 0);
    expect(r.health).toBeCloseTo(50, 3);
    r.update(def.golden * 30, false, 0);
    expect(r.health).toBeCloseTo(0, 3);
    expect(conditionLabel(r.health)).toBe('生命垂危');
  });

  it('机上有人时飞得颠掉得快，没人时不算', () => {
    const calm = new RescueRuntime(def);
    const rough = new RescueRuntime(def);
    const empty = new RescueRuntime(def);
    calm.update(60, true, 1);
    rough.update(60, true, 8);
    empty.update(60, false, 8);
    expect(rough.health).toBeLessThan(calm.health - 5);
    expect(empty.health).toBeCloseTo(calm.health, 3);
  });

  it('硬着陆也伤人；送到以后不再变，下一个人从满状态开始', () => {
    const r = new RescueRuntime(rescues[3]);
    r.bump(5);
    expect(r.health).toBeCloseTo(82, 3);
    r.deliver();
    expect(r.results).toEqual([82]);
    expect(r.health).toBe(100);
    expect(r.waiting).toBe(true);
    r.deliver();
    r.deliver();
    expect(r.waiting).toBe(false);
    r.update(600, true, 9);
    expect(r.health).toBe(100);
    expect(r.score).toBeCloseTo((82 + 100 + 100) / 3, 3);
  });

  it('存档点能恢复', () => {
    const r = new RescueRuntime(rescues[3]);
    r.deliver();
    const s = r.snapshot();
    r.deliver();
    r.update(100, true, 0);
    r.restore(s);
    expect(r.delivered).toBe(1);
    expect(r.results.length).toBe(1);
    expect(r.health).toBe(100);
  });

  it('成绩：伤员状况算进总分，顶替可选任务那一栏', () => {
    const base = { mainDone: true, optionalDone: 0, optionalTotal: 0, durability: 100, collisions: 0, finalLanding: null, safeRecoveries: 0 };
    const good = computeScore({ ...base, patient: 90 });
    const bad = computeScore({ ...base, patient: 10 });
    expect(good.total - bad.total).toBe(240);
    expect(good.breakdown.some((b) => b.label === '伤员状况')).toBe(true);
    expect(good.breakdown.some((b) => b.label === '可选任务')).toBe(false);
  });

  it('救援成绩进存档，坏数据被丢掉', () => {
    const d = migrate({ version: 4, rescues: { plateau: { bestScore: 900, bestRating: 'A', runs: 2, bestTime: 700 }, bad: 3 } });
    expect(d.rescues.plateau.bestScore).toBe(900);
    expect(d.rescues.bad).toBeUndefined();
    const store = new Map<string, string>();
    const m = new SaveStore({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(m.recordRescue('plateau', 800, 'B', 600)).toBe(true);
    expect(m.recordRescue('plateau', 700, 'C', 500)).toBe(false);
    expect(m.data.rescues.plateau).toMatchObject({ bestScore: 800, bestRating: 'B', bestTime: 500, runs: 2 });
  });
});

describe('超大地图的高度', () => {
  it('核心区用精细高程，飞出去以后接外面一层', () => {
    const core = new Heightfield(100, 11, new Float32Array(121).fill(50));
    const outer = new Heightfield(400, 11, new Float32Array(121).fill(80));
    core.outer = outer;
    expect(core.heightAt(0, 0)).toBe(50);
    expect(core.heightAt(49, -49)).toBe(50);
    expect(core.heightAt(60, 0)).toBe(80);
    expect(core.heightAt(0, -150)).toBe(80);
    expect(core.inside(60, 0)).toBe(false);
  });

  it('没有设计航线时直飞目标，到跟前算进近', () => {
    const terrain = new Heightfield(100, 11, new Float32Array(121));
    const nav = new Navigator({ ...GRAND_CANYON, legs: [], nodes: [] }, terrain);
    expect(nav.update({ x: 0, y: 100, z: 0 }, 50, [5000, 100, 0], '去', null).mode).toBe('route');
    expect(nav.update({ x: 4800, y: 100, z: 0 }, 50, [5000, 100, 0], '去', null).mode).toBe('approach');
  });
});
