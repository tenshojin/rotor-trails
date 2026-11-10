// 手柄走菜单：菜单都是网页元素，按屏幕上的位置找这个方向上最近的一个控件。滑块左右调值，下拉框左右换项。
// 长页面（操作说明、飞行记录）只有一个“关闭”按钮：往下没有控件了就滚动页面，右摇杆也能上下滚。
// 拍照模式的面板（panelNavigate）：十字键左右挑项目，上下调这一项，A 按下。

import type { PadNav } from '../game/gamepad';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function visible(e: HTMLElement): boolean {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}

/** 最上面那一层：有弹窗就是弹窗，否则是整个界面 */
function topLayer(root: HTMLElement): HTMLElement {
  const layers = root.querySelectorAll<HTMLElement>('.modal');
  return layers.length ? layers[layers.length - 1] : root;
}

/** 现在能操作的控件：有弹窗就只看弹窗 */
function controls(root: HTMLElement): HTMLElement[] {
  return [...topLayer(root).querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** 能滚动的那一块：焦点所在的那一块优先，其次是这一层里第一个内容超出的 */
function scroller(root: HTMLElement): HTMLElement | null {
  const layer = topLayer(root);
  const canScroll = (e: HTMLElement): boolean => e.scrollHeight > e.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(e).overflowY);
  for (let e = document.activeElement as HTMLElement | null; e && layer.contains(e); e = e.parentElement) if (canScroll(e)) return e;
  return [layer, ...layer.querySelectorAll<HTMLElement>('.modal > *, .screen, .card')].find((e) => e && canScroll(e)) ?? null;
}

/** 右摇杆滚动长页面：px 是这一帧要滚多少（向下为正）。滚动了返回 true */
export function padScroll(root: HTMLElement, px: number): boolean {
  const s = scroller(root);
  if (!s || !px) return false;
  const before = s.scrollTop;
  s.scrollTop = before + px;
  return s.scrollTop !== before;
}

function adjust(e: HTMLElement, sign: number): boolean {
  if (e instanceof HTMLInputElement && e.type === 'range') {
    // 刻度很细的滑块（焦距 0.002 一格）按一下只动一丝看不出来：最多五十下从头走到尾
    const span = Number(e.max) - Number(e.min) || 1;
    const fine = Number(e.step) || span / 20;
    const step = span / fine > 50 ? span / 50 : fine;
    e.value = String(Number(e.value) + sign * step);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (e instanceof HTMLSelectElement) {
    const i = e.selectedIndex + sign;
    if (i >= 0 && i < e.options.length) {
      e.selectedIndex = i;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  return false;
}

/** 这个方向上最近的控件：沿方向的距离为主，错开的距离罚得重一些。
 *  错开算的是两个方块之间的空隙，不是中心：窄屏上主按钮占满一行，按中心算就跳过了紧挨着它的那排小按钮 */
function nearest(list: HTMLElement[], from: HTMLElement, dir: PadNav): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const e of list) {
    if (e === from) continue;
    const b = e.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const vertical = dir === 'up' || dir === 'down';
    const gap = vertical ? Math.max(0, b.left - a.right, a.left - b.right) : Math.max(0, b.top - a.bottom, a.top - b.bottom);
    if (along <= 2) continue;
    const s = along + gap * 2.2 + Math.abs(vertical ? dx : dy) * 0.15;
    if (s < score) {
      score = s;
      best = e;
    }
  }
  return best;
}

/**
 * 焦点挪过去，再打上 .pad-focus 画框。光靠 :focus 不够：浏览器窗口没被选中的时候（游戏开在第二块屏幕上、
 * 手柄照样能按）不画 :focus。App 也在焦点自己变化时（新页面打开、弹窗关上）补这个标记
 */
export function markPadFocus(e: Element | null): void {
  document.querySelectorAll('.pad-focus').forEach((o) => {
    if (o !== e) o.classList.remove('pad-focus');
  });
  if (e && e !== document.body && e instanceof HTMLElement) e.classList.add('pad-focus');
}

function mark(e: HTMLElement): void {
  e.focus({ preventScroll: false });
  e.scrollIntoView({ block: 'nearest' });
  markPadFocus(e);
}

/** 手柄在菜单里按了一下。root：游戏的根节点 */
export function padNavigate(root: HTMLElement, d: PadNav): void {
  const list = controls(root);
  const now = document.activeElement as HTMLElement | null;
  const here = now && list.includes(now) ? now : null;
  if (d === 'ok') {
    (here ?? list.find((e) => e.classList.contains('primary')) ?? list[0])?.click();
    return;
  }
  if (d === 'back') {
    const out = list.find((e) => e.dataset.a === 'close' || e.dataset.a === 'back');
    if (out) out.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    return;
  }
  if (!here) {
    if (list.length) mark(list.find((e) => e.classList.contains('primary')) ?? list[0]);
    else if (d === 'up' || d === 'down') padScroll(root, (d === 'down' ? 1 : -1) * 160);
    return;
  }
  if ((d === 'left' || d === 'right') && adjust(here, d === 'left' ? -1 : 1)) return;
  const next = nearest(list, here, d);
  if (next) mark(next);
  // 往下没有控件了（长页面只有一个“关闭”）：滚动页面，把下面的字露出来
  else if (d === 'up' || d === 'down') {
    const s = scroller(root);
    if (s) padScroll(root, (d === 'down' ? 1 : -1) * Math.max(120, s.clientHeight * 0.4));
  }
}

/**
 * 拍照模式的面板（一排横着的控件）：左右挑项目，上下调这一项（滑块加减、下拉框换一个、勾选框开关），A 按下。
 * 一进来什么都没挑的时候，第一下落在 first 上（焦距：最常调的就是它）。
 */
export function panelNavigate(panel: HTMLElement, d: PadNav, first?: string): void {
  const list = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!list.length) return;
  const now = document.activeElement as HTMLElement | null;
  const here = now && list.includes(now) ? now : null;
  if (!here) {
    const start = (first && panel.querySelector<HTMLElement>(first)) || list[0];
    mark(start);
    if (d === 'ok') start.click();
    return;
  }
  if (d === 'ok' || d === 'back') {
    if (d === 'ok') here.click();
    return;
  }
  if (d === 'left' || d === 'right') {
    const i = list.indexOf(here);
    mark(list[(i + (d === 'right' ? 1 : -1) + list.length) % list.length]);
    return;
  }
  const sign = d === 'up' ? 1 : -1;
  if (here instanceof HTMLInputElement && here.type === 'checkbox') {
    here.click();
    return;
  }
  adjust(here, sign);
}
