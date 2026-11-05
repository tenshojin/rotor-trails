import { describe, expect, it } from 'vitest';
import { LESSONS, Tutorial, TUTORIAL_STEPS, type TutorialCtx } from '../src/game/tutorial';
import { defaultSettings, type Action } from '../src/game/settings';
import type { GameSession } from '../src/sim/session';

function session() {
  return {
    agl: 0,
    groundSpeed: 0,
    body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    flight: { telemetry: { heading: 0, hover: 'off' }, setHover: () => {} },
    nav: { node: 0, path: 0, info: { distance: 100 } },
    mission: { complete: false, main: [{ progress: 0 }] },
    world: { map: { nodes: [{}, {}, {}, {}] }, ctx: { ground: () => 10 } },
    pad: () => ({ pos: [0, 0, 0] }),
    teleport: () => {},
  } as unknown as GameSession;
}

function ctx(held: Action[] = [], yaw = 0): TutorialCtx {
  return { yaw, pitch: 0, held: (a) => held.includes(a), dragLook: false };
}

const indexOf = (id: string) => TUTORIAL_STEPS.findIndex((s) => s.id === id);
function jump(t: Tutorial, s: GameSession, id: string) {
  while (t.step?.id !== id) t.skip(s);
}
/** 让 ✔ 的提示走完，进到下一步 */
function settle(t: Tutorial, s: GameSession, c: TutorialCtx) {
  for (let i = 0; i < 30; i++) t.update(s, 0.05, c);
}

describe('教学内容', () => {
  it('从最基础的操作开始：先转头、认数字，再起飞，最后才是降落', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(ids[0]).toBe('welcome');
    expect(ids.indexOf('look')).toBeLessThan(ids.indexOf('liftoff'));
    expect(ids.indexOf('liftoff')).toBeLessThan(ids.indexOf('forward'));
    expect(ids.indexOf('forward')).toBeLessThan(ids.indexOf('turnL'));
    expect(ids.indexOf('turnL')).toBeLessThan(ids.indexOf('follow1'));
    expect(ids.at(-1)).toBe('down');
  });

  it('每一步都有明确的动作：要么按回车继续，要么有完成条件', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(!!step.manual !== !!step.check, step.id).toBe(true);
      expect(step.text(() => 'X', ctx()).length, step.id).toBeGreaterThan(4);
    }
  });

  it('每一课（第一课除外）都有撞了能回去的安全点', () => {
    for (const lesson of LESSONS.slice(1)) expect(lesson.steps.some((s) => s.anchor), lesson.title).toBe(true);
  });
});

describe('教学状态与提示', () => {
  it('说明页按回车或点鼠标继续，有任务的步骤点鼠标不算', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    expect(t.step?.id).toBe('welcome');
    t.click(s);
    expect(t.step?.id).toBe('look');
    t.click(s);
    expect(t.step?.id).toBe('look');
  });

  it('左右都看过才算过', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'look');
    t.update(s, 0.1, ctx([], 0.7));
    expect(t.progress).toBeCloseTo(0.5);
    t.update(s, 0.1, ctx([], -0.7));
    expect(t.progress).toBe(1);
  });

  it('达标要保持一小会才算过，然后显示 ✔ 再进下一步', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'liftoff');
    s.agl = 6;
    t.update(s, 0.1, ctx());
    s.agl = 2;
    t.update(s, 0.1, ctx());
    s.agl = 6;
    t.update(s, 0.1, ctx());
    expect(t.html()).not.toContain('tut-ok');
    t.update(s, 0.2, ctx());
    expect(t.html()).toContain('tut-ok');
    expect(t.step?.id).toBe('liftoff');
    settle(t, s, ctx());
    expect(t.step?.id).toBe('release');
  });

  it('松手这一步要真的松手，中途按键重新计时', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'release');
    for (let i = 0; i < 20; i++) t.update(s, 0.1, ctx());
    expect(t.progress).toBeCloseTo(2 / 3);
    t.update(s, 0.1, ctx(['up']));
    expect(t.progress).toBe(0);
  });

  it('恢复检查点的航向变化不当作转向进度', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'turnL');
    (s.flight.telemetry as { heading: number }).heading = Math.PI;
    t.resumeStep(s);
    t.update(s, 0.1, ctx());
    expect(t.step?.id).toBe('turnL');
    expect(t.progress).toBe(0);
  });

  it('撞了回到这一课的安全点', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'brake');
    t.rewind(s);
    expect(t.step?.id).toBe('forward');
  });

  it('没学到的操作不起作用，学到之后就开放', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    const input = { pitch: 1, turn: 1, lateral: 1, vertical: 1 };
    t.filter(input);
    expect(input).toEqual({ pitch: 0, turn: 0, lateral: 0, vertical: 0 });
    jump(t, s, 'liftoff');
    Object.assign(input, { pitch: 1, turn: 1, lateral: 1, vertical: 1 });
    t.filter(input);
    expect(input).toEqual({ pitch: 0, turn: 0, lateral: 0, vertical: 1 });
    expect(t.hoverAllowed).toBe(false);
    jump(t, s, 'forward');
    Object.assign(input, { pitch: 1, turn: 1, lateral: 1, vertical: 1 });
    t.filter(input);
    expect(input).toEqual({ pitch: 1, turn: 0, lateral: 0, vertical: 1 });
    expect(t.hoverAllowed).toBe(true);
    jump(t, s, 'turnL');
    Object.assign(input, { pitch: 1, turn: 1, lateral: 1, vertical: 1 });
    t.filter(input);
    expect(input).toEqual({ pitch: 1, turn: 1, lateral: 1, vertical: 1 });
  });

  it('HUD 只露出这一课学到的部分', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    expect(t.hud().parts).toEqual(['flight']);
    jump(t, s, 'follow1');
    expect(t.hud().parts).toContain('marker');
    expect(t.hud().parts).not.toContain('landing');
    jump(t, s, 'overPad');
    expect(t.hud().parts).toContain('landing');
    expect(t.hud().spot).toBe('landing');
  });

  it('可以直接从某一课开始，并把飞机放到这一课开始的地方', () => {
    const s = session();
    const calls: unknown[][] = [];
    (s as unknown as { teleport(...a: unknown[]): void }).teleport = (...a) => calls.push(a);
    const t = new Tutorial(defaultSettings());
    t.start(s, 2);
    expect(t.step?.id).toBe('forward');
    expect(calls).toEqual([[0, 25, 140, 0, 0]]);
    expect(t.lesson).toBe(2);
    t.start(s, 6);
    expect(t.step?.id).toBe('toPad');
    expect(s.nav.node).toBe(4);
  });

  it('一课学完时通知，全部学完才算结束', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    const lessons: number[] = [];
    t.onLesson = (l) => lessons.push(l);
    t.start(s);
    jump(t, s, 'liftoff');
    expect(lessons).toEqual([0]);
    while (!t.done) t.skip(s);
    expect(lessons).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('最后一步之前降落不算数', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    expect(t.missionLocked).toBe(true);
    jump(t, s, 'down');
    expect(t.missionLocked).toBe(false);
  });

  it('按键放大显示，按下时亮起来', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'liftoff');
    expect(t.html(ctx())).toContain('<kbd class="big ">空格</kbd>');
    expect(t.html(ctx(['up']))).toContain('<kbd class="big on">空格</kbd>');
  });

  it('训练中改键后说明立即使用当前设置', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'liftoff');
    const next = defaultSettings();
    next.bindings.up = ['KeyR'];
    t.setSettings(next);
    expect(t.html()).toContain('<kbd>R</kbd>');
    expect(t.html()).not.toContain('<kbd>空格</kbd>');
  });

  it('回车被别的操作占用后，改用鼠标和暂停菜单', () => {
    const s = session();
    const settings = defaultSettings();
    const t = new Tutorial(settings);
    t.start(s);
    expect(t.html()).toContain('按 <kbd>回车</kbd> 或点击鼠标继续');
    settings.bindings.up = ['Enter'];
    t.setSettings(settings);
    expect(t.html()).toContain('点击鼠标继续');
    expect(t.html()).not.toContain('按 <kbd>回车</kbd>');
    jump(t, s, 'look');
    expect(t.html()).toContain('可在暂停菜单跳过这一步');
    settings.bindings.up = ['Space'];
    t.setSettings(settings);
    expect(t.html()).toContain('<kbd>回车</kbd> 跳过这一步');
  });

  it('卡住一阵之后给提示', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    jump(t, s, 'liftoff');
    expect(t.html()).not.toContain('tut-note');
    for (let i = 0; i < 150; i++) t.update(s, 0.1, ctx());
    expect(t.html()).toContain('tut-note');
  });

  it('文字不变时复用，不用每帧重建', () => {
    const s = session();
    const t = new Tutorial(defaultSettings());
    t.start(s);
    const first = t.html();
    expect(t.html()).toBe(first);
    expect(indexOf('welcome')).toBe(0);
  });
});
