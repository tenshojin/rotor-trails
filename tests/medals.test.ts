import { describe, expect, it } from 'vitest';
import { MEDALS, medalRows, newMedals, type MedalWorld } from '../src/game/medals';
import { SaveStore, type SaveData } from '../src/game/save';

const WORLD: MedalWorld = {
  lessons: 7,
  simLessons: 5,
  missions: [
    { id: 'japan', optional: ['a', 'b'] },
    { id: 'canyon', optional: ['c'] },
  ],
  places: [
    { id: 'japan', total: 3 },
    { id: 'grandcanyon', total: 2 },
  ],
};

function fresh(): SaveData {
  return new SaveStore(null).data;
}

const ids = (d: SaveData) => newMedals(d, WORLD).map((m) => m.id);

describe('勋章', () => {
  it('新存档一个都没有，每枚都写着怎么拿', () => {
    const d = fresh();
    expect(ids(d)).toEqual([]);
    const rows = medalRows(d, WORLD);
    expect(rows).toHaveLength(MEDALS.length);
    for (const r of rows) {
      expect(r.done).toBe(false);
      expect(r.how.length).toBeGreaterThan(0);
    }
  });

  it('达到了只报一次', () => {
    const d = fresh();
    d.log.seconds = 90;
    expect(ids(d)).toEqual(['first']);
    expect(ids(d)).toEqual([]);
    expect(d.medals).toContain('first');
  });

  it('最轻的接地：0.2 m/s 以下才算', () => {
    const d = fresh();
    d.log.softest = 0.25;
    expect(ids(d)).toEqual([]);
    d.log.softest = 0.18;
    expect(ids(d)).toEqual(['feather']);
  });

  it('任务、可选任务、评价按地图算，训练场和大峡谷不算任务', () => {
    const d = fresh();
    d.maps.japan = { completed: true, bestScore: 1100, bestRating: 'S', optionalDone: ['a', 'b'], bestTime: 0 } as never;
    expect(ids(d)).toEqual([]);
    d.maps.canyon = { completed: true, bestScore: 900, bestRating: 'A', optionalDone: ['c'], bestTime: 0 } as never;
    expect(ids(d).sort()).toEqual(['extras', 'routes']);
    (d.maps.canyon as { bestRating: string }).bestRating = 'S';
    expect(ids(d)).toEqual(['rating']);
  });

  it('到过的地方：每张图都到全才算，多记的不算', () => {
    const d = fresh();
    d.visited.japan = ['1', '2', '3', '4', '5'];
    expect(ids(d)).toEqual([]);
    d.visited.grandcanyon = ['1', '2'];
    expect(ids(d)).toEqual(['places']);
  });

  it('进度写得对，没拿到的不超过目标', () => {
    const d = fresh();
    d.log.landings = 40;
    const rows = medalRows(d, WORLD);
    expect(rows.find((r) => r.name === '老手')?.done).toBe(true);
    expect(rows.find((r) => r.name === '机长')?.note).toBe('40 / 100');
  });
});
