import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, keyName, useTouchNames, type Action } from '../src/game/settings';

afterEach(() => useTouchNames(false));

describe('手机上的操作提示', () => {
  it('飞行要用的键都换成屏幕上的摇杆和按键，提示里不留 W、Shift 这种手机上没有的东西', () => {
    useTouchNames(true);
    const flying: Action[] = ['forward', 'back', 'left', 'right', 'up', 'down', 'strafeLeft', 'strafeRight', 'hover', 'boost', 'center', 'view', 'cruise', 'pause'];
    for (const a of flying) {
      for (const code of DEFAULT_BINDINGS[a]) expect(keyName(code)).toMatch(/[一-鿿]/);
    }
    expect(keyName('KeyW')).toContain('右摇杆');
    expect(keyName('Space')).toContain('左摇杆');
  });

  it('电脑上还是键名', () => {
    expect(keyName('KeyW')).toBe('W');
    expect(keyName('Space')).not.toContain('摇杆');
  });
});
