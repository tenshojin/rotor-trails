import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';
import { UI } from '../src/ui/menus';
import { defaultSettings, type Settings } from '../src/game/settings';
import { gradeLanding } from '../src/sim/mission';
import type { GameSession } from '../src/sim/session';
import { DEG } from '../src/core/math';

// Only the DOM capabilities used by lifecycle/focus handling are needed here.
// Real layout, keyboard navigation and responsive checks live in ui-regression.html.
class Element extends EventTarget {
  parent: Element | null = null;
  children: Element[] = [];
  className = '';
  innerHTML = '';
  tabIndex = -1;
  inert = false;
  width = 300;
  height = 150;
  id = '';
  private attributes = new Map<string, string>();
  style = { setProperty: vi.fn() };
  context = new Proxy({ setTransform: vi.fn() } as Record<string, unknown>, { get: (target, key: string) => target[key] ??= vi.fn() });
  classList = {
    contains: (name: string) => this.className.split(' ').includes(name),
    add: (name: string) => this.classList.toggle(name, true),
    remove: (name: string) => this.classList.toggle(name, false),
    toggle: (name: string, force = !this.classList.contains(name)) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (force) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
      return force;
    },
  };
  constructor(readonly tagName = 'div') { super(); }
  get firstElementChild(): Element | null { return this.children[0] ?? null; }
  get isConnected(): boolean { return this === body || !!this.parent?.isConnected; }
  appendChild(child: Element): Element { child.remove(); child.parent = this; this.children.push(child); return child; }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  getContext(): typeof this.context { return this.context; }
  querySelector(): null { return null; }
  querySelectorAll(): Element[] { return []; }
  closest(): null { return null; }
  contains(child: Element): boolean { return this === child || this.children.some((item) => item.contains(child)); }
  focus = vi.fn(() => { dom.activeElement = this; });
}

let body: Element;
let dom: { activeElement: Element | null; createElement: (tag: string) => Element };
const html = (element: Element) => element as unknown as HTMLDivElement;
type ModalTestApi = { openModal: (element: HTMLDivElement, cleanup?: (notify: boolean) => void) => void; show: (element: HTMLDivElement) => void };

beforeEach(() => {
  vi.useFakeTimers();
  body = new Element('body');
  dom = { activeElement: null, createElement: (tag) => new Element(tag) };
  vi.stubGlobal('document', dom);
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('界面释放与失效回调', () => {
  it('普通关闭恢复原焦点；销毁取消清理但不触发设置保存/恢复游戏', () => {
    const ui = new UI(html(body));
    const api = ui as unknown as ModalTestApi;
    const opener = body.appendChild(new Element('button'));
    opener.focus();
    const screen = new Element();
    api.show(html(screen));
    opener.focus();
    const cleanup = vi.fn();
    api.openModal(html(new Element()), cleanup);
    expect(screen.inert).toBe(true);
    ui.closeModal();
    expect(cleanup).toHaveBeenLastCalledWith(true);
    expect(screen.inert).toBe(false);
    expect(dom.activeElement).toBe(opener);

    api.openModal(html(new Element()), cleanup);
    opener.focus.mockClear();
    ui.onClick = vi.fn();
    ui.dispose();
    ui.dispose();
    expect(cleanup.mock.calls).toEqual([[true], [false]]);
    expect(opener.focus).not.toHaveBeenCalled();
    expect(ui.hasModal).toBe(false);
    expect(ui.root.isConnected).toBe(false);
    expect(ui.root.children.length).toBe(0);
    expect(ui.onClick).toBeNull();

    const lateCleanup = vi.fn();
    api.openModal(html(new Element()), lateCleanup);
    api.show(html(new Element()));
    expect(lateCleanup).toHaveBeenCalledWith(false);
    expect(ui.root.children.length).toBe(0);
  });

  it('提示数量限制同步取消旧定时器，隐藏和销毁后均无后台提示任务', () => {
    const hud = new Hud(html(body));
    hud.show(true);
    for (let i = 0; i < 8; i++) hud.toast(`提示 ${i}`);
    expect(vi.getTimerCount()).toBe(10);
    vi.advanceTimersByTime(3500);
    expect(vi.getTimerCount()).toBe(5);
    hud.show(false);
    expect(vi.getTimerCount()).toBe(0);
    hud.show(true);
    hud.toast('正在退出');
    hud.dispose();
    hud.dispose();
    hud.toast('异步返回的旧提示');
    expect(vi.getTimerCount()).toBe(0);
    expect(hud.root.isConnected).toBe(false);
    const canvases = (hud.root as unknown as Element).children.flatMap((element) => [element, ...element.children]).filter((element) => element.tagName === 'canvas');
    expect(canvases).toHaveLength(3);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    hud.resize();
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('隐藏或已释放的 HUD 不读取飞行状态或绘制画布', () => {
    const hud = new Hud(html(body));
    const unused = undefined as never;
    expect(() => hud.update(unused, unused, unused, 1)).not.toThrow();
    hud.show(true);
    hud.dispose();
    expect(() => hud.update(unused, unused, unused, 1)).not.toThrow();
  });

  it('降落 HUD 与任务评分在位置、下降、漂移和姿态边界给出一致结论', () => {
    const hud = new Hud(html(body));
    const api = hud as unknown as { updateLanding: (session: GameSession, settings: Settings) => void };
    const root = hud.root as unknown as Element;
    const panel = root.children.find((element) => element.classList.contains('hud-landing'))!;
    const info = panel.children.find((element) => element.classList.contains('land-info'))!;
    const pad = { id: 'test-pad', name: '测试坪', pos: [0, 0, 0], size: 20 };
    const settings = defaultSettings();
    for (const offset of [0, 8.5, 10.49, 10.5, 10.51, 11]) {
      for (const descent of [0, 2.5, 2.51]) for (const horizontal of [0, 2.5, 2.51]) for (const attitude of [0, 12, 12.1]) {
        const session = {
          landingTarget: () => pad,
          mission: { current: () => ({ def: { kind: 'land', padId: pad.id } }) },
          body: { pos: { x: offset, y: 6, z: 0 }, vel: { x: horizontal, y: -descent, z: 0 } },
          flight: { telemetry: { pitch: attitude * DEG, roll: 0, heading: 0 } },
          skidY: 5,
          groundSpeed: horizontal,
        } as unknown as GameSession;
        api.updateLanding(session, settings);
        const expected = gradeLanding(descent, horizontal, attitude * DEG / DEG, offset, pad.size / 2);
        expect(info.innerHTML.includes('land-verdict ok'), `offset ${offset}, descent ${descent}, drift ${horizontal}, attitude ${attitude}`).toBe(expected.safe);
      }
    }
    hud.dispose();
  });
});
