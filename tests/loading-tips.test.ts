// 加载时的提示：按键按玩家改过的键、正在用的设备写（以前写死 J、V、U、F）；手机平板上不抽没有对应按钮的几句
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, keyName, usePadNames, useTouchNames, type Action } from '../src/game/settings';
import { TIPS, UI } from '../src/ui/menus';

afterEach(() => {
  usePadNames(null);
  useTouchNames(false);
});

const copy = (): Record<Action, string[]> => Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([a, c]) => [a, [...c]])) as Record<Action, string[]>;
const keysOf = (b: Record<Action, string[]>) => (a: Action) => keyName(b[a][0] ?? '');
const pick = (touch: boolean, keys: (a: Action) => string, rand: number): string => UI.prototype.pickTip.call({ touch, keys } as unknown as UI, rand);
const all = (keys: (a: Action) => string): string => TIPS.map((t) => t.text(keys)).join('\n');

describe('加载提示', () => {
  it('默认键位：J 巡航、V 电影镜头、U 收起 HUD、F 截图', () => {
    const text = all(keysOf(copy()));
    expect(text).toContain('<kbd>J</kbd> 自动巡航');
    expect(text).toContain('<kbd>V</kbd> 能切到电影镜头');
    expect(text).toContain('<kbd>U</kbd> 收起 HUD');
    expect(text).toContain('<kbd>F</kbd> 截图');
  });

  it('改过键就写改过的键', () => {
    const b = copy();
    b.cruise = ['KeyK'];
    b.photo = ['KeyO'];
    const text = all(keysOf(b));
    expect(text).toContain('<kbd>K</kbd> 自动巡航');
    expect(text).toContain('<kbd>O</kbd> 截图');
    expect(text).not.toContain('<kbd>J</kbd>');
  });

  it('拿着手柄写手柄的键', () => {
    const b = copy();
    usePadNames(() => b);
    const text = all(keysOf(b));
    expect(text).toContain('<kbd>视图键</kbd> 自动巡航');
    expect(text).toContain('<kbd>X</kbd> 能切到电影镜头');
    expect(text).toContain('<kbd>十字键下</kbd> 收起 HUD');
  });

  it('手机平板上不抽收起 HUD、截图、手柄那几句；电脑上每一句都抽得到', () => {
    useTouchNames(true);
    const keys = keysOf(copy());
    const phone = new Set<string>();
    const pc = new Set<string>();
    for (let i = 0; i < 400; i++) {
      phone.add(pick(true, keys, i / 400));
      pc.add(pick(false, keys, i / 400));
    }
    expect([...phone].some((t) => t.includes('收起 HUD') || t.includes('截图') || t.includes('手柄'))).toBe(false);
    expect(phone.size).toBe(TIPS.filter((t) => !t.pc).length);
    expect(pc.size).toBe(TIPS.length);
    // 触屏上巡航、视角写屏幕按钮的名字
    expect([...phone].join('\n')).toContain('<kbd>巡航</kbd> 自动巡航');
  });

  it('不提私有试玩页里没有的大峡谷', () => {
    expect(all(keysOf(copy()))).not.toContain('大峡谷');
  });
});
