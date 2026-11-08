// 拿起手柄：提示里的按键名换成手柄上的（按动作找，改过键也对得上）；改键页、键盘表还是键盘的名字
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, keyLabel, keyName, padNamesOn, usePadNames, useTouchNames, type Action } from '../src/game/settings';

afterEach(() => {
  usePadNames(null);
  useTouchNames(false);
});

const copy = (): Record<Action, string[]> => Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([a, c]) => [a, [...c]])) as Record<Action, string[]>;

describe('手柄的按键名', () => {
  it('用手柄时：空格是 RT，H 是 A，暂停是菜单键，飞行键是左摇杆', () => {
    const b = copy();
    usePadNames(() => b);
    expect(padNamesOn()).toBe(true);
    expect(keyName('Space')).toBe('RT');
    expect(keyName('ShiftLeft')).toBe('LT');
    expect(keyName('KeyH')).toBe('A');
    expect(keyName('KeyV')).toBe('X');
    expect(keyName('Escape')).toBe('菜单键');
    expect(keyName('KeyP')).toBe('菜单键');
    expect(keyName('KeyW')).toBe('左摇杆上推');
    expect(keyName('KeyT')).toBe('按下左摇杆');
  });

  it('改过键也按动作找：把悬停改到 G，G 就是 A', () => {
    const b = copy();
    b.hover = ['KeyG'];
    usePadNames(() => b);
    expect(keyName('KeyG')).toBe('A');
    expect(keyName('KeyH')).toBe('H');
  });

  it('改键页和键盘表用的名字不随手柄换', () => {
    usePadNames(() => copy());
    expect(keyLabel('Space')).toBe('空格');
    expect(keyLabel('KeyH')).toBe('H');
  });

  it('放下手柄回到键盘的名字；触屏的叫法照旧', () => {
    usePadNames(() => copy());
    usePadNames(null);
    expect(keyName('Space')).toBe('空格');
    useTouchNames(true);
    expect(keyName('KeyH')).toBe('悬停');
  });
});
