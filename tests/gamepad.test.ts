// 手柄：死区、模拟量、按键只算一次、菜单里的连发、拔掉之后清零
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PadReader, shape, type PadEdge, type PadNav } from '../src/game/gamepad';

interface FakePad {
  id: string;
  connected: boolean;
  mapping: string;
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
}

function fake(): FakePad {
  return { id: 'pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}

function plug(p: FakePad | null): void {
  vi.stubGlobal('navigator', { getGamepads: () => [p] });
}

function press(p: FakePad, i: number, v = 1): void {
  p.buttons[i] = { pressed: v > 0, value: v };
}

afterEach(() => vi.unstubAllGlobals());

describe('手柄', () => {
  it('死区里是零，推到底是一，小幅度比线性更细', () => {
    expect(shape(0.1)).toBe(0);
    expect(shape(-0.1)).toBe(0);
    expect(shape(1)).toBeCloseTo(1, 6);
    expect(shape(-1)).toBeCloseTo(-1, 6);
    expect(Math.abs(shape(0.4))).toBeLessThan(0.4);
  });

  it('摇杆和扳机是模拟量：往前推是正，RT 是爬升', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    p.axes = [0.5, -1, 0, 0];
    press(p, 7, 0.6);
    press(p, 6, 0.1);
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.connected).toBe(true);
    expect(r.forward).toBeCloseTo(1, 6);
    expect(r.turn).toBeGreaterThan(0);
    expect(r.vertical).toBeCloseTo(0.5, 6);
  });

  it('按住只算一次', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const got: PadEdge[] = [];
    press(p, 0);
    for (let i = 0; i < 5; i++) r.poll(0.016, 'fly', (a) => got.push(a), () => {});
    expect(got).toEqual(['hover']);
    press(p, 0, 0);
    r.poll(0.016, 'fly', (a) => got.push(a), () => {});
    press(p, 0);
    r.poll(0.016, 'fly', (a) => got.push(a), () => {});
    expect(got).toEqual(['hover', 'hover']);
  });

  it('菜单里 A 是确认不是悬停，方向按住会连发', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const edges: PadEdge[] = [];
    const nav: PadNav[] = [];
    press(p, 0);
    r.poll(0.016, 'menu', (a) => edges.push(a), (d) => nav.push(d));
    expect(edges).toEqual([]);
    expect(nav).toEqual(['ok']);
    nav.length = 0;
    press(p, 0, 0);
    press(p, 13);
    for (let i = 0; i < 60; i++) r.poll(0.016, 'menu', () => {}, (d) => nav.push(d));
    expect(nav[0]).toBe('down');
    expect(nav.length).toBeGreaterThanOrEqual(3);
    expect(nav.length).toBeLessThan(10);
  });

  it('菜单里也能用菜单键退出暂停', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const edges: PadEdge[] = [];
    press(p, 9);
    r.poll(0.016, 'menu', (a) => edges.push(a), () => {});
    expect(edges).toEqual(['pause']);
  });

  it('拔掉之后所有量归零', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    p.axes = [1, 1, 1, 1];
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.turn).not.toBe(0);
    plug(null);
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.connected).toBe(false);
    expect(r.turn).toBe(0);
    expect(r.lookY).toBe(0);
  });

  it('撞了一下手柄震；不支持震动的手柄不出错', () => {
    const p = fake();
    const playEffect = vi.fn().mockResolvedValue('complete');
    plug(Object.assign(p, { vibrationActuator: { playEffect } }));
    const r = new PadReader();
    r.poll(0.016, 'fly', () => {}, () => {});
    r.rumble(0.5);
    expect(playEffect).toHaveBeenCalledOnce();
    expect(playEffect.mock.calls[0][0]).toBe('dual-rumble');
    plug(fake());
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(() => r.rumble(1)).not.toThrow();
  });

  it('不是标准布局的设备不当手柄：方向盘的踏板静止时就在头上', () => {
    const p = fake();
    p.mapping = '';
    p.axes = [0, -1, 0, 0];
    plug(p);
    const r = new PadReader();
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.connected).toBe(false);
    expect(r.forward).toBe(0);
  });

  it('没有手柄接口的环境不出错', () => {
    vi.stubGlobal('navigator', {});
    expect(() => new PadReader().poll(0.016, 'fly', () => {}, () => {})).not.toThrow();
  });

  it('按下左摇杆是配平（超仿真）', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const got: PadEdge[] = [];
    press(p, 10);
    r.poll(0.016, 'fly', (a) => got.push(a), () => {});
    expect(got).toEqual(['trim']);
  });

  it('玩家动了手柄才算在用：按键、推杆算，摇杆静止时漂一点不算', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    p.axes = [0.2, -0.15, 0, 0.1];
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.used).toBe(false);
    p.axes = [0, -0.8, 0, 0];
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.used).toBe(true);
    p.axes = [0, 0, 0, 0];
    press(p, 0);
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.used).toBe(true);
    expect(r.down(0)).toBe(true);
    press(p, 0, 0);
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.used).toBe(false);
    expect(r.down(0)).toBe(false);
  });

  it('拍照面板：A 和十字键给面板（按住会连发），其余键照飞行，左摇杆不走面板', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const edges: PadEdge[] = [];
    const nav: PadNav[] = [];
    press(p, 0);
    press(p, 1);
    press(p, 8);
    r.poll(0.016, 'panel', (a) => edges.push(a), (d) => nav.push(d));
    expect(nav).toEqual(['ok']);
    expect(edges).toEqual(['boost', 'cruise']);
    press(p, 0, 0);
    press(p, 1, 0);
    press(p, 8, 0);
    nav.length = 0;
    press(p, 12);
    for (let i = 0; i < 60; i++) r.poll(0.016, 'panel', () => {}, (d) => nav.push(d));
    expect(nav[0]).toBe('up');
    expect(nav.length).toBeGreaterThanOrEqual(3);
    press(p, 12, 0);
    nav.length = 0;
    p.axes = [-1, 0, 0, 0];
    r.poll(0.016, 'panel', () => {}, (d) => nav.push(d));
    expect(nav).toEqual([]);
    expect(r.turn).toBeLessThan(0);
  });

  it('接了两个手柄：谁最后动听谁的，换手柄时上一个按着的键不算', () => {
    const a = Object.assign(fake(), { id: 'A', index: 0, timestamp: 10 });
    const b = Object.assign(fake(), { id: 'B', index: 1, timestamp: 5 });
    vi.stubGlobal('navigator', { getGamepads: () => [a, b] });
    const r = new PadReader();
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.name).toBe('A');
    // B 有人动了（时间更新）：换成 B，B 上正按着的那一下照常算
    const got: PadEdge[] = [];
    press(b, 0);
    b.timestamp = 20;
    r.poll(0.016, 'fly', (e) => got.push(e), () => {});
    expect(r.name).toBe('B');
    expect(got).toEqual(['hover']);
    // A 只是时间戳更新、没人按：不抢过去
    a.timestamp = 30;
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(r.name).toBe('B');
  });

  it('认不出布局的设备（方向盘、飞行摇杆）每个只报一次', () => {
    const wheel = Object.assign(fake(), { id: 'Wheel', mapping: '' });
    plug(wheel);
    const r = new PadReader();
    const told: string[] = [];
    r.onIgnored = (name) => told.push(name);
    r.poll(0.016, 'fly', () => {}, () => {});
    r.poll(0.016, 'menu', () => {}, () => {});
    expect(told).toEqual(['Wheel']);
    expect(r.connected).toBe(false);
  });

  it('接上、断开各通知一次', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const events: string[] = [];
    r.onConnection = (on, name) => events.push(`${on}:${name}`);
    r.poll(0.016, 'fly', () => {}, () => {});
    r.poll(0.016, 'fly', () => {}, () => {});
    plug(null);
    r.poll(0.016, 'fly', () => {}, () => {});
    r.poll(0.016, 'fly', () => {}, () => {});
    expect(events).toEqual(['true:pad', 'false:pad']);
    expect(r.used).toBe(false);
  });
});
