// 巡查任务的判定范围（2026-11-11 玩家反馈：赤岩峡谷第三个传感器“差点停在桩上了”也完成不了，
// 还以为“速度 < 25 m/s”是单位写错了——HUD 上的地速默认是 km/h）。
// 原来判定圈是一个悬在峡谷中线 36 m 高处的球，离桩 13 m，桩边离地 8 m 以下反而不算。
// 现在判定范围是闪灯下面的一根竖直圆柱，限速看水平地速，说明和提示里的限速跟着 HUD 的单位走。

import { describe, expect, it } from 'vitest';
import { fillSpeeds, speedMark } from '../src/core/speedMark';
import { speedText, withSpeeds } from '../src/game/settings';
import { MAPS, getMap } from '../src/maps/index';
import '../src/maps/all';
import type { ObjectiveDef } from '../src/maps/types';
import { MissionRuntime, inspectGap, type MissionContext } from '../src/sim/mission';
import { run, sessionFor } from './helpers';

type Inspect = Extract<ObjectiveDef, { kind: 'inspect' }>;
const canyon = getMap('canyon');
const posts = canyon.props.filter((p) => p.type === 'sensorPost');
const sensors = canyon.mission.main.find((o) => o.id === 'cm-sensors') as Inspect;
const inspects = MAPS.flatMap((m) => [...m.mission.main, ...m.mission.optional].filter((o): o is Inspect => o.kind === 'inspect').map((o) => ({ map: m.id, o })));

const ctxAt = (x: number, y: number, z: number, hspeed = 0, speed = hspeed): MissionContext => ({ t: 0, dt: 1 / 60, pos: { x, y, z }, speed, hspeed, skidY: y - 1.3, settledPad: null, touchdown: null, airborne: true });
const one = (p: Inspect['points'][number], maxSpeed = 25): MissionRuntime =>
  new MissionRuntime({ startCargo: 0, optional: [], main: [{ id: 'i', kind: 'inspect', title: '', detail: '', points: [p], maxSpeed, approach: p.pos }] });

describe('巡查：赤岩峡谷的传感器', () => {
  it.each([0, 1, 2])('传感器 %i：在桩边离地几米、几乎不动，也算巡查过', async (i) => {
    const s = await sessionFor(canyon, 'standard', 'clear');
    try {
      // 直接跳到“巡查下游传感器”这一步（第一步送补给算已完成）
      s.mission.main[0].status = 'done';
      s.mission.index = 1;
      s.mission.main[1].status = 'active';
      const [x, , z] = posts[i].pos;
      const ground = s.world.terrain.heightAt(x + 8, z);
      s.teleport(x + 8, ground + 4, z, 90, 0);
      run(s, 0.5);
      expect(s.mission.main[1].visited[i]).toBe(true);
    } finally {
      s.dispose();
    }
  });

  it('判定范围立在桩上：闪灯在桩的正上方，桩顶以上到离地 80 m 都算', () => {
    expect(sensors.points).toHaveLength(posts.length);
    sensors.points.forEach((p, i) => {
      const [x, , z] = posts[i].pos;
      expect(Math.hypot(p.pos[0] - x, p.pos[2] - z)).toBeLessThan(1);
      const floor = p.top! - 80;
      for (const h of [1, 4, 8, 20, 50, 79]) expect(inspectGap(p, { x, y: floor + h, z }).inside).toBe(true);
      expect(inspectGap(p, { x: x + 39, y: floor + 30, z }).inside).toBe(true);
      expect(inspectGap(p, { x: x + 41, y: floor + 30, z }).inside).toBe(false);
      expect(inspectGap(p, { x, y: floor + 81, z }).inside).toBe(false);
    });
  });

  it('照着航线飞（峡谷中线、谷底以上 36 m）照样每个都经过', () => {
    const route = sensors.route!;
    sensors.points.forEach((p) => {
      const near = route.reduce((a, b) => (Math.hypot(b[0] - p.pos[0], b[2] - p.pos[2]) < Math.hypot(a[0] - p.pos[0], a[2] - p.pos[2]) ? b : a));
      expect(inspectGap(p, { x: near[0], y: near[1], z: near[2] }).inside).toBe(true);
    });
  });

  it('说明里写的数和判定一致：离桩 40 m、离地 80 m、限速用记号（显示时换单位）', () => {
    expect(sensors.detail).toContain('40 m');
    expect(sensors.detail).toContain('80 m');
    expect(sensors.detail).toContain(speedMark(sensors.maxSpeed));
    expect(sensors.points.every((p) => p.radius === 40)).toBe(true);
  });
});

describe('巡查的判定范围（所有地图）', () => {
  it('以前算的位置现在都还算：原来的球整个在新的圆柱里（赤岩峡谷传感器除外，它挪到了桩上）', () => {
    for (const { map, o } of inspects) {
      if (map === 'canyon' && o.id === 'cm-sensors') continue;
      for (const p of o.points) {
        const r = p.radius * 0.999;
        for (let a = 0; a < 12; a++) {
          for (let e = -6; e <= 6; e++) {
            const th = (a / 12) * Math.PI * 2;
            const ph = (e / 6) * (Math.PI / 2);
            const q = { x: p.pos[0] + r * Math.cos(ph) * Math.cos(th), y: p.pos[1] + r * Math.sin(ph), z: p.pos[2] + r * Math.cos(ph) * Math.sin(th) };
            expect(inspectGap(p, q).inside, `${map} ${p.label}`).toBe(true);
          }
        }
      }
    }
  });

  it('闪灯正下方低飞也算（以前球的下沿以下不算）', () => {
    for (const { o } of inspects) {
      for (const p of o.points) expect(inspectGap(p, { x: p.pos[0] + p.radius * 0.5, y: p.pos[1] - p.radius - 30, z: p.pos[2] }).inside).toBe(true);
    }
  });

  it('每条巡查任务的说明都写了限速，并且用记号写（不写死 m/s）', () => {
    for (const { map, o } of inspects) {
      expect(o.detail, `${map} ${o.id}`).toContain(speedMark(o.maxSpeed));
      expect(o.detail, `${map} ${o.id}`).not.toMatch(/\d\s*m\/s/);
    }
  });
});

describe('巡查的限速和提示', () => {
  const p = { pos: [0, 30, 0] as [number, number, number], radius: 20, label: '测试点' };

  it('限速看水平地速：一边往下降一边慢慢飞也算', () => {
    const m = one(p);
    m.update(ctxAt(0, 10, 0, 20, 30), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].status).toBe('done');
  });

  it('太快：提示要减速，记号换成 HUD 的单位', () => {
    const m = one(p);
    m.update(ctxAt(0, 10, 0, 30), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].visited[0]).toBe(false);
    expect(withSpeeds(m.main[0].hint, 'kmh')).toBe('速度过快：低于 90 km/h 才能看清');
    expect(withSpeeds(m.main[0].hint, 'kt')).toBe('速度过快：低于 49 kt 才能看清');
    // 慢下来以后正常算进去
    m.update(ctxAt(0, 10, 0, 10), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].status).toBe('done');
  });

  it('快到了：提示还差几米、要不要降高、要不要减速', () => {
    const m = one(p);
    m.update(ctxAt(60, 30, 0, 10), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].hint).toBe('测试点：靠近目标 40 m');
    m.update(ctxAt(0, 80, 0, 10), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].hint).toBe('测试点：降低 30 m');
    m.update(ctxAt(60, 80, 0, 40), () => 10, () => [0, 0, 0], []);
    expect(withSpeeds(m.main[0].hint, 'kmh')).toBe('测试点：靠近目标 40 m · 降低 30 m · 减速至 90 km/h 以下');
    // 远了只说还剩几个
    m.update(ctxAt(500, 30, 0, 10), () => 10, () => [0, 0, 0], []);
    expect(m.main[0].hint).toBe('剩余 1 个巡查点');
  });
});

describe('速度记号', () => {
  it('换成玩家选的单位，和 HUD 读数一个写法', () => {
    expect(withSpeeds(`低于 ${speedMark(25)}`, 'kmh')).toBe('低于 90 km/h');
    expect(withSpeeds(`低于 ${speedMark(25)}`, 'kt')).toBe('低于 49 kt');
    expect(withSpeeds(`低于 ${speedMark(25)}`, 'ms')).toBe('低于 25 m/s');
    expect(withSpeeds(`${speedMark(30)} / ${speedMark(1.5)}`, 'kmh')).toBe(`${speedText(30, 'kmh')} / ${speedText(1.5, 'kmh')}`);
  });

  it('没有记号的文字原样不动；{0} 这类占位符不碰', () => {
    expect(fillSpeeds('保持悬停… {0}%', () => 'x')).toBe('保持悬停… {0}%');
    expect(withSpeeds('平稳降落：下降 < 2.5 m/s', 'kmh')).toBe('平稳降落：下降 < 2.5 m/s');
  });
});
