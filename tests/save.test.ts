import { describe, it, expect } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, SaveStore, migrate, type StorageLike } from '../src/game/save';
import { defaultSettings, sanitizeSettings } from '../src/game/settings';

class MemStorage implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

describe('本地存档', () => {
  it('首次启动：默认值，可保存并重新读取', () => {
    const st = new MemStorage();
    const a = new SaveStore(st);
    expect(a.warning).toBeNull();
    a.data.settings.fov = 80;
    a.recordResult('japan', 950, 'A', ['jo-lighthouse'], 400);
    expect(a.save()).toBe(true);
    const b = new SaveStore(st);
    expect(b.data.settings.fov).toBe(80);
    expect(b.data.maps.japan?.completed).toBe(true);
    expect(b.data.maps.japan?.bestScore).toBe(950);
    expect(JSON.parse(st.getItem(SAVE_KEY)!).version).toBe(SAVE_VERSION);
  });

  it('损坏的存档：回退默认值、给出提示，并备份原数据', () => {
    const st = new MemStorage();
    st.setItem(SAVE_KEY, '{"version":1,"settings":{"fov":7'); // 截断的 JSON
    const s = new SaveStore(st);
    expect(s.warning).toContain('损坏');
    expect(s.data.settings).toEqual(defaultSettings());
    expect(st.getItem(SAVE_KEY + '.corrupt')).toContain('"fov":7');
  });

  it('存储不可用（隐私模式/被禁止）：不报错，提示进度不会保存', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new SaveStore(broken);
    expect(s.available).toBe(false);
    expect(s.warning).toContain('不可用');
    expect(s.save()).toBe(false);
  });

  it('字段非法或来自旧/新版本：逐项校验，非法值回退默认', () => {
    const d = migrate({
      version: 0,
      settings: { fov: 999, volMaster: -3, quality: 'ultra', invertY: 'yes', bindings: { up: ['KeyQ'], down: 'oops' } },
      maps: { japan: { completed: true, bestScore: 'NaN', runs: 3.7 }, bogus: 5 },
      tutorialDone: true,
    });
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.settings.fov).toBe(100); // 超出范围的数值被夹到边界
    expect(d.settings.volMaster).toBe(0);
    expect(d.settings.quality).toBe(defaultSettings().quality);
    expect(d.settings.invertY).toBe(false);
    expect(d.settings.bindings.up).toEqual(['KeyQ']);
    expect(d.settings.bindings.down).toEqual(defaultSettings().bindings.down);
    expect(d.maps.japan?.bestScore).toBe(0);
    expect(d.maps.japan?.runs).toBe(3);
    expect(d.tutorialDone).toBe(true);
    expect(migrate(null).settings).toEqual(defaultSettings());
    expect(sanitizeSettings('garbage')).toEqual(defaultSettings());
  });
});
