// 飞行教学：在训练场一步一步学。写给没碰过飞行游戏的人：
//   · 每一步只教一个动作，屏幕上只留这一步用得到的东西，没学过的按键先不起作用；
//   · 每一步都检查真实飞行状态（读完说明不算过，要真的飞出来）；
//   · 撞了不算失败，回到这一课的开头再来。

import { RAD, headingDelta, wrap360 } from '../core/math';
import type { GameSession } from '../sim/session';
import { keyName, type Action, type Settings } from './settings';

/** 教学时 HUD 上露出来的部分（没学到的先藏起来） */
export type HudPart = 'flight' | 'heading' | 'nav' | 'marker' | 'status' | 'landing';

export interface TutorialHud {
  parts: readonly HudPart[];
  /** 这一步要看的地方（高亮） */
  spot: HudPart | null;
}

export interface TutorialCtx {
  /** 视线相对机头的偏转（弧度，向左为正） */
  yaw: number;
  pitch: number;
  /** 这个动作的键现在按着吗 */
  held(a: Action): boolean;
  /** 鼠标锁定不可用（只能按住拖动观察） */
  dragLook: boolean;
  /** 手机、平板：手指在屏幕上拖 */
  touch?: boolean;
  /** 超仿真：鼠标指着哪个控件 */
  hover?: string | null;
}

const NO_CTX: TutorialCtx = { yaw: 0, pitch: 0, held: () => false, dragLook: false };

/** 这一步可以用哪些飞行操作 */
type Allow = 'none' | 'lift' | 'forward' | 'all';

export interface StepState {
  t: number;
  a: number;
  b: number;
  x: number;
  z: number;
  lastHeading: number;
}

export type K = (a: Action) => string;

export interface TutorialStep {
  id: string;
  title: string;
  /** 要做什么（一句话） */
  text: (k: K, c: TutorialCtx) => string;
  /** 为什么、会发生什么（一句话） */
  why?: (k: K) => string;
  /** 屏幕上放大显示的按键 */
  keys?: Action[];
  /** 只是看一看：按回车继续 */
  manual?: boolean;
  /** 返回 0..1 的进度；>= 1 表示完成 */
  check?: (s: GameSession, st: StepState, dt: number, c: TutorialCtx) => number;
  /** 这一步要看的地方 */
  spot?: HudPart;
  /** 过了一阵还没完成时给的提示 */
  stuck?: (k: K, s: GameSession) => string;
  /** 进入这一步之前的状态是安全的（悬停或停在地面）：撞了回到这里 */
  anchor?: boolean;
  /** 超仿真：这一步要动座舱里的哪个控件（外面亮一圈） */
  control?: string | ((s: GameSession) => string | null);
  /** 超仿真：HUD 是收起来的，这一步要看的数字写在这里 */
  live?: (s: GameSession) => string;
  /** 分秒必争的步骤：完成了马上进下一步，不停下来打勾 */
  quick?: boolean;
}

export interface Lesson {
  title: string;
  sub: string;
  parts: readonly HudPart[];
  allow: Allow;
  /** 直接从这一课开始时，把飞机放到哪里（x、z、离地高度、航向；node：导航走到第几个航点） */
  place?: { x: number; z: number; agl: number; heading: number; node?: number; hover?: boolean; speed?: number };
  /** 超仿真：直接从这一课开始时停在哪块坪上（发动机已经在转） */
  park?: string;
  /** 上一课学完接着学这一课时，也把飞机放回这一课的起点 */
  jump?: boolean;
  steps: TutorialStep[];
}

const hdg = (s: GameSession) => wrap360(s.flight.telemetry.heading * RAD);
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 累计转过的角度：向右为正 */
export function turned(s: GameSession, st: StepState): number {
  const h = hdg(s);
  const d = headingDelta(st.lastHeading, h);
  st.lastHeading = h;
  return d;
}

/** 导航往前走了一个航点（st.a 是这一步开始时的位置，st.b 是开始时离目标多远） */
function nextNode(s: GameSession, st: StepState): number {
  if (s.nav.node > st.a || st.a >= s.world.map.nodes.length) return 1;
  if (st.b <= 0) st.b = Math.max(1, s.nav.info.distance);
  return 0.95 * clamp01(1 - s.nav.info.distance / st.b);
}

const padPos = (s: GameSession) => s.pad('T-final')?.pos ?? [0, 0, 0];
export const padDist = (s: GameSession) => {
  const p = padPos(s);
  return Math.hypot(s.body.pos.x - p[0], s.body.pos.z - p[2]);
};

export const LESSONS: Lesson[] = [
  {
    title: '认识座舱',
    sub: '转头看看四周，认识两个最重要的数字',
    parts: ['flight'],
    allow: 'none',
    steps: [
      {
        id: 'welcome',
        title: '欢迎！',
        text: () => '你坐在直升机的驾驶座上，飞机停在地面。接下来一步一步教你飞，<b>每次只学一个动作</b>。',
        why: () => '放心大胆地试。撞了也没关系，会自动回到这一课的开头。',
        manual: true,
      },
      {
        id: 'look',
        title: '转头看看',
        text: (_, c) => `${c.touch ? '手指在屏幕中间拖动' : c.dragLook ? '按住鼠标左键拖动' : '移动鼠标'}，向<b>左</b>看，再向<b>右</b>看。`,
        why: () => '这个动作只管你的视线，不管飞机。飞行中随时可以转头看风景。',
        check: (_s, st, _dt, c) => {
          st.a = Math.max(st.a, c.yaw);
          st.b = Math.max(st.b, -c.yaw);
          return (clamp01(st.a / 0.55) + clamp01(st.b / 0.55)) / 2;
        },
        stuck: () => '幅度大一点：往左转到看见门框，再往右转到看见门框。',
      },
      {
        id: 'center',
        title: '看回正前方',
        text: (k) => `按一下 <kbd>${k('center')}</kbd>，视线回到正前方。`,
        why: () => '转头转晕了，按它就好。',
        keys: ['center'],
        check: (_s, _st, _dt, c) => (Math.abs(c.yaw) < 0.1 ? 1 : 0),
      },
      {
        id: 'panel',
        title: '认识两个数字',
        text: () => '看屏幕左边。<b>地速</b>是你飞得多快，<b>离地高度</b>是你离地面多高。',
        why: () => '飞行时最常看的就是这两个数。现在飞机还停着，所以都接近 0。',
        manual: true,
        spot: 'flight',
      },
    ],
  },
  {
    title: '上升与下降',
    sub: '离开地面，停在空中，再降下来一点',
    parts: ['flight'],
    allow: 'lift',
    steps: [
      {
        id: 'liftoff',
        title: '起飞',
        text: (k) => `<b>按住</b> <kbd>${k('up')}</kbd> 不要松手，飞机就会往上升。升到离地 <b>5 米</b>。`,
        why: () => '这个键让旋翼多出力，把飞机拉起来。',
        keys: ['up'],
        spot: 'flight',
        anchor: true,
        check: (s) => clamp01(s.agl / 5),
        stuck: (k) => `要一直按住 <kbd>${k('up')}</kbd>，点一下是不够的。`,
      },
      {
        id: 'release',
        title: '松手',
        text: () => '现在<b>松开所有按键</b>，看看会发生什么。保持 3 秒。',
        why: () => '飞机不会掉下来：新手辅助帮你停在这个高度。<b>松手就是停住</b>，这是最安全的动作。',
        check: (s, st, dt, c) => {
          if (!c.held('up') && !c.held('down') && Math.abs(s.body.vel.y) < 1.5) st.t += dt;
          else st.t = 0;
          return clamp01(st.t / 3);
        },
      },
      {
        id: 'climb',
        title: '爬高',
        text: (k) => `再按住 <kbd>${k('up')}</kbd>，爬到离地 <b>25 米</b>。`,
        why: () => '盯着左边的“离地高度”，它会一直往上跳。',
        keys: ['up'],
        spot: 'flight',
        check: (s) => clamp01((s.agl - 5) / 20),
      },
      {
        id: 'descend',
        title: '下降',
        text: (k) => `按住 <kbd>${k('down')}</kbd>，飞机就往下降。降到离地 <b>15 米</b> 左右，然后松手。`,
        why: (k) => `它和 <kbd>${k('up')}</kbd> 相反：让旋翼少出力。`,
        keys: ['down', 'up'],
        spot: 'flight',
        check: (s, st, dt, c) => {
          // （松手后飞机还会沉几米，范围要留够）
          if (Math.abs(s.agl - 15) < 5 && !c.held('down') && !c.held('up')) st.t += dt;
          else st.t = 0;
          return Math.min(0.9, clamp01((25 - s.agl) / 8) * 0.9) + clamp01(st.t / 0.6) * 0.1;
        },
        stuck: (k, s) => (s.agl < 10 ? `低了一点，按 <kbd>${k('up')}</kbd> 升回 15 米。` : s.agl > 20 ? `继续按住 <kbd>${k('down')}</kbd>，到 15 米左右松手。` : '到了，松开按键。'),
      },
    ],
  },
  {
    title: '前进与刹车',
    sub: '飞起来，停下来，再学一个能救命的按键',
    parts: ['flight'],
    allow: 'forward',
    place: { x: 0, z: 140, agl: 15, heading: 0 },
    steps: [
      {
        id: 'forward',
        title: '向前飞',
        text: (k) => `按住 <kbd>${k('forward')}</kbd>，机头往下压，飞机开始往前走。加速到地速 <b>40 km/h</b>。`,
        why: () => '直升机靠把旋翼往前倾来前进，所以往前飞时机头是低的。',
        keys: ['forward'],
        spot: 'flight',
        anchor: true,
        check: (s) => clamp01(s.groundSpeed / 11),
      },
      {
        id: 'coast',
        title: '松手滑行',
        text: (k) => `松开 <kbd>${k('forward')}</kbd>，看着地速。它不会马上变成 0，飞机还会往前滑一段。`,
        why: () => '空中没有刹车片。飞得越快，要停下来就越要提前。',
        spot: 'flight',
        check: (_s, st, dt, c) => {
          if (!c.held('forward')) st.t += dt;
          else st.t = 0;
          return clamp01(st.t / 2.5);
        },
      },
      {
        id: 'brake',
        title: '刹车',
        text: (k) => `按住 <kbd>${k('back')}</kbd>，机头抬起来就是刹车。地速降到 <b>10 km/h</b> 以下就松手。`,
        why: () => '别按太久，否则飞机会倒着飞。眼睛看着地速，到了就松手。',
        keys: ['back'],
        spot: 'flight',
        check: (s, st) => {
          st.a = Math.max(st.a, s.groundSpeed, 3);
          return s.groundSpeed < 2.8 ? 1 : 0.95 * clamp01((st.a - s.groundSpeed) / (st.a - 2.8));
        },
      },
      {
        id: 'accel2',
        title: '再飞起来',
        text: (k) => `再按住 <kbd>${k('forward')}</kbd>，加速到 <b>30 km/h</b>。`,
        keys: ['forward'],
        spot: 'flight',
        check: (s) => clamp01(s.groundSpeed / 8.3),
      },
      {
        id: 'hoverOn',
        title: '一键定住',
        text: (k) => `松开 <kbd>${k('forward')}</kbd>，按一下 <kbd>${k('hover')}</kbd>。悬停辅助会替你刹车，把飞机定在空中。`,
        why: () => '不知道该怎么办的时候就按它，这是你的保险键。',
        keys: ['hover'],
        check: (s, st, dt) => {
          const on = s.flight.telemetry.hover !== 'off';
          if (s.flight.telemetry.hover === 'holding' && s.groundSpeed < 1.5) st.t += dt;
          else st.t = 0;
          return on ? 0.4 + 0.6 * clamp01(st.t / 1) : 0;
        },
        stuck: (k, s) => (s.flight.telemetry.hover === 'off' ? `按一下 <kbd>${k('hover')}</kbd> 就好，不用按住。` : '等一等，飞机正在自己减速。'),
      },
      {
        id: 'hoverOff',
        title: '关掉悬停',
        text: (k) => `再按一下 <kbd>${k('hover')}</kbd>，把悬停辅助关掉。`,
        why: () => '开着它飞机只会慢慢挪，要飞远的时候就关掉。',
        keys: ['hover'],
        check: (s) => (s.flight.telemetry.hover === 'off' ? 1 : 0),
      },
    ],
  },
  {
    title: '转向',
    sub: '原地转头、横着走、边飞边转',
    parts: ['flight', 'heading'],
    allow: 'all',
    place: { x: 0, z: 40, agl: 25, heading: 0 },
    steps: [
      {
        id: 'turnL',
        title: '向左转',
        text: (k) => `按住 <kbd>${k('left')}</kbd>，机头向左转。转过 <b>90°</b>。`,
        why: () => '看屏幕最上面的罗盘刻度在动：黄线指着的就是机头的方向。',
        keys: ['left'],
        spot: 'heading',
        anchor: true,
        check: (s, st) => {
          st.a -= turned(s, st);
          return clamp01(st.a / 85);
        },
      },
      {
        id: 'turnR',
        title: '向右转',
        text: (k) => `按住 <kbd>${k('right')}</kbd>，把机头转回来。向右转过 <b>90°</b>。`,
        keys: ['right'],
        spot: 'heading',
        check: (s, st) => {
          st.a += turned(s, st);
          return clamp01(st.a / 85);
        },
      },
      {
        id: 'strafe',
        title: '横着走',
        text: (k) => `按住 <kbd>${k('strafeRight')}</kbd>，飞机不转头，直接向右平移 <b>15 米</b>。<kbd>${k('strafeLeft')}</kbd> 是向左。`,
        why: () => '靠近停机坪时，就用这两个键微调位置。',
        keys: ['strafeLeft', 'strafeRight'],
        check: (s, st) => clamp01(Math.hypot(s.body.pos.x - st.x, s.body.pos.z - st.z) / 15),
      },
      {
        id: 'curve',
        title: '边飞边转',
        text: (k) => `同时按住 <kbd>${k('forward')}</kbd> 和 <kbd>${k('left')}</kbd>（或 <kbd>${k('right')}</kbd>），飞机就像汽车过弯一样转起来。转过 <b>120°</b>。`,
        why: () => '飞机会自己倾斜着转弯。速度越快，弯就转得越大。',
        keys: ['forward', 'left', 'right'],
        spot: 'heading',
        check: (s, st) => {
          const d = Math.abs(turned(s, st));
          if (s.groundSpeed > 5) st.a += d;
          return clamp01(st.a / 120);
        },
        stuck: (k, s) => (s.groundSpeed <= 5 ? `要一边飞一边转：先按住 <kbd>${k('forward')}</kbd> 飞起来。` : '继续转。'),
      },
    ],
  },
  {
    title: '跟着导航飞',
    sub: '认识目的地标记，一个航点一个航点飞过去',
    parts: ['flight', 'heading', 'nav', 'marker'],
    allow: 'all',
    place: { x: 0, z: 120, agl: 30, heading: 0, node: 1 },
    steps: [
      {
        id: 'marker',
        title: '认识目的地标记',
        text: () => '屏幕上青色的 <b>◇</b> 就是要去的地方，旁边写着距离。它不在视野里时，屏幕边上的箭头会指着它。',
        why: () => '远处升起的烟也是同一个地方，抬头就能看到。',
        manual: true,
        spot: 'marker',
        anchor: true,
      },
      {
        id: 'follow1',
        title: '飞向航点',
        text: (k) => `用 <kbd>${k('left')}</kbd> <kbd>${k('right')}</kbd> 把 ◇ 转到正前方，然后按住 <kbd>${k('forward')}</kbd> 飞过去。`,
        why: () => '不用飞得很准，靠近就算到。路上的无人机是补给，碰到就能拿，不拿也没关系。',
        spot: 'marker',
        check: nextNode,
        stuck: (k, s) => (s.agl < 15 ? `太低了，按住 <kbd>${k('up')}</kbd> 升高一点。` : s.flight.telemetry.hover !== 'off' ? `悬停还开着，按 <kbd>${k('hover')}</kbd> 关掉才飞得快。` : '把 ◇ 放在屏幕中间，一直往前飞。'),
      },
      {
        id: 'follow2',
        title: '转弯飞向下一个',
        text: () => '到了！◇ 跳到了下一个地方，它在侧面。<b>先减速</b>，转过去，再加速。',
        why: () => '飞得快的时候转弯半径大，提前减速就不会冲过头。',
        spot: 'marker',
        check: nextNode,
      },
    ],
  },
  {
    title: '风',
    sub: '感受侧风，学会在风里定住',
    parts: ['flight', 'heading', 'nav', 'marker', 'status'],
    allow: 'all',
    place: { x: -300, z: -480, agl: 40, heading: 200, node: 3 },
    steps: [
      {
        id: 'toWind',
        title: '飞进侧风区',
        text: () => '继续飞向 ◇。前面是侧风区，风从北边吹过来，看右边的<b>风</b>一栏。',
        why: () => '风不是敌人，只是把飞机往一边推。',
        spot: 'status',
        anchor: true,
        check: nextNode,
      },
      {
        id: 'windDrift',
        title: '感受风',
        text: () => '<b>松开所有按键</b>，看着地面：飞机正被风推着走。保持 3 秒。',
        why: () => '即使机头朝前，飞机也可能斜着走。',
        check: (s, st, dt, c) => {
          const free = !c.held('forward') && !c.held('back') && !c.held('left') && !c.held('right');
          if (free) st.t += dt;
          else st.t = 0;
          return clamp01(st.t / 3);
        },
      },
      {
        id: 'windHold',
        title: '在风里定住',
        text: (k) => `按 <kbd>${k('hover')}</kbd>，悬停辅助会顶着风把飞机定住。等地速降到接近 0，坚持 <b>3 秒</b>。`,
        why: () => '顶风定在一处，就是降落前要做的事。',
        keys: ['hover'],
        spot: 'flight',
        check: (s, st, dt) => {
          if (s.flight.telemetry.hover === 'holding' && s.groundSpeed < 2) st.t += dt;
          else st.t = 0;
          return clamp01(st.t / 3);
        },
        stuck: (k, s) => (s.flight.telemetry.hover === 'off' ? `按一下 <kbd>${k('hover')}</kbd>。` : '等它把速度降下来。'),
      },
    ],
  },
  {
    title: '降落',
    sub: '减速、对准、慢慢落下，完成全部训练',
    parts: ['flight', 'heading', 'nav', 'marker', 'landing'],
    allow: 'all',
    place: { x: -40, z: -260, agl: 45, heading: 270, node: 4, hover: true },
    steps: [
      {
        id: 'toPad',
        title: '飞向降落坪',
        text: (k) => `按 <kbd>${k('hover')}</kbd> 关掉悬停，飞向 ◇：地上那块标着 H 的就是降落坪。<b>离它 100 米时开始减速</b>。`,
        why: () => '飞到坪的上空时速度要接近 0，不是到了才刹车。',
        spot: 'marker',
        anchor: true,
        check: (s, st) => {
          const d = padDist(s);
          st.a = Math.max(st.a, d, 60);
          return d < 45 && s.groundSpeed < 9 ? 1 : 0.95 * clamp01((st.a - d) / (st.a - 45));
        },
        stuck: (k, s) => (s.flight.telemetry.hover !== 'off' ? `悬停还开着，按 <kbd>${k('hover')}</kbd> 关掉才飞得快。` : padDist(s) < 60 ? `速度太快了，按住 <kbd>${k('back')}</kbd> 减速。` : '把 ◇ 放在屏幕中间，一直往前飞。'),
      },
      {
        id: 'overPad',
        title: '停在坪的正上方',
        text: (k) => `看右下角的着陆辅助：绿框是坪，白十字是你。把十字移进框里，按 <kbd>${k('hover')}</kbd> 悬停。`,
        why: (k) => `悬停时用 <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('strafeLeft')}</kbd><kbd>${k('strafeRight')}</kbd> 微调位置。`,
        keys: ['hover'],
        spot: 'landing',
        check: (s, st, dt) => {
          if (padDist(s) < 8 && s.flight.telemetry.hover === 'holding' && s.groundSpeed < 1.5) st.t += dt;
          else st.t = 0;
          return clamp01(st.t / 1);
        },
        stuck: (k, s) => (padDist(s) >= 8 ? `还差 ${Math.round(padDist(s))} 米。用 <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('strafeLeft')}</kbd><kbd>${k('strafeRight')}</kbd> 把十字移进绿框。` : `已经在坪上了，按 <kbd>${k('hover')}</kbd> 悬停。`),
      },
      {
        id: 'down',
        title: '慢慢落下',
        text: (k) => `按住 <kbd>${k('down')}</kbd> 下降。右下角四项都打 ✔ 就是安全的，接地后保持不动。`,
        why: () => '下降速度不要超过 2.5 m/s。快了就松手，飞机会马上慢下来。',
        keys: ['down'],
        spot: 'landing',
        check: (s) => (s.mission.complete ? 1 : s.mission.main[0].progress * 0.9),
      },
    ],
  },
];

/** 全部步骤摊平（序号与 Tutorial.index 对应） */
export const TUTORIAL_STEPS: TutorialStep[] = LESSONS.flatMap((l) => l.steps);

const PRAISE = ['好！', '很好！', '漂亮！', '就是这样！', '没问题！'];
/** 达标后要保持多久才算过（秒）；过了之后 ✔ 留在屏幕上多久 */
const HOLD = 0.25;
const FLASH = 0.9;
/** 多久没完成就给提示（秒） */
const STUCK_AFTER = 14;

export class Tutorial {
  index = 0;
  progress = 0;
  done = false;
  /** 全部步骤摊平（序号与 index 对应） */
  readonly steps: TutorialStep[];
  /** 这一步的控件不在视野里时，往哪边看 */
  lookHint = '';
  /** 每一课第一步的序号 */
  private readonly starts: number[] = [];
  private st: StepState = { t: 0, a: 0, b: 0, x: 0, z: 0, lastHeading: 0 };
  private settings: Settings;
  private cachedHtml = '';
  private htmlKey = '';
  private flash = 0;
  private stepT = 0;
  private holdT = 0;
  private note = '';
  /** 最近一个安全点 */
  private anchorIndex = 0;
  onStep: ((i: number) => void) | null = null;
  /** 一课结束 */
  onLesson: ((lesson: number) => void) | null = null;

  constructor(settings: Settings, readonly lessons: Lesson[] = LESSONS) {
    this.settings = settings;
    this.steps = lessons.flatMap((l) => l.steps);
    let n = 0;
    for (const l of lessons) {
      this.starts.push(n);
      n += l.steps.length;
    }
  }

  private lessonOf(index: number): number {
    let l = 0;
    while (l + 1 < this.lessons.length && this.starts[l + 1] <= index) l++;
    return l;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.htmlKey = '';
  }

  get step(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  get lesson(): number {
    return this.lessonOf(Math.min(this.index, this.steps.length - 1));
  }

  /** 这一步要点的控件 */
  control(s: GameSession): string | null {
    const c = this.step?.control;
    return (typeof c === 'function' ? c(s) : c) ?? null;
  }

  /** 最后一步之前，降落不算数 */
  get missionLocked(): boolean {
    return this.step?.id !== 'down';
  }

  hud(): TutorialHud {
    return { parts: this.lessons[this.lesson].parts, spot: this.step?.spot ?? null };
  }

  private reset(s: GameSession): void {
    this.st = { t: 0, a: 0, b: 0, x: s.body?.pos.x ?? 0, z: s.body?.pos.z ?? 0, lastHeading: hdg(s) };
    // 第 5 课从固定的航点开始，提示才对得上
    if (this.step?.id === 'marker') {
      s.nav.path = 0;
      s.nav.node = 1;
    }
    if (['follow1', 'follow2', 'toWind'].includes(this.step?.id ?? '')) this.st.a = s.nav.node;
    this.progress = 0;
    this.flash = 0;
    this.stepT = 0;
    this.holdT = 0;
    this.note = '';
    this.htmlKey = '';
    if (this.step?.anchor) this.anchorIndex = this.index;
  }

  start(s: GameSession, lesson = 0): void {
    const l = Math.min(this.lessons.length - 1, Math.max(0, lesson));
    this.index = this.starts[l];
    this.anchorIndex = this.index;
    this.done = false;
    this.place(s, l);
    this.reset(s);
    this.onStep?.(this.index);
  }

  /** 直接从后面某一课开始：把飞机放到这一课开始的地方 */
  private place(s: GameSession, lesson: number): void {
    const { place: p, park } = this.lessons[lesson];
    if (park) s.parkRunning(park);
    if (!p || lesson === 0) return;
    const ground = s.world.ctx.ground(p.x, p.z);
    s.teleport(p.x, ground + p.agl, p.z, p.heading, p.speed ?? 0);
    if (p.hover) s.flight.setHover(true);
    if (p.node !== undefined) {
      s.nav.path = 0;
      s.nav.node = p.node;
    }
  }

  /** 恢复之后接着这一步（瞬移不算转向进度） */
  resumeStep(s: GameSession): void {
    if (this.done) this.index = this.steps.length - 1;
    this.done = false;
    this.reset(s);
  }

  /** 撞了：回到最近的安全点 */
  rewind(s: GameSession): void {
    this.index = this.anchorIndex;
    this.done = false;
    this.reset(s);
    this.onStep?.(this.index);
  }

  /** 回车：看完了继续 / 跳过这一步 */
  skip(s: GameSession): void {
    if (!this.done) this.next(s);
  }

  /** 说明页上点鼠标也算继续 */
  click(s: GameSession): void {
    if (!this.done && this.step?.manual && this.flash <= 0) this.next(s);
  }

  private next(s: GameSession): void {
    const before = this.lesson;
    this.index++;
    if (this.index >= this.steps.length) {
      this.done = true;
      this.onLesson?.(before);
      return;
    }
    if (this.lesson !== before) {
      this.onLesson?.(before);
      if (this.lessons[this.lesson].jump) this.place(s, this.lesson);
    }
    this.reset(s);
    this.onStep?.(this.index);
  }

  /** 没学到的操作先不起作用（这一步只做这一件事） */
  filter(input: { pitch: number; turn: number; lateral: number; vertical: number }): void {
    const allow = this.lessons[this.lesson].allow;
    if (allow === 'all') return;
    input.turn = input.lateral = 0;
    if (allow !== 'forward') input.pitch = 0;
    if (allow === 'none') input.vertical = 0;
  }

  /** 悬停键也要学到了才能用 */
  get hoverAllowed(): boolean {
    return this.lesson >= 2;
  }

  update(s: GameSession, dt: number, ctx: TutorialCtx = NO_CTX): void {
    const step = this.step;
    if (!step || this.done || !Number.isFinite(dt) || dt <= 0) return;
    this.liveText = step.live ? step.live(s) : '';
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) this.next(s);
      return;
    }
    if (!step.check) return;
    this.stepT += dt;
    this.progress = step.check(s, this.st, dt, ctx);
    this.note = this.stepT > STUCK_AFTER && step.stuck ? step.stuck(this.keyFn, s) : '';
    if (this.progress >= 1) {
      if (step.quick) {
        this.next(s);
        return;
      }
      this.holdT += dt;
      if (this.holdT >= HOLD) {
        this.holdT = 0;
        this.flash = FLASH;
      }
    } else this.holdT = 0;
  }

  private keyFn: K = (a) => keyName(this.settings.bindings[a][0]);
  private liveText = '';

  html(ctx: TutorialCtx = NO_CTX): string {
    const step = this.step;
    if (!step) return '';
    const percent = Math.round(this.progress * 100);
    const heldBits = (step.keys ?? []).map((a) => (ctx.held(a) ? 1 : 0)).join('');
    const flashing = this.flash > 0;
    const key = `${this.index}:${percent}:${heldBits}:${flashing}:${ctx.dragLook}:${this.note}:${this.liveText}:${this.lookHint}`;
    if (this.htmlKey === key) return this.cachedHtml;
    this.htmlKey = key;
    const k = this.keyFn;
    const l = this.lesson;
    const first = this.starts[l];
    const count = this.lessons[l].steps.length;
    const dots = Array.from({ length: count }, (_, i) => `<i class="${first + i < this.index ? 'on' : first + i === this.index ? 'now' : ''}"></i>`).join('');
    const enterBound = Object.values(this.settings.bindings).some((codes) => codes.includes('Enter'));
    const pause = `<kbd>${k('pause')}</kbd> 暂停`;
    const foot = step.manual
      ? `${ctx.touch ? '点一下屏幕' : enterBound ? '点击鼠标' : '按 <kbd>回车</kbd> 或点击鼠标'}继续 · ${pause}`
      : `${ctx.touch || enterBound ? '可在暂停菜单跳过这一步' : '<kbd>回车</kbd> 跳过这一步'} · ${pause}`;
    const big = (step.keys ?? []).map((a) => `<kbd class="big ${ctx.held(a) ? 'on' : ''}">${k(a)}</kbd>`).join('');
    this.cachedHtml =
      `<div class="tut-head"><span class="tut-lesson">第 ${l + 1} 课 · ${this.lessons[l].title}</span><span class="tut-dots">${dots}</span></div>` +
      `<div class="tut-main"><div class="tut-body"><div class="tut-title">${step.title}</div>` +
      `<div class="tut-text">${step.text(k, ctx)}</div>` +
      (step.why ? `<div class="tut-why">${step.why(k)}</div>` : '') +
      (this.lookHint ? `<div class="tut-note">${this.lookHint}</div>` : '') +
      (this.note ? `<div class="tut-note">${this.note}</div>` : '') +
      (this.liveText ? `<div class="tut-live">${this.liveText}</div>` : '') +
      `</div>${big ? `<div class="tut-keys">${big}</div>` : ''}</div>` +
      (step.manual ? '' : `<div class="tut-bar"><i style="width:${percent}%"></i></div>`) +
      `<div class="tut-skip">${foot}</div>` +
      (flashing ? `<div class="tut-ok"><b>✓</b>${PRAISE[this.index % PRAISE.length]}</div>` : '');
    return this.cachedHtml;
  }
}
