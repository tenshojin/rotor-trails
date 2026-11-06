// 救援任务的任务卡：现在要去哪、多远、往哪边飞、调度说了什么、伤员怎么样。
// 超仿真里 HUD 是收起来的，这张卡是唯一的文字信息，所以不放进 HUD 里。

import { conditionLabel } from '../sim/rescue';
import type { GameSession } from '../sim/session';

/** 调度的话留在屏幕上多久（秒） */
const RADIO_SECONDS = 22;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class RescuePanel {
  private readonly el: HTMLDivElement;
  private readonly clockEl: HTMLSpanElement;
  private readonly task: HTMLDivElement;
  private readonly dist: HTMLSpanElement;
  private readonly arrow: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly radio: HTMLDivElement;
  private readonly life: HTMLDivElement;
  private readonly lifeLabel: HTMLSpanElement;
  private readonly bar: HTMLElement;
  private readonly title: HTMLSpanElement;
  private objective = '';
  private objectiveT = 0;
  private next = 0;

  constructor(parent: HTMLElement) {
    const el = (this.el = document.createElement('div'));
    el.className = 'rescue-panel hidden';
    el.innerHTML =
      '<div class="rp-head"><span class="rp-title"></span><span class="rp-clock"></span></div>' +
      '<div class="rp-task"></div>' +
      '<div class="rp-nav"><span class="rp-arrow">▲</span><span class="rp-dist"></span></div>' +
      '<div class="rp-hint"></div><div class="rp-radio"></div>' +
      '<div class="rp-life"><span class="rp-label"></span><div><i></i></div></div>';
    const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
    this.title = q('.rp-title');
    this.clockEl = q('.rp-clock');
    this.task = q('.rp-task');
    this.dist = q('.rp-dist');
    this.arrow = q('.rp-arrow');
    this.hint = q('.rp-hint');
    this.radio = q('.rp-radio');
    this.life = q('.rp-life');
    this.lifeLabel = q('.rp-label');
    this.bar = q('.rp-life i');
    parent.append(el);
  }

  /** compact：HUD 开着，任务和距离它已经在显示了，这里只留伤员 */
  show(title: string, compact: boolean): void {
    this.title.textContent = `救援 · ${title}`;
    this.objective = '';
    this.next = 0;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('compact', compact);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  /** 每帧调用，一秒只改四次 */
  update(s: GameSession): void {
    const r = s.rescue;
    if (!r || s.t < this.next) return;
    this.next = s.t + 0.25;
    const cur = s.mission.current();
    if (!cur) return;
    if (cur.def.id !== this.objective) {
      this.objective = cur.def.id;
      this.objectiveT = s.t;
      this.task.textContent = cur.def.title;
      this.radio.textContent = `调度：${cur.def.detail}`;
    }
    this.radio.style.display = s.t - this.objectiveT < RADIO_SECONDS ? '' : 'none';
    this.clockEl.textContent = clock(s.t);
    const nav = s.nav.info;
    const km = nav.distance / 1000;
    this.dist.textContent = `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} 公里 · 方位 ${String(Math.round(nav.bearing)).padStart(3, '0')}°`;
    const rel = nav.bearing - (s.flight.telemetry.heading * 180) / Math.PI;
    this.arrow.style.transform = `rotate(${rel}deg)`;
    this.hint.textContent = cur.hint;
    this.hint.style.display = cur.hint ? '' : 'none';
    const show = r.waiting;
    this.life.style.display = show ? '' : 'none';
    if (show) {
      const aboard = s.mission.cargo > 0;
      this.lifeLabel.textContent = `伤员：${conditionLabel(r.health)}${aboard ? '（已上机）' : ''}${r.rough > 0.25 ? ' · 太颠了，飞稳一点' : ''}`;
      this.bar.style.width = `${r.health}%`;
      this.life.classList.toggle('bad', r.health <= 70 && r.health > 40);
      this.life.classList.toggle('worse', r.health <= 40);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
