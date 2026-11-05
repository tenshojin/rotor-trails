import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { CAMPAIGN, MAPS } from '../src/maps/index';
import '../src/maps/all';
import { checkRoutes, obstacleTop } from '../src/sim/routeCheck';
import { runAutopilot } from '../src/sim/autopilot';
import { run, sessionFor, worldFor } from './helpers';

describe.each(MAPS.map((m) => [m.id, m] as const))('地图 %s', (_id, map) => {
  it('数据完整：航点、航段、任务、停机坪互相对应', () => {
    const nodeIds = new Set(map.nodes.map((n) => n.id));
    expect(nodeIds.size).toBe(map.nodes.length);
    for (const leg of map.legs) {
      expect(map.mission.main.some((o) => o.id === leg.to)).toBe(true);
      for (const p of leg.paths) for (const id of p.nodes) expect(nodeIds.has(id), `${leg.to}/${p.id} → ${id}`).toBe(true);
    }
    const padIds = new Set(map.pads.map((p) => p.id));
    expect(padIds.has(map.spawn.padId)).toBe(true);
    for (const o of [...map.mission.main, ...map.mission.optional]) if (o.kind === 'land') expect(padIds.has(o.padId)).toBe(true);
    expect(map.weathers.some((w) => w.id === map.defaultWeather)).toBe(true);
  });

  it('停机坪在地图范围内、露出地面，正上方的射线首先命中停机坪本身', async () => {
    const s = await sessionFor(map);
    const half = map.size / 2;
    for (const p of map.pads) {
      expect(Math.abs(p.pos[0]) < half - 60 && Math.abs(p.pos[2]) < half - 60, `${p.id} 超出地图`).toBe(true);
      expect(p.pos[1], `${p.id} 低于地形`).toBeGreaterThanOrEqual(s.world.terrain.heightAt(p.pos[0], p.pos[2]) - 0.05);
      const hit = s.phys.castDown(new Vector3(p.pos[0], p.pos[1] + 60, p.pos[2]), 200, true);
      expect(hit, `${p.id} 无命中`).not.toBeNull();
      expect(hit!.tag.padId, `${p.id} 被其他物体覆盖（命中 ${hit!.tag.kind}）`).toBe(p.id);
      expect(Math.abs(p.pos[1] + 60 - hit!.distance - p.pos[1])).toBeLessThan(0.6);
    }
    s.dispose();
  });

  it('出生点稳定：停在坪上不弹跳、不受损', async () => {
    const s = await sessionFor(map);
    run(s, 3, {});
    expect(s.gear.contactCount).toBeGreaterThanOrEqual(3);
    expect(s.damage.durability).toBe(100);
    expect(s.body.vel.length()).toBeLessThan(0.1);
    s.dispose();
  });

  it('航线净空检查：所有路线都不穿过地形、水面、建筑或树冠', async () => {
    const w = await worldFor(map);
    const spawn = w.pads.get(map.spawn.padId)!.pos;
    const issues = checkRoutes(w, spawn);
    expect(issues.map((i) => `leg${i.leg}/${i.path} (${i.x.toFixed(0)},${i.z.toFixed(0)}) y=${i.y.toFixed(0)} obst=${i.obstacle.toFixed(0)}`)).toEqual([]);
  });

  it('补给在地图范围内且不在障碍物里', async () => {
    const w = await worldFor(map);
    for (const p of w.map.pickups) {
      expect(Math.abs(p.pos[0]) < map.size / 2 - 60 && Math.abs(p.pos[2]) < map.size / 2 - 60).toBe(true);
      const top = obstacleTop(w, p.pos[0], p.pos[2], 4, p.pos[1]);
      expect(p.pos[1] - top, `${p.id} 离障碍太近`).toBeGreaterThan(4);
    }
  });
});

describe.each(CAMPAIGN.map((id) => [id] as const))('关卡设计要求 %s', (id) => {
  const map = MAPS.find((m) => m.id === id)!;
  it('至少两处有意义的路线选择、可选任务、维修/备降点、多种天气、检查点', () => {
    expect(map.legs.filter((l) => l.paths.length >= 2).length).toBeGreaterThanOrEqual(2);
    for (const l of map.legs) if (l.paths.length >= 2) for (const p of l.paths) expect(p.detail.length).toBeGreaterThan(8);
    expect(map.mission.main.length).toBeGreaterThanOrEqual(3);
    expect(map.mission.optional.length).toBeGreaterThanOrEqual(1);
    expect(map.pads.some((p) => p.kind === 'repair')).toBe(true);
    expect(map.pads.some((p) => p.kind === 'final')).toBe(true);
    expect(map.weathers.length).toBeGreaterThanOrEqual(2);
    expect(map.nodes.filter((n) => n.checkpoint).length).toBeGreaterThanOrEqual(2);
    expect(map.landmarks.length).toBeGreaterThanOrEqual(2);
  });

  it('自动驾驶（只用飞行员输入）走默认路线完成主线，无碰撞', async () => {
    const s = await sessionFor(map, 'standard');
    const r = runAutopilot(s, 1500);
    expect(r.log.filter((l) => l.note.startsWith('受损'))).toEqual([]);
    expect(r.completed).toBe(true);
    expect(r.collisions).toBe(0);
    s.dispose();
  });
});
