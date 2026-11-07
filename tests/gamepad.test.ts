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
    r.poll(0.016, false, () => {}, () => {});
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
    for (let i = 0; i < 5; i++) r.poll(0.016, false, (a) => got.push(a), () => {});
    expect(got).toEqual(['hover']);
    press(p, 0, 0);
    r.poll(0.016, false, (a) => got.push(a), () => {});
    press(p, 0);
    r.poll(0.016, false, (a) => got.push(a), () => {});
    expect(got).toEqual(['hover', 'hover']);
  });

  it('菜单里 A 是确认不是悬停，方向按住会连发', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    const edges: PadEdge[] = [];
    const nav: PadNav[] = [];
    press(p, 0);
    r.poll(0.016, true, (a) => edges.push(a), (d) => nav.push(d));
    expect(edges).toEqual([]);
    expect(nav).toEqual(['ok']);
    nav.length = 0;
    press(p, 0, 0);
    press(p, 13);
    for (let i = 0; i < 60; i++) r.poll(0.016, true, () => {}, (d) => nav.push(d));
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
    r.poll(0.016, true, (a) => edges.push(a), () => {});
    expect(edges).toEqual(['pause']);
  });

  it('拔掉之后所有量归零', () => {
    const p = fake();
    plug(p);
    const r = new PadReader();
    p.axes = [1, 1, 1, 1];
    r.poll(0.016, false, () => {}, () => {});
    expect(r.turn).not.toBe(0);
    plug(null);
    r.poll(0.016, false, () => {}, () => {});
    expect(r.connected).toBe(false);
    expect(r.turn).toBe(0);
    expect(r.lookY).toBe(0);
  });

  it('撞了一下手柄震；不支持震动的手柄不出错', () => {
    const p = fake();
    const playEffect = vi.fn().mockResolvedValue('complete');
    plug(Object.assign(p, { vibrationActuator: { playEffect } }));
    const r = new PadReader();
    r.poll(0.016, false, () => {}, () => {});
    r.rumble(0.5);
    expect(playEffect).toHaveBeenCalledOnce();
    expect(playEffect.mock.calls[0][0]).toBe('dual-rumble');
    plug(fake());
    r.poll(0.016, false, () => {}, () => {});
    expect(() => r.rumble(1)).not.toThrow();
  });

  it('不是标准布局的设备不当手柄：方向盘的踏板静止时就在头上', () => {
    const p = fake();
    p.mapping = '';
    p.axes = [0, -1, 0, 0];
    plug(p);
    const r = new PadReader();
    r.poll(0.016, false, () => {}, () => {});
    expect(r.connected).toBe(false);
    expect(r.forward).toBe(0);
  });

  it('没有手柄接口的环境不出错', () => {
    vi.stubGlobal('navigator', {});
    expect(() => new PadReader().poll(0.016, false, () => {}, () => {})).not.toThrow();
  });
});
