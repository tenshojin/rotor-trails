import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructed = vi.hoisted(() => ({ views: [] as any[], huds: [] as any[], failResize: false }));

vi.mock('../src/render/worldView', () => ({ WorldView: class {
  constructor() { constructed.views.push(this); }
  onThunder = null;
  rig = { mode: 'cockpit', setMode: vi.fn() };
  setTimeOfDay = vi.fn();
  prefetch = vi.fn();
  render = vi.fn();
  drawInstruments = vi.fn();
  resize = vi.fn();
  dispose = vi.fn();
  applySettings = vi.fn();
  load = vi.fn();
  init = vi.fn();
  frames = 0;
  setWarm = vi.fn();
  parallelCompile = vi.fn();
  gpuIdle = vi.fn();
} }));
vi.mock('../src/ui/hud', () => ({ Hud: class {
  constructor() { constructed.huds.push(this); }
  setOpacity = vi.fn();
  setHint = vi.fn();
  resize = vi.fn(() => { if (constructed.failResize) throw new Error('HUD resize failed'); });
  show = vi.fn();
  update = vi.fn();
  dispose = vi.fn();
} }));
vi.mock('../src/ui/menus', () => ({ UI: class {
  hasModal = false;
  main = vi.fn();
  loading = vi.fn();
  pause = vi.fn();
  clear = vi.fn();
  clickToStart = vi.fn();
  dispose = vi.fn();
  compatError = vi.fn();
} }));
vi.mock('../src/ui/replayPanel', () => ({ ReplayPanel: class {
  update = vi.fn();
  show = vi.fn();
  toggle = vi.fn();
  dispose = vi.fn();
} }));
vi.mock('../src/world/worldgen', () => ({ generateWorld: vi.fn() }));

import { App } from '../src/game/app';
import { SAVE_KEY } from '../src/game/save';
import { TRAINING } from '../src/maps/training';
import { GameSession, newBody } from '../src/sim/session';
import { generateWorld } from '../src/world/worldgen';

class Element extends EventTarget {
  className = '';
  classList = { add: vi.fn(), remove: vi.fn() };
  appendChild = vi.fn();
  remove = vi.fn();
}

describe('运行与加载恢复', () => {
  let app: App;
  let win: EventTarget;
  beforeEach(() => {
    constructed.failResize = false;
    constructed.views.length = constructed.huds.length = 0;
    win = Object.assign(new EventTarget(), { localStorage: null });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element(), pointerLockElement: null }));
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(17));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    app = new App(new Element() as unknown as HTMLElement);
  });
  afterEach(() => { app.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('构造中途失败也释放已经创建的画面与 HUD，不遗留画布', () => {
    const canvas = new Element();
    vi.spyOn(document, 'createElement')
      .mockReturnValueOnce(canvas as unknown as HTMLCanvasElement)
      .mockImplementationOnce(() => { throw new Error('DOM unavailable'); });
    expect(() => new App(new Element() as unknown as HTMLElement)).toThrow('DOM unavailable');
    expect(constructed.views.at(-1).dispose).toHaveBeenCalledOnce();
    expect(constructed.huds.at(-1).dispose).toHaveBeenCalledOnce();
    expect(canvas.remove).toHaveBeenCalledOnce();
  });

  it('构造末尾失败会移除已经注册的输入与窗口回调', () => {
    const add = vi.spyOn(win, 'addEventListener');
    const remove = vi.spyOn(win, 'removeEventListener');
    constructed.failResize = true;
    expect(() => new App(new Element() as unknown as HTMLElement)).toThrow('HUD resize failed');
    constructed.failResize = false;
    const view = constructed.views.at(-1);
    win.dispatchEvent(new Event('resize'));
    expect(view.resize).not.toHaveBeenCalled();
    const capture = add.mock.calls.find(([type, , options]) => type === 'keydown' && (options as AddEventListenerOptions)?.capture);
    expect(capture).toBeDefined();
    expect(remove.mock.calls.some(([type, fn]) => type === 'keydown' && fn === capture![1])).toBe(true);
    expect(view.dispose).toHaveBeenCalledOnce();
  });

  it('操作提示开关立即生效，重新改键显示真实按键，暂停时收起', () => {
    app.state = 'ready';
    app.session = { restoreOptions: () => [], dispose: vi.fn() } as unknown as GameSession;
    vi.spyOn(app.input, 'requestLock').mockImplementation(() => undefined);
    vi.spyOn(app as any, 'audioState').mockReturnValue({ paused: true });
    app.beginFlight();
    expect(app.hud.setHint).toHaveBeenLastCalledWith(expect.stringContaining('悬停'));
    app.applySettings({ ...app.settings, hints: false });
    expect(app.hud.setHint).toHaveBeenLastCalledWith('');
    const settings = structuredClone(app.settings);
    settings.hints = true;
    settings.bindings.hover = ['KeyL'];
    app.applySettings(settings);
    expect(app.hud.setHint).toHaveBeenLastCalledWith(expect.stringContaining('<kbd>L</kbd>'));
    app.pause();
    expect(app.hud.setHint).toHaveBeenLastCalledWith('');
    app.resume();
    expect(app.hud.setHint).toHaveBeenLastCalledWith(expect.stringContaining('<kbd>L</kbd>'));
  });

  it.each([true, false])('起飞页尊重操作提示开关 %s，同时保留任务说明', async (hints) => {
    app.settings.hints = hints;
    app.world = { map: TRAINING } as never;
    vi.spyOn(app as any, 'warmUp').mockResolvedValue(undefined);
    vi.spyOn(GameSession, 'create').mockResolvedValue({
      step: vi.fn(), drainEvents: () => [], dispose: vi.fn(),
      mission: { current: () => ({ def: { title: '到达训练坪' } }) },
    } as unknown as GameSession);
    await app.startRun({ map: TRAINING, weather: 'clear', assist: 'novice', tutorial: false });
    expect(app.state).toBe('ready');
    const description = vi.mocked(app.ui.clickToStart).mock.calls[0][1];
    expect(description).toContain('到达训练坪');
    expect(description.includes('<kbd>')).toBe(hints);
  });

  it('回放放完飞机回到暂停时的地方，转速、镜头都还原，物理接着走', () => {
    const body = newBody();
    body.pos.set(100, 50, 0);
    body.vel.set(30, 0, 0);
    const tel = { rotorRpm: 1, thrust: 20000, airspeed: 30 };
    const s = { body, prev: newBody(), flight: { telemetry: tel }, gear: { weightOnSkids: 0 }, dispose: vi.fn(), restoreOptions: () => [] };
    const a = app as any;
    const tape = a.tape;
    for (let i = 0; i < 1200; i++) {
      body.pos.x += 0.5;
      a.recordTape(s, 1 / 60);
    }
    tel.rotorRpm = 0.42;
    const end = body.pos.x;
    a.session = s;
    a.state = 'paused';
    a.view.setDof = vi.fn();
    a.view.rig.mode = 'chase';
    a.view.rig.nextShot = vi.fn();
    const done = vi.fn();
    expect(tape.seconds).toBeGreaterThan(19);
    a.openReplay(done);
    expect(a.view.rig.setMode).toHaveBeenLastCalledWith('cinema');
    expect(a.replayDt(0.1)).toBeCloseTo(0.1);
    a.stepReplay(s, 3);
    expect(s.body.pos.x).toBeLessThan(end - 300);
    expect(s.prev.pos.x).toBe(s.body.pos.x);
    expect(tel.rotorRpm).toBe(1);
    a.onEdge('view');
    expect(a.view.rig.nextShot).toHaveBeenCalledOnce();
    a.stepReplay(s, 30);
    expect(a.replay.t).toBe(0);
    a.onEdge('pause');
    expect(a.replay).toBeNull();
    expect(done).toHaveBeenCalledOnce();
    expect(s.body.pos.x).toBe(end);
    expect(s.prev.pos.x).toBe(end);
    expect(tel.rotorRpm).toBe(0.42);
    expect(a.view.rig.setMode).toHaveBeenLastCalledWith('chase');
    a.session = null;
  });

  it('录得太短不放回放', () => {
    const a = app as any;
    a.session = { body: newBody(), prev: newBody(), flight: { telemetry: {} }, dispose: vi.fn() };
    a.openReplay(vi.fn());
    expect(a.replay).toBeNull();
    a.session = null;
  });

  it('验收实例可注入独立存储，完全不接触玩家浏览器存档', () => {
    const browserStore = { getItem: vi.fn(), setItem: vi.fn() };
    Object.assign(win, { localStorage: browserStore });
    const memory = new Map<string, string>([[SAVE_KEY, JSON.stringify({ version: 2, settings: { fov: 79, volMaster: 0 } })]]);
    app.dispose();
    app = new App(new Element() as unknown as HTMLElement, {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
    });
    expect(app.settings.fov).toBe(79);
    expect(app.settings.volMaster).toBe(0);
    app.settings.fov = 82;
    app.save.save();
    expect(JSON.parse(memory.get(SAVE_KEY)!).settings.fov).toBe(82);
    expect(browserStore.getItem).not.toHaveBeenCalled();
    expect(browserStore.setItem).not.toHaveBeenCalled();
  });

  it('无鼠标锁定的拖动模式切换窗口也会暂停', () => {
    app.state = 'playing';
    app.session = { restoreOptions: () => [], dispose: vi.fn() } as unknown as GameSession;
    vi.spyOn(app as any, 'audioState').mockReturnValue({ paused: true });
    win.dispatchEvent(new Event('blur'));
    expect(app.state).toBe('paused');
    expect(app.input.active).toBe(false);
    expect(app.ui.pause).toHaveBeenCalledOnce();
  });

  it.each(['failTimer', 'completeTimer'])('暂停冻结 %s，继续飞行后再显示结果', (timer) => {
    app.state = 'paused';
    app.session = { state: timer === 'failTimer' ? 'crashed' : 'complete', dispose: vi.fn() } as unknown as GameSession;
    const internals = app as any;
    internals[timer] = 0.08;
    internals.instrumentData = vi.fn();
    internals.audioState = vi.fn().mockReturnValue({ paused: true });
    internals.showFailure = vi.fn();
    internals.showResult = vi.fn();
    internals.frame(100);
    expect(internals[timer]).toBe(0.08);
    expect(internals.showFailure).not.toHaveBeenCalled();
    expect(internals.showResult).not.toHaveBeenCalled();
    app.state = 'playing';
    internals.frame(200);
    expect(timer === 'failTimer' ? internals.showFailure : internals.showResult).toHaveBeenCalledOnce();
  });

  it('重复启动只加载一次，失败后返回菜单且可再次尝试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let reject!: (error: Error) => void;
    vi.mocked(generateWorld).mockReset().mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const cfg = { map: TRAINING, weather: 'clear', assist: 'novice' as const, tutorial: true };
    const first = app.startRun(cfg);
    await app.startRun(cfg);
    expect(generateWorld).toHaveBeenCalledOnce();
    reject(new Error('texture unavailable'));
    await first;
    expect(app.state).toBe('menu');
    expect(app.session).toBeNull();
    expect(app.world).toBeNull();
    expect(app.ui.main).toHaveBeenCalledOnce();
    vi.mocked(generateWorld).mockRejectedValueOnce(new Error('offline'));
    await app.startRun(cfg);
    expect(generateWorld).toHaveBeenCalledTimes(2);
    expect(app.state).toBe('menu');
  });

  it('销毁停止帧循环和全局事件，且每项资源只释放一次', () => {
    const session = { dispose: vi.fn() };
    app.session = session as unknown as GameSession;
    const internals = app as any;
    internals.tick = vi.fn();
    internals.frame(10);
    const resizeCount = vi.mocked(app.view.resize).mock.calls.length;
    app.dispose();
    app.dispose();
    win.dispatchEvent(new Event('resize'));
    win.dispatchEvent(new Event('blur'));
    internals.frame(20);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(internals.tick).toHaveBeenCalledOnce();
    expect(app.view.resize).toHaveBeenCalledTimes(resizeCount);
    expect(app.view.dispose).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(app.hud.dispose).toHaveBeenCalledOnce();
    expect(app.ui.dispose).toHaveBeenCalledOnce();
    expect(app.state).toBe('disposed');
  });

  it('地图生成期间销毁不会让晚到结果复活，渲染器等构建收尾后释放', async () => {
    let finish!: (value: never) => void;
    vi.mocked(generateWorld).mockReset().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = app.startRun({ map: TRAINING, weather: 'clear', assist: 'novice', tutorial: false });
    app.dispose();
    expect(app.view.dispose).not.toHaveBeenCalled();
    finish({ map: TRAINING } as never);
    await pending;
    expect(app.view.load).not.toHaveBeenCalled();
    expect(app.view.dispose).toHaveBeenCalledOnce();
    expect(app.ui.main).not.toHaveBeenCalled();
    expect(app.session).toBeNull();
    expect(app.world).toBeNull();
  });

  it('重复 start 共用初始化，销毁后不再启动第二个帧循环', async () => {
    let finish!: () => void;
    vi.mocked(app.view.init).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const a = app.start();
    const b = app.start();
    expect(a).toBe(b);
    expect(app.view.init).toHaveBeenCalledOnce();
    const check = expect(a).rejects.toThrow('已停止');
    app.dispose();
    finish();
    await check;
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(app.view.dispose).toHaveBeenCalledOnce();
  });

  it('地图视觉资源仍在构建时，销毁等待当前加载收尾而不继续创建物理世界', async () => {
    const world = { map: TRAINING } as never;
    vi.mocked(generateWorld).mockReset().mockResolvedValue(world);
    let finish!: () => void;
    vi.mocked(app.view.load).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const create = vi.spyOn(GameSession, 'create');
    const pending = app.startRun({ map: TRAINING, weather: 'clear', assist: 'novice', tutorial: false });
    await Promise.resolve();
    expect(app.view.load).toHaveBeenCalledOnce();
    app.dispose();
    expect(app.view.dispose).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(create).not.toHaveBeenCalled();
    expect(app.view.dispose).toHaveBeenCalledOnce();
    expect(app.world).toBeNull();
  });

  it('物理世界晚到时立即释放，不复活已停止的游戏', async () => {
    app.world = { map: TRAINING } as never;
    let finish!: (session: GameSession) => void;
    vi.spyOn(GameSession, 'create').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = app.startRun({ map: TRAINING, weather: 'clear', assist: 'novice', tutorial: false });
    app.dispose();
    const lateSession = { dispose: vi.fn() } as unknown as GameSession;
    finish(lateSession);
    await pending;
    expect(lateSession.dispose).toHaveBeenCalledOnce();
    expect(app.session).toBeNull();
    expect(app.state).toBe('disposed');
    expect(app.view.dispose).toHaveBeenCalledOnce();
  });

  it('绘制异常只报告一次，停止仿真和后续帧', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const internals = app as any;
    internals.tick = vi.fn(() => { throw new Error('device lost'); });
    internals.frame(10);
    internals.frame(20);
    expect(internals.tick).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    expect(app.state).toBe('disposed');
    expect(app.view.dispose).toHaveBeenCalledOnce();
  });

  it('预热无帧进展会失败，并恢复编译钩子与预热状态', async () => {
    vi.useFakeTimers();
    const compile = Object.assign(vi.fn().mockResolvedValue(undefined), { cancel: vi.fn() });
    vi.mocked(app.view.parallelCompile).mockReturnValue(compile);
    const pending = (app as any).warmUp();
    const check = expect(pending).rejects.toThrow('无进展');
    await vi.advanceTimersByTimeAsync(60030);
    await check;
    expect(compile.cancel).toHaveBeenCalledOnce();
    expect(app.view.setWarm).toHaveBeenLastCalledWith(false);
  });

  it('后台浏览器暂停动画不会误报预热卡死，销毁仍会停止等待', async () => {
    vi.useFakeTimers();
    Object.assign(document, { hidden: true });
    const compile = Object.assign(vi.fn().mockResolvedValue(undefined), { cancel: vi.fn() });
    vi.mocked(app.view.parallelCompile).mockReturnValue(compile);
    const pending = (app as any).warmUp();
    const check = expect(pending).rejects.toThrow('已停止');
    await vi.advanceTimersByTimeAsync(65000);
    expect(app.view.setWarm).toHaveBeenLastCalledWith(true);
    app.dispose();
    await vi.advanceTimersByTimeAsync(30);
    await check;
    expect(compile.cancel).toHaveBeenCalledOnce();
  });

  it('连续滑动设置仅写一次，退出实例前刷新尚未保存的最终值', async () => {
    vi.useFakeTimers();
    const save = vi.spyOn(app.save, 'save');
    for (let fov = 70; fov <= 90; fov++) app.applySettings({ ...app.settings, fov });
    expect(save).not.toHaveBeenCalled();
    expect(app.view.applySettings).toHaveBeenCalledTimes(21);
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledOnce();
    expect(app.save.data.settings.fov).toBe(90);
    app.applySettings({ ...app.settings, fov: 80 });
    app.dispose();
    expect(save).toHaveBeenCalledTimes(2);
    expect(app.save.data.settings.fov).toBe(80);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('帧率使用真实经过时间，长帧仍限制仿真与渲染推进量', () => {
    app.state = 'ready';
    app.session = { dispose: vi.fn() } as unknown as GameSession;
    const internals = app as any;
    internals.instrumentData = vi.fn();
    internals.audioState = vi.fn().mockReturnValue({ paused: true });
    internals.last = 0;
    internals.frame(2000);
    expect(app.fps).toBe(0.5);
    expect(app.view.render).toHaveBeenCalledWith(app.session, expect.objectContaining({ dt: 0.1 }));
  });
});
