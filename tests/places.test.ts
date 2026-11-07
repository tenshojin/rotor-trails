import { describe, expect, it } from 'vitest';
import { directionTo, PlaceWatcher, placesOf, type Place } from '../src/game/places';
import { migrate, SaveStore, type StorageLike } from '../src/game/save';
import { MAPS, REAL_MAPS } from '../src/maps';
import { PLACE_NOTES } from '../src/maps/placeNotes';

const all = [...MAPS, ...REAL_MAPS];

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('地名字幕', () => {
  it('每张图的每个地方都有一句话，表里也没有对不上的名字', () => {
    for (const m of all) {
      const places = placesOf(m);
      expect(places.length).toBeGreaterThan(2);
      for (const p of places) expect(p.note, `${m.id} ${p.name}`).not.toBe('');
      const names = new Set(places.map((p) => p.name));
      for (const k of Object.keys(PLACE_NOTES[m.id] ?? {})) expect(names.has(k), `${m.id} ${k}`).toBe(true);
    }
  });

  it('菜单跳到一个景点，就算到了那里', () => {
    for (const m of all) {
      for (const v of m.vistas ?? []) {
        const w = new PlaceWatcher(placesOf(m).filter((p) => p.name === v.name));
        expect(w.arrive(v.at[0], v.at[2])?.name, `${m.id} ${v.name}`).toBe(v.name);
      }
    }
  });

  it('一趟飞行里每个地方只报一次，先报近的', () => {
    const a: Place = { name: 'a', note: '', x: 0, z: 0, r: 100 };
    const b: Place = { name: 'b', note: '', x: 60, z: 0, r: 100 };
    const w = new PlaceWatcher([a, b]);
    expect(w.arrive(500, 0)).toBeNull();
    expect(w.arrive(50, 0)?.name).toBe('b');
    expect(w.arrive(50, 0)?.name).toBe('a');
    expect(w.arrive(50, 0)).toBeNull();
  });

  it('方向和距离按指南针说', () => {
    const p: Place = { name: 'p', note: '', x: 0, z: -1200, r: 1 };
    expect(directionTo(0, 0, p)).toBe('北 1.2 公里');
    expect(directionTo(0, -2400, p)).toBe('南 1.2 公里');
    expect(directionTo(1200, -1200, p)).toBe('西 1.2 公里');
    expect(directionTo(-300, -900, p)).toBe('东北 420 米');
  });

  it('飞行记录存得下，坏数据读不进来', () => {
    const st = memory();
    const save = new SaveStore(st);
    save.data.log.seconds = 90;
    save.data.log.landings = 3;
    save.data.log.softest = 0.4;
    save.save();
    expect(new SaveStore(st).data.log).toEqual({ seconds: 90, landings: 3, softest: 0.4, photos: 0 });
    expect(migrate({ version: 4, log: { seconds: 'x', landings: -2, softest: NaN, photos: 2.7 } }).log).toEqual({ seconds: 0, landings: 0, softest: null, photos: 2 });
    expect(migrate({ version: 4 }).log.seconds).toBe(0);
  });

  it('到过的地方记进存档，只记一次，坏数据读不进来', () => {
    const st = memory();
    const save = new SaveStore(st);
    expect(save.visit('fjord', '七姐妹瀑布')).toBe(true);
    expect(save.visit('fjord', '七姐妹瀑布')).toBe(false);
    expect(new SaveStore(st).data.visited.fjord).toEqual(['七姐妹瀑布']);
    const bad = migrate({ version: 4, visited: { fjord: ['a', 'a', 3, ''], grandcanyon: 'x', nowhere: ['b'] } });
    expect(bad.visited).toEqual({ fjord: ['a'] });
    expect(migrate({ version: 4 }).visited).toEqual({});
  });
});
