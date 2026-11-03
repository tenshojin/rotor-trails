// 飞行教学：在训练场按步骤实际操作（每一步都检查真实飞行状态，不是只显示说明文字）。

import { RAD, headingDelta, wrap360 } from '../core/math';
import type { GameSession } from '../sim/session';
import { keyName, type Settings } from './settings';

export interface TutorialStep {
  id: string;
  title: string;
  text: (k: (a: keyof Settings['bindings']) => string) => string;
  /** 返回 0..1 的进度；>= 1 表示完成 */
  check: (s: GameSession, st: StepState, dt: number) => number;
}

interface StepState {
  t: number;
  a: number;
  b: number;
  flag: boolean;
  startHeading: number;
  accHeading: number;
  lastHeading: number;
}

const hdg = (s: GameSession) => wrap360(s.flight.telemetry.heading * RAD);

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'takeoff',
    title: '1 / 8　起飞',
    text: (k) => `按住 <kbd>${k('up')}</kbd> 增加升力。直升机会逐渐变轻、离开地面。爬升到<b>离地 15 m</b> 以上后松开。`,
    check: (s) => Math.min(1, s.agl / 15),
  },
  {
    id: 'accel',
    title: '2 / 8　前进加速',
    text: (k) => `按住 <kbd>${k('forward')}</kbd>：机头下倾，旋翼推力向前倾斜，速度<b>逐渐</b>增加。加速到地速 <b>70 km/h</b>（约 20 m/s）。`,
    check: (s) => Math.min(1, s.groundSpeed / 20),
  },
  {
    id: 'brake',
    title: '3 / 8　减速',
    text: (k) => `松开 <kbd>${k('forward')}</kbd> 后飞机不会立刻停下。按住 <kbd>${k('back')}</kbd> 让机头上仰“刹车”，把地速降到 <b>18 km/h</b>（5 m/s）以下。高速时需要提前减速。`,
    check: (s, st) => {
      if (s.groundSpeed > 12) st.flag = true;
      return st.flag ? Math.min(1, Math.max(0, (20 - s.groundSpeed) / 15)) : 0;
    },
  },
  {
    id: 'turn',
    title: '4 / 8　转向',
    text: (k) => `按住 <kbd>${k('left')}</kbd> 或 <kbd>${k('right')}</kbd> 转向：低速时原地转动机头，有速度时会自动协调坡度。累计转过 <b>90°</b>。`,
    check: (s, st) => {
      const h = hdg(s);
      st.accHeading += Math.abs(headingDelta(st.lastHeading, h));
      st.lastHeading = h;
      return Math.min(1, st.accHeading / 90);
    },
  },
  {
    id: 'altitude',
    title: '5 / 8　高度控制',
    text: (k) => `用 <kbd>${k('up')}</kbd> / <kbd>${k('down')}</kbd> 控制升降：先爬升到<b>离地 60 m</b>，再下降并在<b>离地 25–35 m</b> 保持 3 秒。松开按键时系统会帮你保持高度。`,
    check: (s, st, dt) => {
      if (s.agl >= 58) st.flag = true;
      if (!st.flag) return Math.min(0.5, s.agl / 120);
      if (s.agl > 25 && s.agl < 35) st.t += dt;
      else st.t = Math.max(0, st.t - dt);
      return 0.5 + Math.min(0.5, st.t / 6);
    },
  },
  {
    id: 'hover',
    title: '6 / 8　悬停',
    text: (k) => `按 <kbd>${k('hover')}</kbd> 开启悬停辅助：系统会<b>逐渐</b>降低水平速度并保持位置（不会瞬间停住）。定点保持 <b>5 秒</b>。悬停时可用 <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('strafeLeft')}</kbd><kbd>${k('strafeRight')}</kbd> 微调位置。`,
    check: (s, st, dt) => {
      if (s.flight.telemetry.hover === 'holding' && s.groundSpeed < 1.5) st.t += dt;
      return Math.min(1, st.t / 5);
    },
  },
  {
    id: 'wind',
    title: '7 / 8　侧风修正',
    text: (k) =>
      `关闭悬停（<kbd>${k('hover')}</kbd>），沿导航飞往西侧的<b>侧风区</b>（北风 8 m/s，看风向袋和风速表）。到达标记点上方后保持低速悬停 <b>5 秒</b>：风会把飞机吹偏，用 <kbd>${k('strafeLeft')}</kbd>/<kbd>${k('strafeRight')}</kbd> 或悬停辅助修正。`,
    check: (s, st, dt) => {
      const d = Math.hypot(s.body.pos.x + 420, s.body.pos.z + 150);
      if (d < 45 && s.groundSpeed < 2.5 && s.agl > 5) st.t += dt;
      else st.t = Math.max(0, st.t - dt * 0.5);
      return Math.min(1, st.t / 5);
    },
  },
  {
    id: 'land',
    title: '8 / 8　安全降落',
    text: (k) =>
      `飞向训练降落坪（蓝色光柱）。提前减速，在坪上方悬停，再按 <kbd>${k('down')}</kbd> 缓慢下降。右下角的<b>着陆辅助</b>会显示相对高度、下降速度、水平漂移和姿态：全部为绿色时接地最安全。`,
    check: (s) => (s.mission.complete ? 1 : s.mission.main[0].progress * 0.9),
  },
];

export class Tutorial {
  index = 0;
  progress = 0;
  done = false;
  private st: StepState = { t: 0, a: 0, b: 0, flag: false, startHeading: 0, accHeading: 0, lastHeading: 0 };
  private settings: Settings;
  onStep: ((i: number) => void) | null = null;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get step(): TutorialStep | null {
    return TUTORIAL_STEPS[this.index] ?? null;
  }

  private reset(s: GameSession): void {
    const h = hdg(s);
    this.st = { t: 0, a: 0, b: 0, flag: false, startHeading: h, accHeading: 0, lastHeading: h };
    this.progress = 0;
  }

  start(s: GameSession): void {
    this.index = 0;
    this.done = false;
    this.reset(s);
    this.onStep?.(0);
  }

  skip(s: GameSession): void {
    this.next(s);
  }

  private next(s: GameSession): void {
    this.index++;
    if (this.index >= TUTORIAL_STEPS.length) {
      this.done = true;
      return;
    }
    this.reset(s);
    this.onStep?.(this.index);
  }

  update(s: GameSession, dt: number): void {
    const step = this.step;
    if (!step || this.done) return;
    this.progress = step.check(s, this.st, dt);
    if (this.progress >= 1) {
      this.st.b += dt;
      if (this.st.b > 0.6) this.next(s);
    }
  }

  html(): string {
    const step = this.step;
    if (!step) return '';
    const k = (a: keyof Settings['bindings']) => keyName(this.settings.bindings[a][0]);
    return `<div class="tut-title">${step.title}</div><div class="tut-text">${step.text(k)}</div><div class="tut-bar"><i style="width:${Math.round(this.progress * 100)}%"></i></div><div class="tut-skip">按 <kbd>Enter</kbd> 跳过此步 · <kbd>Esc</kbd> 暂停/退出教学</div>`;
  }
}
