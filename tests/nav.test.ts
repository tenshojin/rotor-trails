import { describe, expect, it } from 'vitest';
import type { MapDef, V3 } from '../src/maps/types';
import { Navigator } from '../src/sim/nav';
import { HeightBuilder } from '../src/sim/terrain';
import { FLAT } from './testmap';

function navigator(): Navigator {
  const map: MapDef = {
    ...FLAT,
    nodes: [
      { id: 'climb', pos: [0, 60, 0], radius: 20, checkpoint: true },
      { id: 'left', pos: [-200, 60, -200], radius: 30 },
      { id: 'right', pos: [200, 60, -200], radius: 30 },
    ],
    legs: [{ to: 'land', paths: [
      { id: 'left', label: '左线', tag: 'main', detail: '', nodes: ['climb', 'left'] },
      { id: 'right', label: '右线', tag: 'short', detail: '', nodes: ['climb', 'right'] },
    ] }],
  };
  const nav = new Navigator(map, new HeightBuilder(1024, 17).build());
  nav.setLeg(0, [0, 0, 0]);
  return nav;
}

describe('航线选择与恢复', () => {
  it('共用爬升段先到达高度，再分岔，恢复后保留推荐与路线进度', () => {
    const nav = navigator();
    const goal: V3 = [0, 30, -400];
    expect(nav.update({ x: 0, y: 0, z: 0 }, 0, goal, '终点', null).pathLabel).toBe('共用航段');
    expect(nav.node).toBe(0);
    expect(nav.update({ x: 0, y: 60, z: 0 }, 0, goal, '终点', null).mode).toBe('fork');
    expect(nav.passedCheckpoint?.id).toBe('climb');
    nav.cycle(0);
    const snapshot = nav.snapshot();
    nav.update({ x: 200, y: 60, z: -200 }, 0, goal, '终点', null);
    expect(nav.path).toBe(1);
    nav.setLeg(0, [500, 10, 500]);
    nav.restore(snapshot);
    expect(nav.update({ x: 0, y: 60, z: 0 }, 0, goal, '终点', null).target).toEqual([200, 60, -200]);
    expect(nav.preferred).toBe(1);
    expect(nav.legStart).toEqual([0, 0, 0]);
  });

  it('通过航点后跟随变化的巡查目标，切段后使用新的起点', () => {
    const nav = navigator();
    nav.update({ x: 0, y: 60, z: 0 }, 0, [0, 30, -400], '终点', null);
    nav.update({ x: 200, y: 60, z: -200 }, 0, [0, 30, -400], '终点', null);
    const movingGoal: V3 = [300, 80, -400];
    expect(nav.update({ x: 200, y: 60, z: -200 }, 0, movingGoal, '巡查目标', null).target).toEqual(movingGoal);
    movingGoal[1] = 100;
    expect(nav.update({ x: 250, y: 60, z: -300 }, 0, movingGoal, '巡查目标', null).targetAlt).toBe(80);
    nav.setLeg(0, [0, 0, 0]);
    expect(nav.update({ x: 0, y: 0, z: 0 }, 0, [0, 30, -400], '终点', null).pathLabel).toBe('共用航段');
  });
});
