// 手柄（标准布局，Xbox / PS 都是这个编号）：
//   左摇杆  前后 = 机头俯仰，左右 = 转向        右摇杆  转头看
//   LT / RT 下降 / 爬升（模拟量）               LB / RB 左 / 右平移
//   A 悬停  B 动力增强  X 换视角（休闲飞行）  Y 视角回正    菜单键 暂停  视图键 自动巡航
//   十字键 上 导航目标  下 HUD  左右 地图范围   按下右摇杆 截图  按下左摇杆 配平（超仿真）
//   超仿真：屏幕中间有准星，对准开关按 A 往前拨、X 往回拨，按住转旋钮（App.simControls）
//   教学的说明页：A 翻页
// 菜单里：十字键或左摇杆移动焦点，A 确认，B 返回，右摇杆上下滚动长页面。
// 拍照模式（'panel'）：摇杆、扳机、肩键照旧管机位，十字键和 A 走下面那排面板。
// 接了好几个手柄时跟着最后有人动的那个；不是标准布局的设备（方向盘、飞行摇杆）不认，但告诉玩家一声。

export type PadEdge = 'hover' | 'boost' | 'view' | 'center' | 'pause' | 'cruise' | 'nav' | 'hud' | 'mapRange' | 'photo' | 'trim';
export type PadNav = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';
/** menu：在菜单里；fly：在飞；panel：拍照模式（十字键和 A 给面板，其余照飞行） */
export type PadMode = 'menu' | 'fly' | 'panel';

const DEAD = 0.14;
/** 摇杆推过这么多才算“玩家在用手柄”：静止时漂一点不算 */
const USED = 0.3;
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
  [10, 'trim'],
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
  /** 这一帧玩家动了手柄（按了键或推了摇杆）：提示里的键名换成手柄上的 */
  used = false;
  /** 手柄接上（true）或断开（false） */
  onConnection: ((connected: boolean, name: string) => void) | null = null;
  /** 接着一个认不出布局的设备（每个设备只报一次） */
  onIgnored: ((name: string) => void) | null = null;
  private held: boolean[] = [];
  private navDir: PadNav | null = null;
  private navT = 0;
  private motor: { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> } | null = null;
  private ignored = new Set<string>();
  private index = -1;

  /** 读一次手柄。mode：menu 方向键和 A、B 走菜单；panel 十字键和 A 走拍照面板；fly 全是飞行动作 */
  poll(dt: number, mode: PadMode, edge: (a: PadEdge) => void, nav: (d: PadNav) => void): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const list = [...pads].filter((p): p is Gamepad => !!p && p.connected);
    // 只认标准布局：方向盘、飞行摇杆、踏板也报成手柄，它们的轴静止时可能在 ±1，接上就等于有人一直推着杆
    const std = list.filter((p) => p.mapping === 'standard' && p.buttons.length >= 10);
    for (const p of list) {
      if (std.includes(p) || this.ignored.has(p.id)) continue;
      this.ignored.add(p.id);
      this.onIgnored?.(p.id);
    }
    // 接了好几个：跟着最后有人动的那个（timestamp 是它最后一次有输入的时间），都没动就还用原来那个
    let pad = std.find((p) => p.index === this.index) ?? std[0] ?? null;
    for (const p of std) if (pad && p.timestamp > pad.timestamp && (p.buttons.some((b) => b.pressed) || p.axes.some((v) => Math.abs(v) > USED))) pad = p;
    this.used = false;
    if (!pad) {
      if (this.connected) {
        const name = this.name;
        this.reset();
        this.onConnection?.(false, name);
      }
      return;
    }
    const fresh = !this.connected;
    // 换了一个手柄：上一个手柄按着的键不算到这一个头上（这一个上正按着的，就是让它接手的那一下，照常算）
    if (pad.index !== this.index) {
      this.held = [];
      this.navDir = null;
    }
    this.index = pad.index;
    this.connected = true;
    this.name = pad.id;
    if (fresh) this.onConnection?.(true, pad.id);
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
    this.used = pad.buttons.some((b) => b.pressed) || pad.axes.some((v) => Math.abs(v) > USED);
    const pressed = (i: number): boolean => on(i) && !this.held[i];
    if (mode === 'menu') {
      if (pressed(0)) nav('ok');
      if (pressed(1)) nav('back');
      if (pressed(9)) edge('pause');
      this.moveFocus(dt, on, ax, nav, true);
    } else {
      // 拍照面板：A 和十字键给面板，其余的键照飞行（B 加速、Y 倾斜回正、视图键收面板……）
      for (const [i, a] of EDGES) if (pressed(i) && !(mode === 'panel' && (i === 0 || i >= 12))) edge(a);
      if (mode === 'panel') {
        if (pressed(0)) nav('ok');
        this.moveFocus(dt, on, ax, nav, false);
      } else this.navDir = null;
    }
    this.held = pad.buttons.map((b) => b.pressed);
  }

  /** 这个键现在按着没有（标准布局的编号） */
  down(i: number): boolean {
    return !!this.held[i];
  }

  /** 撞了一下：strength 0..1 */
  rumble(strength: number): void {
    const k = Math.min(1, Math.max(0, strength));
    void this.motor?.playEffect?.('dual-rumble', { duration: 120 + 260 * k, strongMagnitude: k, weakMagnitude: 0.3 + 0.5 * k })?.catch(() => {});
  }

  /** stick：左摇杆也能走（菜单里）；拍照面板只认十字键，左摇杆在挪机位 */
  private moveFocus(dt: number, on: (i: number) => boolean, ax: (i: number) => number, nav: (d: PadNav) => void, stick: boolean): void {
    const s = stick ? ax : () => 0;
    const dir: PadNav | null = on(12) || s(1) < -STICK_NAV ? 'up' : on(13) || s(1) > STICK_NAV ? 'down' : on(14) || s(0) < -STICK_NAV ? 'left' : on(15) || s(0) > STICK_NAV ? 'right' : null;
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
    this.index = -1;
    this.forward = this.turn = this.lateral = this.vertical = this.lookX = this.lookY = 0;
    this.held = [];
    this.navDir = null;
    this.motor = null;
  }
}
