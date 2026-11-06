import { describe, expect, it } from 'vitest';
import { PressQueue } from '../src/sim/controls';

describe('超仿真：点下去到手碰到控件之间', () => {
  it('手没碰到就不算按下，碰到的那一帧才生效', () => {
    const q = new PressQueue<string>();
    const pressed: string[] = [];
    let touching = false;
    const reached: string[] = [];
    const step = () =>
      q.step(
        1 / 60,
        (s) => {
          reached.push(s);
          return touching;
        },
        (s) => pressed.push(s),
      );
    q.push('fuel', 1);
    step();
    step();
    expect(pressed).toEqual([]);
    expect(reached).toEqual(['fuel', 'fuel']);
    touching = true;
    step();
    expect(pressed).toEqual(['fuel']);
    expect(q.length).toBe(0);
  });

  it('什么都没点时手不动', () => {
    const q = new PressQueue<string>();
    let asked = 0;
    q.step(
      1,
      () => {
        asked++;
        return true;
      },
      () => {},
    );
    expect(asked).toBe(0);
  });

  it('连着点了几个控件：手一个一个按过去，不会同时够两个', () => {
    const q = new PressQueue<string>();
    const pressed: string[] = [];
    let at = 'a';
    const asked: string[] = [];
    const step = () =>
      q.step(
        1 / 60,
        (s) => {
          asked.push(s);
          return s === at;
        },
        (s) => pressed.push(s),
      );
    q.push('a', 1);
    q.push('b', 1);
    step();
    expect(pressed).toEqual(['a']);
    expect(asked).toEqual(['a', 'b']);
    step();
    expect(pressed).toEqual(['a']);
    at = 'b';
    step();
    expect(pressed).toEqual(['a', 'b']);
  });

  it('手一直够不到也不能让按钮失灵：等一会儿照样生效，方向不变', () => {
    const q = new PressQueue<string>();
    const pressed: Array<[string, number]> = [];
    q.push('stuck', -1);
    for (let i = 0; i < 40; i++)
      q.step(
        0.05,
        () => false,
        (s, d) => pressed.push([s, d]),
      );
    expect(pressed).toEqual([['stuck', -1]]);
  });

  it('滚轮滚得再快也不会排出一长串', () => {
    const q = new PressQueue<string>();
    for (let i = 0; i < 100; i++) q.push('dial', 1);
    expect(q.length).toBeLessThanOrEqual(12);
    q.clear();
    expect(q.length).toBe(0);
  });
});
