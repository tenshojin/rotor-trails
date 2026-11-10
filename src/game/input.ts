// 键盘鼠标输入：可重绑定的按键、鼠标锁定观察（失败时退化为拖拽/方向键观察）、
// 浏览器快捷键冲突处理（游戏中拦截可拦截的 Ctrl 组合键）、失焦/切后台时清空按键状态。

import { PadReader, type PadEdge, type PadMode, type PadNav } from './gamepad';
import { isBindingCode, type Action, type Settings } from './settings';

type EdgeAction = 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange' | 'hud' | 'cruise' | 'trim' | 'photo';
const EDGE: EdgeAction[] = ['hover', 'boost', 'center', 'pause', 'view', 'nav', 'mapRange', 'hud', 'cruise', 'trim', 'photo'];

/** 手柄上按住哪个键算按住这个动作（拍照模式“按住 B 走得快”这类要看按住没有，不是按了一下） */
const PAD_HOLD: Partial<Record<Action, number>> = { hover: 0, boost: 1, view: 2, center: 3, cruise: 8, pause: 9, trim: 10, photo: 11, nav: 12, hud: 13, mapRange: 14 };

/** 鼠标移到屏幕边上转头：从离边 EDGE_ZONE 处开始转，越靠边越快 */
const EDGE_ZONE = 0.2;
const EDGE_YAW = 1.5;
const EDGE_PITCH = 1.05;

/** 触屏的两根摇杆：量和手柄走同一条路 */
export interface TouchAxes {
  forward: number;
  turn: number;
  lateral: number;
  vertical: number;
}

export interface PointerClick {
  button: number;
  /** 画面坐标 -1..1，y 向下 */
  x: number;
  y: number;
}

export class Input {
  private down = new Set<string>();
  private codeToActions = new Map<string, Action[]>();
  private settings: Settings;
  private canvas: HTMLCanvasElement;
  active = false;
  locked = false;
  lockFailed = false;
  private dragging = false;
  lookDX = 0;
  lookDY = 0;
  /** 按了一下（fromPad：手柄上按的，超仿真的准星、教学的说明页按这个分开处理） */
  onEdge: ((a: EdgeAction, fromPad?: boolean) => void) | null = null;
  /** 玩家现在用的是键盘鼠标还是手柄：最后动的那个（提示里的键名跟着换） */
  device: 'keyboard' | 'pad' = 'keyboard';
  onDevice: ((d: 'keyboard' | 'pad') => void) | null = null;
  /** 手柄接上（true）或断开（false） */
  onPadConnection: ((connected: boolean, name: string) => void) | null = null;
  /** 手柄：摇杆和扳机是模拟量，和键盘谁动用谁 */
  readonly pad = new PadReader();
  /** 手柄在菜单里按了一下 */
  onPadNav: ((d: PadNav) => void) | null = null;
  /** 手机、平板：没有鼠标，也就不锁鼠标 */
  touch: TouchAxes | null = null;
  /** 拍照模式开着面板：手柄的十字键和 A 走面板（App 设） */
  padPanel = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** 改键捕获：返回按下的按键代码 */
  private capture: ((code: string) => void) | null = null;
  private disposed = false;
  private lockRequest = 0;
  /** 超仿真：鼠标不锁定，是一只真的手 */
  private simMode = false;
  /** 拍照模式：鼠标不锁定，按住才转镜头，放开了能点面板 */
  private freeMouse = false;
  /** 鼠标在画面里的位置（-1..1，y 向下）；移出窗口时 inside = false */
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  /** 左键按着 */
  mouseHeld = false;
  /** 右键按着：像平时一样用鼠标环视 */
  private rightDrag = false;
  /** 这一帧的点击与滚轮 */
  private clicks: PointerClick[] = [];
  private wheelSteps = 0;
  private dragY = 0;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.rebuild();
    this.pad.onConnection = (connected, name) => {
      // （先告诉 App：它要看断开之前玩家是不是在用手柄）
      this.onPadConnection?.(connected, name);
      if (!connected) this.setDevice('keyboard');
    };
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
    document.addEventListener('mouseleave', this.onMouseLeave);
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.rebuild();
  }

  get sim(): boolean {
    return this.simMode;
  }

  /** 进入或离开拍照模式 */
  setFreeMouse(on: boolean): void {
    this.freeMouse = on;
    this.dragging = false;
    if (on) this.exitLock();
  }

  /** 进入或离开超仿真：鼠标放开 */
  setSim(on: boolean): void {
    if (on === this.simMode) return;
    this.simMode = on;
    this.mouseHeld = this.rightDrag = false;
    this.clicks.length = 0;
    this.wheelSteps = 0;
    if (on) this.exitLock();
  }

  private rebuild(): void {
    this.codeToActions.clear();
    for (const action of Object.keys(this.settings.bindings) as Action[]) {
      const codes = this.settings.bindings[action];
      for (const c of codes) {
        const arr = this.codeToActions.get(c) ?? [];
        arr.push(action);
        this.codeToActions.set(c, arr);
      }
    }
  }

  captureNextKey(cb: (code: string) => void): () => void {
    if (this.disposed) return () => {};
    this.clear();
    this.capture = cb;
    return () => {
      if (this.capture === cb) this.capture = null;
    };
  }

  cancelCapture(): void {
    this.capture = null;
  }

  is(a: Action): boolean {
    if (this.keyHeld(a)) return true;
    const b = PAD_HOLD[a];
    if (b !== undefined && this.active && this.pad.connected && this.pad.down(b)) return true;
    return Math.abs(this.padAxis(a)) > 0.5;
  }

  /** 键盘上按着这个动作的键没有（不看手柄、触屏） */
  keyHeld(a: Action): boolean {
    for (const c of this.settings.bindings[a]) if (this.down.has(c)) return true;
    return false;
  }

  /** 这个动作在手柄、触屏摇杆上的量：教学里判断“按住了没有”也看它。
   *  平板接着手柄时屏幕上的摇杆照样能用：两边谁推得多算谁 */
  private padAxis(a: Action, touch = true): number {
    if (!this.active) return 0;
    return Math.max(this.pad.connected ? stickAmount(this.pad, a) : 0, touch && this.touch ? stickAmount(this.touch, a) : 0);
  }

  /** 每帧读一次手柄。飞行中按键走 onEdge，菜单（和拍照面板）里走 onPadNav */
  pollPad(dt: number): void {
    const mode: PadMode = !this.active ? 'menu' : this.padPanel ? 'panel' : 'fly';
    this.pad.poll(dt, mode, (a: PadEdge) => {
      if (this.active || a === 'pause') this.onEdge?.(a, true);
    }, (d) => this.onPadNav?.(d));
    if (this.pad.used) this.setDevice('pad');
  }

  /** 手指碰了屏幕上的摇杆或按键：提示换回触屏的叫法（之前拿过手柄的话） */
  noteTouch(): void {
    this.setDevice('keyboard');
  }

  private setDevice(d: 'keyboard' | 'pad'): void {
    if (d === this.device) return;
    this.device = d;
    this.onDevice?.(d);
  }

  /** 取出这一帧的点击 */
  takeClicks(): PointerClick[] {
    if (!this.clicks.length) return NO_CLICKS;
    const c = this.clicks;
    this.clicks = [];
    return c;
  }

  /** 取出这一帧的滚轮（向上为正，一格一步） */
  takeWheel(): number {
    const w = this.wheelSteps;
    this.wheelSteps = 0;
    return w;
  }

  /** 取出这一帧左键按着上下拖了多少（屏幕高度的比例，向上为正） */
  takeDrag(): number {
    const d = this.dragY;
    this.dragY = 0;
    return d;
  }

  /** 鼠标贴边转头：这一帧的视线变化（弧度）。右键环视、按住左键操作时不转 */
  edgeLook(dt: number): [number, number] {
    if (!this.mouseInside || this.rightDrag || this.mouseHeld) return [0, 0];
    return [edgeRate(this.mouseX) * EDGE_YAW * dt, edgeRate(this.mouseY) * EDGE_PITCH * dt];
  }

  /** touch = false：不算屏幕上的摇杆（拍照模式里右摇杆左右是挪机位，不是倾斜） */
  axis(neg: Action, pos: Action, touch = true): number {
    const keys = (this.keyHeld(pos) ? 1 : 0) - (this.keyHeld(neg) ? 1 : 0);
    return keys || this.padAxis(pos, touch) - this.padAxis(neg, touch);
  }

  clear = (): void => {
    this.down.clear();
    this.dragging = false;
    this.lookDX = this.lookDY = 0;
    this.mouseHeld = this.rightDrag = false;
    this.clicks.length = 0;
    this.wheelSteps = 0;
    this.dragY = 0;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.onBlur();
  };

  private onBlur = (): void => {
    this.clear();
    // A pending remap should not consume the first key after returning to the app.
    const capture = this.capture;
    this.capture = null;
    capture?.('Escape');
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.setDevice('keyboard');
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || e.isComposing || !isBindingCode(e.code)) return;
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (e.isComposing || target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const actions = this.codeToActions.get(e.code);
    if (this.active) {
      // 游戏中拦截浏览器快捷键（Ctrl+S/D/H/F/R/P 等可拦截；Ctrl+W 等无法拦截的由离开确认兜底）
      if (actions || e.ctrlKey || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    }
    if (!actions) return;
    if (!e.repeat && !this.down.has(e.code)) {
      const wasActive = this.active;
      for (const a of actions) if ((EDGE as string[]).includes(a) && (this.active || a === 'pause' || a === 'photo')) this.onEdge?.(a as EdgeAction);
      // A remapped Enter/Space can resume from a focused menu button. Consuming
      // that transition prevents its native click (and the tutorial skip key)
      // from also acting on the same physical press.
      if (!wasActive && this.active) e.preventDefault();
    }
    // onEdge may pause the game and clear the held keys. Never add a stale key
    // afterwards, or collect movement keys while a menu has keyboard focus.
    if (this.active) this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private pointerAt(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    this.mouseInside = Math.abs(this.mouseX) <= 1 && Math.abs(this.mouseY) <= 1;
  }

  private onMouseMove = (e: MouseEvent): void => {
    // （手一碰鼠标就是在用键盘鼠标；只差一两个像素的抖动不算）
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setDevice('keyboard');
    if (!this.active) return;
    if (this.simMode && !this.freeMouse) {
      this.pointerAt(e);
      if (this.rightDrag) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      } else if (this.mouseHeld) this.dragY -= e.movementY / Math.max(1, this.canvas.clientHeight);
      return;
    }
    if (this.locked || this.dragging) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    }
  };

  private onMouseLeave = (): void => {
    this.mouseInside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.active || !(this.simMode || this.freeMouse)) return;
    e.preventDefault();
    this.wheelSteps += e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.setDevice('keyboard');
    if (!this.active) return;
    // （超仿真里进拍照模式也是这样：这时候鼠标不是手）
    if (this.freeMouse) {
      this.dragging = e.button === 0 || e.button === 2;
      return;
    }
    if (this.simMode) {
      this.pointerAt(e);
      if (e.button === 0) this.mouseHeld = true;
      if (e.button === 2) this.rightDrag = true;
      // 右键既可以环视，也可以把旋钮往回拧：有没有拖动由 App 看
      this.clicks.push({ button: e.button, x: this.mouseX, y: this.mouseY });
      return;
    }
    if (e.button !== 0) return;
    if (!this.locked) {
      this.dragging = true;
      // 上一次没锁上也再试一次：按 Esc 退出锁定后浏览器会拦一小会儿，那次失败不代表这台机器锁不了。
      // 点一下画面是真正的用户操作，锁不上就按住拖动看，什么也不丢
      this.requestLock();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.dragging = false;
    if (e.button === 0) this.mouseHeld = false;
    if (e.button === 2) this.rightDrag = false;
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.active) e.preventDefault();
  };

  requestLock(): void {
    if (!this.active || this.disposed || this.simMode || this.freeMouse || this.touch) return;
    const request = ++this.lockRequest;
    const failed = () => {
      if (request === this.lockRequest && this.active && !this.locked && !this.disposed) this.lockFailed = true;
    };
    const c = this.canvas;
    if (!c.requestPointerLock) {
      this.lockFailed = true;
      return;
    }
    try {
      const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.then === 'function') {
        void r.then(() => {
          // Permission can resolve after listeners were removed by dispose().
          if (this.disposed || !this.active) this.exitLock();
        }, failed);
      }
    } catch {
      failed();
    }
  }

  exitLock(): void {
    this.lockRequest++;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onPointerLock = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    // A pending browser permission can resolve after the player has paused.
    if (this.locked && !this.active) {
      this.exitLock();
      return;
    }
    if (this.locked) {
      this.lockRequest++;
      this.lockFailed = false;
    } else this.clear();
    this.onLockChange?.(this.locked);
  };

  private onPointerLockError = (): void => {
    if (this.active && !this.locked && !this.disposed) this.lockFailed = true;
  };

  /** 取出本帧视线变化（弧度）。 */
  takeLook(dt: number): [number, number] {
    const s = this.settings;
    const k = 0.0022 * s.mouseSensitivity;
    let dx = this.lookDX * k;
    let dy = this.lookDY * k;
    this.lookDX = this.lookDY = 0;
    // 方向键观察（鼠标锁定不可用时的替代方式）
    dx += this.axis('lookLeft', 'lookRight') * 1.6 * dt;
    dy -= this.axis('lookDown', 'lookUp') * 1.2 * dt;
    if (this.active && this.pad.connected) {
      dx += this.pad.lookX * 2.1 * s.padSensitivity * dt;
      dy += this.pad.lookY * 1.6 * s.padSensitivity * dt;
    }
    if (s.invertX) dx = -dx;
    if (s.invertY) dy = -dy;
    return [dx, dy];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.cancelCapture();
    this.clear();
    this.exitLock();
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel as EventListener);
    document.removeEventListener('mouseleave', this.onMouseLeave);
  }
}

const NO_CLICKS: PointerClick[] = [];

/** 摇杆（手柄或屏幕上的）往这个动作的方向推了多少（0..1） */
function stickAmount(p: TouchAxes, a: Action): number {
  switch (a) {
    case 'forward':
      return Math.max(0, p.forward);
    case 'back':
      return Math.max(0, -p.forward);
    case 'right':
      return Math.max(0, p.turn);
    case 'left':
      return Math.max(0, -p.turn);
    case 'strafeRight':
      return Math.max(0, p.lateral);
    case 'strafeLeft':
      return Math.max(0, -p.lateral);
    case 'up':
      return Math.max(0, p.vertical);
    case 'down':
      return Math.max(0, -p.vertical);
    default:
      return 0;
  }
}

/** 离屏幕边还有 EDGE_ZONE 时开始转，越靠边越快（平方：刚进去只是微微转） */
function edgeRate(p: number): number {
  const a = Math.abs(p);
  const k = (a - (1 - EDGE_ZONE)) / EDGE_ZONE;
  if (k <= 0) return 0;
  return Math.sign(p) * Math.min(1, k) * Math.min(1, k);
}
