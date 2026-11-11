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
  toast = vi.fn();
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

import { App, autoQualityStep, defaultQuality, gpuWarning } from '../src/game/app';
import { browserOf } from '../src/game/version';
import { SAVE_KEY } from '../src/game/save';
import { TRAINING } from '../src/maps/training';
import { getMap } from '../src/maps/index';
import { FLIGHTS_KEY, FLIGHT_FORMAT, mapSig } from '../src/game/flightSave';
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

  it('无鼠标锁定的拖动模式切换窗口也会暂停（焦点 0.3 秒没回来）', () => {
    vi.useFakeTimers();
    try {
      app.state = 'playing';
      app.session = { restoreOptions: () => [], dispose: vi.fn() } as unknown as GameSession;
      vi.spyOn(app as any, 'audioState').mockReturnValue({ paused: true });
      win.dispatchEvent(new Event('blur'));
      expect(app.state).toBe('playing');
      vi.advanceTimersByTime(300);
      expect(app.state).toBe('paused');
      expect(app.input.active).toBe(false);
      expect(app.ui.pause).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  // Linux 玩家反馈“时不时卡一下”：自动降画质要重新编译着色器，WebGL2 上画面停好几秒；
  // 停的那几秒原来又被算成帧率低，接着再降、再停，一路降到最低
  it('自动降画质：先提示、下一帧才换；停顿的那一秒不算；换完 12 秒内不再降；差得多一次降两档', () => {
    const internals = app as any;
    app.state = 'playing';
    app.session = { state: 'running', restoreOptions: () => [], dispose: vi.fn() } as unknown as GameSession;
    app.settings.autoQuality = true;
    app.settings.quality = 'ultra';
    app.settings.rayTracing = true;
    const second = (fps: number, longest = 1 / fps) => {
      internals.fps = fps;
      internals.frameMax = longest;
      internals.watchFrameRate();
      internals.frameMax = 0;
    };
    for (let i = 0; i < 7; i++) second(25);
    second(25, 2.4);
    expect(internals.pendingQuality).toBeNull();
    second(25);
    expect(internals.pendingQuality).toEqual({ quality: 'ultra', rayTracing: false });
    expect(app.hud.toast).toHaveBeenLastCalledWith(expect.stringContaining('换的时候会停一下'), 'info', 6000);
    expect(app.settings.rayTracing).toBe(true);
    const applied = vi.mocked(app.view.applySettings).mock.calls.length;
    internals.applyAutoQuality();
    expect(app.settings.rayTracing).toBe(false);
    expect(vi.mocked(app.view.applySettings).mock.calls.length).toBe(applied + 1);
    for (let i = 0; i < 12; i++) second(4, 3);
    for (let i = 0; i < 7; i++) second(12);
    expect(internals.pendingQuality).toBeNull();
    second(12);
    expect(internals.pendingQuality).toEqual({ quality: 'medium', rayTracing: false });
  });

  // X11 上窗口管理器偶尔让窗口失焦一下又马上还回来：不该弹出暂停菜单
  it('失焦一下焦点马上回来，不暂停', () => {
    vi.useFakeTimers();
    try {
      app.state = 'playing';
      app.session = { restoreOptions: () => [], dispose: vi.fn() } as unknown as GameSession;
      vi.spyOn(app as any, 'audioState').mockReturnValue({ paused: true });
      (document as unknown as { hasFocus: () => boolean }).hasFocus = () => true;
      win.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(300);
      expect(app.state).toBe('playing');
      expect(app.ui.pause).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

describe('集成显卡的提示', () => {
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

  it('Windows 电脑的浏览器跑在核显上：提示去系统设置里换显卡', () => {
    expect(gpuWarning('ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toContain('UHD Graphics 770');
    expect(gpuWarning('intel gen-12lp', WIN)).not.toBeNull();
  });

  it('独立显卡不提示', () => {
    expect(gpuWarning('ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBeNull();
    expect(gpuWarning('nvidia blackwell', WIN)).toBeNull();
  });

  // Linux 上驱动不在浏览器支持名单里时常常是软件模拟，一秒几帧；双显卡笔记本浏览器默认用核显
  it('软件模拟：哪个系统都提示打开硬件加速；Linux 的核显提示双显卡笔记本怎么换', () => {
    const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
    expect(gpuWarning('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', LINUX)).toContain('软件模拟');
    expect(gpuWarning('llvmpipe (LLVM 17.0.6, 256 bits)', LINUX)).toContain('硬件加速');
    expect(gpuWarning('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', WIN)).toContain('软件模拟');
    expect(gpuWarning('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', LINUX)).toContain('prime-run');
    expect(gpuWarning('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)', LINUX)).toBeNull();
    expect(gpuWarning('SwiftShader', ANDROID)).toBeNull();
  });

  it('手机、平板、苹果电脑不提示：Windows 设置里换显卡对它们没有用', () => {
    expect(gpuWarning('ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', ANDROID)).toBeNull();
    expect(gpuWarning('Mali-G78', ANDROID)).toBeNull();
    expect(gpuWarning('Intel(R) Iris(TM) Plus Graphics 655', MAC)).toBeNull();
  });
});

describe('飞行存档：离开时自动存、读档键连按两下', () => {
  let app: App;
  let win: EventTarget;
  let memory: Map<string, string>;
  const fakeSession = (state = 'running') =>
    ({
      state,
      mission: { main: [{}, {}, {}, {}], index: 1, complete: false },
      damage: { durability: 64 },
      weather: { preset: { id: 'clear' } },
      saveState: () => ({ snap: { t: 12 }, checkpoints: [], stats: {} }),
      restoreOptions: () => [],
      dispose: vi.fn(),
    }) as unknown as GameSession;
  beforeEach(() => {
    win = Object.assign(new EventTarget(), { localStorage: null });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, createElement: () => new Element(), pointerLockElement: null }));
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(17));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    memory = new Map();
    app = new App(new Element() as unknown as HTMLElement, { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) });
    app.run = { map: getMap('japan'), weather: 'clear', assist: 'novice', tutorial: false, time: 'dusk' } as never;
  });
  afterEach(() => { app.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const slots = () => JSON.parse(memory.get(FLIGHTS_KEY) ?? '{"slots":{}}').slots;

  it('飞到一半回主菜单：自动存一份（单独一格），进度写对', () => {
    app.state = 'paused';
    app.session = fakeSession();
    app.quitToMenu();
    const f = slots().resume;
    expect(f.auto).toBe(true);
    expect(f.info).toEqual({ step: 2, total: 4, durability: 64 });
    expect(f.run).toMatchObject({ map: 'japan', time: 'dusk', free: false, assist: 'novice' });
    expect(slots()['japan/mission']).toBeUndefined();
    expect(app.ui.main).toHaveBeenLastCalledWith(expect.objectContaining({ cont: expect.objectContaining({ title: expect.stringContaining('继续飞行') }) }), expect.anything());
  });

  it('坠毁了、教学里回主菜单不存', () => {
    app.state = 'paused';
    app.session = fakeSession('crashed');
    app.quitToMenu();
    expect(slots().resume).toBeUndefined();
    app.state = 'paused';
    app.session = fakeSession();
    (app as any).tutorial = {};
    app.quitToMenu();
    expect(slots().resume).toBeUndefined();
  });

  it('关网页、刷新：存上了就不弹“确认离开”；存不上（浏览器不让存）才弹', () => {
    app.state = 'paused';
    app.session = fakeSession();
    const e = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(slots().resume.auto).toBe(true);
    app.dispose();
    app = new App(new Element() as unknown as HTMLElement, null);
    app.run = { map: getMap('japan'), weather: 'clear', assist: 'novice', tutorial: false } as never;
    app.state = 'paused';
    app.session = fakeSession();
    const e2 = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true);
  });

  // 任务刚完成、结算要等 1.6 秒才出来：这时关网页原来既丢成绩、又问“确定离开吗”
  it('任务刚完成就关网页：先把成绩记下，不问“确定离开”', () => {
    app.state = 'playing';
    app.session = fakeSession('complete');
    (app as any).completeTimer = 1.2;
    const show = vi.spyOn(app as any, 'showResult').mockImplementation(() => { app.state = 'result'; });
    const e = new Event('beforeunload', { cancelable: true });
    win.dispatchEvent(e);
    expect(show).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(false);
  });

  it('读档键按一下只提示，2.5 秒内再按一下才读；读的是这张图自己存的那一格', () => {
    const map = getMap('japan');
    const save = { format: FLIGHT_FORMAT, savedAt: Date.now(), version: '1.1', auto: false, run: { map: 'japan', weather: 'clear', assist: 'standard', free: false, time: 'day' }, sig: mapSig(map), info: { step: 3, total: 4, durability: 90 }, state: {} };
    memory.set(FLIGHTS_KEY, JSON.stringify({ format: FLIGHT_FORMAT, slots: { 'japan/mission': save } }));
    app.state = 'playing';
    app.session = fakeSession();
    const start = vi.spyOn(app, 'startRun').mockResolvedValue();
    (app as any).quickLoad();
    expect(start).not.toHaveBeenCalled();
    expect(app.hud.toast).toHaveBeenLastCalledWith(expect.stringContaining('再按一次'), 'info', 2500);
    (app as any).quickLoad();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ map, assist: 'standard', free: false, resume: expect.objectContaining({ info: save.info }) }));
  });

  it('按存档键：存进这张图自己的那一格；存不了的时候说原因', () => {
    app.state = 'playing';
    app.session = fakeSession();
    (app as any).quickSave();
    expect(slots()['japan/mission'].auto).toBe(false);
    app.session = fakeSession('crashed');
    (app as any).quickSave();
    expect(app.hud.toast).toHaveBeenLastCalledWith('飞机出事了，现在不能存档', 'warn', 2500);
  });
});

describe('默认画质和自动降档', () => {
  it('WebGL2（浏览器没有 WebGPU）默认低一档、不开光线追踪；WebGPU 照旧', () => {
    const rtx = 'NVIDIA RTX 3060';
    expect(defaultQuality(rtx, false, false)).toEqual({ quality: 'ultra', rayTracing: true });
    expect(defaultQuality(rtx, true, false)).toEqual({ quality: 'high', rayTracing: false });
    expect(defaultQuality('NVIDIA GeForce GTX 1660', true, false)).toEqual({ quality: 'medium', rayTracing: false });
    expect(defaultQuality('Mesa Intel(R) UHD Graphics 620', true, false)).toEqual({ quality: 'low', rayTracing: false });
    expect(defaultQuality(rtx, false, true)).toEqual({ quality: 'low', rayTracing: false });
  });

  it('光线追踪和画质一起降，平均不到 18 帧一次降两档，最低档不再动', () => {
    expect(autoQualityStep('ultra', true, 25)).toEqual({ quality: 'ultra', rayTracing: false });
    expect(autoQualityStep('ultra', true, 12)).toEqual({ quality: 'high', rayTracing: false });
    expect(autoQualityStep('ultra', false, 25)).toEqual({ quality: 'high', rayTracing: false });
    expect(autoQualityStep('high', false, 10)).toEqual({ quality: 'low', rayTracing: false });
    expect(autoQualityStep('medium', false, 10)).toEqual({ quality: 'low', rayTracing: false });
    expect(autoQualityStep('low', false, 5)).toBeNull();
    expect(autoQualityStep('low', true, 5)).toEqual({ quality: 'low', rayTracing: false });
  });
});

describe('关于页的运行环境', () => {
  it('认得出常见的浏览器和系统（Linux 玩家反馈时附上这一行）', () => {
    expect(browserOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36')).toBe('Chrome 156 · Linux');
    expect(browserOf('Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0')).toBe('Firefox 146 · Linux');
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0')).toBe('Edge 156 · Windows');
    expect(browserOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15')).toBe('Safari 19 · macOS');
    expect(browserOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36')).toBe('Chrome 156 · Android');
    expect(browserOf('')).toBe('? · ?');
  });
});
