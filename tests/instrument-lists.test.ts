import { expect, it } from 'vitest';
import { InstrumentLists } from '../src/game/instrumentLists';
import type { GameSession } from '../src/sim/session';

function fixture() {
  const optional = [{ status: 'pending', pos: [10, 0, 20] }];
  const current = { pos: [30, 0, 40] };
  const session = {
    body: { pos: { x: 1, z: 2 } }, nav: { info: { preview: [{ pos: [3, 0, 4] }] } },
    mission: { optional, current: (): { pos: number[] } | null => current, goalOf: (obj: { pos: number[] }) => obj.pos },
    world: { map: { pickups: [{ id: 'a', pos: [5, 0, 6], kind: 'shield' }, { id: 'b', pos: [7, 0, 8], kind: 'repair' }] } },
    pickupsTaken: new Set<string>(),
  };
  return { session, read: session as unknown as GameSession };
}

it('连续仪表更新复用数组与点，同时刷新移动位置', () => {
  const { session, read } = fixture();
  const lists = new InstrumentLists();
  lists.update(read);
  const start = lists.route[0], waypoint = lists.route[1], objective = lists.objectives[0], pickup = lists.pickups[0];
  session.body.pos.x = 100;
  session.nav.info.preview[0].pos[2] = 200;
  session.mission.optional[0].pos[0] = 300;
  lists.update(read);
  expect(lists.route[0]).toBe(start);
  expect(lists.route[1]).toBe(waypoint);
  expect(lists.objectives[0]).toBe(objective);
  expect(lists.pickups[0]).toBe(pickup);
  expect(lists.route).toEqual([[100, 2], [3, 200]]);
  expect(lists.objectives).toEqual([{ x: 300, z: 20, main: false }, { x: 30, z: 40, main: true }]);
});

it('改道、完成任务、领取补给与恢复检查点不会遗留或遗漏标记', () => {
  const { session, read } = fixture();
  const lists = new InstrumentLists();
  lists.update(read);
  session.nav.info.preview.length = 0;
  session.mission.optional[0].status = 'done';
  session.mission.current = () => null;
  session.pickupsTaken.add('a');
  lists.update(read);
  expect(lists.route).toEqual([[1, 2]]);
  expect(lists.objectives).toEqual([]);
  expect(lists.pickups).toEqual([{ x: 7, z: 8, kind: 'repair' }]);
  session.pickupsTaken.clear();
  session.mission.optional[0].status = 'pending';
  lists.update(read);
  expect(lists.objectives).toEqual([{ x: 10, z: 20, main: false }]);
  expect(lists.pickups).toHaveLength(2);
  expect(lists.pickups[0]).toEqual({ x: 5, z: 6, kind: 'shield' });
});
