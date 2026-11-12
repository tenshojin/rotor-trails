// 触屏操作：两根虚拟摇杆（和航模遥控器一样的“美国手”）加几个按键，手指按在哪儿摇杆就出现在哪儿。
//   左摇杆  上下 = 爬升 / 下降，左右 = 转向
//   右摇杆  上下 = 前进 / 后退，左右 = 平移
//   屏幕其余地方拖动 = 转头看
// 摇杆的量走手柄同一条路（Input.padAxis），所以教学里“按住了没有”、飞行手感都不用另写一份。
// 悬停、增强这种开关键自己亮着显示状态：手机屏幕矮，写状态的大面板放不下。

import { shape } from '../game/gamepad';
import { tr } from '../i18n';

export type TouchEdge = 'hover' | 'boost' | 'view' | 'center' | 'pause' | 'cruise' | 'nav';

/** 拇指从按下的地方推多远算推到底（像素） */
const REACH = 58;
/** 拖动转头比鼠标灵敏一些：手机屏幕小 */
const LOOK_GAIN = 2.2;

/** 'fly' 全有；'photo' 拍照模式（两根摇杆挪机位、拖动转镜头，没有飞行按键）；'look' 只能拖动转头；'off' 什么都没有 */
export type TouchMode = 'off' | 'look' | 'photo' | 'fly';

interface Stick {
  el: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  id: number | null;
  x0: number;
  y0: number;
}

/** 只有触屏、没有鼠标的设备（手机、平板）。网址加 ?touch=1 可以在电脑上看 */
export function touchOnly(): boolean {
  try {
    if (new URLSearchParams(location.search).get('touch') === '1') return true;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export class TouchControls {
  forward = 0;
  turn = 0;
  lateral = 0;
  vertical = 0;
  onEdge: (a: TouchEdge) => void = () => {};
  onLook: (dx: number, dy: number) => void = () => {};
  /** 手指碰到了屏幕上的摇杆、按键或者拖动转头（App 拿它把提示换回触屏的叫法） */
  onTouch: () => void = () => {};
  private readonly root: HTMLElement;
  private readonly left: Stick;
  private readonly right: Stick;
  private readonly cruiseBtn: HTMLElement;
  private readonly viewBtn: HTMLElement;
  private readonly navBtn: HTMLElement;
  private readonly keys = new Map<TouchEdge, HTMLElement>();
  private readonly keyState = new Map<TouchEdge, string>();
  private readonly lookLayer: HTMLElement;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private mode: TouchMode = 'off';

  constructor(parent: HTMLElement) {
    const root = (this.root = document.createElement('div'));
    root.className = 'touch-ui hidden';
    root.innerHTML = `<div class="t-look"></div>
      <div class="t-stick t-left"><i class="t-base"><b class="t-knob"></b><span class="t-fly">${tr`升降 · 转向`}</span><span class="t-photo">${tr`升降 · 左右`}</span></i></div>
      <div class="t-stick t-right"><i class="t-base"><b class="t-knob"></b><span class="t-fly">${tr`前后 · 平移`}</span><span class="t-photo">${tr`前后 · 左右`}</span></i></div>
      <div class="t-keys t-keys-l">
        <button type="button" class="t-key" data-k="pause" aria-label="${tr`暂停`}">${tr`暂停`}</button>
        <button type="button" class="t-key" data-k="view" aria-label="${tr`切换视角`}">${tr`视角`}</button>
        <button type="button" class="t-key hidden" data-k="nav" aria-label="${tr`切换导航目标或推荐路线`}">${tr`导航`}</button>
        <button type="button" class="t-key" data-k="center" aria-label="${tr`视角回正`}">${tr`回正`}</button>
      </div>
      <div class="t-keys t-keys-r">
        <button type="button" class="t-key hidden" data-k="cruise" aria-label="${tr`自动巡航`}" aria-pressed="false">${tr`巡航`}</button>
        <button type="button" class="t-key" data-k="boost" aria-label="${tr`动力增强`}">${tr`增强`}</button>
        <button type="button" class="t-key" data-k="hover" aria-label="${tr`悬停辅助`}" aria-pressed="false">${tr`悬停`}</button>
      </div>`;
    parent.appendChild(root);
    this.lookLayer = root.querySelector('.t-look') as HTMLElement;
    this.cruiseBtn = root.querySelector('[data-k="cruise"]') as HTMLElement;
    this.viewBtn = root.querySelector('[data-k="view"]') as HTMLElement;
    this.navBtn = root.querySelector('[data-k="nav"]') as HTMLElement;
    this.left = this.stick('.t-left');
    this.right = this.stick('.t-right');
    this.lookLayer.addEventListener('pointerdown', this.lookStart);
    this.lookLayer.addEventListener('pointermove', this.lookMove);
    this.lookLayer.addEventListener('pointerup', this.lookEnd);
    this.lookLayer.addEventListener('pointercancel', this.lookEnd);
    this.lookLayer.addEventListener('lostpointercapture', this.lookEnd);
    root.querySelectorAll<HTMLElement>('.t-key').forEach((b) => {
      this.keys.set(b.dataset.k as TouchEdge, b);
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        this.onTouch();
        this.onEdge(b.dataset.k as TouchEdge);
      });
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 开关键的状态：on 亮着（悬停开着、巡航开着、增强正在生效），dim 暗着（手上没有增强），text 换字（增强 ×2） */
  setKey(k: TouchEdge, on: boolean, dim = false, text?: string): void {
    const b = this.keys.get(k);
    if (!b) return;
    const sig = `${on}|${dim}|${text ?? ''}`;
    if (this.keyState.get(k) === sig) return;
    this.keyState.set(k, sig);
    b.classList.toggle('on', on);
    b.classList.toggle('dim', dim);
    if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
    if (text !== undefined) b.textContent = text;
  }

  private stick(selector: string): Stick {
    const el = this.root.querySelector(selector) as HTMLElement;
    const s: Stick = { el, base: el.querySelector('.t-base') as HTMLElement, knob: el.querySelector('.t-knob') as HTMLElement, id: null, x0: 0, y0: 0 };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || s.id !== null) return;
      e.preventDefault();
      this.onTouch();
      s.id = e.pointerId;
      s.x0 = e.clientX;
      s.y0 = e.clientY;
      el.setPointerCapture?.(e.pointerId);
      // 按在哪儿摇杆就到哪儿：手大手小、屏幕大小都不用找位置
      const r = el.getBoundingClientRect();
      s.base.style.left = `${e.clientX - r.left}px`;
      s.base.style.top = `${e.clientY - r.top}px`;
      s.base.style.bottom = 'auto';
      s.base.classList.add('on');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== s.id) return;
      this.push(s, e.clientX - s.x0, e.clientY - s.y0);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== s.id) return;
      this.release(s);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    return s;
  }

  private push(s: Stick, dx: number, dy: number): void {
    const d = Math.hypot(dx, dy);
    const k = d > REACH ? REACH / d : 1;
    const x = dx * k;
    const y = dy * k;
    s.knob.style.transform = `translate(${x}px, ${y}px)`;
    const h = shape(x / REACH);
    const v = shape(-y / REACH);
    if (s === this.left) {
      this.turn = h;
      this.vertical = v;
    } else {
      this.lateral = h;
      this.forward = v;
    }
  }

  private release(s: Stick): void {
    const id = s.id;
    s.id = null;
    if (id !== null) {
      try {
        s.el.releasePointerCapture?.(id);
      } catch {
        /* 浏览器可能已经收回了 */
      }
    }
    s.knob.style.transform = '';
    s.base.style.left = s.base.style.top = s.base.style.bottom = '';
    s.base.classList.remove('on');
    if (s === this.left) this.turn = this.vertical = 0;
    else this.lateral = this.forward = 0;
  }

  private lookStart = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || this.lookId !== null) return;
    e.preventDefault();
    this.onTouch();
    this.lookId = e.pointerId;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
    this.lookLayer.setPointerCapture?.(e.pointerId);
  };

  private lookMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookId) return;
    this.onLook((e.clientX - this.lookX) * LOOK_GAIN, (e.clientY - this.lookY) * LOOK_GAIN);
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  };

  private lookEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.lookId) this.lookId = null;
  };

  /** 松开所有手指：窗口失焦、屏幕转向、换成鼠标或手柄的时候 */
  reset = (): void => {
    this.release(this.left);
    this.release(this.right);
    const id = this.lookId;
    this.lookId = null;
    if (id !== null) {
      try {
        this.lookLayer.releasePointerCapture?.(id);
      } catch {
        /* 浏览器可能已经收回了 */
      }
    }
  };

  setMode(m: TouchMode): void {
    if (m === this.mode) return;
    // 飞行和拍照的摇杆管的不是一回事：换过去的时候手指还按着也要松开，不然机位接着飞行的量走
    this.reset();
    this.mode = m;
    this.root.classList.toggle('hidden', m === 'off');
    this.root.classList.toggle('look-only', m === 'look');
    this.root.classList.toggle('photo-sticks', m === 'photo');
    if (m === 'off') this.lookId = null;
  }

  /** 休闲飞行才有自动巡航和切换视角（任务和训练固定座舱视角，见 game/views.ts）；任务里有导航键（切换推荐路线、可选任务） */
  setFree(on: boolean, nav = !on): void {
    this.cruiseBtn.classList.toggle('hidden', !on);
    this.viewBtn.classList.toggle('hidden', !on);
    this.navBtn.classList.toggle('hidden', !nav);
  }

  dispose(): void {
    this.reset();
    this.root.remove();
  }
}
