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
  it('根结构损坏但 JSON 合法时备份原数据，再恢复默认值', () => {
    for (const raw of ['null', '[]', '"broken save"', '123']) {
      const st = new MemStorage();
      st.setItem(SAVE_KEY, raw);
      const save = new SaveStore(st);
      expect(save.warning).toContain('损坏');
      expect(st.getItem(SAVE_KEY + '.corrupt')).toBe(raw);
      expect(save.data.settings).toEqual(defaultSettings());
      expect(save.save()).toBe(true);
      expect(st.getItem(SAVE_KEY + '.corrupt')).toBe(raw);
    }
  });

  it('旧客户端只读更新版本存档，保存设置与通关都不会降级覆盖', () => {
    const st = new MemStorage();
    const raw = JSON.stringify({ version: SAVE_VERSION + 1, newFutureField: { keep: true }, settings: { fov: 87 }, maps: { japan: { completed: true, bestScore: 1234 } } });
    st.setItem(SAVE_KEY, raw);
    const save = new SaveStore(st);
    expect(save.data.settings.fov).toBe(87);
    expect(save.data.maps.japan?.bestScore).toBe(1234);
    expect(save.warning).toContain('更新版本');
    expect(save.available).toBe(false);
    save.data.settings.fov = 70;
    expect(save.save()).toBe(false);
    save.recordResult('canyon', 1500, 'S', [], 300);
    expect(st.getItem(SAVE_KEY)).toBe(raw);
  });

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
      settings: { fov: 999, volMaster: -3, quality: 'extreme', invertY: 'yes', bindings: { up: ['KeyQ'], down: 'oops' } },
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
    // 座舱视点居中：没有这个字段的旧存档用默认值（居中 50%），超出 0..1 的值夹到边界
    expect(d.settings.viewCenter).toBe(defaultSettings().viewCenter);
    expect(sanitizeSettings({ viewCenter: 3 }).viewCenter).toBe(1);
    expect(sanitizeSettings({ viewCenter: -1 }).viewCenter).toBe(0);
    // 光线追踪开关：旧存档没有这个字段时默认关闭，非布尔值退回默认
    expect(d.settings.rayTracing).toBe(false);
    expect(sanitizeSettings({ rayTracing: true }).rayTracing).toBe(true);
    expect(sanitizeSettings({ rayTracing: 'yes' }).rayTracing).toBe(false);
    // 体积雾开关：旧存档没有这个字段时默认开启
    expect(d.settings.volumetric).toBe(true);
    expect(sanitizeSettings({ volumetric: false }).volumetric).toBe(false);
    expect(sanitizeSettings({ volumetric: 0 }).volumetric).toBe(true);
  });

  it('v1 存档的旧默认键位升级为新键位（下降 C、视角回正 Z），自定义键位保持不变', () => {
    const oldDefaults = { ...structuredClone(defaultSettings().bindings), down: ['ControlLeft', 'KeyX'], center: ['KeyC'] };
    const a = migrate({ version: 1, settings: { bindings: oldDefaults } });
    expect(a.settings.bindings.up).toEqual(['Space']);
    expect(a.settings.bindings.down).toEqual(['KeyC']);
    expect(a.settings.bindings.center).toEqual(['KeyZ']);
    // 玩家自己改过下降键：不动
    const b = migrate({ version: 1, settings: { bindings: { ...oldDefaults, down: ['KeyF'] } } });
    expect(b.settings.bindings.down).toEqual(['KeyF']);
    expect(b.settings.bindings.center).toEqual(['KeyC']);
    // v2 存档不再迁移
    const c = migrate({ version: 2, settings: { bindings: { ...oldDefaults } } });
    expect(c.settings.bindings.down).toEqual(['ControlLeft', 'KeyX']);
    // 默认键位里没有冲突（同一个键不绑定两个操作）
    const all = Object.values(defaultSettings().bindings).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((k) => k.startsWith('Control'))).toBe(false);
  });

  it('存储已满仍读取原进度，保存失败不会被误判为首次运行', () => {
    const raw = JSON.stringify({ version: 2, settings: { fov: 81 }, maps: { japan: { completed: true, bestScore: 1100 } } });
    const s = new SaveStore({ getItem: () => raw, setItem: () => { throw new Error('QuotaExceededError'); } });
    expect(s.fresh).toBe(false);
    expect(s.data.settings.fov).toBe(81);
    expect(s.data.maps.japan?.bestScore).toBe(1100);
    expect(s.save()).toBe(false);
    expect(s.available).toBe(false);
    expect(s.warning).toContain('保存失败');
  });

  it('读取失败或损坏备份失败时保留原数据，不写入默认值覆盖', () => {
    const writes: string[] = [];
    const unreadable = new SaveStore({ getItem: () => { throw new Error('denied'); }, setItem: (k) => { writes.push(k); } });
    expect(unreadable.save()).toBe(false);
    expect(writes).toEqual([]);
    const corrupt = new SaveStore({ getItem: () => '{broken', setItem: () => { throw new Error('full'); } });
    expect(corrupt.warning).toContain('备份失败');
    expect(corrupt.save()).toBe(false);
  });

  it('拒绝存档中的原型键、负时间和 HTML 按键，并去除重复数据', () => {
    const d = migrate(JSON.parse('{"version":2,"maps":{"__proto__":{"completed":true},"japan":{"bestTime":-3,"bestScore":-8,"bestRating":"ZZ","optionalDone":["a","a",""]}},"settings":{"bindings":{"up":["<img onerror=x>"],"forward":["KeyW","KeyW"]}}}'));
    expect(Object.getPrototypeOf(d.maps)).toBe(Object.prototype);
    expect(Object.keys(d.maps)).toEqual(['japan']);
    expect(d.maps.japan?.bestTime).toBeNull();
    expect(d.maps.japan?.bestScore).toBe(0);
    expect(d.maps.japan?.bestRating).toBe('');
    expect(d.maps.japan?.optionalDone).toEqual(['a']);
    expect(d.settings.bindings.up).toEqual(['Space']);
    expect(d.settings.bindings.forward).toEqual(['KeyW']);
  });

  it('旧键位迁移不抢占自定义 Z 键，首次零分通关仍记录评价', () => {
    const bindings = { ...defaultSettings().bindings, forward: ['KeyZ'], down: ['ControlLeft', 'KeyX'], center: ['KeyC'] };
    const migrated = migrate({ version: 1, settings: { bindings } }).settings.bindings;
    expect(migrated.forward).toEqual(['KeyZ']);
    expect(migrated.center).toEqual(['KeyC']);
    expect(migrated.down).toEqual(['ControlLeft', 'KeyX']);
    const s = new SaveStore(new MemStorage());
    expect(s.recordResult('japan', 0, 'D', [], 400)).toBe(true);
    expect(s.record('japan').bestRating).toBe('D');
    expect(s.recordResult('japan', 0, 'D', [], -5)).toBe(false);
    expect(s.record('japan').bestTime).toBe(400);
  });
});
