// 手柄（标准布局，Xbox / PS 都是这个编号）：
//   左摇杆  前后 = 机头俯仰，左右 = 转向        右摇杆  转头看
//   LT / RT 下降 / 爬升（模拟量）               LB / RB 左 / 右平移
//   A 悬停  B 动力增强  X 换视角（休闲飞行）  Y 视角回正    菜单键 暂停  视图键 自动巡航
//   十字键 上 导航目标  下 HUD  左右 地图范围   按下右摇杆 截图
// 菜单里：十字键或左摇杆移动焦点，A 确认，B 返回。

export type PadEdge = 'hover' | 'boost' | 'view' | 'center' | 'pause' | 'cruise' | 'nav' | 'hud' | 'mapRange' | 'photo';
export type PadNav = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

const DEAD = 0.14;
const STICK_NAV = 0.6;
/** 按住方向键多久开始连发、连发的间隔（秒） */
const REPEAT_WAIT = 0.38;
const REPEAT_EVERY = 0.13;

/** 按钮编号 → 飞行中的动作 */
const EDGES: Array<[number, PadEdge]> = [
  [0, 'hover'],
  [1, 'boost'],
  [2, 'view'],
  [3, 'center'],
  [8, 'cruise'],
  [9, 'pause'],
  [11, 'photo'],
  [12, 'nav'],
  [13, 'hud'],
  [14, 'mapRange'],
  [15, 'mapRange'],
];

/** 死区之外重新铺满 0..1，中间软一些：小幅修正要细，推到底才是全量 */
export function shape(v: number): number {
  const a = Math.abs(v);
  if (a <= DEAD) return 0;
  const k = Math.min(1, (a - DEAD) / (1 - DEAD));
  return Math.sign(v) * (0.4 * k + 0.6 * k * k);
}

export class PadReader {
  connected = false;
  name = '';
  /** 这一帧的模拟量（-1..1） */
  forward = 0;
  turn = 0;
  lateral = 0;
  vertical = 0;
  lookX = 0;
  lookY = 0;
  private held: boolean[] = [];
  private navDir: PadNav | null = null;
  private navT = 0;
  private motor: { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> } | null = null;

  /** 读一次手柄。inMenu：方向键和 A、B 用来走菜单，不是飞行动作 */
  poll(dt: number, inMenu: boolean, edge: (a: PadEdge) => void, nav: (d: PadNav) => void): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    // 只认标准布局：方向盘、飞行摇杆、踏板也报成手柄，它们的轴静止时可能在 ±1，接上就等于有人一直推着杆
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard' && p.buttons.length >= 10) ?? null;
    if (!pad) {
      if (this.connected) this.reset();
      return;
    }
    this.connected = true;
    this.name = pad.id;
    this.motor = (pad as unknown as { vibrationActuator?: PadReader['motor'] }).vibrationActuator ?? null;
    const ax = (i: number): number => pad.axes[i] ?? 0;
    const val = (i: number): number => pad.buttons[i]?.value ?? 0;
    const on = (i: number): boolean => !!pad.buttons[i]?.pressed;
    this.forward = shape(-ax(1));
    this.turn = shape(ax(0));
    this.lookX = shape(ax(2));
    this.lookY = shape(ax(3));
    this.lateral = (on(5) ? 1 : 0) - (on(4) ? 1 : 0);
    this.vertical = val(7) - val(6);
    const pressed = (i: number): boolean => on(i) && !this.held[i];
    if (inMenu) {
      if (pressed(0)) nav('ok');
      if (pressed(1)) nav('back');
      if (pressed(9)) edge('pause');
      this.moveFocus(dt, on, ax, nav);
    } else {
      for (const [i, a] of EDGES) if (pressed(i)) edge(a);
      this.navDir = null;
    }
    this.held = pad.buttons.map((b) => b.pressed);
  }

  /** 撞了一下：strength 0..1 */
  rumble(strength: number): void {
    const k = Math.min(1, Math.max(0, strength));
    void this.motor?.playEffect?.('dual-rumble', { duration: 120 + 260 * k, strongMagnitude: k, weakMagnitude: 0.3 + 0.5 * k })?.catch(() => {});
  }

  private moveFocus(dt: number, on: (i: number) => boolean, ax: (i: number) => number, nav: (d: PadNav) => void): void {
    const dir: PadNav | null = on(12) || ax(1) < -STICK_NAV ? 'up' : on(13) || ax(1) > STICK_NAV ? 'down' : on(14) || ax(0) < -STICK_NAV ? 'left' : on(15) || ax(0) > STICK_NAV ? 'right' : null;
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navT = REPEAT_WAIT;
      if (dir) nav(dir);
      return;
    }
    if (!dir) return;
    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = REPEAT_EVERY;
      nav(dir);
    }
  }

  private reset(): void {
    this.connected = false;
    this.forward = this.turn = this.lateral = this.vertical = this.lookX = this.lookY = 0;
    this.held = [];
    this.navDir = null;
    this.motor = null;
  }
}
