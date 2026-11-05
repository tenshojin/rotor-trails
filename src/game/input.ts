// 键盘鼠标输入：可重绑定的按键、鼠标锁定观察（失败时退化为拖拽/方向键观察）、
// 浏览器快捷键冲突处理（游戏中拦截可拦截的 Ctrl 组合键）、失焦/切后台时清空按键状态。

import { isBindingCode, type Action, type Settings } from './settings';

type EdgeAction = 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange' | 'hud' | 'cruise';
const EDGE: EdgeAction[] = ['hover', 'boost', 'center', 'pause', 'view', 'nav', 'mapRange', 'hud', 'cruise'];

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
  onEdge: ((a: EdgeAction) => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** 改键捕获：返回按下的按键代码 */
  private capture: ((code: string) => void) | null = null;
  private disposed = false;
  private lockRequest = 0;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.rebuild();
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
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.rebuild();
  }

  private rebuild(): void {
    this.codeToActions.clear();
    for (const [action, codes] of Object.entries(this.settings.bindings) as Array<[Action, string[]]>) {
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
    for (const c of this.settings.bindings[a]) if (this.down.has(c)) return true;
    return false;
  }

  axis(neg: Action, pos: Action): number {
    return (this.is(pos) ? 1 : 0) - (this.is(neg) ? 1 : 0);
  }

  clear = (): void => {
    this.down.clear();
    this.dragging = false;
    this.lookDX = this.lookDY = 0;
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
      for (const a of actions) if ((EDGE as string[]).includes(a) && (this.active || a === 'pause')) this.onEdge?.(a as EdgeAction);
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

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    if (this.locked || this.dragging) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.active || e.button !== 0) return;
    if (!this.locked) {
      this.dragging = true;
      if (!this.lockFailed && e.button === 0) this.requestLock();
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.active) e.preventDefault();
  };

  requestLock(): void {
    if (!this.active || this.disposed) return;
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
  }
}
