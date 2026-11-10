// HUD：地速/空速、离地高度与海拔（分别标注）、垂直速度、姿态、耐久、动力余量、风、导航（方向/距离/建议高度与速度/转弯预告/分岔选项）、
// 任务目标、Buff 状态、着陆辅助（俯视悬停显示 + 安全着陆条件）、提示消息与告警。全部数据来自实际游戏状态。

import * as THREE from 'three';
import { DEG, RAD, clamp, headingDelta, wrap360 } from '../core/math';
import { BUFFS } from '../sim/buffs';
import { STATUS_LABEL } from '../sim/damage';
import { LANDING_LIMITS } from '../sim/mission';
import type { GameSession } from '../sim/session';
import { keyName, type Settings } from '../game/settings';
import type { TutorialHud } from '../game/tutorial';
import type { WorldView } from '../render/worldView';
import { tr } from '../i18n';

const SPEED_K = { kmh: 3.6, kt: 1.9438, ms: 1 };
const SPEED_U = { kmh: 'km/h', kt: 'kt', ms: 'm/s' };
const headingLabel = (degrees: number) => String(Math.round(wrap360(degrees)) % 360).padStart(3, '0');

// 静止或悬停时大部分文字不变，不必每秒重建十余次 DOM。
const markup = new WeakMap<HTMLElement, string>();
function setMarkup(element: HTMLElement, value: string): void {
  if (markup.get(element) === value) return;
  element.innerHTML = value;
  markup.set(element, value);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 标记旁边那行字放在哪：y 处压着面板或航点读数，就试另一边 alt；两边都压着就留在原处、淡一些。
 * cx、half：字的中心和半宽；y 是字的基线（字高按 13 px 算）
 */
export function placeLabel(cx: number, half: number, y: number, alt: number | undefined, blockers: readonly Box[]): { y: number; dim: boolean } {
  const hit = (yy: number): boolean => blockers.some((b) => cx - half < b.right && cx + half > b.left && yy - 13 < b.bottom && yy + 4 > b.top);
  if (!hit(y)) return { y, dim: false };
  if (alt !== undefined && !hit(alt)) return { y: alt, dim: false };
  return { y, dim: true };
}

export class Hud {
  readonly root: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private og: CanvasRenderingContext2D;
  private objTitle: HTMLDivElement;
  private objDetail: HTMLDivElement;
  private objBar: HTMLElement;
  private objHint: HTMLDivElement;
  private optList: HTMLDivElement;
  private flight: HTMLDivElement;
  private status: HTMLDivElement;
  private navBox: HTMLDivElement;
  private headingCv: HTMLCanvasElement;
  private forks: HTMLDivElement;
  private landing: HTMLDivElement;
  private landCv: HTMLCanvasElement;
  private landInfo: HTMLDivElement;
  private buffs: HTMLDivElement;
  private toasts: HTMLDivElement;
  private warn: HTMLDivElement;
  private hint: HTMLDivElement;
  private debug: HTMLDivElement;
  private lastText = -1;
  private mode = 0;
  /** 上次有事情需要注意的时间：平稳飞行一段时间后，面板收起来，把风景让出来 */
  private busyT = 0;
  private lastObjective = '';
  /** 教学时只露出学到的部分（null = 不在教学里） */
  private tut: TutorialHud | null = null;
  private tutKey = '';
  /** 休闲模式：没有任务和导航，平时只留航向和一行读数 */
  private free = false;
  /** 自动巡航开着 */
  autoFlight = false;
  /** 点了第几张路线卡片（触屏） */
  onFork: ((index: number) => void) | null = null;
  /** 动力到顶：这一次从什么时候开始、最后一次是什么时候 */
  private limitOn = false;
  private limitAt = -99;
  private limitT = -99;
  showDebug = false;
  private proj = { x: 0, y: 0, behind: false };
  private pkPos = new THREE.Vector3();
  private velocityMarker = new THREE.Vector3();
  private targetMarker = new THREE.Vector3();
  private disposed = false;
  private toastTimers = new Map<HTMLElement, [ReturnType<typeof setTimeout>, ReturnType<typeof setTimeout>]>();
  private placeCard: HTMLElement | null = null;
  /** 屏幕上被面板、航点读数占住的地方（半秒量一次）：标记的字落在上面就换到另一边，免得字压着字 */
  private blockers: Box[] = [];
  private blockT = -Infinity;
  private blockEls: HTMLElement[] = [];
  private placeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    this.overlay = el('canvas', 'hud-overlay', this.root);
    this.og = this.overlay.getContext('2d')!;
    const obj = el('div', 'panel hud-obj', this.root);
    el('div', 'hud-label', obj, tr('当前任务'));
    this.objTitle = el('div', 'obj-title', obj);
    this.objDetail = el('div', 'obj-detail', obj);
    const bar = el('div', 'obj-bar', obj);
    this.objBar = el('i', '', bar);
    this.objHint = el('div', 'obj-hint', obj);
    this.optList = el('div', 'obj-opt', obj);
    this.buffs = el('div', 'panel hud-buffs', this.root);
    this.flight = el('div', 'panel hud-flight', this.root);
    this.status = el('div', 'panel hud-status', this.root);
    this.navBox = el('div', 'hud-nav', this.root);
    this.headingCv = el('canvas', 'heading-tape', this.navBox);
    this.headingCv.width = 560;
    this.headingCv.height = 46;
    this.forks = el('div', 'hud-forks hidden', this.root);
    // 触屏上路线卡片能点：点哪张就推荐哪条（键盘、手柄是导航键轮着换）
    this.forks.addEventListener('pointerdown', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.fork');
      if (!card?.dataset.i) return;
      e.preventDefault();
      this.onFork?.(Number(card.dataset.i));
    });
    this.landing = el('div', 'panel hud-landing hidden', this.root);
    el('div', 'hud-label', this.landing, tr('着陆辅助'));
    this.landCv = el('canvas', 'land-cv', this.landing);
    this.landCv.width = this.landCv.height = 200;
    this.landInfo = el('div', 'land-info', this.landing);
    this.blockEls = [obj, this.buffs, this.flight, this.status, this.navBox, this.landing, this.forks];
    this.toasts = el('div', 'hud-toasts', this.root);
    this.toasts.setAttribute('role', 'status');
    this.toasts.setAttribute('aria-live', 'polite');
    this.warn = el('div', 'hud-warn', this.root);
    this.warn.setAttribute('role', 'alert');
    this.warn.setAttribute('aria-atomic', 'true');
    this.hint = el('div', 'hud-hint', this.root);
    this.debug = el('div', 'hud-debug hidden', this.root);
  }

  show(on: boolean): void {
    if (this.disposed) return;
    this.root.classList.toggle('hidden', !on);
    if (on) this.lastText = -Infinity;
    else this.clearToasts();
  }

  /** 超仿真：HUD 收起来，飞行信息都在仪表上（按 U 还能叫出来） */
  setHidden(hidden: boolean): void {
    this.mode = hidden ? 2 : 0;
    this.root.classList.toggle('hud-full', false);
    this.root.classList.toggle('hud-off', hidden);
  }

  /** 自动（平稳飞行时收起）→ 完整（一直显示）→ 隐藏（只留告警），返回新模式的名字 */
  cycleMode(): string {
    this.mode = (this.mode + 1) % 3;
    this.root.classList.toggle('hud-full', this.mode === 1);
    this.root.classList.toggle('hud-off', this.mode === 2);
    this.root.classList.toggle('hud-clean', this.mode === 2);
    return [tr('自动'), tr('完整'), tr('隐藏')][this.mode];
  }

  setFree(on: boolean): void {
    this.free = on;
    this.root.classList.toggle('hud-free', on);
  }

  /** 电影镜头里什么都不显示 */
  setCinema(on: boolean): void {
    this.root.classList.toggle('hud-cine', on);
  }

  /** 教学：露出哪些部分、这一步要看哪里 */
  setTutorial(view: TutorialHud | null): void {
    const key = view ? `${view.parts.join()}|${view.spot}` : '';
    if (key === this.tutKey) return;
    this.tutKey = key;
    this.tut = view;
    const r = this.root.classList;
    r.toggle('hud-tut', !!view);
    for (const part of ['flight', 'heading', 'nav', 'status', 'landing'] as const) {
      r.toggle(`tut-no-${part}`, !!view && !view.parts.includes(part));
      r.toggle(`tut-spot-${part}`, view?.spot === part);
    }
  }

  setOpacity(o: number): void {
    this.root.style.setProperty('--hud-opacity', String(clamp(o, 0.3, 1)));
  }

  setHint(text: string): void {
    this.hint.innerHTML = text;
    this.hint.classList.toggle('hidden', !text);
  }

  toast(text: string, level: 'info' | 'warn' | 'good' | 'bad' = 'info', ms = 3500): void {
    if (this.disposed) return;
    const t = el('div', `toast ${level}`, this.toasts, text);
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : 3500;
    this.toastTimers.set(t, [
      setTimeout(() => t.classList.add('out'), duration),
      setTimeout(() => this.removeToast(t), duration + 600),
    ]);
    while (this.toasts.children.length > 5) this.removeToast(this.toasts.firstElementChild as HTMLElement);
  }

  /** 飞到一个地方：地名和一句话淡入淡出，第一次来的多一行进度 */
  place(name: string, note: string, tail = ''): void {
    if (this.disposed) return;
    this.placeCard?.remove();
    if (this.placeTimer) clearTimeout(this.placeTimer);
    const card = el('div', 'hud-place', this.root);
    card.setAttribute('role', 'status');
    el('b', '', card, name);
    if (note) el('span', '', card, note);
    if (tail) el('i', '', card, tail);
    this.placeCard = card;
    this.placeTimer = setTimeout(() => {
      card.remove();
      this.placeTimer = null;
    }, 9000);
  }

  private removeToast(toast: HTMLElement): void {
    const timers = this.toastTimers.get(toast);
    if (timers) for (const timer of timers) clearTimeout(timer);
    this.toastTimers.delete(toast);
    toast.remove();
  }

  private clearToasts(): void {
    for (const toast of this.toastTimers.keys()) this.removeToast(toast);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearToasts();
    if (this.placeTimer) clearTimeout(this.placeTimer);
    this.overlay.width = this.overlay.height = 0;
    this.headingCv.width = this.headingCv.height = 0;
    this.landCv.width = this.landCv.height = 0;
    this.root.remove();
  }

  resize(): void {
    if (this.disposed) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.floor(window.innerWidth * dpr);
    this.overlay.height = Math.floor(window.innerHeight * dpr);
    this.og.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.headingCv.width = Math.round(560 * dpr);
    this.headingCv.height = Math.round(46 * dpr);
    this.headingCv.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.landCv.width = this.landCv.height = Math.round(200 * dpr);
    this.landCv.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(s: GameSession, view: WorldView, set: Settings, t: number): void {
    if (this.disposed || this.root.classList.contains('hidden')) return;
    if (this.mode !== 2) {
      if (!this.tut || this.tut.parts.includes('marker')) this.drawOverlay(s, view);
      else this.og.clearRect(0, 0, window.innerWidth, window.innerHeight);
      this.drawHeading(s);
    }
    if (t >= this.lastText && t - this.lastText < 0.08) return;
    if (t < this.lastText) this.busyT = t;
    this.lastText = t;
    const tel = s.flight.telemetry;
    const k = SPEED_K[set.speedUnit];
    const u = SPEED_U[set.speedUnit];
    const pitch = tel.pitch * RAD;
    const roll = tel.roll * RAD;
    const vs = s.body.vel.y;
    const msl = s.altitudeMSL();
    const navInfo = s.nav.info;
    const d = s.damage.durability;
    const dc = d >= 70 ? 'ok' : d >= 30 ? 'amber' : 'red';
    // 飞行数据（教学时只留最要紧的两个数）。最后一行耐久只在手机上露出来：右边的状态面板手机上放不下
    if (this.tut) setMarkup(this.flight, `
      <div class="row big"><span>${tr`地速`}</span><b>${Math.round(s.groundSpeed * k)}</b><em>${u}</em></div>
      <div class="row big ${s.agl < 3 && !s.gear.contactCount ? 'amber' : ''}"><span>${tr`离地高度`}</span><b>${s.agl > 2500 ? '—' : s.agl.toFixed(s.agl < 20 ? 1 : 0)}</b><em>m</em></div>`);
    else setMarkup(this.flight, `
      <div class="row big"><span>${tr`地速`}</span><b>${Math.round(s.groundSpeed * k)}</b><em>${u}</em></div>
      <div class="row"><span>${tr`空速`}</span><b>${Math.round(tel.airspeed * k)}</b><em>${u}</em></div>
      <div class="row big ${s.agl < 10 ? 'amber' : ''}"><span>${tr`离地高度`}</span><b>${s.agl > 2500 ? '—' : s.agl.toFixed(s.agl < 20 ? 1 : 0)}</b><em>m</em></div>
      <div class="row"><span>${tr`海拔`}</span><b>${Math.round(msl)}</b><em>m</em></div>
      <div class="row ${Math.abs(vs) > 6 ? 'amber' : ''}"><span>${tr`垂直速度`}</span><b>${vs >= 0 ? '+' : ''}${vs.toFixed(1)}</b><em>m/s</em></div>
      <div class="row"><span>${tr`姿态`}</span><b class="sm">${tr`俯仰 ${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}° · 横滚 ${roll >= 0 ? '+' : ''}${roll.toFixed(0)}°`}</b></div>
      <div class="row"><span>${tr`航向`}</span><b>${headingLabel(tel.heading * RAD)}°</b></div>
      <div class="row compact"><span>${tr`耐久`}</span><b class="${dc}">${Math.round(d)}</b></div>`);
    // 状态
    const st = s.damage.status;
    const margin = clamp(1 - tel.hoverPowerFrac, -1, 1);
    const wi = s.windInfo;
    const relWind = headingDelta(wrap360(tel.heading * RAD), wrap360(wi.dirFrom));
    const gustTxt = wi.gustIn !== null && wi.gustIn < 2.5 ? `<div class="gust-warn">${tr`阵风将至 ${wi.gustIn.toFixed(1)} s`}</div>` : '';
    setMarkup(this.status, `
      <div class="row"><span>${tr`机体耐久`}</span><b class="${dc}">${Math.round(d)}</b><em class="${dc}">${STATUS_LABEL[st]}</em></div>
      <div class="meter ${dc}"><i style="width:${d}%"></i><s style="left:70%"></s><s style="left:30%"></s></div>
      <div class="row"><span>${tr`动力余量`}</span><b class="${margin < 0.1 ? 'amber' : ''}">${Math.round(margin * 100)}%</b><em>${tel.torqueLimited ? `<span class="amber">${tr`动力上限`}</span>` : tr`密度 ${(tel.density * 100).toFixed(0)}%`}</em></div>
      <div class="meter ${margin < 0.1 ? 'amber' : 'ok'}"><i style="width:${clamp(tel.powerFrac, 0, 1) * 100}%"></i><s style="left:${clamp(tel.hoverPowerFrac, 0, 1) * 100}%"></s></div>
      <div class="row wind"><span>${tr`风`}</span><div class="warrow" style="transform:rotate(${relWind + 180}deg)">➤</div>${tr`<b>${wi.speed.toFixed(0)}</b><em>m/s 来自 ${headingLabel(wi.dirFrom)}°</em>`}</div>
      <div class="row"><span>${tr`阵风`}</span><b class="sm">${wi.gust > 0.5 ? '+' + wi.gust.toFixed(0) + ' m/s' : tr('平稳')}</b><em>${wi.vertical > 1 ? tr('上升气流') : wi.vertical < -1 ? tr('下沉气流') : ''}</em></div>
      ${wi.zone ? `<div class="zone">${tr`风区：${wi.zone}`}</div>` : ''}${gustTxt}
      <div class="row"><span>${tr`悬停辅助`}</span><b class="sm ${tel.hover !== 'off' ? 'ok' : ''}">${tel.hover === 'off' ? tr('关闭@@悬停辅助的状态') : tel.hover === 'braking' ? tr('减速中') : tr('定点保持')}</b></div>
      <div class="row"><span>${tr`辅助模式`}</span><b class="sm">${s.flight.assist.label}</b></div>
      <div class="row"><span>${tr`载货`}</span><b class="sm">${tr`${s.mission.cargo} 箱`}</b></div>`);
    // Buff
    const b = s.buffs;
    const slot = (cls: string, name: string, on: boolean, text: string, frac: number) =>
      `<div class="buff ${cls} ${on ? 'on' : ''}"><div class="bi"></div><div class="bt"><b>${name}</b><span>${text}</span></div><div class="bbar"><i style="width:${frac * 100}%"></i></div></div>`;
    // 手上没有补给时不占地方
    this.buffs.classList.toggle('hidden', !(b.boostActive || b.boostCharges > 0 || b.shieldActive));
    setMarkup(this.buffs,
      slot('boost', tr('动力增强'), b.boostActive || b.boostCharges > 0, b.boostActive ? tr`生效 ${b.boostTime.toFixed(1)} s` : b.boostCharges > 0 ? tr`已储备 · ${[...new Set(set.bindings.boost.map(keyName))].join(' / ')} 使用` : tr('未持有'), b.boostActive ? b.boostTime / BUFFS.boost.duration : b.boostCharges > 0 ? 1 : 0) +
      slot('shield', tr('免伤护盾'), b.shieldActive, b.shieldActive ? tr`剩余 ${b.shieldTime.toFixed(1)} s` : tr('未激活'), b.shieldTime / BUFFS.shield.maxDuration));
    // 任务
    const cur = s.mission.current();
    if (cur) {
      const idx = s.mission.index + 1;
      const title = `${idx}/${s.mission.main.length} · ${cur.def.title}`;
      if (title !== this.lastObjective) {
        this.lastObjective = title;
        this.busyT = t;
      }
      this.objTitle.textContent = title;
      this.objDetail.textContent = cur.def.detail;
      this.objBar.style.width = `${cur.progress * 100}%`;
      let hint = cur.hint;
      if (s.repairProgress > 0) hint = tr`维修中… ${Math.round(s.repairProgress * 100)}%`;
      this.objHint.textContent = hint;
    } else {
      this.objTitle.textContent = tr('全部任务完成');
      this.objDetail.textContent = '';
      this.objBar.style.width = '100%';
      this.objHint.textContent = '';
    }
    const opts = s.mission.optional;
    setMarkup(this.optList, opts.length
      ? `<div class="hud-label">${tr`可选任务 ${s.mission.optionalDone}/`}${opts.length}${s.nav.focus > 0 ? tr(' · 导航中') : ''}</div>` +
        opts.map((o) => `<div class="opt ${o.status === 'done' ? 'done' : ''}">${o.status === 'done' ? '✔' : '○'} ${o.def.title}${o.status !== 'done' && o.progress > 0 ? ` (${Math.round(o.progress * 100)}%)` : ''}</div>`).join('')
      : '');
    // 导航文字
    const nav = navInfo;
    const dist = nav.distance > 1000 ? `${(nav.distance / 1000).toFixed(2)} km` : `${Math.round(nav.distance)} m`;
    const rel = headingDelta(wrap360(tel.heading * RAD), nav.bearing);
    const dirTxt = Math.abs(rel) < 8 ? tr('正前方') : `${rel > 0 ? tr('右') : tr('左')} ${Math.abs(Math.round(rel))}°`;
    let navHtml = '';
    if (this.free) navHtml = `<div class="nav-main">${tr`${Math.round(s.groundSpeed * k)} ${u} · 离地 ${s.agl > 2500 ? '—' : Math.round(s.agl)} m`}</div>`;
    else if (nav.mode === 'complete') navHtml = `<div class="nav-main">${tr`任务完成`}</div>`;
    else {
      const alt = `${Math.round(nav.targetAlt + s.world.map.altitudeOffset)} m`;
      navHtml = `<div class="nav-main"><span class="nav-path">${nav.pathLabel}</span> ${tr`下一点：<b>${nav.label}</b> · ${dist} · ${dirTxt}`}</div>
        <div class="nav-sub">${tr`建议高度 ${alt}（海拔）`}${nav.speed ? tr` · 建议速度 ${Math.round(nav.speed * k)} ${u}` : ''}${nav.mode === 'optional' ? tr(' · 可选任务') : ''}</div>`;
      if (nav.turn) {
        const tt = nav.turn;
        navHtml += `<div class="nav-turn">${tr`前方 ${Math.round(tt.distance)} m ${tt.angle > 0 ? tr('右') : tr('左')}转 ${Math.abs(Math.round(tt.angle))}°`}${tt.speed ? tr` · 建议减速至 ${Math.round(tt.speed * k)} ${u}` : ''}</div>`;
      }
      if (nav.message) navHtml += `<div class="nav-warn">${nav.message}</div>`;
    }
    let navText = this.navBox.querySelector('.nav-text') as HTMLDivElement | null;
    if (!navText) navText = el('div', 'nav-text', this.navBox);
    setMarkup(navText, navHtml);
    // 分岔
    if (nav.forks) {
      this.forks.classList.remove('hidden');
      setMarkup(this.forks,
        `<div class="hud-label">${tr`路线选择（飞向其中一条即可`}<span class="fork-key">${tr`；按 ${[...new Set(set.bindings.nav.map(keyName))].join(' / ')} 切换推荐`}</span><span class="fork-tap">${tr`；点卡片设为推荐`}</span>${tr`）`}</div>` +
        nav.forks
          .map((f, i) => {
            const r = headingDelta(wrap360(tel.heading * RAD), f.bearing);
            return `<div class="fork ${f.preferred ? 'pref' : ''} tag-${f.tag}" data-i="${i}"><b>${f.label}</b><span>${f.detail}</span><em>${Math.round(f.distance)} m · ${Math.abs(r) < 8 ? tr('正前方') : (r > 0 ? tr('右 ') : tr('左 ')) + Math.abs(Math.round(r)) + '°'}</em></div>`;
          })
          .join(''));
    } else this.forks.classList.add('hidden');
    // 告警
    const warns: string[] = [];
    if (s.terrainWarning !== null) warns.push(`<div class="w red">${tr`地形！ ${s.terrainWarning} 秒内接近地面 — 拉升或减速`}</div>`);
    // 动力到顶只在刚碰到时提醒一下，之后看右边面板：高原上爬升经常顶着上限飞，横幅一直挂着很烦。自动巡航时不是玩家在飞，不用提醒
    if (!tel.torqueLimited) {
      if (t - this.limitT > 4) this.limitOn = false;
    } else {
      if (!this.limitOn) this.limitAt = t;
      this.limitOn = true;
      this.limitT = t;
    }
    if (tel.torqueLimited && s.agl > 3 && !this.tut && !this.autoFlight && t - this.limitAt < 3) warns.push(`<div class="w amber">${tr`动力已达上限`}</div>`);
    if (vs < -4 && s.agl < 12 && s.agl > 0.5) warns.push(`<div class="w amber">${tr`下降过快`}</div>`);
    if (s.weatherInCloud > 0.5) warns.push(`<div class="w amber">${tr`在云中：依靠仪表与导航飞行`}</div>`);
    if (st === 'critical') warns.push(`<div class="w red">${tr`严重受损：前往维修点或谨慎飞行`}</div>`);
    setMarkup(this.warn, warns.join(''));
    this.updateLanding(s, set);
    const busy = this.free ? warns.length > 0 : warns.length > 0 || !this.forks.classList.contains('hidden') || !this.landing.classList.contains('hidden') || s.groundSpeed < 8 || this.toasts.children.length > 0;
    if (busy) this.busyT = t;
    this.root.classList.toggle('hud-calm', this.mode === 0 && !this.tut && t - this.busyT > 6);
    if (this.showDebug) {
      this.debug.classList.remove('hidden');
      this.debug.textContent = `${view.info()} · trees ${s.treeProxyCount} · t ${s.t.toFixed(1)}`;
    } else this.debug.classList.add('hidden');
  }

  private updateLanding(s: GameSession, set: Settings): void {
    if (this.free && this.mode !== 1) {
      this.landing.classList.add('hidden');
      this.root.classList.remove('hud-approach');
      return;
    }
    const pad = s.landingTarget();
    const cur = s.mission.current();
    const hoverObj = cur && cur.def.kind === 'hover' ? cur.def : null;
    const near = pad ? Math.hypot(s.body.pos.x - pad.pos[0], s.body.pos.z - pad.pos[2]) : Infinity;
    const hoverNear = hoverObj ? Math.hypot(s.body.pos.x - hoverObj.center[0], s.body.pos.z - hoverObj.center[2]) : Infinity;
    const isMissionPad = !!pad && !!cur && cur.def.kind === 'land' && cur.def.padId === pad.id;
    // 当前任务的停机坪：进近范围内显示；其他停机坪：低速、低空靠近时显示
    const showPad = pad && s.skidY - pad.pos[1] < 80 && ((isMissionPad && near < 220) || (near < 120 && s.groundSpeed < 12));
    const showHover = hoverObj && hoverNear < 200;
    if (!showPad && !showHover) {
      this.landing.classList.add('hidden');
      this.root.classList.remove('hud-approach');
      return;
    }
    this.landing.classList.remove('hidden');
    this.root.classList.add('hud-approach');
    const tel = s.flight.telemetry;
    const k = SPEED_K[set.speedUnit];
    const target = showHover && (!showPad || hoverNear < near) ? { x: hoverObj!.center[0], y: hoverObj!.center[1], z: hoverObj!.center[2], half: hoverObj!.radius, name: hoverObj!.title, hover: true } : { x: pad!.pos[0], y: pad!.pos[1], z: pad!.pos[2], half: pad!.size / 2, name: pad!.name, hover: false };
    const relH = s.skidY - target.y;
    const descent = Math.max(0, -s.body.vel.y);
    const drift = s.groundSpeed;
    const att = Math.max(Math.abs(tel.pitch), Math.abs(tel.roll)) / DEG;
    const off = Math.hypot(s.body.pos.x - target.x, s.body.pos.z - target.z);
    const ok = (b: boolean) => (b ? '<i class="ok">✔</i>' : '<i class="bad">✘</i>');
    const L = LANDING_LIMITS;
    const onPad = off <= target.half + L.offsetMargin;
    const safe = descent <= L.descent && drift <= L.horizontal && att <= L.attitude && onPad;
    setMarkup(this.landInfo, target.hover
      ? `<div><b>${target.name}</b></div>
        <div>${tr`相对目标高度 <b>${relH.toFixed(1)} m</b>（需 ${hoverObj!.minH}–${hoverObj!.maxH} m）`}</div>
        <div>${tr`水平偏移 <b>${off.toFixed(1)} m</b>（半径 ${hoverObj!.radius} m）`}</div>
        <div>${tr`水平速度 <b>${drift.toFixed(1)} m/s</b>（< ${hoverObj!.maxSpeed}）`}</div>`
      : `<div><b>${target.name}</b></div>
        <div>${tr`相对高度 <b>${relH.toFixed(1)} m</b>`}</div>
        <div>${tr`${ok(descent <= L.descent)} 下降速度 <b>${descent.toFixed(1)}</b> m/s（≤ ${L.descent}）`}</div>
        <div>${tr`${ok(drift <= L.horizontal)} 水平漂移 <b>${drift.toFixed(1)}</b> m/s（≤ ${L.horizontal}）`}</div>
        <div>${tr`${ok(att <= L.attitude)} 机身姿态 <b>${att.toFixed(0)}</b>°（≤ ${L.attitude}°）`}</div>
        <div>${tr`${ok(onPad)} 位于坪内 偏移 <b>${off.toFixed(1)}</b> m`}</div>
        <div class="land-verdict ${safe ? 'ok' : 'bad'}">${safe ? tr('符合安全着陆条件') : tr('暂不符合安全着陆条件')}</div>`);
    void k;
    // 俯视悬停显示：机头朝上
    const g = this.landCv.getContext('2d')!;
    const W = 200;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(5,10,16,0.55)';
    g.fillRect(0, 0, W, W);
    const scale = 70 / Math.max(10, target.half * 2.2);
    const h = tel.heading;
    const toLocal = (wx: number, wz: number): [number, number] => {
      const dx = wx - s.body.pos.x;
      const dz = wz - s.body.pos.z;
      const lx = dx * Math.cos(h) + dz * Math.sin(h);
      const lz = -dx * Math.sin(h) + dz * Math.cos(h);
      return [W / 2 + lx * scale, W / 2 + lz * scale];
    };
    g.save();
    g.translate(...toLocal(target.x, target.z));
    g.rotate(-h + (pad && !target.hover ? -(pad.rotY ?? 0) : 0));
    g.strokeStyle = '#42ff8a';
    g.lineWidth = 2;
    const hs = target.half * scale;
    if (target.hover) {
      g.beginPath();
      g.arc(0, 0, hs, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.strokeRect(-hs, -hs, hs * 2, hs * 2);
      g.fillStyle = 'rgba(66,255,138,0.12)';
      g.fillRect(-hs, -hs, hs * 2, hs * 2);
      g.fillStyle = '#42ff8a';
      g.font = `bold ${Math.max(10, hs * 0.8)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', 0, 0);
    }
    g.restore();
    // 本机与速度矢量
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2 - 8, W / 2);
    g.lineTo(W / 2 + 8, W / 2);
    g.moveTo(W / 2, W / 2 - 10);
    g.lineTo(W / 2, W / 2 + 8);
    g.stroke();
    const vx = s.body.vel.x * Math.cos(h) + s.body.vel.z * Math.sin(h);
    const vz = -s.body.vel.x * Math.sin(h) + s.body.vel.z * Math.cos(h);
    g.strokeStyle = drift > L.horizontal ? '#ffb347' : '#38e8ff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(W / 2, W / 2);
    g.lineTo(W / 2 + clamp(vx * 12, -90, 90), W / 2 + clamp(vz * 12, -90, 90));
    g.stroke();
    // 高度条
    g.fillStyle = '#1a222c';
    g.fillRect(W - 14, 10, 8, W - 20);
    const hf = clamp(relH / 30, 0, 1);
    g.fillStyle = descent > L.descent ? '#ff5a3a' : '#38e8ff';
    g.fillRect(W - 14, 10 + (W - 20) * (1 - hf), 8, 4);
  }

  /** 屏幕叠加层：速度矢量标记、航点标记（屏幕外显示边缘箭头）。 */
  private drawOverlay(s: GameSession, view: WorldView): void {
    const g = this.og;
    const W = window.innerWidth;
    const H = window.innerHeight;
    g.clearRect(0, 0, W, H);
    if (s.state !== 'running' || this.free) return;
    this.measureBlockers();
    const nav = s.nav.info;
    const p = this.proj;
    // 速度矢量（飞行轨迹标记）
    if (s.groundSpeed > 4) {
      const v = this.velocityMarker.copy(s.body.vel).normalize().multiplyScalar(300).add(view.rig.camera.position);
      view.project(v, p);
      if (!p.behind && p.x > 0 && p.y > 0 && p.x < W && p.y < H) {
        g.strokeStyle = 'rgba(120,255,170,0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x, p.y, 7, 0, Math.PI * 2);
        g.moveTo(p.x - 16, p.y);
        g.lineTo(p.x - 7, p.y);
        g.moveTo(p.x + 7, p.y);
        g.lineTo(p.x + 16, p.y);
        g.moveTo(p.x, p.y - 7);
        g.lineTo(p.x, p.y - 13);
        g.stroke();
      }
    }
    // 附近的补给无人机：小圆点 + 种类
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const pk of s.world.map.pickups) {
      if (s.pickupsTaken.has(pk.id)) continue;
      const pos = this.pkPos.set(...pk.pos);
      const dist = pos.distanceTo(view.rig.camera.position);
      if (dist > 900) continue;
      view.project(pos, p);
      if (p.behind || p.x < 30 || p.y < 30 || p.x > W - 30 || p.y > H - 30) continue;
      const col = pk.kind === 'boost' ? '#ffd23a' : pk.kind === 'shield' ? '#46b4ff' : '#4cff7a';
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 8, 0, Math.PI * 2);
      g.stroke();
      this.overlayLabel(`${pk.kind === 'boost' ? tr('动力') : pk.kind === 'shield' ? tr('护盾') : tr('维修')} ${Math.round(dist)} m`, p.x, p.y - 14, W, p.y + 24);
    }
    if (nav.mode === 'complete') return;
    const count = nav.forks?.length ?? 1;
    for (let i = 0; i < count; i++) {
      const fork = nav.forks?.[i];
      const target = this.targetMarker.set(...(fork?.target ?? nav.target));
      const color = fork ? fork.preferred ? '#38e8ff' : '#7fb8c8' : nav.mode === 'optional' ? '#c08bff' : nav.mode === 'recover' ? '#ffb347' : '#38e8ff';
      const label = fork?.label ?? nav.label;
      view.project(target, p);
      const dist = target.distanceTo(view.rig.camera.position);
      const inside = !p.behind && p.x > 30 && p.y > 30 && p.x < W - 30 && p.y < H - 30;
      g.fillStyle = color;
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.font = '600 13px system-ui, sans-serif';
      g.textAlign = 'center';
      if (inside) {
        g.beginPath();
        g.moveTo(p.x, p.y - 11);
        g.lineTo(p.x + 11, p.y);
        g.lineTo(p.x, p.y + 11);
        g.lineTo(p.x - 11, p.y);
        g.closePath();
        g.stroke();
        this.overlayLabel(`${label} ${dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}`, p.x, p.y - 18, W, p.y + 28);
      } else {
        // 屏幕边缘箭头
        const cx = W / 2;
        const cy = H / 2;
        let dx = p.x - cx;
        let dy = p.y - cy;
        if (p.behind) {
          dx = -dx;
          dy = -dy;
        }
        const a = Math.atan2(dy, dx);
        const r = Math.min(W, H) * 0.42;
        const ex = cx + Math.cos(a) * r;
        const ey = cy + Math.sin(a) * r;
        g.save();
        g.translate(ex, ey);
        g.rotate(a);
        g.beginPath();
        g.moveTo(14, 0);
        g.lineTo(-8, -10);
        g.lineTo(-4, 0);
        g.lineTo(-8, 10);
        g.closePath();
        g.fill();
        g.restore();
        this.overlayLabel(`${label} ${dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}`, ex, ey + 26, W, ey - 16);
      }
    }
  }

  /** 量一下面板、航点读数现在占着哪些地方（隐藏的、平稳飞行时收起来的面板不算） */
  private measureBlockers(): void {
    const now = performance.now();
    if (now - this.blockT < 500 && now >= this.blockT) return;
    this.blockT = now;
    this.blockers.length = 0;
    const r = this.root.classList;
    if (r.contains('hud-off') || r.contains('hud-cine')) return;
    const calm = r.contains('hud-calm');
    for (const e of this.blockEls) {
      if (e.classList.contains('hidden') || (calm && e.classList.contains('panel'))) continue;
      const b = e.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) this.blockers.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
  }

  /** 标记旁边的字（带深色描边）：压着面板或航点读数时换到 alt 那一边，两边都压着就淡一些 */
  private overlayLabel(text: string, x: number, y: number, width: number, alt?: number): void {
    const g = this.og;
    const half = Math.min(width / 2 - 12, g.measureText(text).width / 2);
    const cx = clamp(x, half + 12, width - half - 12);
    const at = placeLabel(cx, half, y, alt, this.blockers);
    g.save();
    if (at.dim) g.globalAlpha = 0.3;
    g.strokeStyle = 'rgba(2, 7, 12, 0.92)';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeText(text, cx, at.y, width - 24);
    g.fillText(text, cx, at.y, width - 24);
    g.restore();
  }

  private drawHeading(s: GameSession): void {
    const g = this.headingCv.getContext('2d')!;
    const W = 560;
    const H = 46;
    g.clearRect(0, 0, W, H);
    // 不铺底色：刻度直接画在风景上，靠阴影保持看得清
    g.shadowColor = 'rgba(0,0,0,0.75)';
    g.shadowBlur = 3;
    const hdg = wrap360(s.flight.telemetry.heading * RAD);
    const px = 2.6;
    g.strokeStyle = 'rgba(232,240,246,0.9)';
    g.fillStyle = 'rgba(232,240,246,0.92)';
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 1;
    for (let a = Math.floor((hdg - 70) / 5) * 5; a <= hdg + 70; a += 5) {
      const x = W / 2 + headingDelta(hdg, wrap360(a)) * px;
      const aa = wrap360(a);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, aa % 10 === 0 ? 12 : 6);
      g.stroke();
      if (aa % 30 === 0) g.fillText(aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(aa), x, 28);
    }
    // 航点方位
    const nav = s.nav.info;
    if (nav.mode !== 'complete' && (!this.tut || this.tut.parts.includes('marker'))) {
      const rel = headingDelta(hdg, nav.bearing);
      const x = W / 2 + clamp(rel, -68, 68) * px;
      g.fillStyle = nav.mode === 'optional' ? '#c08bff' : '#38e8ff';
      g.beginPath();
      g.moveTo(x, 2);
      g.lineTo(x - 9, 16);
      g.lineTo(x + 9, 16);
      g.closePath();
      g.fill();
    }
    // 航迹（实际运动方向）
    if (s.groundSpeed > 3) {
      const trk = wrap360(Math.atan2(s.body.vel.x, -s.body.vel.z) * RAD);
      const x = W / 2 + clamp(headingDelta(hdg, trk), -68, 68) * px;
      g.strokeStyle = '#78ffaa';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, 38, 4, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#ffd34a';
    g.fillRect(W / 2 - 1, 0, 2, H);
    g.font = 'bold 14px system-ui, sans-serif';
    g.fillStyle = '#fff';
    g.fillText(headingLabel(hdg) + '°', W / 2 + 26, 42);
  }
}
