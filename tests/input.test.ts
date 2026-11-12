import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/game/input';
import { defaultSettings } from '../src/game/settings';

function event(type: string, props: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), props);
}

describe('键盘鼠标生命周期', () => {
  let win: EventTarget;
  let doc: EventTarget & { hidden: boolean; pointerLockElement: EventTarget | null; exitPointerLock: ReturnType<typeof vi.fn> };
  let canvas: EventTarget & { requestPointerLock: ReturnType<typeof vi.fn> };
  let input: Input;

  beforeEach(() => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null, exitPointerLock: vi.fn() });
    canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    input = new Input(canvas as unknown as HTMLCanvasElement, defaultSettings());
  });
  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  it('暂停或失焦清理也释放触屏摇杆，恢复后没有旧轴输入', () => {
    input.active = true;
    const touch = { forward: 1, turn: 1, lateral: 1, vertical: 1, reset: () => { touch.forward = touch.turn = touch.lateral = touch.vertical = 0; } };
    input.touch = touch;
    expect(input.axis('back', 'forward')).toBe(1);
    win.dispatchEvent(event('blur'));
    expect(input.axis('back', 'forward')).toBe(0);
    expect(input.axis('down', 'up')).toBe(0);
  });

  it('混合设备触摸后可切回鼠标锁定，再触摸会更新模式与提示', () => {
    input.active = true;
    input.touch = { forward: 0, turn: 0, lateral: 0, vertical: 0, reset: vi.fn() };
    const changed = vi.fn();
    input.onDevice = changed;
    input.noteTouch();
    expect(input.touchActive).toBe(true);
    input.requestLock();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    input.noteMouse();
    expect(input.touchActive).toBe(false);
    input.requestLock();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    input.noteTouch();
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('手机点一下以后浏览器补发的鼠标事件不算换成鼠标，真动了鼠标才换', () => {
    input.active = true;
    input.touch = { forward: 0, turn: 0, lateral: 0, vertical: 0, reset: vi.fn() };
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    input.noteTouch();
    win.dispatchEvent(event('pointerdown', { pointerType: 'touch' }));
    // 紧跟在手指后面的（Firefox 这类浏览器补发的 mousemove 移动量可能很大）
    now.mockReturnValue(1300);
    win.dispatchEvent(event('mousemove', { movementX: 240, movementY: 80 }));
    canvas.dispatchEvent(event('mousedown', { button: 0 }));
    expect(input.touchActive).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    // Chrome 直接标出是手指点出来的
    now.mockReturnValue(5000);
    win.dispatchEvent(event('mousemove', { movementX: 240, movementY: 80, sourceCapabilities: { firesTouchEvents: true } }));
    expect(input.touchActive).toBe(true);
    // 过了一秒，真的动了鼠标
    win.dispatchEvent(event('mousemove', { movementX: 40, movementY: 0 }));
    expect(input.touchActive).toBe(false);
  });

  it('菜单中的导航键保留浏览器行为，不积累飞行输入', () => {
    for (const code of ['Tab', 'Enter', 'Space', 'ArrowRight', 'KeyW']) {
      const e = event('keydown', { code });
      win.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(input.is('up')).toBe(false);
    expect(input.is('forward')).toBe(false);
    expect(input.takeLook(1)).toEqual([0, 0]);
  });

  it('失焦清空移动和观察，暂停按键回调后不会重新写入旧按键', () => {
    input.active = true;
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    expect(input.is('forward')).toBe(true);
    win.dispatchEvent(event('blur'));
    expect(input.is('forward')).toBe(false);
    input.onEdge = () => { input.active = false; input.clear(); };
    win.dispatchEvent(event('keydown', { code: 'Escape' }));
    expect(input.is('pause')).toBe(false);
  });

  it('改为回车或空格的暂停键恢复飞行时，不同时触发原菜单按钮或跳过教程', () => {
    const settings = defaultSettings();
    settings.bindings.pause = ['Enter', 'Space'];
    input.setSettings(settings);
    const resume = vi.fn(() => { input.active = true; });
    input.onEdge = resume;
    for (const code of settings.bindings.pause) {
      input.active = false;
      input.clear();
      const pressed = event('keydown', { code });
      win.dispatchEvent(pressed);
      expect(pressed.defaultPrevented).toBe(true);
      expect(input.active).toBe(true);
    }
    expect(resume).toHaveBeenCalledTimes(2);
    // A modal that declines to resume must retain native menu-key behavior.
    input.active = false;
    input.clear();
    input.onEdge = vi.fn();
    const blocked = event('keydown', { code: 'Enter' });
    win.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(false);
  });

  it('取消过期改键不会吞掉下一次按键，也不会取消更新的捕获', () => {
    const first = vi.fn();
    const second = vi.fn();
    const cancelFirst = input.captureNextKey(first);
    input.captureNextKey(second);
    cancelFirst();
    win.dispatchEvent(event('keydown', { code: 'KeyA', repeat: true }));
    expect(second).not.toHaveBeenCalled();
    win.dispatchEvent(event('keydown', { code: 'KeyB' }));
    expect(second).toHaveBeenCalledWith('KeyB');
    expect(first).not.toHaveBeenCalled();
    const cancel = input.captureNextKey(first);
    cancel();
    const e = event('keydown', { code: 'Space' });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(first).not.toHaveBeenCalled();
  });

  it('未识别和输入法事件不会覆盖绑定，失焦会明确取消等待中的改键', () => {
    const captured = vi.fn();
    input.captureNextKey(captured);
    for (const props of [{ code: '' }, { code: 'Unidentified' }, { code: 'KeyA', isComposing: true }]) win.dispatchEvent(event('keydown', props));
    expect(captured).not.toHaveBeenCalled();
    win.dispatchEvent(event('blur'));
    expect(captured).toHaveBeenCalledExactlyOnceWith('Escape');
    win.dispatchEvent(event('keydown', { code: 'KeyB' }));
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('较早锁定请求迟到的拒绝不会覆盖后一次成功状态', async () => {
    let rejectOld!: (reason: Error) => void;
    const old = new Promise<void>((_, reject) => { rejectOld = reject; });
    canvas.requestPointerLock.mockReturnValueOnce(old).mockResolvedValue(undefined);
    input.active = true;
    input.requestLock();
    input.requestLock();
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(event('pointerlockchange'));
    expect(input.locked).toBe(true);
    rejectOld(new Error('late rejection'));
    await Promise.resolve();
    expect(input.lockFailed).toBe(false);
    doc.dispatchEvent(event('pointerlockerror'));
    expect(input.lockFailed).toBe(false);
  });

  it('释放后才获准的未决鼠标锁定会退出，不因移除监听器而留住鼠标', async () => {
    let resolve!: () => void;
    canvas.requestPointerLock.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    input.active = true;
    input.requestLock();
    input.dispose();
    doc.pointerLockElement = canvas;
    resolve();
    await Promise.resolve();
    expect(doc.exitPointerLock).toHaveBeenCalledOnce();
    input.active = true;
    input.requestLock();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
  });

  it('拍照模式：不锁鼠标，按住才转镜头，滚轮归变焦', () => {
    input.active = true;
    input.setFreeMouse(true);
    input.requestLock();
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)).toEqual([0, 0]);
    canvas.dispatchEvent(event('mousedown', { button: 0 }));
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)[0]).toBeGreaterThan(0);
    win.dispatchEvent(event('mouseup', { button: 0 }));
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)).toEqual([0, 0]);
    canvas.dispatchEvent(event('wheel', { deltaY: -100 }));
    expect(input.takeWheel()).toBe(1);
    input.setFreeMouse(false);
    canvas.dispatchEvent(event('wheel', { deltaY: -100 }));
    expect(input.takeWheel()).toBe(0);
  });

  it('仅左键拖动观察；暂停后才获准的鼠标锁定会立即退出', () => {
    input.active = true;
    input.lockFailed = true;
    canvas.dispatchEvent(event('mousedown', { button: 2 }));
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)).toEqual([0, 0]);
    canvas.dispatchEvent(event('mousedown', { button: 0 }));
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)[0]).toBeGreaterThan(0);
    input.active = false;
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(event('pointerlockchange'));
    expect(doc.exitPointerLock).toHaveBeenCalledOnce();
  });

  it('上一次没锁上，点一下画面会再试一次（按 Esc 退出后浏览器会拦一小会儿）', () => {
    input.active = true;
    input.lockFailed = true;
    canvas.dispatchEvent(event('mousedown', { button: 0 }));
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    // 锁不上也能按住拖动看
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)[0]).toBeGreaterThan(0);
  });

  it('释放后不再保留画布事件或捕获回调', () => {
    const captured = vi.fn();
    input.captureNextKey(captured);
    input.dispose();
    input.active = true;
    const e = event('contextmenu');
    canvas.dispatchEvent(e);
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    expect(e.defaultPrevented).toBe(false);
    expect(captured).not.toHaveBeenCalled();
    expect(input.is('forward')).toBe(false);
  });
});

describe('手柄、触屏和键盘一起用', () => {
  let win: EventTarget;
  let canvas: EventTarget & { requestPointerLock: ReturnType<typeof vi.fn> };
  let input: Input;
  const pad = { id: 'pad', index: 0, timestamp: 1, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const touch = { forward: 0, turn: 0, lateral: 0, vertical: 0 };

  beforeEach(() => {
    win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null, exitPointerLock: vi.fn() });
    canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    for (const b of pad.buttons) Object.assign(b, { pressed: false, value: 0 });
    pad.axes = [0, 0, 0, 0];
    Object.assign(touch, { forward: 0, turn: 0, lateral: 0, vertical: 0 });
    input = new Input(canvas as unknown as HTMLCanvasElement, defaultSettings());
    input.active = true;
  });
  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
  });

  it('平板接着手柄：手柄放着不动时，屏幕上的摇杆照样能飞', () => {
    input.touch = touch;
    input.pollPad(0.016);
    expect(input.pad.connected).toBe(true);
    touch.forward = 0.8;
    expect(input.axis('back', 'forward')).toBeCloseTo(0.8, 6);
    // 两边一起推：推得多的算
    pad.axes = [0, -1, 0, 0];
    input.pollPad(0.016);
    expect(input.axis('back', 'forward')).toBeCloseTo(1, 6);
  });

  it('拍照模式“按住 B 走得快”：手柄按着 B 就算按着动力增强', () => {
    expect(input.is('boost')).toBe(false);
    pad.buttons[1] = { pressed: true, value: 1 };
    input.pollPad(0.016);
    expect(input.is('boost')).toBe(true);
    pad.buttons[1] = { pressed: false, value: 0 };
    input.pollPad(0.016);
    expect(input.is('boost')).toBe(false);
  });

  it('手柄转头的速度单独设置，不跟着鼠标灵敏度走', () => {
    pad.axes = [0, 0, 1, 0];
    input.pollPad(0.016);
    const [slow] = input.takeLook(0.1);
    const s = defaultSettings();
    s.padSensitivity = 2;
    s.mouseSensitivity = 0.2;
    input.setSettings(s);
    const [fast] = input.takeLook(0.1);
    expect(fast).toBeCloseTo(slow * 2, 6);
  });

  it('拍照面板开着：手柄的 A 和十字键走面板，B 还是加速、Y 还是回正', () => {
    const edges: string[] = [];
    const nav: string[] = [];
    input.onEdge = (a) => edges.push(a);
    input.onPadNav = (d) => nav.push(d);
    input.padPanel = true;
    pad.buttons[0] = { pressed: true, value: 1 };
    pad.buttons[15] = { pressed: true, value: 1 };
    pad.buttons[3] = { pressed: true, value: 1 };
    input.pollPad(0.016);
    expect(nav).toEqual(['ok', 'right']);
    expect(edges).toEqual(['center']);
    // 左摇杆在挪机位，不走面板
    pad.buttons[0] = pad.buttons[15] = pad.buttons[3] = { pressed: false, value: 0 };
    pad.axes = [1, 0, 0, 0];
    input.pollPad(0.016);
    expect(nav).toEqual(['ok', 'right']);
  });

  it('拍照模式里倾斜不算触屏右摇杆的左右（那是挪机位）', () => {
    input.touch = touch;
    touch.lateral = 1;
    expect(input.axis('strafeLeft', 'strafeRight')).toBeCloseTo(1, 6);
    expect(input.axis('strafeLeft', 'strafeRight', false)).toBe(0);
  });

  it('拿过手柄以后手指碰屏幕，提示换回触屏的叫法', () => {
    const got: string[] = [];
    input.onDevice = (d) => got.push(d);
    pad.buttons[0] = { pressed: true, value: 1 };
    input.pollPad(0.016);
    input.noteTouch();
    expect(got).toEqual(['pad', 'keyboard']);
  });
});

// X11 上的毛病（2026-11-11 Linux 玩家反馈“时不时卡一下”）：锁定鼠标时偶尔冒出几百像素的假移动；
// 有的输入法按住不放会送成“松开、按下”一对一对
describe('X11 上的鼠标、键盘', () => {
  let win: EventTarget;
  let doc: EventTarget & { hidden: boolean; pointerLockElement: EventTarget | null; exitPointerLock: ReturnType<typeof vi.fn> };
  let canvas: EventTarget & { requestPointerLock: ReturnType<typeof vi.fn> };
  let input: Input;

  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null, exitPointerLock: vi.fn() });
    canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    input = new Input(canvas as unknown as HTMLCanvasElement, defaultSettings());
    input.active = true;
  });
  afterEach(() => {
    input.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const lock = () => {
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(event('pointerlockchange'));
  };

  it('刚锁上的第一下移动不算，之后正常', () => {
    lock();
    win.dispatchEvent(event('mousemove', { movementX: 180, movementY: 40 }));
    expect(input.takeLook(0)).toEqual([0, 0]);
    win.dispatchEvent(event('mousemove', { movementX: 12, movementY: 4 }));
    expect(input.takeLook(0)[0]).toBeGreaterThan(0);
  });

  it('一个事件里几百像素的假移动不算，正常甩鼠标照算', () => {
    lock();
    win.dispatchEvent(event('mousemove', { movementX: 1, movementY: 0 }));
    input.takeLook(0);
    win.dispatchEvent(event('mousemove', { movementX: -640, movementY: 3 }));
    win.dispatchEvent(event('mousemove', { movementX: 2, movementY: -420 }));
    expect(input.takeLook(0)).toEqual([0, 0]);
    win.dispatchEvent(event('mousemove', { movementX: 120, movementY: -60 }));
    const [dx, dy] = input.takeLook(0);
    expect(dx).toBeGreaterThan(0);
    expect(dy).not.toBe(0);
  });

  it('按住不放时冒出来的“松开、按下”不算松开，也不算新按了一下', () => {
    const edges: string[] = [];
    input.onEdge = (a) => edges.push(a);
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    win.dispatchEvent(event('keydown', { code: 'KeyH' }));
    expect(edges).toEqual(['hover']);
    for (let i = 0; i < 5; i++) {
      win.dispatchEvent(event('keyup', { code: 'KeyW' }));
      win.dispatchEvent(event('keyup', { code: 'KeyH' }));
      vi.advanceTimersByTime(10);
      expect(input.is('forward')).toBe(true);
      win.dispatchEvent(event('keydown', { code: 'KeyW' }));
      win.dispatchEvent(event('keydown', { code: 'KeyH' }));
      vi.advanceTimersByTime(20);
    }
    expect(input.is('forward')).toBe(true);
    expect(edges).toEqual(['hover']);
  });

  it('真松开了 30 毫秒以内生效；失焦马上清空', () => {
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    win.dispatchEvent(event('keyup', { code: 'KeyW' }));
    vi.advanceTimersByTime(29);
    expect(input.is('forward')).toBe(true);
    vi.advanceTimersByTime(2);
    expect(input.is('forward')).toBe(false);
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    win.dispatchEvent(event('keyup', { code: 'KeyW' }));
    win.dispatchEvent(event('blur'));
    expect(input.is('forward')).toBe(false);
    // 失焦清掉的待松开计时，回来以后不会误伤新按下的键
    win.dispatchEvent(event('keydown', { code: 'KeyW' }));
    vi.advanceTimersByTime(100);
    expect(input.is('forward')).toBe(true);
  });
});
