// 菜单与界面：主菜单、地图选择、任务简介（天气/辅助选择）、加载、开始提示、暂停、失败、结算、设置（含改键）、操作说明、关于。

import { ASSISTS, type AssistId } from '../config/flight';
import { TIME_OF_DAY, type TimeOfDay } from '../render/timeOfDay';
import type { MapDef } from '../maps/types';
import type { MapRecord } from '../game/save';
import { ACTION_LABEL, DEFAULT_BINDINGS, QUALITY, keyName, type Action, type Settings } from '../game/settings';
import type { ScoreResult } from '../sim/scoring';
import type { LandingMetrics } from '../sim/mission';
import type { Lesson } from '../game/tutorial';
import { GRADE_LABEL } from '../sim/mission';

export interface CheckpointItem {
  index: number;
  label: string;
  durability: number;
  safe: boolean;
  t: number;
}

function h(html: string): HTMLDivElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLDivElement;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

export class UI {
  readonly root: HTMLDivElement;
  private screen: HTMLDivElement | null = null;
  private modal: HTMLDivElement | null = null;
  private modalReturnFocus: HTMLElement | null = null;
  private modalCleanup: ((notify: boolean) => void) | null = null;
  private disposed = false;
  private panelId = 0;
  onClick: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onClick?.();
    });
    this.root.addEventListener('keydown', (e) => {
      if (!this.modal || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(this.modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        e.preventDefault();
        this.modal.focus();
      } else if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !this.modal.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  private show(el: HTMLDivElement): HTMLDivElement {
    if (this.disposed) return el;
    this.closeModal();
    this.screen?.remove();
    this.screen = el;
    this.root.appendChild(el);
    el.tabIndex = -1;
    (el.querySelector<HTMLElement>('.primary, button:not([disabled]), [tabindex="0"]') ?? el).focus({ preventScroll: true });
    return el;
  }

  clear(): void {
    this.screen?.remove();
    this.screen = null;
    this.closeModal();
  }

  get hasModal(): boolean {
    return !!this.modal;
  }

  closeModal(notify = true): void {
    if (!this.modal) return;
    this.modal?.remove();
    this.modal = null;
    if (this.screen) this.screen.inert = false;
    const cleanup = this.modalCleanup;
    this.modalCleanup = null;
    cleanup?.(notify);
    if (this.modalReturnFocus?.isConnected) this.modalReturnFocus.focus({ preventScroll: true });
    this.modalReturnFocus = null;
  }

  private openModal(el: HTMLDivElement, cleanup?: (notify: boolean) => void): HTMLDivElement {
    if (this.disposed) {
      cleanup?.(false);
      return el;
    }
    this.closeModal();
    this.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modal = el;
    this.modalCleanup = cleanup ?? null;
    if (this.screen) this.screen.inert = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.tabIndex = -1;
    const heading = el.querySelector('h2');
    if (heading) {
      heading.id = `ui-dialog-${++this.panelId}`;
      el.setAttribute('aria-labelledby', heading.id);
    }
    this.root.appendChild(el);
    (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus({ preventScroll: true });
    return el;
  }

  /** Tear down without firing a settings-save/resume callback from a dead app. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.modalReturnFocus = null;
    this.screen?.remove();
    this.screen = null;
    this.closeModal(false);
    this.onClick = null;
    this.root.remove();
  }

  private bind(el: HTMLElement, handlers: Record<string, (btn: HTMLElement) => void>): void {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
      if (!b || !el.contains(b)) return;
      const f = handlers[b.dataset.a!];
      if (f) f(b);
    });
  }

  compatError(msg: string): void {
    this.show(
      h(`<div class="screen center"><div class="card narrow"><h1>无法启动 Rotor Trails</h1><p>${escapeHtml(msg)}</p>
      <p class="muted">需要支持 WebGL2 的桌面浏览器（推荐最新版 Chrome 或 Edge），并开启硬件加速。</p></div></div>`),
    );
  }

  main(opts: { warning: string | null; tutorialDone: boolean }, on: { play: () => void; free: () => void; tutorial: () => void; settings: () => void; help: () => void; about: () => void }): void {
    const el = this.show(
      h(`<div class="screen main-menu">
        <div class="title-block">
          <h1 class="logo">ROTOR TRAILS</h1>
          <div class="logo-sub">旋翼航迹 · 第一人称拟真直升机</div>
        </div>
        <div class="menu-col">
          <button class="btn primary" data-a="play">开始游戏</button>
          <button class="btn" data-a="free">休闲飞行</button>
          <button class="btn" data-a="tutorial">飞行训练${opts.tutorialDone ? '' : ' <span class="tag">推荐先玩</span>'}</button>
          <button class="btn" data-a="settings">设置</button>
          <button class="btn" data-a="help">操作说明</button>
          <button class="btn ghost" data-a="about">关于与授权</button>
        </div>
        <div class="menu-foot">${opts.warning ? `<div class="warnbox">${opts.warning}</div>` : ''}<span>v1.0 · 没有时间限制，按自己的节奏飞行</span></div>
      </div>`),
    );
    this.bind(el, { play: on.play, free: on.free, tutorial: on.tutorial, settings: on.settings, help: on.help, about: on.about });
  }

  /** 飞行训练的课程表 */
  training(lessons: Lesson[], done: number[], on: { start: (lesson: number) => void; back: () => void }): void {
    const finished = lessons.every((_, i) => done.includes(i));
    const next = finished ? 0 : Math.max(0, lessons.findIndex((_, i) => !done.includes(i)));
    const rows = lessons
      .map((l, i) => `<button type="button" class="lesson ${done.includes(i) ? 'done' : ''}" data-a="lesson" data-i="${i}"><span class="ls-no">${done.includes(i) ? '✓' : i + 1}</span><span class="ls-body"><b>${l.title}</b><span>${l.sub}</span></span></button>`)
      .join('');
    const el = this.show(
      h(`<div class="screen"><div class="screen-head"><button class="btn ghost" data-a="back">← 返回</button><h2>飞行训练</h2><span class="muted">不需要任何基础。全部学完大约 10 分钟，撞了也不要紧</span></div>
      <div class="train"><div class="train-side card"><div class="brief-hero" style="background-image:url(ui/map_training.webp)" aria-hidden="true"></div>
        <p class="lead">坐进驾驶舱，一步一步学会飞直升机：从转头看四周开始，到能自己飞到另一块停机坪安全降落。</p>
        <button class="btn primary big" data-a="go">${done.length === 0 ? '从第 1 课开始' : finished ? '从头再学一遍' : `继续学第 ${next + 1} 课`}</button>
        <p class="muted">飞过的人可以直接点右边任何一课。</p></div>
      <div class="lessons">${rows}</div></div></div>`),
    );
    this.bind(el, { go: () => on.start(next), lesson: (b) => on.start(Number(b.dataset.i)), back: on.back });
  }

  /** 训练结束 */
  trainingDone(landing: LandingMetrics | null, on: { next: () => void; free: () => void; again: () => void; menu: () => void }): void {
    const el = this.show(
      h(`<div class="screen center dim"><div class="card narrow"><div class="hud-label">训练完成</div><h2>你会飞直升机了</h2>
      ${landing ? `<p>最后这次降落：<b>${GRADE_LABEL[landing.grade]}</b>（下降速度 ${landing.descent.toFixed(1)} m/s）</p>` : ''}
      <p>起飞、悬停、前进刹车、转向、跟着导航飞、在风里定住、安全降落，你都做到了。</p>
      <p class="muted">忘了怎么操作？暂停菜单里有“操作说明”，也可以回来重学任何一课。</p>
      <button class="btn primary" data-a="next">开始第一个任务</button>
      <button class="btn" data-a="free">先随便飞飞（休闲飞行）</button>
      <button class="btn" data-a="again">回到课程表</button>
      <button class="btn ghost" data-a="menu">回主菜单</button></div></div>`),
    );
    this.bind(el, { next: on.next, free: on.free, again: on.again, menu: on.menu });
  }

  mapSelect(maps: MapDef[], records: Partial<Record<string, MapRecord>>, on: { pick: (m: MapDef) => void; back: () => void }, free = false): void {
    const cards = maps
      .map((m, i) => {
        const r = records[m.id];
        return `<button type="button" class="map-card map-${m.id}" data-a="pick" data-i="${i}" aria-labelledby="map-name-${m.id}">
          <span class="mc-img" style="background-image:url(ui/map_${m.id}.webp)" aria-hidden="true"></span>
          <span class="mc-body">${free ? `<span class="mc-head"><span class="mc-no">${m.region}</span></span>` : `<span class="mc-head"><span class="mc-no">${m.id === 'training' ? '训练' : `第 ${maps.filter((x) => x.id !== 'training').indexOf(m) + 1} 关`}</span><span class="mc-stars" aria-label="推荐难度 ${m.difficulty} / 5">${stars(m.difficulty)}</span></span>`}
          <span class="mc-name" id="map-name-${m.id}">${m.name}</span><span class="mc-sub">${m.subtitle}</span>
          <span class="mc-desc">${m.description}</span>
          ${free ? '' : `<span class="mc-foot"><span>推荐：${ASSISTS[m.recommendedAssist].label}</span>${r?.completed ? `<span class="mc-best">最佳 ${r.bestRating} · ${r.bestScore}</span>` : '<span class="muted">未完成</span>'}</span>`}</span>
        </button>`;
      })
      .join('');
    const el = this.show(
      h(`<div class="screen"><div class="screen-head"><button class="btn ghost" data-a="back">← 返回</button><h2>${free ? '休闲飞行' : '选择地图'}</h2><span class="muted">${free ? '没有任务，没有计时，撞了也没关系。选一个想去的地方' : '所有地图均可直接选择，无需解锁'}</span></div>
      <div class="map-grid">${cards}</div></div>`),
    );
    this.bind(el, { pick: (b) => on.pick(maps[Number(b.dataset.i)]), back: on.back });
  }

  briefing(m: MapDef, rec: MapRecord | undefined, settings: Settings, on: { start: (weather: string, assist: AssistId, time: TimeOfDay) => void; back: () => void }): void {
    let weather = m.defaultWeather;
    let time: TimeOfDay = 'day';
    let assist: AssistId = settings.assist;
    const objs = m.mission.main
      .map((o, i) => `<li><b>${i + 1}. ${o.title}</b><span>${o.detail}</span></li>`)
      .join('');
    const opt = m.mission.optional.map((o) => `<li><b>${rec?.optionalDone.includes(o.id) ? '✔ ' : ''}${o.title}</b><span>${o.detail}</span></li>`).join('');
    const forks = m.legs
      .filter((l) => l.paths.length > 1)
      .map((l) => `<li>${l.paths.map((p) => `<b>${p.label}</b>：${p.detail}`).join('<br>')}</li>`)
      .join('');
    const el = this.show(
      h(`<div class="screen"><div class="screen-head"><button class="btn ghost" data-a="back">← 返回</button><h2>${m.name}</h2><span class="muted">${m.region} · 推荐难度 ${stars(m.difficulty)}</span></div>
      <div class="brief">
        <div class="brief-main card">
          <div class="brief-hero" style="background-image:url(ui/map_${m.id}.webp)" aria-hidden="true"></div>
          <p class="lead">${m.description}</p>
          ${m.briefing.map((b) => `<p>${b}</p>`).join('')}
          <h3>主线任务</h3><ol class="obj-list">${objs}</ol>
          ${opt ? `<h3>可选任务</h3><ul class="obj-list">${opt}</ul>` : ''}
          ${forks ? `<h3>路线选择</h3><ul class="obj-list">${forks}</ul>` : ''}
          <p class="muted">预计主线 ${m.estMinutes[0]}–${m.estMinutes[1]} 分钟（不限时）。${rec?.completed ? `最佳评价 ${rec.bestRating}（${rec.bestScore} 分）${rec.bestTime ? ` · 最快 ${fmtTime(rec.bestTime)}（仅记录）` : ''}` : ''}</p>
        </div>
        <div class="brief-side">
          <div class="card"><h3 id="brief-weather">天气</h3><div class="opts" data-group="weather" role="group" aria-labelledby="brief-weather">${m.weathers
            .map((w) => `<button type="button" class="opt-card ${w.id === weather ? 'sel' : ''}" data-a="weather" data-v="${w.id}" aria-pressed="${w.id === weather}"><b>${w.label}</b><span>${w.desc}</span></button>`)
            .join('')}</div></div>
          <div class="card"><h3 id="brief-time">时段</h3><div class="opts" data-group="time" role="group" aria-labelledby="brief-time">${(Object.keys(TIME_OF_DAY) as TimeOfDay[])
            .map((k) => `<button type="button" class="opt-card ${k === time ? 'sel' : ''}" data-a="time" data-v="${k}" aria-pressed="${k === time}"><b>${TIME_OF_DAY[k].label}</b><span>${TIME_OF_DAY[k].desc}</span></button>`)
            .join('')}</div></div>
          <div class="card"><h3 id="brief-assist">飞行辅助</h3><div class="opts" data-group="assist" role="group" aria-labelledby="brief-assist">${(Object.keys(ASSISTS) as AssistId[])
            .map((k) => `<button type="button" class="opt-card ${k === assist ? 'sel' : ''}" data-a="assist" data-v="${k}" aria-pressed="${k === assist}"><b>${ASSISTS[k].label}${k === m.recommendedAssist ? ' · 推荐' : ''}</b><span>${ASSISTS[k].desc}</span></button>`)
            .join('')}</div></div>
          <button class="btn primary big" data-a="start">开始飞行</button>
        </div>
      </div></div>`),
    );
    const sel = (group: string, v: string) => el.querySelectorAll<HTMLElement>(`[data-group="${group}"] .opt-card`).forEach((c) => {
      const selected = c.dataset.v === v;
      c.classList.toggle('sel', selected);
      c.setAttribute('aria-pressed', String(selected));
    });
    this.bind(el, {
      weather: (b) => {
        weather = b.dataset.v!;
        sel('weather', weather);
      },
      assist: (b) => {
        assist = b.dataset.v as AssistId;
        sel('assist', assist);
      },
      time: (b) => {
        time = b.dataset.v as TimeOfDay;
        sel('time', time);
      },
      start: () => on.start(weather, assist, time),
      back: on.back,
    });
  }

  /** 休闲飞行：选时段和天气 */
  freeBrief(m: MapDef, settings: Settings, vistas: string[], on: { start: (weather: string, time: TimeOfDay, sim: boolean) => void; back: () => void }): void {
    let weather = m.defaultWeather;
    let time: TimeOfDay = 'dusk';
    let sim = settings.assist === 'sim';
    const el = this.show(
      h(`<div class="screen"><div class="screen-head"><button class="btn ghost" data-a="back">← 返回</button><h2>${m.name}</h2><span class="muted">${m.region} · 休闲飞行</span></div>
      <div class="brief">
        <div class="brief-main card">
          <div class="brief-hero" style="background-image:url(ui/map_${m.id}.webp)" aria-hidden="true"></div>
          <p class="lead">${m.description}</p>
          <h3>值得一去的地方</h3>
          <p class="vistas">${vistas.map((v) => `<span>${v}</span>`).join('')}</p>
          <p class="muted">飞行中按暂停键可以随时换时段、换天气，或者直接跳到这些地方。</p>
          ${m.real ? `<p class="muted">${m.real.credit}</p>` : ''}
        </div>
        <div class="brief-side">
          <div class="card"><h3 id="brief-time">时段</h3><div class="opts" data-group="time" role="group" aria-labelledby="brief-time">${(Object.keys(TIME_OF_DAY) as TimeOfDay[])
            .map((k) => `<button type="button" class="opt-card ${k === time ? 'sel' : ''}" data-a="time" data-v="${k}" aria-pressed="${k === time}"><b>${TIME_OF_DAY[k].label}</b><span>${TIME_OF_DAY[k].desc}</span></button>`)
            .join('')}</div></div>
          <div class="card"><h3 id="brief-weather">天气</h3><div class="opts" data-group="weather" role="group" aria-labelledby="brief-weather">${m.weathers
            .map((w) => `<button type="button" class="opt-card ${w.id === weather ? 'sel' : ''}" data-a="weather" data-v="${w.id}" aria-pressed="${w.id === weather}"><b>${w.label}</b><span>${w.desc}</span></button>`)
            .join('')}</div></div>
          <div class="card"><h3 id="brief-sim">飞行方式</h3><div class="opts" data-group="sim" role="group" aria-labelledby="brief-sim">
            <button type="button" class="opt-card ${sim ? '' : 'sel'}" data-a="sim" data-v="0" aria-pressed="${!sim}"><b>轻松</b><span>辅助全开，飞到哪儿算哪儿。</span></button>
            <button type="button" class="opt-card ${sim ? 'sel' : ''}" data-a="sim" data-v="1" aria-pressed="${sim}"><b>超仿真</b><span>${ASSISTS.sim.desc}</span></button>
          </div></div>
          <button class="btn primary big" data-a="start">起飞</button>
        </div>
      </div></div>`),
    );
    const sel = (group: string, v: string) => el.querySelectorAll<HTMLElement>(`[data-group="${group}"] .opt-card`).forEach((c) => {
      const selected = c.dataset.v === v;
      c.classList.toggle('sel', selected);
      c.setAttribute('aria-pressed', String(selected));
    });
    this.bind(el, {
      weather: (b) => {
        weather = b.dataset.v!;
        sel('weather', weather);
      },
      time: (b) => {
        time = b.dataset.v as TimeOfDay;
        sel('time', time);
      },
      sim: (b) => {
        sim = b.dataset.v === '1';
        sel('sim', sim ? '1' : '0');
      },
      start: () => on.start(weather, time, sim),
      back: on.back,
    });
  }

  /** 休闲飞行的暂停菜单 */
  freePause(o: { map: MapDef; time: TimeOfDay; weather: string; vistas: string[]; cruise: boolean }, on: { resume: () => void; time: (t: TimeOfDay) => void | Promise<void>; weather: (id: string) => void; vista: (i: number) => void; cruise: () => void; settings: () => void; help: () => void; quit: () => void }): void {
    const chip = (a: string, v: string, label: string, sel: boolean) => `<button type="button" class="chip ${sel ? 'sel' : ''}" data-a="${a}" data-v="${v}" aria-pressed="${sel}">${label}</button>`;
    const el = this.show(
      h(`<div class="screen center dim"><div class="card free-pause"><h2>${o.map.name}</h2>
      <h3>时段</h3><div class="chips" data-group="time">${(Object.keys(TIME_OF_DAY) as TimeOfDay[]).map((k) => chip('time', k, TIME_OF_DAY[k].label, k === o.time)).join('')}</div>
      <h3>天气</h3><div class="chips" data-group="weather">${o.map.weathers.map((w) => chip('weather', w.id, w.label, w.id === o.weather)).join('')}</div>
      <h3>去这些地方</h3><div class="chips">${o.vistas.map((v, i) => chip('vista', String(i), v, false)).join('')}</div>
      <div class="free-actions"><button class="btn primary" data-a="resume">继续飞行</button>
      <button class="btn" data-a="cruise">${o.cruise ? '关闭自动巡航' : '自动巡航（看风景）'}</button>
      <button class="btn" data-a="settings">设置</button>
      <button class="btn" data-a="help">操作说明</button>
      <button class="btn ghost" data-a="quit">回主菜单</button></div></div></div>`),
    );
    const sel = (group: string, v: string) => el.querySelectorAll<HTMLElement>(`[data-group="${group}"] .chip`).forEach((c) => {
      const selected = c.dataset.v === v;
      c.classList.toggle('sel', selected);
      c.setAttribute('aria-pressed', String(selected));
    });
    this.bind(el, {
      resume: on.resume,
      time: (b) => {
        sel('time', b.dataset.v!);
        void on.time(b.dataset.v as TimeOfDay);
      },
      weather: (b) => {
        sel('weather', b.dataset.v!);
        on.weather(b.dataset.v!);
      },
      vista: (b) => on.vista(Number(b.dataset.v)),
      cruise: on.cruise,
      settings: on.settings,
      help: on.help,
      quit: on.quit,
    });
  }

  /** map：这张图的实拍画面铺满背景，地图名压在上面（等待的时候看的是风景，不是一个进度条） */
  loading(label: string, p: number, map?: MapDef): void {
    let el = this.screen?.classList.contains('loading') ? this.screen : null;
    if (el && map && el.dataset.map !== map.id) el = null;
    if (!el) {
      // （写在 CSS 变量里的相对地址按样式表的位置解析，这里要给完整地址）
      const art = map ? ` style="--art:url('${new URL(`ui/map_${map.id}_bg.webp`, document.baseURI).href}')" data-map="${map.id}"` : '';
      el = this.show(
        h(`<div class="screen loading"${art}>
          <div class="load-name">${map ? `<h2>${map.name}</h2><span>${map.subtitle}</span>` : '<h2>正在准备地图</h2>'}</div>
          <div class="load-foot"><div class="lbar" role="progressbar" aria-label="地图准备进度" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="llabel" role="status"></div></div>
        </div>`),
      );
    }
    const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0)) * 100);
    (el.querySelector('.lbar i') as HTMLElement).style.width = `${percent}%`;
    el.querySelector('.lbar')?.setAttribute('aria-valuenow', String(percent));
    (el.querySelector('.llabel') as HTMLElement).textContent = label;
  }

  clickToStart(text: string, sub: string, on: () => void): void {
    const el = this.show(h(`<div class="screen center click-start" data-a="go"><div class="card narrow"><h2>${text}</h2><p>${sub}</p><button class="btn primary" data-a="go">点击开始飞行</button></div></div>`));
    this.bind(el, { go: on });
  }

  pause(opts: { tutorial: boolean; checkpoints: CheckpointItem[] }, on: { resume: () => void; checkpoint: (i: number, mode: 'exact' | 'safe') => void; restart: () => void; settings: () => void; help: () => void; quit: () => void; skipStep?: () => void }): void {
    const last = opts.checkpoints[opts.checkpoints.length - 1];
    const el = this.show(
      h(`<div class="screen center dim"><div class="card narrow pause"><h2>已暂停</h2>
      <button class="btn primary" data-a="resume">继续飞行</button>
      ${opts.tutorial ? '<button class="btn" data-a="skip">跳过当前教学步骤</button>' : ''}
      ${last && opts.checkpoints.length > 1 ? `<button class="btn" data-a="cp">从最近检查点继续（${last.label}）</button>` : ''}
      ${opts.checkpoints.length > 1 ? '<button class="btn" data-a="cplist">选择检查点…</button>' : ''}
      <button class="btn" data-a="restart">${opts.tutorial ? '重新开始这一课' : '从关卡起点重新开始'}</button>
      <button class="btn" data-a="settings">设置</button>
      <button class="btn" data-a="help">操作说明</button>
      <button class="btn ghost" data-a="quit">${opts.tutorial ? '退出教学' : '退出到主菜单'}</button></div></div>`),
    );
    this.bind(el, {
      resume: on.resume,
      skip: () => on.skipStep?.(),
      cp: () => on.checkpoint(last.index, 'exact'),
      cplist: () => this.checkpointList(opts.checkpoints, on.checkpoint),
      restart: on.restart,
      settings: on.settings,
      help: on.help,
      quit: on.quit,
    });
  }

  checkpointList(list: CheckpointItem[], pick: (i: number, mode: 'exact' | 'safe') => void): void {
    const rows = list
      .map(
        (c) => `<div class="cp-row"><div><b>${c.label}</b><span class="muted"> · ${fmtTime(c.t)} · 耐久 ${Math.round(c.durability)}${c.safe ? '' : ' · <span class="amber">状态不佳</span>'}</span></div>
        <div><button class="btn sm" data-a="exact" data-i="${c.index}">从此继续</button><button class="btn sm ghost" data-a="safe" data-i="${c.index}" title="在该位置以稳定悬停状态恢复，耐久至少 40（评分扣分）">安全恢复</button></div></div>`,
      )
      .reverse()
      .join('');
    const el = this.openModal(h(`<div class="modal"><div class="card wide"><div class="screen-head"><h2>选择检查点</h2><button class="btn ghost" data-a="close">关闭</button></div><div class="cp-list">${rows}</div>
      <p class="muted">“安全恢复”会在检查点位置以稳定悬停状态继续，耐久至少恢复到 40，用于避免严重受损时无法继续的情况（计入评分扣分）。已消耗的奖励不会因恢复检查点而重复获得。</p></div></div>`));
    this.bind(el, {
      exact: (b) => {
        this.closeModal();
        pick(Number(b.dataset.i), 'exact');
      },
      safe: (b) => {
        this.closeModal();
        pick(Number(b.dataset.i), 'safe');
      },
      close: () => this.closeModal(),
    });
  }

  failed(opts: { cause: string; detail: string; checkpoints: CheckpointItem[] }, on: { checkpoint: (i: number, mode: 'exact' | 'safe') => void; restart: () => void; quit: () => void }): void {
    const last = opts.checkpoints[opts.checkpoints.length - 1];
    const safeOnes = opts.checkpoints.filter((c) => c.safe);
    const earlier = safeOnes.length > 0 ? safeOnes[safeOnes.length - 1] : null;
    const el = this.show(
      h(`<div class="screen center dim"><div class="card narrow fail"><div class="fail-badge">任务失败</div><h2>${opts.cause}</h2><p>${opts.detail}</p>
      ${last ? `<button class="btn primary" data-a="cp">从最近检查点继续（${last.label} · 耐久 ${Math.round(last.durability)}）</button>` : ''}
      ${earlier && earlier !== last ? `<button class="btn" data-a="earlier">从较早的安全检查点继续（${earlier.label}）</button>` : ''}
      ${last && last.durability < 30 ? `<button class="btn" data-a="safe">安全恢复（悬停状态，耐久至少 40）</button>` : ''}
      ${opts.checkpoints.length > 1 ? '<button class="btn" data-a="cplist">选择检查点…</button>' : ''}
      <button class="btn" data-a="restart">从关卡起点重新开始</button>
      <button class="btn ghost" data-a="quit">退出到主菜单</button></div></div>`),
    );
    this.bind(el, {
      cp: () => on.checkpoint(last.index, 'exact'),
      earlier: () => earlier && on.checkpoint(earlier.index, 'exact'),
      safe: () => on.checkpoint(last.index, 'safe'),
      cplist: () => this.checkpointList(opts.checkpoints, on.checkpoint),
      restart: on.restart,
      quit: on.quit,
    });
  }

  result(opts: { map: MapDef; score: ScoreResult; best: boolean; time: number; landing: LandingMetrics | null; optional: Array<{ title: string; done: boolean }>; next: MapDef | null; tutorial: boolean }, on: { again: () => void; maps: () => void; next: () => void; menu: () => void }): void {
    const s = opts.score;
    const rows = s.breakdown.map((b) => `<tr><td>${b.label}</td><td class="muted">${b.note ?? ''}</td><td class="num">${b.value > 0 ? '+' : ''}${b.value}</td></tr>`).join('');
    const el = this.show(
      h(`<div class="screen center dim"><div class="card wide result">
        <div class="res-head"><div><div class="hud-label">${opts.tutorial ? '训练完成' : '任务完成'}</div><h2>${opts.map.name}</h2></div><div class="rating r-${s.rating}">${opts.tutorial ? '✔' : s.rating}</div></div>
        ${opts.tutorial ? '<p>你已经掌握了起飞、加速、减速、转向、高度控制、悬停、侧风修正和安全降落。可以开始正式地图了！</p>' : ''}
        <table class="score">${rows}<tr class="total"><td>总分</td><td></td><td class="num">${s.total}</td></tr></table>
        ${opts.best && !opts.tutorial ? '<div class="newbest">新的最佳成绩！</div>' : ''}
        <div class="res-grid">
          <div><span class="muted">最终降落</span><b>${opts.landing ? `${GRADE_LABEL[opts.landing.grade]} · 下降 ${opts.landing.descent.toFixed(1)} m/s · 漂移 ${opts.landing.horizontal.toFixed(1)} m/s · 偏移 ${opts.landing.offset.toFixed(1)} m` : '—'}</b></div>
          <div><span class="muted">用时（仅记录，不计分）</span><b>${fmtTime(opts.time)}</b></div>
          <div><span class="muted">可选任务</span><b>${opts.optional.map((o) => `${o.done ? '✔' : '○'} ${o.title}`).join('<br>') || '—'}</b></div>
        </div>
        <div class="btn-row">${opts.next ? `<button class="btn primary" data-a="next">下一张地图：${opts.next.name}</button>` : ''}<button class="btn" data-a="again">再飞一次</button><button class="btn" data-a="maps">地图选择</button><button class="btn ghost" data-a="menu">主菜单</button></div>
      </div></div>`),
    );
    this.bind(el, { again: on.again, maps: on.maps, next: on.next, menu: on.menu });
  }

  help(bindings: Settings['bindings']): void {
    const k = (a: Action) => bindings[a].map(keyName).join(' / ');
    const el = this.openModal(
      h(`<div class="modal"><div class="card wide"><div class="screen-head"><h2>操作说明</h2><button class="btn ghost" data-a="close">关闭</button></div>
      <div class="help-grid">
        <div><h3>基本操控</h3><table class="keys">
          <tr><td>${k('forward')}</td><td>机体前倾，逐渐加速</td></tr>
          <tr><td>${k('back')}</td><td>后倾减速，低速下缓慢后退</td></tr>
          <tr><td>${k('left')} / ${k('right')}</td><td>左/右转（自动协调机头方向与坡度）</td></tr>
          <tr><td>${k('up')}</td><td>爬升（增加升力）</td></tr>
          <tr><td>${k('down')}</td><td>下降（减小升力）</td></tr>
          <tr><td>${k('strafeLeft')} / ${k('strafeRight')}</td><td>向左/右平移（悬停修正、侧风修正）</td></tr>
          <tr><td>${k('hover')}</td><td>悬停辅助：逐渐减速并保持位置</td></tr>
          <tr><td>${k('boost')}</td><td>使用已获得的动力增强</td></tr>
          <tr><td>鼠标</td><td>观察四周（不控制飞机方向）</td></tr>
          <tr><td>${k('center')}</td><td>视角回正</td></tr>
          <tr><td>${k('view')}</td><td>切换座舱/追尾视角</td></tr>
          <tr><td>${k('nav')}</td><td>切换导航目标（主线/可选任务）；分岔处切换推荐路线</td></tr>
          <tr><td>${k('mapRange')}</td><td>切换座舱地图显示范围</td></tr>
          <tr><td>${k('hud')}</td><td>HUD 显示：自动（平稳飞行时收起）/ 完整 / 隐藏（想看风景、截图的时候）</td></tr>
          <tr><td>${k('cruise')}</td><td>自动巡航（休闲飞行）：沿着景点自己飞，动任何飞行键就交回给你</td></tr>
          <tr><td>${k('pause')}</td><td>暂停</td></tr></table></div>
        <div><h3>飞行要点</h3><ul class="tips">
          <li>直升机有真实的重量和惯性：加速、减速、转弯都需要时间和空间，<b>高速时请提前减速</b>。</li>
          <li>升力来自旋翼，机身倾斜时升力方向也随之倾斜；急转弯需要更多动力，动力不足时会掉高度。</li>
          <li>风通过相对气流影响飞机：侧风会让飞机漂移，顶风降低地速、顺风增加地速。注意风向袋、旗帜、树木和右侧风速表。</li>
          <li>降落时看右下角“着陆辅助”：下降速度 ≤ 2.5 m/s、水平漂移 ≤ 2.5 m/s、姿态 ≤ 12° 且落在坪内才算安全着陆。</li>
          <li>耐久 70 以下性能逐渐下降，30 以下明显下降，但始终保留控制能力；可前往绿色维修坪或拾取绿色维修补给。</li>
          <li>Buff：黄色闪电 = 动力增强（储存后按 ${k('boost')} 使用）；蓝色六边形 = 免伤护盾（自动生效）；绿色十字 = 维修 +25。</li>
          <li>没有时间限制：可以慢慢探索、练习和欣赏风景。</li>
          <li>浏览器不允许网页拦截 Ctrl+W 等快捷键，所以默认键位里没有 Ctrl。在设置里改键时也请避开 Ctrl，否则和字母键一起按可能会关闭页面。</li>
        </ul></div>
      </div></div></div>`),
    );
    this.bind(el, { close: () => this.closeModal() });
  }

  about(): void {
    const el = this.openModal(
      h(`<div class="modal"><div class="card wide"><div class="screen-head"><h2>关于与授权</h2><button class="btn ghost" data-a="close">关闭</button></div>
      <p><b>Rotor Trails（旋翼航迹）</b> — 第一人称拟真直升机闯关游戏。地形高度、仪表画面与音效由程序生成；驾驶舱、直升机外观、建筑与树木由本项目的 Blender 脚本建模。</p>
      <p>地形与建筑使用 Poly Haven 的 CC0 照片材质。建模参照照片仅用于结构与比例参考，不随游戏分发。</p>
      <p>“大峡谷”地图的高程来自 USGS 3D Elevation Program，影像来自 USDA National Agriculture Imagery Program（2023 年，经 USGS The National Map 分发），均为美国政府公有领域数据，courtesy of the U.S. Geological Survey。</p>
      <h3>第三方开源库</h3>
      <ul class="tips"><li>three.js — MIT License</li><li>Rapier（@dimforge/rapier3d-compat）— Apache License 2.0</li><li>开发工具：Vite（MIT）、TypeScript（Apache-2.0）、Vitest（MIT）</li></ul>
      <p class="muted">可查看<a href="./licenses.md" target="_blank" rel="noopener">第三方素材与开源许可</a>。除大峡谷外，地图都是虚构地形，仅体现日本海湾、美国西南峡谷、亚马孙雨林、挪威峡湾、尼泊尔高山的地貌特色，不对应真实地理位置。</p></div></div>`),
    );
    this.bind(el, { close: () => this.closeModal() });
  }

  settings(cur: Settings, on: { change: (s: Settings) => void; capture: (cb: (code: string) => void) => (() => void) | void; close: () => void }): void {
    const s: Settings = structuredClone(cur);
    let tab = 'controls';
    let cancelCapture: (() => void) | void;
    let captureVersion = 0;
    let bindingNotice = '点击按键即可修改；按 Esc 取消。每个动作最多保留 3 个按键。';
    const stopCapture = () => {
      captureVersion++;
      cancelCapture?.();
      cancelCapture = undefined;
    };
    const el = this.openModal(h(`<div class="modal"><div class="card wide settings"><div class="screen-head"><h2>设置</h2><button class="btn ghost" data-a="close">完成</button></div>
      <div class="tabs" role="tablist" aria-label="设置分类"><button class="tab" id="settings-controls" role="tab" aria-controls="settings-panel" data-a="tab" data-t="controls">操作</button><button class="tab" id="settings-video" role="tab" aria-controls="settings-panel" data-a="tab" data-t="video">画面</button><button class="tab" id="settings-audio" role="tab" aria-controls="settings-panel" data-a="tab" data-t="audio">声音</button><button class="tab" id="settings-assist" role="tab" aria-controls="settings-panel" data-a="tab" data-t="assist">辅助与显示</button></div>
      <div class="tab-body" id="settings-panel" role="tabpanel"></div><p class="settings-save muted">设置自动保存到此浏览器</p></div></div>`), (notify) => { stopCapture(); if (notify) on.close(); });
    const body = el.querySelector('.tab-body') as HTMLDivElement;
    const range = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<label class="set-row"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${s[key] as number}"><em>${fmt(s[key] as number)}</em></label>`;
    const check = (key: keyof Settings, label: string, note = '') => `<label class="set-row"><span>${label}</span><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}><em class="muted">${note}</em></label>`;
    const select = (key: keyof Settings, label: string, opts: Array<[string, string]>) =>
      `<label class="set-row"><span>${label}</span><select data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${s[key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select><em></em></label>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const render = () => {
      el.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
        const selected = t.dataset.t === tab;
        t.classList.toggle('sel', selected);
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
      });
      body.setAttribute('aria-labelledby', `settings-${tab}`);
      if (tab === 'controls') {
        const rows = (Object.keys(ACTION_LABEL) as Action[])
          .map((a) => `<div class="bind-row"><span>${ACTION_LABEL[a]}</span><div>${s.bindings[a].map((c, i) => `<button class="key" data-a="rebind" data-act="${a}" data-i="${i}" aria-label="${ACTION_LABEL[a]}：${escapeHtml(keyName(c))}，点击改键">${escapeHtml(keyName(c))}</button>`).join('')}${s.bindings[a].length < 3 ? `<button class="key add" data-a="rebind" data-act="${a}" data-i="${s.bindings[a].length}" aria-label="为${ACTION_LABEL[a]}添加备用按键" title="添加备用按键">＋</button>` : ''}</div></div>`)
          .join('');
        body.innerHTML =
          range('mouseSensitivity', '鼠标灵敏度', 0.1, 4, 0.05, (v) => v.toFixed(2)) +
          check('invertY', '视角上下反转') +
          check('invertX', '视角左右反转') +
          `<h3>按键绑定 <button class="btn sm ghost" data-a="resetKeys">恢复默认</button></h3><p class="binding-notice" role="status">${escapeHtml(bindingNotice)}</p><div class="bind-list">${rows}</div>`;
      } else if (tab === 'video') {
        body.innerHTML =
          select('quality', '画质', (Object.keys(QUALITY) as Array<keyof typeof QUALITY>).map((q) => [q, QUALITY[q].label])) +
          check('rayTracing', '光线追踪', '沿地形追踪真实光线：山谷、岩壁、机腹接到地面反上来的彩色光，金属映出地形，舱内光线随脚下的地面变化。进图时多算一秒，飞行时几乎不占性能') +
          check('volumetric', '体积雾与光束', '贴地薄雾、穿过树林与云缝的光束（丁达尔效应）；中画质及以上生效') +
          range('renderScale', '渲染分辨率（低于 100% 时用时间超分还原清晰度）', 0.5, 1, 0.05, pct) +
          range('fov', '视野范围（FOV）', 50, 100, 1, (v) => `${Math.round(v)}°`) +
          range('viewCenter', '座舱视点居中（0% = 右侧机长座位）', 0, 1, 0.05, pct) +
          range('shake', '镜头震动强度', 0, 1, 0.05, pct) +
          check('headMotion', '头部晃动（加速度引起）', '关闭后机体的真实运动仍会反映在画面上') +
          check('motionBlur', '动态模糊', '中及以上画质，或开启光线追踪时生效；默认关闭') +
          check('navGuides', '三维航线标记', '在场景里显示光环和箭头，默认关闭（方向看 HUD 的菱形标记）') +
          check('eyeAdapt', '人眼适应', '看向明暗不同的地方时，曝光像眼睛一样慢慢调整；关闭后曝光固定。') +
          check('lightning', '闪电闪光', '对光敏感可关闭') +
          '<p class="muted">低画质减少远景细节、阴影和雨滴数量，不改变碰撞、导航或物理难度。画面卡顿时，先降低画质或渲染分辨率，再关闭光线追踪。</p>';
      } else if (tab === 'audio') {
        body.innerHTML = range('volMaster', '总音量', 0, 1, 0.05, pct) + range('volEngine', '发动机与旋翼', 0, 1, 0.05, pct) + range('volAmbience', '环境与天气', 0, 1, 0.05, pct) + range('volAlerts', '告警与提示', 0, 1, 0.05, pct);
      } else {
        body.innerHTML =
          select('assist', '默认飞行辅助', (Object.keys(ASSISTS) as AssistId[]).map((a) => [a, ASSISTS[a].label])) +
          `<p class="muted">${ASSISTS[s.assist].desc}</p>` +
          select('speedUnit', 'HUD 速度单位', [
            ['kmh', 'km/h'],
            ['kt', '节（kt）'],
            ['ms', 'm/s'],
          ]) +
          range('hudOpacity', 'HUD 不透明度', 0.3, 1, 0.05, pct) +
          check('hints', '显示操作提示', '常规提示；教学与安全告警始终保留');
      }
    };
    render();
    el.querySelector('.tabs')?.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('.tab'));
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index].click();
      tabs[index].focus();
    });
    body.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset.k as keyof Settings | undefined;
      if (!k) return;
      const rec = s as unknown as Record<string, unknown>;
      if (t instanceof HTMLInputElement && t.type === 'checkbox') rec[k] = t.checked;
      else if (t instanceof HTMLInputElement && t.type === 'range') {
        rec[k] = Number(t.value);
        const em = t.parentElement?.querySelector('em');
        if (em) em.textContent = k === 'fov' ? `${Math.round(Number(t.value))}°` : k === 'mouseSensitivity' ? Number(t.value).toFixed(2) : `${Math.round(Number(t.value) * 100)}%`;
      } else rec[k] = t.value;
      if (k === 'quality' || k === 'rayTracing') s.autoQuality = false;
      on.change(structuredClone(s));
      if (k === 'assist') {
        render();
        body.querySelector<HTMLElement>('[data-k="assist"]')?.focus({ preventScroll: true });
      }
    });
    this.bind(el, {
      close: () => this.closeModal(),
      tab: (b) => {
        stopCapture();
        tab = b.dataset.t!;
        render();
      },
      resetKeys: () => {
        stopCapture();
        s.bindings = structuredClone(DEFAULT_BINDINGS);
        bindingNotice = '已恢复默认按键。';
        on.change(structuredClone(s));
        render();
        body.querySelector<HTMLElement>('[data-a="resetKeys"]')?.focus({ preventScroll: true });
      },
      rebind: (b) => {
        stopCapture();
        const act = b.dataset.act as Action;
        const i = Number(b.dataset.i);
        const version = captureVersion;
        render();
        b = body.querySelector<HTMLElement>(`[data-a="rebind"][data-act="${act}"][data-i="${i}"]`)!;
        b.textContent = '按下新按键…';
        b.classList.add('wait');
        b.focus({ preventScroll: true });
        body.querySelector('.binding-notice')!.textContent = `正在修改“${ACTION_LABEL[act]}”：按下新按键，或按 Esc 取消。`;
        cancelCapture = on.capture((code) => {
          if (version !== captureVersion || !el.isConnected) return;
          cancelCapture = undefined;
          const conflict = (Object.keys(s.bindings) as Action[]).find((a) => a !== act && s.bindings[a].includes(code));
          if (code === 'Escape') {
            bindingNotice = '已取消改键，原按键保留。';
          } else if (conflict) {
            bindingNotice = `${keyName(code)} 已用于“${ACTION_LABEL[conflict]}”，请先修改该动作，或选用其他按键。原按键保留。`;
          } else if (/^(Control|Alt|Meta)/.test(code) || ['Tab', 'F5', 'F11', 'F12'].includes(code)) {
            bindingNotice = `${keyName(code)} 是浏览器或菜单快捷键，请选用字母、数字、方向键或 Shift。原按键保留。`;
          } else {
            const list = s.bindings[act].filter((_, j) => j !== i);
            list.splice(Math.min(i, list.length), 0, code);
            s.bindings[act] = Array.from(new Set(list)).slice(0, 3);
            bindingNotice = `“${ACTION_LABEL[act]}”已设为 ${s.bindings[act].map(keyName).join(' / ')}。`;
            on.change(structuredClone(s));
          }
          render();
          body.querySelector<HTMLElement>(`[data-a="rebind"][data-act="${act}"][data-i="${Math.min(i, s.bindings[act].length - 1)}"]`)?.focus({ preventScroll: true });
        });
      },
    });
  }
}
