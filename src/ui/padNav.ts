// 手柄走菜单：菜单都是网页元素，按屏幕上的位置找这个方向上最近的一个控件。滑块左右调值，下拉框左右换项。

import type { PadNav } from '../game/gamepad';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function visible(e: HTMLElement): boolean {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}

/** 现在能操作的控件：有弹窗就只看弹窗 */
function controls(root: HTMLElement): HTMLElement[] {
  const layers = root.querySelectorAll<HTMLElement>('.modal');
  const top = layers.length ? layers[layers.length - 1] : root;
  return [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function adjust(e: HTMLElement, sign: number): boolean {
  if (e instanceof HTMLInputElement && e.type === 'range') {
    const step = Number(e.step) || (Number(e.max) - Number(e.min)) / 20 || 1;
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

/** 这个方向上最近的控件：沿方向的距离为主，偏出去的距离罚得重一些 */
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
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 2) continue;
    const s = along + across * 2.2;
    if (s < score) {
      score = s;
      best = e;
    }
  }
  return best;
}

function mark(e: HTMLElement): void {
  document.querySelectorAll('.pad-focus').forEach((o) => o.classList.remove('pad-focus'));
  e.classList.add('pad-focus');
  e.focus({ preventScroll: false });
  e.scrollIntoView({ block: 'nearest' });
}

/** 手柄在菜单里按了一下。root：游戏的根节点 */
export function padNavigate(root: HTMLElement, d: PadNav): void {
  const list = controls(root);
  if (!list.length) return;
  const now = document.activeElement as HTMLElement | null;
  const here = now && list.includes(now) ? now : null;
  if (d === 'ok') {
    (here ?? list.find((e) => e.classList.contains('primary')) ?? list[0]).click();
    return;
  }
  if (d === 'back') {
    const out = list.find((e) => e.dataset.a === 'close' || e.dataset.a === 'back');
    if (out) out.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    return;
  }
  if (!here) {
    mark(list.find((e) => e.classList.contains('primary')) ?? list[0]);
    return;
  }
  if ((d === 'left' || d === 'right') && adjust(here, d === 'left' ? -1 : 1)) return;
  const next = nearest(list, here, d);
  if (next) mark(next);
}
