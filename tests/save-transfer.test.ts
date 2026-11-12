import { beforeAll, describe, expect, it } from 'vitest';
import { SaveStore, SAVE_KEY, SAVE_VERSION, MAX_BACKUP_BYTES, type StorageLike } from '../src/game/save';
import { FLIGHTS_KEY, FLIGHT_FORMAT, type FlightSave } from '../src/game/flightSave';
import { GameSession, type SessionSave } from '../src/sim/session';
import { generateWorld } from '../src/world/worldgen';
import { FLAT } from './testmap';

let snapshot: SessionSave;
beforeAll(async () => {
  const world = await generateWorld(FLAT, false);
  const session = await GameSession.create(world, 'calm', 'standard');
  try { snapshot = JSON.parse(JSON.stringify(session.saveState())); } finally { session.dispose(); }
});

class Storage implements StorageLike {
  entries = new Map<string, string>();
  failWrite = false;
  failRead = false;
  writes = 0;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error('read denied');
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('quota');
    this.writes++;
    this.entries.set(key, value);
  }
}
const flight = (time = 1000): FlightSave => ({
  format: FLIGHT_FORMAT, savedAt: time, version: '1.1', auto: true,
  run: { map: 'japan', weather: 'clear', assist: 'standard', free: false, time: 'day' },
  sig: '1:2:3:4', info: { step: 2, total: 4, durability: 64 },
  state: structuredClone(snapshot),
});
function backup(): string {
  const storage = new Storage();
  const save = new SaveStore(storage);
  save.data.settings.fov = 88;
  save.recordResult('japan', 900, 'A', [], 250);
  save.flights.put('resume', flight());
  save.flights.put('japan/mission', { ...flight(500), auto: false });
  return save.exportText();
}
const legacy = () => JSON.stringify({ version: 4, settings: { fov: 66 }, maps: {} });

describe('完整备份与跨设备续飞', () => {
  it('两份飞行与总进度一次写入，重新打开和后续交替保存不会丢掉彼此', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    const text = backup();
    expect(SaveStore.describe(text)).toMatchObject({ completedMaps: 1, flightCount: 2 });
    expect(save.importText(text)).toBe(true);
    expect(storage.writes).toBe(1);
    expect(save.flights.get('resume')).toEqual(flight());
    const reopened = new SaveStore(storage);
    expect(reopened.data.settings.fov).toBe(88);
    reopened.data.settings.fov = 77;
    expect(reopened.save()).toBe(true);
    expect(reopened.flights.put('resume', flight(2000))).toBe(true);
    reopened.recordResult('canyon', 1200, 'S', [], 300);
    expect(new SaveStore(storage).flights.get('resume')?.savedAt).toBe(2000);
    expect(new SaveStore(storage).data.maps.canyon?.bestScore).toBe(1200);
    expect(new SaveStore(storage).data.settings.fov).toBe(77);
    expect(new SaveStore(storage).flights.get('japan/mission')?.savedAt).toBe(500);
  });

  it('完整导入写入失败时，内存、主键和独立槽位逐字保持原样；重试可成功', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.save();
    save.flights.put('resume', flight(600));
    const before = new Map(storage.entries);
    const data = save.data;
    storage.failWrite = true;
    expect(save.importText(backup())).toBe(false);
    expect(save.data).toBe(data);
    expect(storage.entries).toEqual(before);
    storage.failWrite = false;
    expect(save.importText(backup())).toBe(true);
    // The legacy source remains untouched; the embedded container is authoritative.
    expect(storage.entries.get(FLIGHTS_KEY)).toBe(before.get(FLIGHTS_KEY));
    expect(save.flights.get('resume')?.savedAt).toBe(1000);
  });

  it.each([false, true])('旧备份保留本机飞行（内嵌容器=%s）', (embedded) => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    if (embedded) save.importText(backup());
    else save.flights.put('resume', flight());
    expect(save.importText(legacy())).toBe(true);
    expect(save.data.settings.fov).toBe(66);
    expect(save.flights.get('resume')).toEqual(flight());
    expect(SaveStore.describe(legacy())?.flightCount).toBeNull();
  });

  it('缺少 flights 表示保留；完整备份的空 slots 表示清空，不能重新读出旧独立槽位', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.flights.put('resume', flight());
    const empty = { ...JSON.parse(backup()), flights: { format: FLIGHT_FORMAT, slots: {} } };
    expect(save.importText(JSON.stringify(empty))).toBe(true);
    expect(save.flights.latest()).toBeNull();
    expect(new SaveStore(storage).flights.latest()).toBeNull();
    expect(storage.entries.has(FLIGHTS_KEY)).toBe(true);
    expect(SaveStore.describe(JSON.stringify(empty))?.flightCount).toBe(0);
  });


  it('过大的备份在读取解析前拒绝，原进度和飞行不变', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.importText(backup());
    const before = new Map(storage.entries);
    const text = legacy().padEnd(MAX_BACKUP_BYTES, ' ');
    expect(SaveStore.check(text)).toBe('ok');
    expect(SaveStore.check(text + ' ')).toBe('invalid');
    expect(save.importText(text + ' ')).toBe(false);
    expect(storage.entries).toEqual(before);
  });

  it('拒绝非法和未来飞行格式，不静默丢弃坏槽位', () => {
    const base = JSON.parse(backup());
    const badFlights = [
      null, [], { format: 1, slots: [] }, { format: 1, slots: { resume: {} } },
      { format: 1, slots: { resume: { ...flight(), info: { step: -1, total: 2, durability: 100 } } } },
      { format: 1, slots: JSON.parse('{"__proto__":{}}') },
    ];
    for (const flights of badFlights) expect(SaveStore.check(JSON.stringify({ ...base, flights }))).toBe('invalid');
    expect(SaveStore.check(JSON.stringify({ ...base, flights: { format: 999, slots: {} } }))).toBe('newer');
    expect(SaveStore.check(JSON.stringify({ ...base, version: SAVE_VERSION + 1 }))).toBe('newer');
  });

  it('飞行读取失败时只能导出进度部分，不伪装成空的完整备份', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.save();
    storage.entries.set(FLIGHTS_KEY, '{broken');
    const exported = save.exportText();
    expect(SaveStore.describe(exported)?.flightCount).toBeNull();
    expect(JSON.parse(exported).flights).toBeUndefined();
    expect(storage.entries.get(FLIGHTS_KEY)).toBe('{broken');
  });

  it('主容器临时不可读时设置与飞行都拒绝覆盖，读取恢复后继续保存', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.importText(backup());
    const before = storage.entries.get(SAVE_KEY);
    storage.failRead = true;
    expect(save.save()).toBe(false);
    expect(save.flights.put('resume', flight(3000))).toBe(false);
    expect(storage.entries.get(SAVE_KEY)).toBe(before);
    storage.failRead = false;
    expect(save.flights.put('resume', flight(3000))).toBe(true);
  });

  it('完整容器写入飞行失败时保留全部数据，移除槽位后再次打开也不复活', () => {
    const storage = new Storage();
    const save = new SaveStore(storage);
    save.importText(backup());
    const before = storage.entries.get(SAVE_KEY);
    storage.failWrite = true;
    expect(save.flights.put('resume', flight(4000))).toBe(false);
    expect(storage.entries.get(SAVE_KEY)).toBe(before);
    storage.failWrite = false;
    save.flights.remove('resume');
    expect(save.flights.get('resume')).toBeNull();
    expect(new SaveStore(storage).flights.get('resume')).toBeNull();
    expect(save.flights.get('japan/mission')).not.toBeNull();
  });

  it('另一标签页导入后，旧标签页不能用旧飞行或旧进度覆盖它', () => {
    const storage = new Storage();
    const first = new SaveStore(storage);
    first.save();
    const second = new SaveStore(storage);
    expect(second.importText(backup())).toBe(true);
    const imported = storage.entries.get(SAVE_KEY);
    expect(first.hasExternalReplacement()).toBe(true);
    expect(first.save()).toBe(false);
    expect(first.flights.put('resume', flight(6000))).toBe(false);
    expect(first.importText(legacy())).toBe(false);
    expect(storage.entries.get(SAVE_KEY)).toBe(imported);
    expect(first.warning).toContain('别的标签页');
  });

  it('导入过完整备份以后飞行存档放在主存档里：坏了也是先备份到单独的键，再照常存；原来那个单独的键不碰', () => {
    const storage = new Storage();
    storage.entries.set(FLIGHTS_KEY, JSON.stringify({ format: FLIGHT_FORMAT, slots: {} }));
    const save = new SaveStore(storage);
    expect(save.importText(backup())).toBe(true);
    const legacyKey = storage.entries.get(FLIGHTS_KEY);
    const root = JSON.parse(storage.entries.get(SAVE_KEY)!);
    root.flights = { format: FLIGHT_FORMAT, slots: [] };
    storage.entries.set(SAVE_KEY, JSON.stringify(root));
    const reopened = new SaveStore(storage);
    expect(reopened.flights.put('resume', flight(7000))).toBe(true);
    expect(JSON.parse(storage.entries.get(FLIGHTS_KEY + '.corrupt')!)).toEqual({ format: FLIGHT_FORMAT, slots: [] });
    const after = JSON.parse(storage.entries.get(SAVE_KEY)!);
    expect(Object.keys(after.flights.slots)).toEqual(['resume']);
    expect(after.saveGeneration).toBe(root.saveGeneration);
    expect(after.settings.fov).toBe(88);
    expect(storage.entries.get(FLIGHTS_KEY)).toBe(legacyKey);
  });
});
