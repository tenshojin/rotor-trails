// 键盘鼠标输入：可重绑定的按键、鼠标锁定观察（失败时退化为拖拽/方向键观察）、
// 浏览器快捷键冲突处理（游戏中拦截可拦截的 Ctrl 组合键）、失焦/切后台时清空按键状态。

import type { Action, Settings } from './settings';

type EdgeAction = 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange';
const EDGE: EdgeAction[] = ['hover', 'boost', 'center', 'pause', 'view', 'nav', 'mapRange'];

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

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.rebuild();
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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

  captureNextKey(cb: (code: string) => void): void {
    this.capture = cb;
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
    if (document.hidden) this.clear();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const actions = this.codeToActions.get(e.code);
    if (this.active) {
      // 游戏中拦截浏览器快捷键（Ctrl+S/D/H/F/R/P 等可拦截；Ctrl+W 等无法拦截的由离开确认兜底）
      if (actions || e.ctrlKey || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    }
    if (!actions) return;
    if (!e.repeat && !this.down.has(e.code)) {
      for (const a of actions) if ((EDGE as string[]).includes(a) && (this.active || a === 'pause')) this.onEdge?.(a as EdgeAction);
    }
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    // 修饰键松开时，部分浏览器不会为同时按下的字母键发送 keyup（例如 Ctrl+W 被拦截后）
    if (e.code.startsWith('Control') || e.code.startsWith('Shift') || e.code.startsWith('Alt') || e.code.startsWith('Meta')) {
      if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
        /* 保持其他键状态 */
      }
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;
    if (this.locked || this.dragging) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.active) return;
    if (!this.locked) {
      this.dragging = true;
      if (!this.lockFailed && e.button === 0) this.requestLock();
    }
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  requestLock(): void {
    const c = this.canvas;
    if (!c.requestPointerLock) {
      this.lockFailed = true;
      return;
    }
    try {
      const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onPointerLock = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.lockFailed = false;
    this.onLockChange?.(this.locked);
  };

  private onPointerLockError = (): void => {
    this.lockFailed = true;
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
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
  }
}
