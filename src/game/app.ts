// 游戏总控：界面状态机、渲染循环、固定步长仿真（1/60 s，渲染插值）、暂停/后台处理、事件反馈、存档。

import * as THREE from 'three';
import { AudioEngine } from '../audio/audio';
import { REAL_MAPS, MAPS, CAMPAIGN, getMap } from '../maps/index';
import type { MapDef } from '../maps/types';
import { CAUSE_LABEL } from '../sim/damage';
import { GRADE_LABEL } from '../sim/mission';
import { computeScore } from '../sim/scoring';
import { copyBody, GameSession, newBody, STEP, type GameEvent } from '../sim/session';
import type { BodyState } from '../sim/flight';
import { ScenicCruise, vistasOf } from '../sim/cruise';
import { FixedStepper } from '../core/stepper';
import { WorldView } from '../render/worldView';
import { DEFAULT_PITCH } from '../render/cameraRig';
import type { InstrumentData } from '../render/instruments';
import { Hud } from '../ui/hud';
import { downloadRealFiles } from '../world/realData';
import { UI } from '../ui/menus';
import { generateWorld, type WorldData } from '../world/worldgen';
import type { AssistId } from '../config/flight';
import { Input } from './input';
import { SaveStore, type StorageLike } from './save';
import { keyName, QUALITY, usePadNames, useTouchNames, type Settings } from './settings';
import { TouchControls, touchOnly } from '../ui/touchControls';
import { clamp, damp } from '../core/math';
import { PHOTO_FOV } from '../render/cameraRig';
import { wallDistances } from '../sim/echo';
import { directionTo, PlaceWatcher, placesOf } from './places';
import { FlightTape, REPLAY_MIN } from './replay';
import { LOOK } from '../render/post';
import { PhotoPanel } from '../ui/photoPanel';
import { ReplayPanel } from '../ui/replayPanel';
import { markPadFocus, padNavigate, padScroll, panelNavigate } from '../ui/padNav';
import { blocked, GPS_RANGES, operate, PressQueue, readout, type ActEnv, type ReadEnv } from '../sim/controls';
import { SimPanel } from '../ui/simPanel';
import type { Spot } from '../render/cockpitControls';
import { medalRows, newMedals, type MedalWorld } from './medals';
import { LESSONS, Tutorial, type TutorialCtx } from './tutorial';
import { SIM_LESSONS } from './simTutorial';
import { isTimeOfDay, type TimeOfDay } from '../render/timeOfDay';
import { waitForOperation } from './pending';
import { InstrumentLists } from './instrumentLists';
import { nextView } from './views';

/** claude.ai 的私有试玩页（Artifact）放不下大峡谷的数据（单个文件超过 20 MiB），那里不列出真实地形的地图（见 tools/artifact-page.mjs） */
const PLAYABLE_REAL_MAPS = (globalThis as { __artifact?: boolean }).__artifact ? [] : REAL_MAPS;

type State = 'boot' | 'menu' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed' | 'result' | 'disposed';

/** 正在放回放：放完把这些写回去，物理接着从原来的地方走 */
interface ReplayRun {
  t: number;
  seg: number;
  hold: boolean;
  speed: number;
  panel: ReplayPanel;
  body: BodyState;
  rpm: number;
  thrust: number;
  airspeed: number;
  view: 'cockpit' | 'chase' | 'cinema';
  done: () => void;
}

const _tapeFrame = { rpm: 0, thrust: 0, airspeed: 0 };

interface RunConfig {
  map: MapDef;
  weather: string;
  assist: AssistId;
  tutorial: boolean;
  /** 教学从第几课开始 */
  lesson?: number;
  /** 哪一门课：基础飞行还是超仿真 */
  course?: Course;
  /** 休闲模式：没有任务，随便飞 */
  free?: boolean;
  /** 时段（只影响画面） */
  time?: TimeOfDay;
}

type Course = 'flight' | 'sim';

const _spotPos = new THREE.Vector3();
const _screen = { x: 0, y: 0, behind: false };
const _wB = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

// 显卡名称：WebGL2 后端是驱动报告的型号（如 “NVIDIA GeForce RTX 4070”）；
// WebGPU 后端只给厂商与架构（如 “nvidia blackwell”），所以两种写法都要能识别。
const isIntegrated = (gpu: string) =>
  (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d+ Graphics|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu) && !/Arc|xe-hpg|alchemist|battlemage/i.test(gpu)) ||
  /^intel gen-|^intel xe-lp/i.test(gpu);

/** 超仿真的默认视线：比平时低一点，仪表板和自己的手都在视野里 */
const SIM_PITCH = -0.2;

/** 按显卡挑默认画质：近几代独立显卡“极高”，其他独立显卡“高”，集成显卡/软件渲染“低”，其余“中” */
function pickQuality(gpu: string): Settings['quality'] {
  if (/RTX ?[3-9]\d|RX ?[6-9]\d|nvidia (ampere|lovelace|ada|blackwell|rubin)|amd rdna-?[3-9]/i.test(gpu)) return 'ultra';
  if (/RTX|GTX 1[6-9]|GTX [2-9]\d|Radeon RX ?[5-9]|Apple M[1-9]|Arc A[57]|nvidia (turing|ampere|lovelace|ada|blackwell|hopper|rubin)|amd rdna-?[2-9]|apple metal-?3|xe-hpg|battlemage/i.test(gpu)) return 'high';
  if (isIntegrated(gpu)) return 'low';
  return 'medium';
}

/** 浏览器跑在集成显卡上时的提示（笔记本常见：有独显但浏览器默认用核显） */
function gpuWarning(gpu: string): string | null {
  if (!isIntegrated(gpu)) return null;
  return '浏览器当前使用集成显卡（' + gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 60) + '），画面可能卡顿。电脑有独立显卡时：Windows 设置 → 系统 → 屏幕 → 显示卡，把浏览器设为“高性能”，重启浏览器即可。';
}


export class App {
  readonly save: SaveStore;
  settings: Settings;
  readonly view: WorldView;
  readonly ui: UI;
  readonly hud: Hud;
  readonly input: Input;
  readonly audio = new AudioEngine();
  state: State = 'boot';
  session: GameSession | null = null;
  world: WorldData | null = null;
  run: RunConfig | null = null;
  tutorial: Tutorial | null = null;
  /** 固定步长推进（与帧率无关；超长帧截断） */
  private stepper = new FixedStepper(STEP, 6, 0.1);
  private last = 0;
  private t = 0;
  private idleAngle = 0;
  private tutBox: HTMLDivElement;
  private failTimer = -1;
  private completeTimer = -1;
  private lastBlocked = -10;
  private readonly lifetime = new AbortController();
  private disposed = false;
  private pendingOperations = 0;
  private viewDisposed = false;
  private frameId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly idlePose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 34 };
  /** 主菜单的并行编译（见 warmMenu） */
  private menuWarm: { cancel(): void } | null = null;
  private readonly instrumentLists = new InstrumentLists();
  private loadingRun = false;
  private loadWarning: string | null = null;
  /** 休闲模式的自动巡航 */
  private cruise: ScenicCruise | null = null;
  private touch: TouchControls | null = null;
  /** 接着、但认不出布局的设备（方向盘、飞行摇杆）：进飞行时说一次 */
  private ignoredPad: string | null = null;
  private ignoredPadTold = false;
  /** 浏览器的“返回”（手机的返回键、鼠标侧键）先当暂停用：飞行时在历史里垫了一格 */
  private backArmed = false;
  /** 拿着手柄时框着的那个控件（焦点变了就挪框） */
  private padMarked: Element | null = null;
  /** 回放里上一帧有没有按着：退/进 5 秒（Q、E，LB、RB）、空格暂停，按一下算一次 */
  private replaySideHeld = false;
  private replaySpaceHeld = false;
  private medalInfo: MedalWorld | null = null;
  private medalT = 0;
  private photoPending = false;
  /** 电影镜头里耳朵离飞机多远、飞机朝耳朵过来的速度 */
  private far = 0;
  private closing = 0;
  /** 左右山壁的距离（一秒算四次，给回声用） */
  private echo: readonly [number, number] = [0, 0];
  private echoT = 0;
  /** 拍照模式开着的时候是它的面板 */
  private photoPanel: PhotoPanel | null = null;
  /** 超仿真的人眼景深 */
  private eyeDof = false;
  /** 一路录着，回头用电影镜头放 */
  private readonly tape = new FlightTape();
  private replay: ReplayRun | null = null;
  /** 休闲飞行：飞到了哪里（只有休闲模式有） */
  private placeWatch: PlaceWatcher | null = null;
  private placeT = 0;
  private tutorialHtml = '';
  private readonly tutorialCtx: TutorialCtx = { yaw: 0, pitch: 0, held: (a) => this.input.is(a), dragLook: false };
  private controlHintHtml = '';
  /** 上次提示“任务里只用座舱视角”的时间（连按不叠一串提示） */
  private viewLockToastT = -1e9;
  private frames = 0;
  private fpsT = 0;
  private lowFps = 0;
  /** 超仿真 */
  private simPanel: SimPanel | null = null;
  private checklistDone = false;
  private autoStart = false;
  private autoT = 0;
  private dragAcc = 0;
  /** 超仿真用手柄：屏幕中间的准星对着的控件（A 往前拨、X 往回拨） */
  private padSpot: Spot | null = null;
  /** 手柄按住 A / X 转旋钮：按了多久、下一下还差多久 */
  private padHoldT = 0;
  private padRepeatT = 0;
  private padReticle: HTMLDivElement | null = null;
  /** 点了、手还没碰到的控件 */
  private readonly presses = new PressQueue<Spot>();
  /** 灯测试按一下也要亮一会儿 */
  private lampT = 0;
  private rect: DOMRect | null = null;
  fps = 0;
  /** 实际使用的显卡名称（renderer.init() 之后才知道） */
  gpu = '';

  constructor(private readonly root: HTMLElement, storage?: StorageLike | null) {
    // A constructor that throws never reaches main.ts's currentApp assignment.
    // Roll back completed owners here so failed startup cannot retain a renderer
    // or input callbacks that still receive events behind the recovery screen.
    const rollback: Array<() => void> = [() => this.audio.dispose()];
    try {
      this.save = new SaveStore(storage);
      this.settings = this.save.data.settings;
      this.audio.applyVolumes({ master: this.settings.volMaster, engine: this.settings.volEngine, ambience: this.settings.volAmbience, alerts: this.settings.volAlerts, music: this.settings.volMusic });
      const canvas = this.canvas = document.createElement('canvas');
      rollback.push(() => canvas.remove());
      canvas.className = 'gl';
      root.appendChild(canvas);
      this.view = new WorldView(canvas, this.settings);
      rollback.push(() => this.view.dispose());
      this.hud = new Hud(root);
      rollback.push(() => this.hud.dispose());
      this.hud.setOpacity(this.settings.hudOpacity);
      this.hud.onFork = (i) => {
        if (this.state === 'playing') this.session?.preferRoute(i);
      };
      this.tutBox = document.createElement('div');
      rollback.push(() => this.tutBox.remove());
      this.tutBox.className = 'tutorial hidden';
      root.appendChild(this.tutBox);
      this.ui = new UI(root);
      rollback.push(() => this.ui.dispose());
      this.ui.onClick = () => this.audio.click();
      this.ui.keys = (a) => keyName(this.settings.bindings[a][0] ?? '');
      this.input = new Input(canvas, this.settings);
      rollback.push(() => this.input.dispose());
      this.input.onEdge = (a, fromPad) => this.onEdge(a, fromPad);
      this.input.onPadNav = (d) => {
        // 拍照模式：十字键和 A 走下面那排面板；其他时候走菜单
        if (this.photoPanel && this.input.padPanel) panelNavigate(this.photoPanel.element, d, '[data-k="lens"]');
        else padNavigate(this.root, d);
      };
      this.input.onDevice = (d) => this.onDevice(d);
      this.input.onPadConnection = (connected) => this.onPadConnection(connected);
      this.input.pad.onIgnored = (name) => {
        // 方向盘、飞行摇杆、老式手柄：浏览器没按标准布局报，读不了它的键。进了飞行再说一声（菜单里没有提示条）
        this.ignoredPad = name;
        if (this.state === 'playing') this.tellIgnoredPad();
      };
      if (touchOnly()) this.setupTouch(rollback);
      this.input.onLockChange = (locked) => {
        if (!locked && this.state === 'playing' && !this.input.lockFailed) this.pause();
      };
      this.view.onThunder = (delay, strength) => this.audio.thunder(delay, strength);
      this.view.onGpuLost = () => {
        // 画面再也回不来了：存好进度，告诉玩家发生了什么，别让人对着一张定格的图
        this.save.save();
        this.audio.suspend();
        this.input.active = false;
        this.input.exitLock();
        this.ui.gpuLost?.(() => location.reload());
      };
      const listenerOptions = { signal: this.lifetime.signal };
      window.addEventListener('resize', () => {
        this.rect = null;
        this.view.resize();
        this.hud.resize();
      }, listenerOptions);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.flushSettingsSave();
          if (this.state === 'playing') this.pause();
          this.audio.suspend();
        } else if (this.state !== 'playing') this.audio.resume();
      }, listenerOptions);
      window.addEventListener('blur', () => {
        // Drag-to-look browsers do not emit pointerlockchange on Alt+Tab.
        // Losing the window must still leave the aircraft safely paused.
        if (this.state === 'playing') this.pause();
      }, listenerOptions);
      window.addEventListener('popstate', () => this.onBrowserBack(), listenerOptions);
      window.addEventListener('beforeunload', (e) => {
        this.flushSettingsSave();
        if (this.state === 'playing' || this.state === 'paused') {
          e.preventDefault();
          e.returnValue = '';
        }
      }, listenerOptions);
      // 教学的说明页：点一下鼠标也算看完了
      window.addEventListener('mousedown', () => {
        if (this.state === 'playing' && this.tutorial && this.session) this.tutorial.click(this.session);
      }, listenerOptions);
      window.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.isComposing) return;
        if (e.code === 'Enter' && !e.repeat && this.state === 'playing' && this.tutorial && this.session) {
          this.tutorial.skip(this.session);
          e.preventDefault();
        }
        if (e.code === 'F3') {
          if (!e.repeat) this.hud.showDebug = !this.hud.showDebug;
          e.preventDefault();
        }
      }, listenerOptions);
      this.hud.resize();
    } catch (error) {
      this.lifetime.abort();
      for (const release of rollback.reverse()) {
        try { release(); } catch (cleanupError) { console.warn('启动失败后的资源清理未完成', cleanupError); }
      }
      throw error;
    }
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.startPromise ??= this.startTracked();
  }

  private async startTracked(): Promise<void> {
    this.pendingOperations++;
    try {
      await this.startApp();
    } finally {
      this.finishOperation();
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('游戏实例已停止');
  }

  private finishOperation(): void {
    this.pendingOperations--;
    if (this.disposed && this.pendingOperations === 0) this.disposeView();
  }

  private disposeView(): void {
    if (this.viewDisposed) return;
    this.viewDisposed = true;
    this.view.dispose();
  }

  /** Stop owned callbacks immediately; let in-flight construction settle before freeing the renderer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state = 'disposed';
    this.flushSettingsSave();
    this.lifetime.abort();
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.input.onEdge = this.input.onLockChange = this.input.onPadNav = null;
    this.input.onDevice = this.input.onPadConnection = null;
    usePadNames(null);
    this.replay?.panel.dispose();
    this.replay = null;
    this.view.onThunder = null;
    this.input.dispose();
    this.audio.dispose();
    this.session?.dispose();
    this.session = null;
    this.world = null;
    this.run = null;
    this.tutorial = null;
    this.ui.dispose();
    this.hud.dispose();
    this.tutBox.remove();
    this.photoPanel?.dispose();
    this.simPanel?.dispose();
    this.canvas.remove();
    if (this.pendingOperations === 0) this.disposeView();
  }

  private async startApp(): Promise<void> {
    // 先初始化 GPU（WebGPU，不可用时自动退回 WebGL2），再按显卡选默认画质
    await this.view.init();
    this.assertActive();
    this.gpu = this.view.gpuInfo().name;
    if (this.save.fresh || this.save.requalify) {
      // （手机的显卡名字看不出好坏，先从低档开始）
      this.settings.quality = this.touch ? 'low' : pickQuality(this.gpu);
      this.settings.rayTracing = this.settings.quality === 'high' || this.settings.quality === 'ultra';
      this.view.applySettings(this.settings);
      this.save.save();
    }
    const params = new URLSearchParams(location.search);
    const auto = [...MAPS, ...PLAYABLE_REAL_MAPS].find((m) => m.id === params.get('map'));
    if (!auto) {
      // 菜单背景：训练场的黄昏
      this.view.setTimeOfDay('dusk');
      const home = getMap('training');
      this.ui.loading('生成地形', 0.1, home);
      const w = await generateWorld(home, true, (p, l) => this.ui.loading(l, p * 0.9, home));
      this.assertActive();
      await this.view.load(w, (p, l) => this.ui.loading(l, p, home));
      this.assertActive();
      this.world = w;
      const pad = w.pads.get(w.map.spawn.padId)!;
      this.view.heli.root.position.set(pad.pos[0], pad.pos[1] + 1.32, pad.pos[2]);
      this.view.heli.root.quaternion.identity();
    }
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
    if (auto) {
      const m = auto;
      const tp = params.get('time');
      const assist = params.get('assist');
      const weather = m.weathers.find((w) => w.id === params.get('weather'))?.id ?? m.defaultWeather;
      await this.startRun({ map: m, weather, assist: assist === 'novice' || assist === 'standard' || assist === 'challenge' || assist === 'sim' ? assist : this.settings.assist, tutorial: auto.id === 'training' && params.get('tutorial') !== '0' && params.get('free') !== '1', lesson: Number(params.get('lesson') ?? 0) || 0, course: assist === 'sim' ? 'sim' : 'flight', free: params.get('free') === '1' || !!m.real, time: isTimeOfDay(tp) ? tp : 'day' });
      if (params.get('autostart') === '1') this.beginFlight();
    } else {
      this.mainMenu();
      void this.warmMenu();
    }
  }

  // ---------------- 调试 / 自动化测试接口 ----------------

  debugTeleport(x: number, y: number, z: number, heading: number, speed = 0): void {
    this.session?.teleport(x, y, z, heading, speed);
  }

  /** 模拟按住按键 ms 毫秒（通过真实的键盘事件路径）。 */
  async debugHold(codes: string[], ms: number): Promise<void> {
    for (const c of codes) window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    await new Promise((r) => setTimeout(r, ms));
    for (const c of codes) window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
  }

  debugLook(yaw: number, pitch: number): void {
    this.view.rig.yaw = yaw;
    this.view.rig.pitch = pitch;
  }

  debugState(): Record<string, unknown> {
    const s = this.session;
    if (!s) return { state: this.state };
    return {
      state: this.state,
      sim: s.state,
      t: +s.t.toFixed(1),
      pos: [s.body.pos.x, s.body.pos.y, s.body.pos.z].map((v) => +v.toFixed(1)),
      agl: +s.agl.toFixed(1),
      gs: +s.groundSpeed.toFixed(1),
      dur: +s.damage.durability.toFixed(1),
      obj: s.mission.current()?.def.id ?? 'done',
      nav: s.nav.info.label,
      fps: +this.fps.toFixed(0),
      render: this.view.info(),
    };
  }

  // ---------------- 界面流程 ----------------

  mainMenu(): void {
    this.state = 'menu';
    this.refreshControlHint();
    this.hud.show(false);
    this.tutBox.classList.add('hidden');
    this.input.active = false;
    this.input.clear();
    this.input.cancelCapture();
    this.input.exitLock();
    this.ui.main(
      { warning: [this.loadWarning, gpuWarning(this.gpu), this.save.warning].filter(Boolean).join('<br>') || null, tutorialDone: this.save.data.tutorialDone },
      {
        play: () => this.mapSelect(),
        free: () => this.freeSelect(),
        tutorial: () => this.trainingMenu(),
        settings: () => this.openSettings(),
        help: () => this.ui.help(this.settings.bindings),
        about: () => this.ui.about(),
        log: () => this.openLog(),
      },
    );
  }

  private openLog(): void {
    const all = [...MAPS, ...REAL_MAPS];
    this.ui.logbook({
      ...this.save.data.log,
      maps: all.map((m) => ({ name: m.name, been: this.save.data.visited[m.id]?.length ?? 0, total: placesOf(m).length, rating: this.save.data.maps[m.id]?.bestRating ?? '' })),
      medals: medalRows(this.save.data, this.medalWorld()),
    });
  }

  private medalWorld(): MedalWorld {
    return (this.medalInfo ??= {
      lessons: LESSONS.length,
      simLessons: SIM_LESSONS.length,
      missions: MAPS.filter((m) => m.id !== 'training').map((m) => ({ id: m.id, optional: m.mission.optional.map((o) => o.id) })),
      places: [...MAPS, ...REAL_MAPS].map((m) => ({ id: m.id, total: placesOf(m).length })),
    });
  }

  /** 看看有没有新拿到的勋章：落地、到了新地方、每隔一会儿。结算页自己写在页面上 */
  private checkMedals(): void {
    const got = newMedals(this.save.data, this.medalWorld());
    if (!got.length) return;
    this.save.save();
    for (const m of got) this.hud.toast(`获得勋章：${m.name}（${m.how}）`, 'good', 5000);
    this.audio.checkpoint();
  }

  /** 飞行训练的课程表：从头学，或者直接选一课 */
  trainingMenu(course: Course = 'flight'): void {
    this.state = 'menu';
    const sim = course === 'sim';
    this.ui.training(sim ? SIM_LESSONS : LESSONS, sim ? this.save.data.simLessonsDone : this.save.data.lessonsDone, course, {
      start: (lesson) => void this.startRun({ map: getMap('training'), weather: 'clear', assist: sim ? 'sim' : 'novice', tutorial: true, lesson, course }),
      course: (c) => this.trainingMenu(c),
      back: () => this.mainMenu(),
    });
  }

  /** 休闲飞行：选地图 → 选时段和天气 → 直接在空中开始 */
  freeSelect(): void {
    this.state = 'menu';
    const list = [...CAMPAIGN.filter((id) => MAPS.find((m) => m.id === id)).map((id) => getMap(id)), getMap('training')];
    const seen = (m: MapDef) => {
      const total = placesOf(m).length;
      const n = this.save.data.visited[m.id]?.length ?? 0;
      return n === 0 ? `${total} 个地方等你去` : n >= total ? `${total} 个地方都到过了` : `到过 ${n} / ${total} 个地方`;
    };
    this.ui.mapSelect([...PLAYABLE_REAL_MAPS, ...list], {}, { pick: (m) => this.freeBrief(m), back: () => this.mainMenu() }, true, seen);
  }

  freeBrief(m: MapDef): void {
    const been = this.save.data.visited[m.id] ?? [];
    this.ui.freeBrief(m, this.settings, vistasOf(m).map((v) => `${been.includes(v.name) ? '✓ ' : ''}${v.name}`), {
      start: (weather, time, sim) => void this.startRun({ map: m, weather, assist: sim ? 'sim' : 'novice', tutorial: false, free: true, time }),
      back: () => this.freeSelect(),
    });
  }

  mapSelect(): void {
    this.state = 'menu';
    const list = [...CAMPAIGN.filter((id) => MAPS.find((m) => m.id === id)).map((id) => getMap(id)), getMap('training')];
    // 训练场的正门是课程表
    this.ui.mapSelect(list, this.save.data.maps, { pick: (m) => (m.id === 'training' ? this.trainingMenu() : this.briefing(m)), back: () => this.mainMenu() });
  }

  briefing(m: MapDef): void {
    this.ui.briefing(m, this.save.data.maps[m.id], this.settings, {
      start: (weather, assist, time) => void this.startRun({ map: m, weather, assist, tutorial: false, time }),
      back: () => this.mapSelect(),
    });
  }

  openSettings(): void {
    this.ui.settings(this.settings, {
      change: (s) => this.applySettings(s),
      capture: (cb) => this.input.captureNextKey(cb),
      close: () => {
        this.input.cancelCapture();
        this.flushSettingsSave();
      },
    });
  }

  applySettings(s: Settings): void {
    if (this.disposed) return;
    this.settings = s;
    this.save.data.settings = s;
    this.view.applySettings(s);
    this.input.setSettings(s);
    this.tutorial?.setSettings(s);
    this.hud.setOpacity(s.hudOpacity);
    this.refreshControlHint();
    this.audio.applyVolumes({ master: s.volMaster, engine: s.volEngine, ambience: s.volAmbience, alerts: s.volAlerts, music: s.volMusic });
    // Sliders update the game immediately, but storage is synchronous and should
    // only receive the final value after a short pause or when leaving settings.
    if (this.settingsSaveTimer !== null) clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = setTimeout(() => this.flushSettingsSave(), 200);
  }

  private flushSettingsSave(): void {
    if (this.settingsSaveTimer === null) return;
    clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    this.save.save();
  }

  private refreshControlHint(): void {
    const k = (a: keyof Settings['bindings']) => keyName(this.settings.bindings[a][0]);
    const html = this.settings.hints && !this.tutorial && this.state === 'playing'
      ? this.input.sim
        ? this.input.device === 'pad'
          ? `准星对准开关 <kbd>A</kbd> 往前拨、<kbd>X</kbd> 往回拨，按住转旋钮 · <kbd>${k('trim')}</kbd> 配平 · <kbd>${k('hud')}</kbd> 显示 HUD · <kbd>${k('pause')}</kbd> 暂停`
          : `<kbd>${k('down')}</kbd> 下降 · <kbd>${k('boost')}</kbd> 动力增强 · <kbd>${k('trim')}</kbd> 配平 · <kbd>${k('hover')}</kbd> 增稳 · <kbd>${k('hud')}</kbd> 显示 HUD · <kbd>${k('pause')}</kbd> 暂停`
        : this.run?.free
        ? `<kbd>${k('cruise')}</kbd> 自动巡航 · <kbd>${k('view')}</kbd> 切换视角 · <kbd>${k('hud')}</kbd> 显示仪表 · <kbd>${k('photo')}</kbd> 截图 · <kbd>${k('pause')}</kbd> 换时段、天气、景点`
        : `<kbd>${k('hover')}</kbd> 悬停 · <kbd>${k('nav')}</kbd> 导航 · <kbd>${k('pause')}</kbd> 暂停`
      : '';
    if (html === this.controlHintHtml) return;
    this.controlHintHtml = html;
    this.hud.setHint(html);
  }

  /** 拿起手柄、碰到键盘鼠标：提示里的按键名跟着换（教学、提示条、路线说明都走 keyName） */
  private onDevice(d: 'keyboard' | 'pad'): void {
    usePadNames(d === 'pad' ? () => this.settings.bindings : null);
    this.root.classList.toggle('pad-active', d === 'pad');
    // 拿起手柄：现在焦点在哪就框在哪（不用先按一下方向键才看得见）；放下手柄：键盘有浏览器自己的焦点框
    this.padMarked = d === 'pad' ? document.activeElement : null;
    markPadFocus(this.padMarked);
    this.controlHintHtml = '';
    this.refreshControlHint();
  }

  /** 手柄接上、断开。飞着的时候用的就是手柄却断了（没电、线松了）：先暂停，别让飞机自己掉下去 */
  private onPadConnection(connected: boolean): void {
    if (this.state !== 'playing') return;
    if (connected) this.hud.toast('手柄已连接', 'info', 2200);
    else if (this.input.device === 'pad') {
      this.hud.toast('手柄断开了，已暂停', 'warn', 4000);
      this.pause();
    } else this.hud.toast('手柄断开了', 'info', 2200);
  }

  async startRun(cfg: RunConfig): Promise<void> {
    if (this.disposed || this.loadingRun) return;
    this.menuWarm?.cancel();
    this.menuWarm = null;
    this.pendingOperations++;
    this.loadingRun = true;
    this.loadWarning = null;
    this.failTimer = this.completeTimer = -1;
    this.input.active = false;
    this.input.clear();
    this.input.cancelCapture();
    this.input.exitLock();
    try {
      await this.loadRun(cfg);
    } catch (error) {
      if (this.disposed) return;
      console.error('关卡加载失败', error);
      this.session?.dispose();
      this.session = null;
      this.tutorial = null;
      // A partly loaded scene must be rebuilt on retry, even on the same map.
      this.world = null;
      this.audio.setAmbience({});
      this.loadWarning = '关卡未能加载完成。请稍后重新选择任务；也可以在设置中降低画质后重试。已保存的进度不受影响。';
      this.mainMenu();
    } finally {
      this.loadingRun = false;
      this.finishOperation();
    }
  }

  private async loadRun(cfg: RunConfig): Promise<void> {
    this.audio.init();
    this.audio.applyVolumes({ master: this.settings.volMaster, engine: this.settings.volEngine, ambience: this.settings.volAmbience, alerts: this.settings.volAlerts, music: this.settings.volMusic });
    this.state = 'loading';
    this.refreshControlHint();
    this.hud.show(false);
    this.tutBox.classList.add('hidden');
    this.session?.dispose();
    this.session = null;
    this.run = cfg;
    this.view.setTimeOfDay(cfg.time ?? 'day');
    if (!this.world || this.world.map.id !== cfg.map.id) {
      this.ui.loading('生成地形', 0.02, cfg.map);
      this.view.prefetch(cfg.map);
      // 真实地形的数据大：下载占进度条的前一半
      const dl = cfg.map.real ? 0.5 : 0;
      if (cfg.map.real) {
        await downloadRealFiles(cfg.map.real, (done, total) => this.ui.loading(`下载地形数据 ${Math.round(done / 1e6)} / ${Math.round(total / 1e6)} MB`, (done / total) * dl, cfg.map));
        this.assertActive();
      }
      const stage = (p: number, l: string): void => this.ui.loading(l, dl + p * (1 - dl), cfg.map);
      const w = await generateWorld(cfg.map, true, stage);
      this.assertActive();
      await this.view.load(w, stage);
      this.assertActive();
      this.world = w;
    }
    this.ui.loading('初始化物理', 0.98, cfg.map);
    // 人物模型先全部撤下（2026-11-08 用户：“还是把人物相关建模先全部去掉吧，这个我之后再想办法”）：
    // 不加载飞行员。超仿真里点控件就直接生效（useControl 在没有飞行员时不等手伸过去）
    this.eyeDof = cfg.assist === 'sim' && !cfg.tutorial;
    this.view.setDof?.(this.eyeDof);
    const session = await GameSession.create(this.world, cfg.weather, cfg.assist, cfg.free === true);
    if (this.disposed) {
      session.dispose();
      return;
    }
    this.session = session;
    // 先推进一个物理步（停在坪上，无副作用），让 HUD 在“点击开始”画面里就显示真实的密度、航点等数值
    this.session.step();
    this.session.drainEvents();
    this.tutorial = cfg.tutorial ? new Tutorial(this.settings, cfg.course === 'sim' ? SIM_LESSONS : LESSONS) : null;
    this.tutorialHtml = '';
    this.hud.setTutorial?.(null);
    this.hud.setFree?.(cfg.free === true);
    // 导航键只在任务里有：切换推荐路线、去可选任务（教学按课走，用不着）
    this.touch?.setFree(cfg.free === true, !cfg.free && !cfg.tutorial);
    this.hud.setCinema?.(false);
    this.cruise = null;
    this.tape.clear();
    this.placeWatch = cfg.free ? new PlaceWatcher(placesOf(cfg.map)) : null;
    this.placeT = 4;
    // 超仿真是冷舱启动，要停在坪上；休闲飞行直接从第一个景点开始
    if (cfg.free && cfg.assist !== 'sim') this.goToVista(session, 0);
    this.audio.setAmbience(cfg.map.ambience);
    this.stepper.reset();
    this.view.rig.setMode('cockpit');
    this.view.rig.yaw = 0;
    this.view.rig.pitch = cfg.assist === 'sim' ? SIM_PITCH : DEFAULT_PITCH;
    this.view.rig.zoom = 1;
    this.checklistDone = false;
    this.autoStart = false;
    this.presses.clear();
    this.state = 'ready';
    this.ui.loading('编译着色器（第一次进入会慢一些）', 0.99, cfg.map);
    await this.warmUp();
    this.assertActive();
    this.hud.show(true);
    this.applySim(cfg.assist === 'sim');
    const k = (a: keyof Settings['bindings']) => keyName(this.settings.bindings[a][0]);
    const pad = this.input.device === 'pad';
    const controls = !this.settings.hints
      ? ''
      : cfg.assist === 'sim'
        ? pad
          ? `<br>冷舱启动：照左上角的检查单操作，右摇杆转头，屏幕中间的准星对准按钮按 <kbd>A</kbd>（<kbd>X</kbd> 往回拨）· <kbd>左摇杆</kbd> 杆 · <kbd>RT</kbd>/<kbd>LT</kbd> 总距 · <kbd>${k('trim')}</kbd> 配平`
          : `<br>冷舱启动：照左上角的检查单操作，鼠标点按钮 · 鼠标移到屏幕边转头 · <kbd>${k('forward')}</kbd><kbd>${k('left')}</kbd><kbd>${k('back')}</kbd><kbd>${k('right')}</kbd> 杆 · <kbd>${k('up')}</kbd>/<kbd>${k('down')}</kbd> 总距 · <kbd>${k('boost')}</kbd> 动力增强 · <kbd>${k('trim')}</kbd> 配平`
        : pad
          ? `<br>按住 <kbd>${k('up')}</kbd> 起飞 · <kbd>左摇杆</kbd> 飞行 · <kbd>右摇杆</kbd> 观察 · <kbd>${k('pause')}</kbd> 暂停`
          : `<br>按住 <kbd>${k('up')}</kbd> 起飞 · <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('left')}</kbd><kbd>${k('right')}</kbd> 飞行 · 鼠标观察 · <kbd>${k('pause')}</kbd> 暂停`;
    this.ui.clickToStart(
      this.tutorial ? `第 ${(cfg.lesson ?? 0) + 1} 课 · ${this.tutorial.lessons[cfg.lesson ?? 0].title}` : cfg.free ? `休闲飞行 · ${cfg.map.name}` : cfg.map.name,
      cfg.tutorial ? '跟着屏幕下方的提示做，每次只学一个动作。' : cfg.free ? `没有任务，没有计时。想去哪儿就去哪儿，懒得飞就按 <kbd>${k('cruise')}</kbd> 让它自己飞。` : `${this.session.mission.current()?.def.title ?? ''}${controls}`,
      () => this.beginFlight(),
    );
  }

  /**
   * 主菜单第一次画实时场景要编译一批着色器（十几秒）。菜单这时已经能用，背后先放一张实拍画面，
   * 着色器并行编译，好了再淡入实时画面。玩家中途开始飞行时取消，交给 warmUp。
   */
  private async warmMenu(): Promise<void> {
    const v = this.view;
    const compiled = v.parallelCompile();
    if (!compiled) return;
    const art = document.createElement('div');
    art.className = 'menu-art';
    art.style.backgroundImage = "url('ui/map_training_bg.webp')";
    this.canvas?.parentElement?.insertBefore(art, this.canvas.nextSibling);
    this.menuWarm = { cancel: () => { compiled.cancel(); art.remove(); } };
    try {
      const target = v.frames + 4;
      const t0 = performance.now();
      while (v.frames < target && this.menuWarm && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 30));
      if (this.menuWarm) await compiled();
      v.refreshEnv?.();
      await new Promise((r) => setTimeout(r, 400));
    } catch (error) {
      console.warn('主菜单着色器预热失败：', error);
    }
    if (!this.menuWarm) return;
    this.menuWarm = null;
    compiled.cancel();
    art.classList.add('off');
    setTimeout(() => art.remove(), 1600);
  }

  /**
   * 等渲染管线全部编译完：强制全画几帧（第一帧就把所有管线提交了，体积雾等到阴影贴图建好才重建，所以多画几帧），
   * 这几帧里的管线并行编译；编译好之后再真的画几帧，最后等显卡把队列跑完。
   * 按帧数而不是帧时间判断，慢显卡上也不会白等；用定时器轮询，后台标签页里也能走完。
   */
  private async warmUp(): Promise<void> {
    const v = this.view;
    const frames = async (n: number): Promise<void> => {
      const target = v.frames + n;
      let observedFrames = v.frames;
      let lastCheck = performance.now();
      let stalledMs = 0;
      while (v.frames < target) {
        this.assertActive();
        const now = performance.now();
        if (document.hidden || v.frames !== observedFrames) stalledMs = 0;
        else stalledMs += now - lastCheck;
        observedFrames = v.frames;
        lastCheck = now;
        if (stalledMs >= 60000) throw new Error('画面预热无进展，请重试或降低画质');
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    v.setWarm(true);
    let compiled: ReturnType<WorldView['parallelCompile']> | null = null;
    try {
      compiled = v.parallelCompile();
      await frames(6);
      await waitForOperation(compiled(), this.lifetime.signal, 60000, '着色器编译');
      v.refreshEnv?.();
      await frames(3);
      await waitForOperation(v.gpuIdle(), this.lifetime.signal, 60000, '显卡准备');
    } finally {
      compiled?.cancel();
      v.setWarm(false);
    }
  }

  beginFlight(): void {
    if (!this.session || this.state !== 'ready') return;
    this.audio.init();
    this.ui.clear();
    this.state = 'playing';
    this.refreshControlHint();
    this.input.active = true;
    this.input.clear();
    this.input.requestLock();
    this.last = performance.now();
    this.stepper.reset();
    this.armBack();
    this.goFullscreen();
    if (this.ignoredPad) this.tellIgnoredPad();
    if (this.tutorial) {
      const s = this.session;
      const t = this.tutorial;
      // 每一课开头都是安全的状态（悬停或停在地面）：撞了回到这里
      t.onStep = (i) => {
        if (t.steps[i]?.anchor) s.saveCheckpoint('教学', true);
      };
      t.onLesson = (lesson) => {
        this.audio.success();
        const done = this.run?.course === 'sim' ? this.save.data.simLessonsDone : this.save.data.lessonsDone;
        if (!done.includes(lesson)) {
          done.push(lesson);
          this.save.save();
        }
      };
      t.start(s, this.run?.lesson ?? 0);
      this.tutBox.classList.remove('hidden');
      // 超仿真要低头看仪表板：卡片放到上面，别挡住开关
      this.tutBox.classList.toggle('top', this.run?.course === 'sim');
    }
    if (this.input.lockFailed && !this.input.pad.connected && !this.touch) this.hud.toast('鼠标锁定不可用：按住鼠标拖动或使用方向键观察', 'warn', 6000);
  }

  pause(): void {
    if (this.state !== 'playing' || !this.session) return;
    this.state = 'paused';
    this.refreshControlHint();
    this.input.active = false;
    this.input.clear();
    this.input.exitLock();
    this.simPanel?.hideTooltip();
    this.audio.update(this.audioState(true), 0);
    this.save.save();
    this.pauseMenu();
  }

  private pauseMenu(): void {
    if (!this.session) return;
    if (this.run?.free) {
      this.freePause();
      return;
    }
    this.ui.pause(
      // （教学里的安全点是自动的，玩家不用选）
      { tutorial: !!this.tutorial, checkpoints: this.tutorial ? [] : this.session.restoreOptions(), replay: this.tape.seconds >= REPLAY_MIN },
      {
        replay: () => this.replayFromPause(),
        resume: () => this.resume(),
        checkpoint: (i, mode) => this.restoreCheckpoint(i, mode),
        restart: () => void this.restart(),
        photo: () => this.openPhoto(),
        settings: () => this.openSettings(),
        help: () => this.ui.help(this.settings.bindings),
        quit: () => this.quitToMenu(),
        skipStep: () => {
          if (this.tutorial && this.session) this.tutorial.skip(this.session);
          this.resume();
        },
      },
    );
  }

  /** 休闲模式的暂停菜单：时段、天气、景点都在这里换 */
  private freePause(): void {
    const s = this.session;
    const run = this.run;
    if (!s || !run) return;
    const vistas = vistasOf(run.map);
    const places = placesOf(run.map);
    const been = this.save.data.visited[run.map.id] ?? [];
    const here = s.body?.pos;
    const todo = places.filter((p) => !been.includes(p.name));
    const unseen = todo.map((p) => (here ? `${p.name} · ${directionTo(here.x, here.z, p)}` : p.name));
    this.ui.freePause(
      { map: run.map, time: run.time ?? 'day', weather: s.weather.preset.id, vistas: vistas.map((v) => v.name), been, total: places.length, unseen, canGo: !s.sys, cruise: !!this.cruise, replay: this.tape.seconds >= REPLAY_MIN },
      {
        go: (i) => {
          const p = todo[i];
          this.cruise = new ScenicCruise(s, vistas, [p.x, p.z]);
          this.hud.toast(`自动巡航：去${p.name}。动任何一个飞行键就交回给你`, 'info', 3500);
          this.resume();
        },
        replay: () => this.replayFromPause(),
        resume: () => this.resume(),
        time: (t) => this.freeTime(t),
        weather: (id) => {
          s.weather.preset = run.map.weathers.find((w) => w.id === id) ?? s.weather.preset;
          s.weather.transitionTo(id, 5);
        },
        vista: (i) => {
          this.goToVista(s, i);
          this.resume();
        },
        cruise: () => {
          this.toggleCruise();
          this.resume();
        },
        photo: () => this.openPhoto(),
        settings: () => this.openSettings(),
        help: () => this.ui.help(this.settings.bindings),
        quit: () => this.quitToMenu(),
      },
    );
  }

  /** 撞了一下：镜头震，手柄也震 */
  private shake(strength: number): void {
    this.view.rig.kick(strength);
    this.input.pad?.rumble(strength);
    if (this.session) this.view.impactFx?.(this.session, strength);
    if (!this.replay) this.tape.mark(strength);
  }

  /** 电影镜头：耳朵在摄影机那里。声音跟着距离走，飞过的时候有多普勒 */
  private listenFromCamera(s: GameSession, dt: number): void {
    const rig = this.view.rig;
    if (rig?.mode !== 'cinema' || !s.body || dt <= 0) {
      this.far = this.closing = 0;
      return;
    }
    const c = rig.camera.position;
    const p = s.body.pos;
    const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
    const was = this.far || d;
    this.far = d;
    this.closing = damp(this.closing, (was - d) / dt, 5, dt);
  }

  /** 飞到一个地方：字幕之间至少隔半分钟，景点挨得近的时候不会一个接一个地跳 */
  private watchPlaces(s: GameSession, dt: number): void {
    this.placeT -= dt;
    const w = this.placeWatch;
    if (!w || this.placeT > 0 || !s.body || !this.run) return;
    this.placeT = 0.5;
    const p = w.arrive(s.body.pos.x, s.body.pos.z);
    if (!p) return;
    this.placeT = 30;
    const id = this.run.map.id;
    const first = this.save.visit(id, p.name);
    this.hud.place?.(p.name, p.note, first ? `到过 ${this.save.data.visited[id]?.length ?? 1} / ${w.places.length}` : '');
  }

  /** 左右的山壁有多远：一秒四次就够了 */
  private listenForWalls(s: GameSession, dt: number): void {
    this.echoT -= dt;
    const ground = s.world?.ctx?.ground;
    if (this.echoT > 0 || !ground || !s.body) return;
    this.echoT = 0.25;
    this.echo = wallDistances(ground, s.body.pos.x, s.body.pos.y, s.body.pos.z, s.flight.telemetry.heading);
  }

  /** 地面和水面：拍照的机位不能钻下去 */
  private photoFloor = (x: number, z: number): number => {
    const w = this.session?.world;
    return w ? Math.max(w.terrain.heightAt(x, z), w.map.waterLevel ?? -Infinity) : -1e4;
  };

  /** 拍照模式：世界定格（状态还是暂停），机位归玩家。菜单和 HUD 都收起来 */
  private openPhoto(): void {
    const s = this.session;
    if (!s || this.state !== 'paused' || this.photoPanel) return;
    const rig = this.view.rig;
    const b = this.settings.bindings;
    const k = (a: keyof Settings['bindings']): string => keyName(b[a][0]);
    this.ui.clear();
    this.hud.show(false);
    this.replay?.panel.show(false);
    this.root.classList.add('photo-on');
    rig.enterPhoto(this.view.heli.root.position, this.view.heli.root.quaternion, this.photoFloor);
    this.view.heli.frozen = true;
    this.input.setFreeMouse(true);
    this.input.active = true;
    this.input.clear();
    // 提示按正在用的设备写：触屏上两根摇杆挪机位、拖动转镜头；手柄的摇杆写成一个词，不然是一串“左摇杆上推左摇杆左推……”。
    // 手柄的十字键走下面这排面板（左右挑、上下调，一进来挑的是焦距），A 按下
    const pad = this.input.device === 'pad';
    const keys = this.touch && !pad
      ? '左摇杆升降 · 右摇杆前后左右 · 拖动屏幕转镜头 · 下面调焦距、曝光、倾斜 · 点“存图”保存，“返回”回到暂停菜单'
      : pad
        ? `右摇杆转镜头 · 左摇杆移动 · ${k('up')} / ${k('down')} 升降 · 按住 ${k('boost')} 走得快 · ${k('strafeLeft')} / ${k('strafeRight')} 倾斜 · 十字键左右挑、上下调（焦距、曝光……） · A 勾选、按按钮 · ${k('cruise')} 收起面板 · ${k('photo')} 存图 · ${k('pause')} 返回`
        : `按住鼠标转镜头 · ${k('forward')}${k('left')}${k('back')}${k('right')} 移动 · ${k('up')} / ${k('down')} 升降 · 按住 ${k('boost')} 走得快 · 滚轮变焦 · ${k('strafeLeft')} / ${k('strafeRight')} 倾斜 · ${k('hud')} 收起面板 · ${k('photo')} 存图 · ${k('pause')} 返回`;
    this.input.padPanel = true;
    this.photoPanel = new PhotoPanel(this.root, rig.photoFov, keys, this.settings.quality !== 'low', {
      fov: (v) => {
        rig.photoFov = v;
      },
      exposure: (v) => {
        this.view.exposureBias = v;
      },
      blur: (v) => {
        this.view.photoBlur = v;
        // （景深那一步要重建后期，动了滑块才建）
        this.view.setDof(this.eyeDof || v > 0, 48);
      },
      roll: (v) => {
        rig.photoRoll = v;
      },
      hideHeli: (on) => {
        this.view.hideHeli = on;
      },
      look: (sat, warm, fade) => this.setLook(sat, warm, fade),
      blurRotor: (on) => {
        this.view.heli.frozen = !on;
      },
      save: () => {
        this.photoPending = true;
      },
      back: () => this.closePhoto(),
    });
  }

  private setLook(sat: number, warm: number, fade: number): void {
    LOOK.sat.value = sat;
    LOOK.warm.value = warm;
    LOOK.fade.value = fade;
  }

  private closePhoto(): void {
    if (!this.photoPanel) return;
    this.photoPanel.dispose();
    this.photoPanel = null;
    this.input.padPanel = false;
    this.setLook(1, 0, 0);
    this.view.exposureBias = 0;
    this.view.hideHeli = false;
    this.view.photoBlur = 0;
    this.view.setDof(this.eyeDof && !this.replay);
    this.view.heli.frozen = false;
    this.view.rig.leavePhoto();
    this.root.classList.remove('photo-on');
    this.input.setFreeMouse(false);
    this.input.active = false;
    this.input.clear();
    if (this.replay) {
      // 从回放里拍的：回到回放
      this.replay.panel.show(true);
      this.input.setFreeMouse(true);
      this.input.active = true;
      return;
    }
    this.wreckView();
    this.hud.show(true);
    this.pauseMenu();
  }

  /** 坠毁之后的页面都是在外面看着残骸，不是坐在翻倒的座舱里 */
  private wreckView(): void {
    const s = this.session;
    if (s?.state === 'crashed' && !this.tutorial) this.view.rig.crash(s.body.pos, s.body.vel, s.world.ctx.ground);
  }

  /** 飞行时一路录着。地上干等的时间不录，教学不录 */
  private recordTape(s: GameSession, dt: number): void {
    const tel = s.flight.telemetry;
    _tapeFrame.rpm = tel.rotorRpm;
    _tapeFrame.thrust = tel.thrust;
    _tapeFrame.airspeed = tel.airspeed;
    const v = s.body.vel;
    this.tape.record(dt, s.body, _tapeFrame, (s.gear?.weightOnSkids ?? 0) > 0.5 && Math.hypot(v.x, v.y, v.z) < 0.4);
  }

  private replayDt(dt: number): number {
    const r = this.replay;
    return r && !r.hold && !this.photoPanel ? dt * r.speed : 0;
  }

  private replayFromPause(): void {
    this.openReplay(() => {
      this.hud.show(true);
      this.pauseMenu();
    });
  }

  /** 回放：电影镜头把刚才飞的再放一遍。done 是放完回到哪里，lead 是从结尾往前多少秒开始（想看更早的拖进度条） */
  private openReplay(done: () => void, lead = 60): void {
    const s = this.session;
    if (!s || this.replay || this.tape.seconds < REPLAY_MIN) return;
    const tel = s.flight.telemetry;
    const rig = this.view.rig;
    const body = newBody();
    copyBody(body, s.body);
    this.ui.clear();
    this.hud.show(false);
    this.state = 'paused';
    this.root.classList.add('replay-on');
    this.view.setDof(false);
    const view = rig.mode === 'photo' || rig.mode === 'crash' ? 'cockpit' : rig.mode;
    rig.setMode('cinema');
    this.input.setFreeMouse(true);
    this.input.active = true;
    this.input.clear();
    const k = (a: keyof Settings['bindings']): string => keyName(this.settings.bindings[a][0]);
    // 触屏上没有收起面板、截图这些键，面板上的按钮就是全部操作；手柄和键盘每个按钮都有对应的键
    const pad = this.input.device === 'pad';
    const keys = this.touch && !pad
      ? '拖动进度条看任意一刻 · 点“拍这一帧”进拍照模式'
      : pad
        ? `${k('hover')} 暂停 / 继续 · ${k('strafeLeft')} / ${k('strafeRight')} 退 / 进 5 秒 · ${k('center')} 慢放 · ${k('view')} 换镜头 · ${k('nav')} 拍这一帧 · ${k('hud')} 收起面板 · ${k('photo')} 截图 · ${k('boost')} 结束`
        : `${k('up')} 暂停 / 继续 · ${k('strafeLeft')} / ${k('strafeRight')} 退 / 进 5 秒 · ${k('center')} 慢放 · ${k('view')} 换镜头 · ${k('nav')} 拍这一帧 · ${k('hud')} 收起面板 · ${k('photo')} 截图 · ${k('pause')} 结束`;
    this.replaySideHeld = this.replaySpaceHeld = false;
    const r: ReplayRun = {
      t: Math.max(0, this.tape.seconds - lead),
      seg: 0,
      hold: false,
      speed: 1,
      body,
      rpm: tel.rotorRpm,
      thrust: tel.thrust,
      airspeed: tel.airspeed,
      view,
      done,
      panel: new ReplayPanel(this.root, this.tape.seconds, keys, {
        seek: (t) => {
          r.t = t;
          rig.setMode('cinema');
        },
        hold: (on) => {
          r.hold = on;
        },
        slow: (on) => {
          r.speed = on ? 0.35 : 1;
        },
        shot: () => rig.nextShot(),
        photo: () => this.openPhoto(),
        back: () => this.closeReplay(),
      }),
    };
    this.replay = r;
  }

  /** 回放里的键：Q / E（手柄 LB / RB）退、进 5 秒，空格暂停、继续。按一下算一次，按住不连跳 */
  private replayKeys(): void {
    const r = this.replay;
    if (!r || this.photoPanel) {
      this.replaySideHeld = this.replaySpaceHeld = false;
      return;
    }
    const side = this.input.axis('strafeLeft', 'strafeRight');
    const held = Math.abs(side) > 0.5;
    if (held && !this.replaySideHeld) {
      r.t = clamp(r.t + Math.sign(side) * 5, 0, Math.max(0, this.tape.seconds - 0.05));
      this.view.rig.setMode('cinema');
      r.panel.update(r.t);
    }
    this.replaySideHeld = held;
    const space = this.input.keyHeld('up');
    if (space && !this.replaySpaceHeld) r.panel.toggleHold();
    this.replaySpaceHeld = space;
  }

  /** 把这一刻的姿态写给画面和声音看（物理这时候没在走） */
  private stepReplay(s: GameSession, dt: number): void {
    const r = this.replay;
    if (!r) return;
    const was = r.t;
    r.t += dt;
    if (dt > 0) {
      const k = this.tape.hit(was, r.t);
      if (k > 0) {
        this.view.impactFx?.(s, k);
        this.audio.impact(k * 10);
      }
    }
    if (r.t >= this.tape.seconds) {
      r.t = 0;
      this.view.rig.setMode('cinema');
    }
    const f = this.tape.pose(r.t, s.body);
    // 传送过的地方是一个剪辑点：镜头跟着切
    if (f.seg !== r.seg) {
      r.seg = f.seg ?? 0;
      this.view.rig.setMode('cinema');
    }
    copyBody(s.prev, s.body);
    const tel = s.flight.telemetry;
    tel.rotorRpm = f.rpm;
    tel.thrust = f.thrust;
    tel.airspeed = f.airspeed;
    r.panel.update(r.t);
  }

  private closeReplay(): void {
    const r = this.replay;
    if (!r) return;
    this.closePhoto();
    this.replay = null;
    r.panel.dispose();
    const s = this.session;
    if (s) {
      copyBody(s.body, r.body);
      copyBody(s.prev, r.body);
      const tel = s.flight.telemetry;
      tel.rotorRpm = r.rpm;
      tel.thrust = r.thrust;
      tel.airspeed = r.airspeed;
    }
    this.root.classList.remove('replay-on');
    this.view.setDof(this.eyeDof);
    this.view.rig.setMode(r.view);
    this.wreckView();
    this.input.setFreeMouse(false);
    this.input.active = false;
    this.input.clear();
    r.done();
  }

  /** 拍照模式每一帧：世界不走，只走机位 */
  private stepPhoto(dt: number): void {
    const panel = this.photoPanel;
    const s = this.session;
    if (!panel || !s) return;
    const i = this.input;
    const rig = this.view.rig;
    const wheel = i.takeWheel();
    if (wheel) {
      rig.photoFov = clamp(rig.photoFov * 0.93 ** wheel, PHOTO_FOV[0], PHOTO_FOV[1]);
      panel.setFov(rig.photoFov);
    }
    // 倾斜只听键盘 Q / E 和手柄 LB / RB：触屏右摇杆的左右在拍照模式里是挪机位
    const tilt = i.axis('strafeLeft', 'strafeRight', false);
    if (tilt) {
      rig.photoRoll = clamp(rig.photoRoll - tilt * dt * 0.35, -0.5236, 0.5236);
      panel.setRoll(rig.photoRoll);
    }
    // 触屏：左摇杆上下升降、左右挪，右摇杆前后左右挪（两根摇杆的左右都是横着挪）
    const side = clamp(i.axis('left', 'right') + (this.touch?.lateral ?? 0), -1, 1);
    rig.movePhoto(dt, { x: side, y: i.axis('down', 'up'), z: i.axis('back', 'forward') }, i.takeLook(dt), i.is('boost'), (s.world.map.flightSize ?? s.world.map.size) / 2 - 30, this.photoFloor);
  }

  /** 换时段：夜里多一盏着陆灯，所有材质要重新编译，所以进出夜晚时等它编译完 */
  private async freeTime(t: TimeOfDay): Promise<void> {
    const run = this.run;
    if (!run) return;
    const night = (run.time ?? 'day') === 'night' || t === 'night';
    run.time = t;
    this.view.setTimeOfDay(t);
    if (night) await this.warmUp();
  }

  /** 到某个景点：悬停在那里，朝着要看的方向 */
  private goToVista(s: GameSession, i: number): void {
    const v = vistasOf(s.world.map)[i];
    if (!v) return;
    this.cruise = null;
    const heading = (Math.atan2(v.look[0] - v.at[0], -(v.look[1] - v.at[2])) * 180) / Math.PI;
    s.hoverAt(v.at[0], v.at[1], v.at[2], heading);
    this.view.rig.yaw = 0;
    this.view.rig.pitch = DEFAULT_PITCH;
  }

  private toggleCruise(): void {
    const s = this.session;
    const run = this.run;
    if (!s || !run?.free) return;
    if (s.sys) {
      this.hud.toast('超仿真没有自动巡航：飞机只听你的', 'info', 2500);
      return;
    }
    if (this.cruise) {
      this.cruise = null;
      this.hud.toast('自动巡航：关闭，你来飞', 'info', 2500);
    } else {
      this.cruise = new ScenicCruise(s, vistasOf(run.map));
      this.hud.toast('自动巡航：开启。动任何一个飞行键就交回给你', 'info', 3500);
    }
  }

  resume(): void {
    if (!this.session || (this.state !== 'paused' && this.state !== 'failed')) return;
    this.audio.resume();
    this.ui.clear();
    this.state = 'playing';
    this.refreshControlHint();
    this.input.active = true;
    this.input.clear();
    this.input.requestLock();
    this.last = performance.now();
    this.stepper.reset();
    this.armBack();
    this.goFullscreen();
  }

  /**
   * 手机、平板：飞的时候铺满屏幕。玩家中途退出全屏（安卓的返回手势会先退全屏）以后，
   * 下一次点“开始飞行”“继续飞行”再进去：点按钮本身就是浏览器要求的那一下用户操作
   */
  private goFullscreen(): void {
    if (!this.touch || document.fullscreenElement) return;
    const el = document.documentElement;
    try {
      void el.requestFullscreen?.({ navigationUI: 'hide' })
        ?.then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    } catch {
      /* 浏览器不给全屏（iPhone 的 Safari）：照常玩 */
    }
  }

  /**
   * 飞行时在浏览器历史里垫一格：按返回（手机的返回键、鼠标侧键）先暂停，而不是直接离开页面。
   * 暂停菜单、拍照、回放、弹窗里按返回是关掉它；回到主菜单以后不再垫，再按一次就是真的离开
   */
  private armBack(): void {
    if (this.backArmed) return;
    try {
      history.pushState({ rotorBack: true }, '');
      this.backArmed = true;
    } catch {
      /* 嵌在别的页面里、不让改历史：返回键照浏览器默认的来 */
    }
  }

  /** 浏览器“返回”了一步（垫的那一格用掉了）：能当作退一层就退一层，再垫回去 */
  private onBrowserBack(): void {
    this.backArmed = false;
    let handled = true;
    if (this.state === 'disposed') handled = false;
    else if (this.ui.hasModal) this.ui.closeModal();
    else if (this.photoPanel) this.closePhoto();
    else if (this.replay) this.closeReplay();
    else if (this.state === 'playing') this.pause();
    // 暂停菜单、坠毁、结算、起飞前：停在这一页（离开飞行走菜单里的按钮，免得一按返回整局没了）
    else if (this.state === 'paused' || this.state === 'failed' || this.state === 'ready' || this.state === 'result') handled = true;
    else handled = false;
    if (handled) this.armBack();
  }

  /** 接着认不出的设备：飞行时提示一次（只提示一次，不然方向盘一直插着每局都说） */
  private tellIgnoredPad(): void {
    if (this.ignoredPadTold || !this.ignoredPad) return;
    this.ignoredPadTold = true;
    const name = this.ignoredPad.replace(/\s*\(.*$/, '').slice(0, 40) || '这个设备';
    this.hud.toast(`接着“${name}”，但浏览器没有按标准手柄布局识别它，游戏读不了它的按键。Xbox / PS 手柄在 Chrome、Edge 里最稳`, 'warn', 7000);
  }

  restoreCheckpoint(i: number, mode: 'exact' | 'safe'): void {
    if (!this.session?.checkpoints[i]) return;
    this.session.restoreCheckpoint(i, mode);
    this.failTimer = this.completeTimer = -1;
    this.tutorial?.resumeStep(this.session);
    this.hud.toast(mode === 'safe' ? '安全恢复：以稳定悬停状态继续' : '已从检查点继续', 'info');
    this.resume();
  }

  async restart(): Promise<void> {
    if (!this.run) return;
    this.failTimer = -1;
    this.completeTimer = -1;
    await this.startRun(this.run);
  }

  quitToMenu(): void {
    this.save.save();
    this.session?.dispose();
    this.session = null;
    this.tutorial = null;
    this.cruise = null;
    this.hud.setTutorial?.(null);
    this.hud.setFree?.(false);
    this.hud.setCinema?.(false);
    this.applySim(false);
    this.failTimer = this.completeTimer = -1;
    this.audio.update(this.audioState(true), 0);
    this.audio.setAmbience({});
    this.mainMenu();
  }

  /** 进入或离开超仿真：鼠标放开，HUD 收起，换一套按键提示 */
  private applySim(on: boolean): void {
    if (on === this.input.sim) return;
    this.input.setSim(on);
    this.hud.setHidden?.(on);
    this.canvas.classList.toggle('sim-cursor', on);
    if (on && !this.simPanel) {
      this.simPanel = new SimPanel(this.root);
      this.simPanel.onAuto = () => {
        this.autoStart = true;
        this.autoT = 0;
      };
    }
    if (!on) {
      this.simPanel?.hide();
      this.autoStart = false;
      this.presses.clear();
      this.view.cockpit.controls?.highlight(null, 0);
    }
  }

  /** 每帧：鼠标贴边转头、指着的控件、点击、滚轮 */
  private simControls(s: GameSession, dt: number): void {
    const sys = s.sys;
    const I = this.input;
    const v = this.view;
    if (!sys) return;
    // 用手柄时看屏幕中间的准星（右摇杆转头对准，A 往前拨、X 往回拨，见 onEdge）；鼠标停在屏幕边上也不转头
    const padAim = I.device === 'pad';
    if (!padAim) {
      const [ex, ey] = I.edgeLook(dt);
      if (ex || ey) v.rig.look(ex, ey);
    }
    // 鼠标指着只是在看：显示名称和读数，手不动。点下去手才抬起来
    const mx = padAim ? 0 : I.mouseX;
    const my = padAim ? 0 : I.mouseY;
    const spot = padAim || I.mouseInside ? v.pickControl(mx, my) : null;
    this.padSpot = padAim ? spot : null;
    v.focusAt(mx, my, spot, dt);
    const tut = this.tutorial;
    this.tutorialCtx.hover = spot?.id ?? null;
    for (const c of I.takeClicks()) {
      // （教学的说明页上点鼠标是“看完了”，不是按开关）
      if (spot && (c.button === 0 || c.button === 2) && !tut?.step?.manual) this.useControl(s, spot, c.button === 0 ? 1 : -1);
    }
    const wheel = I.takeWheel();
    if (wheel) {
      if (spot && (spot.def.type === 'dial' || spot.def.type === 'step')) this.useControl(s, spot, wheel);
      else v.rig.zoom = Math.min(1, Math.max(0.36, v.rig.zoom * (wheel > 0 ? 0.86 : 1.16)));
    }
    // 按住旋钮上下拖：转得更快
    const drag = I.takeDrag();
    if (spot && I.mouseHeld && drag && spot.def.type === 'dial') {
      this.dragAcc += drag * 60;
      const n = Math.trunc(this.dragAcc);
      if (n) {
        this.dragAcc -= n;
        this.useControl(s, spot, n);
      }
    }
    // 手柄按住 A / X 转旋钮：按住 0.35 秒以后连续转
    const hold = padAim && spot?.def.type === 'dial' ? (I.pad.down(0) ? 1 : I.pad.down(2) ? -1 : 0) : 0;
    if (hold && spot) {
      this.padHoldT += dt;
      if (this.padHoldT > 0.35) {
        this.padRepeatT -= dt;
        if (this.padRepeatT <= 0) {
          this.padRepeatT = 0.07;
          this.useControl(s, spot, hold);
        }
      }
    } else this.padHoldT = this.padRepeatT = 0;
    const hand = v.pilot;
    this.presses.step(
      dt,
      (target) => {
        hand?.reachFor(target);
        return hand?.touching(target) ?? true;
      },
      (target, dir) => this.pressNow(s, target, dir),
    );
    if (I.mouseHeld && spot) hand?.hold(spot);
    this.lampT = Math.max(0, this.lampT - dt);
    if (!I.mouseHeld && this.lampT <= 0) sys.lampTest = false;
    v.cockpit.mapRange = GPS_RANGES[sys.c.gpsRange] ?? 2000;
    // 检查单：冷舱到旋翼 100% 之前一直在
    const list = sys.checklist(s.flight.nr);
    const pending = this.checklistDone || tut ? null : list.find((r) => !r.done) ?? null;
    if (!pending) this.checklistDone = true;
    this.simPanel?.checklist(this.checklistDone ? null : list);
    const lit = tut ? tut.control(s) : this.settings.hints && pending ? pending.spot : null;
    v.cockpit.controls?.highlight(lit, this.t);
    if (tut) tut.lookHint = this.lookHint(lit);
    if (this.autoStart && pending) {
      this.autoT -= dt;
      if (this.autoT <= 0 && !this.presses.length) {
        this.autoT = 0.75;
        const target = v.cockpit.controls?.get(pending.spot);
        if (target && sys.c[pending.key] !== pending.want) this.useControl(s, target, 1);
      }
    } else if (!pending) this.autoStart = false;
    if (spot) {
      const r = this.rect ?? (this.rect = this.canvas.getBoundingClientRect());
      const env = this.readEnv(s);
      this.simPanel?.tooltip(spot.def.name, spot.def.label, readout(spot.def, sys, env), r.left + ((mx + 1) / 2) * r.width, r.top + ((my + 1) / 2) * r.height, blocked(spot.def, sys));
      this.canvas.classList.toggle('sim-cursor-hot', spot.def.type !== 'info');
    } else {
      this.simPanel?.hideTooltip();
      this.canvas.classList.remove('sim-cursor-hot');
    }
  }

  /** 教学要点的控件不在视野里：告诉玩家往哪边看 */
  private lookHint(id: string | null): string {
    const spot = id ? this.view.cockpit.controls?.get(id) : null;
    if (!spot) return '';
    const p = this.view.cockpit.root.localToWorld(_spotPos.copy(spot.center));
    const q = this.view.project(p, _screen);
    const w = innerWidth * 0.08;
    const h = innerHeight * 0.08;
    const dx = q.behind ? 1 : q.x < w ? -1 : q.x > innerWidth - w ? 1 : 0;
    const dy = q.behind ? 0 : q.y < h ? -1 : q.y > innerHeight - h ? 1 : 0;
    if (!dx && !dy) return '';
    const way = `${dx < 0 ? '左' : dx > 0 ? '右' : ''}${dy < 0 ? '上' : dy > 0 ? '下' : ''}`;
    return this.input.device === 'pad' ? `光圈在视野外：推右摇杆往${way}看。` : `光圈在视野外：把鼠标移到屏幕${way}边，往${way}看。`;
  }

  private readEnv(s: GameSession): ReadEnv {
    const t = s.flight.telemetry;
    return { nr: t.rotorRpm, torque: t.torque, airspeed: t.airspeed, altitude: s.altitudeMSL(), vs: s.body.vel.y, heading: ((t.heading * 180) / Math.PI + 360) % 360, slip: t.sideslip };
  }

  /** 点了控件：手伸过去，手指碰到的那一刻才算按下（飞行员模型没加载时直接生效） */
  private useControl(s: GameSession, spot: Spot, dir: number): void {
    if (spot.def.type === 'info') return;
    if (this.view.pilot?.loaded) this.presses.push(spot, dir);
    else this.pressNow(s, spot, dir);
  }

  private pressNow(s: GameSession, spot: Spot, dir: number): void {
    const sys = s.sys;
    if (!sys) return;
    const env: ActEnv = {
      nextTarget: () => s.cycleNav(),
      range: (d) => {
        sys.c.gpsRange = Math.min(GPS_RANGES.length - 1, Math.max(0, sys.c.gpsRange + d));
      },
      toast: (text) => this.hud.toast(text, 'info', 2000),
    };
    const moved = operate(spot.def, sys, dir, env);
    if (sys.lampTest) this.lampT = 0.5;
    this.view.pilot?.poke(spot);
    if (spot.kind === 'press') this.view.cockpit.controls?.pressAnim(spot);
    if (moved) this.audio.control(spot.def.sound);
  }

  private onEdge(a: 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange' | 'hud' | 'cruise' | 'trim' | 'photo', fromPad = false): void {
    const s = this.session;
    if (this.photoPanel) {
      if (a === 'pause') this.closePhoto();
      else if (a === 'photo') this.photoPending = true;
      // 收起面板：键盘 U；手柄是视图键（十字键在走面板）
      else if (a === 'hud' || (fromPad && a === 'cruise')) {
        this.photoPanel.toggle();
        this.input.padPanel = this.photoPanel.open;
        (document.activeElement as HTMLElement | null)?.blur?.();
      } else if (a === 'center') {
        this.view.rig.photoRoll = 0;
        this.photoPanel.setRoll(0);
      }
      return;
    }
    if (this.replay) {
      const r = this.replay;
      if (a === 'pause' || (fromPad && a === 'boost')) this.closeReplay();
      else if (a === 'photo') this.photoPending = true;
      else if (a === 'hud' || a === 'cruise') r.panel.toggle();
      else if (a === 'view') this.view.rig.nextShot();
      // A / H 暂停、继续；Y / Z 慢放；十字键上 / N 拍这一帧（进拍照模式）
      else if (a === 'hover') r.panel.toggleHold();
      else if (a === 'center') r.panel.toggleSlow();
      else if (a === 'nav') this.openPhoto();
      return;
    }
    if (a === 'pause') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && !this.ui.hasModal) this.resume();
      return;
    }
    if (a === 'photo') {
      // （暂停的时候也能拍：菜单是网页元素，不在画面里）
      if (this.state === 'playing' || (this.state === 'paused' && !this.ui.hasModal)) this.photoPending = true;
      return;
    }
    if (this.state !== 'playing' || !s) return;
    // 教学的说明页：手柄的 A 也算“看完了”（不然只用手柄的玩家第一页就翻不过去）
    if (fromPad && a === 'hover' && this.tutorial?.step?.manual) {
      this.tutorial.click(s);
      return;
    }
    // 超仿真用手柄：准星对着开关时 A 往前拨、X 往回拨（旋钮按住连续转，见 simControls）
    if (fromPad && s.sys && this.padSpot && (a === 'hover' || a === 'view')) {
      if (!this.tutorial?.step?.manual) this.useControl(s, this.padSpot, a === 'hover' ? 1 : -1);
      this.padHoldT = 0;
      return;
    }
    if (a === 'trim') {
      if (s.sys) {
        s.flight.setTrim();
        this.audio.control('button');
        this.hud.toast('已配平', 'info', 900);
      }
      return;
    }
    if (a === 'hover' && s.sys) {
      // 超仿真没有悬停辅助：H 是增稳开关的快捷键
      const spot = this.view.cockpit.controls?.get('rk_sas');
      if (spot) this.useControl(s, spot, 1);
      return;
    }
    if (a === 'hover') {
      if (!this.tutorial || this.tutorial.hoverAllowed) s.toggleHover();
    }
    else if (a === 'boost') s.useBoost();
    else if (a === 'center') this.view.rig.center();
    else if (a === 'cruise') this.toggleCruise();
    else if (a === 'view') {
      // 只有休闲飞行能换镜头（座舱、追尾、电影镜头）；任务和训练固定座舱视角，见 views.ts
      const rig = this.view.rig;
      const next = nextView(rig.mode, this.run?.free === true);
      if (!next) {
        const now = performance.now();
        if (now - this.viewLockToastT > 2500) {
          this.viewLockToastT = now;
          this.hud.toast('任务和训练只用座舱视角，休闲飞行可以换镜头', 'info', 2200);
        }
        return;
      }
      rig.setMode(next);
      this.hud.setCinema?.(next === 'cinema');
      if (next === 'cinema') this.hud.toast('电影镜头', 'info', 1500);
    }
    else if (a === 'nav') s.cycleNav();
    else if (a === 'hud') this.hud.toast(`HUD：${this.hud.cycleMode()}`, 'info', 1500);
    else if (a === 'mapRange') {
      const r = [1000, 2000, 4000];
      const c = this.view.cockpit;
      c.mapRange = r[(r.indexOf(c.mapRange) + 1) % r.length];
      this.hud.toast(`地图范围 ${c.mapRange / 1000} km`, 'info', 1500);
    }
  }

  /** 把这一帧存成图片。显卡画的画面只有刚画完的时候读得到，所以在 frame 里画完马上调。HUD 是网页元素，不在图里 */
  private savePhoto(): void {
    this.canvas.toBlob((blob) => {
      if (!blob) {
        this.hud.toast('这个浏览器存不了截图', 'warn', 2000);
        return;
      }
      const p = (n: number): string => String(n).padStart(2, '0');
      const d = new Date();
      const a = document.createElement('a');
      a.download = `rotor-trails-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.save.data.log.photos++;
      this.save.save();
      if (this.photoPanel) {
        this.photoPanel.saved('已存到下载文件夹');
        this.audio.click();
      }
      else if (this.replay) this.audio.click();
      else this.hud.toast('截图已存到下载文件夹', 'good', 1800);
    }, 'image/png');
  }

  // ---------------- 主循环 ----------------

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.frame);
    try {
      this.tick(now);
    } catch (error) {
      // A failed frame must not keep throwing and advancing flight every refresh.
      console.error('游戏运行中断', error);
      this.dispose();
      new UI(this.root).compatError('游戏运行中断，请刷新页面后重试。已保存的进度不受影响。');
    }
  };

  private tick(now: number): void {
    if (this.state !== 'playing') this.padReticle?.classList.remove('on');
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    const frameSeconds = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    const dt = Math.min(frameSeconds, 0.1);
    this.frames++;
    this.input.pollPad?.(dt);
    // 菜单里右摇杆上下滚动长页面（操作说明、飞行记录、设置）
    if (!this.input.active && this.input.pad.connected && this.input.pad.lookY) padScroll(this.root, this.input.pad.lookY * 1100 * dt);
    // 拿着手柄时焦点自己变了（新页面打开落在主按钮上、弹窗关上回到原来的按钮）：框跟过去。
    // 不靠 focus 事件：浏览器窗口没被选中时（手柄照样能按）焦点事件不一定来
    if (this.input.device === 'pad' && document.activeElement !== this.padMarked) {
      this.padMarked = document.activeElement;
      markPadFocus(this.padMarked);
    }
    // Report actual elapsed time; the simulation clamp must not hide long stalls.
    this.fpsT += frameSeconds;
    if (this.fpsT >= 1) {
      this.fps = this.frames / this.fpsT;
      this.watchFrameRate();
      if (this.state === 'playing' && !this.replay && ++this.medalT >= 15) {
        this.medalT = 0;
        this.checkMedals();
      }
      this.frames = 0;
      this.fpsT = 0;
    }
    const s = this.session;
    let alpha = 1;
    const running = this.state === 'playing' && s && s.state === 'running';
    const renderDt = this.state === 'paused' ? this.replayDt(dt) : dt;
    this.t += renderDt;
    if (s && s.state === 'crashed' && !this.tutorial && !this.replay && (this.state === 'playing' || this.state === 'failed')) {
      // 残骸还在往下掉
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) s.step?.();
      alpha = this.stepper.alpha;
      // （录下来：回放里看得到它掉下去）
      if ((s.wreckAge ?? 9) < 3) this.recordTape(s, dt);
    }
    if (s && s.state === 'running') this.view.rig.endCrash?.();
    if (s && running) {
      this.readInput(s, dt);
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) {
        s.step();
        this.handleEvents(s.drainEvents());
        if (s.state !== 'running') break;
      }
      alpha = this.stepper.alpha;
      if (!this.tutorial) this.recordTape(s, dt);
      if ((s.gear?.weightOnSkids ?? 1) < 0.5) this.save.data.log.seconds += dt;
      if (this.tutorial) {
        const c = this.tutorialCtx;
        c.yaw = this.view.rig.yaw;
        c.pitch = this.view.rig.pitch;
        c.dragLook = this.input.lockFailed;
        s.mission.locked = this.tutorial.missionLocked;
        this.tutorial.update(s, dt, c);
        const tutHud = this.tutorial.hud();
        this.hud.setTutorial?.(tutHud);
        // 着陆辅助在右下角：卡片让到左边
        this.tutBox.classList.toggle('side', tutHud.parts.includes('landing'));
        const html = this.tutorial.html(c);
        if (html !== this.tutorialHtml) {
          this.tutorialHtml = html;
          this.tutBox.innerHTML = html;
        }
        if (this.tutorial.done && this.completeTimer < 0 && !s.mission.complete) {
          this.completeTimer = 0.5;
        }
      }
    }
    if (this.state === 'playing' && s && s.state !== 'running') {
      if (s.state === 'crashed' && this.failTimer < 0) {
        // （教学里撞了不算什么：一下就回到这一课的安全点，不用看残骸）
        this.failTimer = this.tutorial ? 1.4 : 2.8;
        if (!this.tutorial) {
          this.view.impactFx?.(s, 1);
          this.tape.mark(1);
          this.view.rig.crash(s.body.pos, s.body.vel, s.world.ctx.ground);
        }
      }
      if (s.state === 'complete' && this.completeTimer < 0) this.completeTimer = 1.6;
    }
    // （坠毁过程中从暂停菜单选了景点：飞机已经好好地在那儿了，这次恢复就不要了，不然两秒后又被传送一次）
    if (this.failTimer > 0 && s?.state === 'running') this.failTimer = -1;
    if (this.state === 'playing' && this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) {
        if (this.tutorial && s) this.tutorialRecover(s);
        else if (this.run?.free && s) {
          // 休闲模式没有失败：回到刚才那里的上空
          this.failTimer = -1;
          this.cruise = null;
          s.hoverAt(s.body.pos.x, 60, s.body.pos.z, s.flight.telemetry.heading * 57.29578);
          this.hud.toast('没关系，继续飞', 'info', 2500);
        } else this.showFailure();
      }
    }
    if (this.state === 'playing' && this.completeTimer > 0) {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.showResult();
    }
    if (s && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready' || this.state === 'failed')) {
      this.stepPhoto(dt);
      this.replayKeys();
      this.stepReplay(s, renderDt);
      this.view.render(s, { dt: renderDt, t: this.t, alpha, replay: !!this.replay });
      if (this.photoPending) {
        this.photoPending = false;
        this.savePhoto();
      }
      this.hud.update(s, this.view, this.settings, this.t);
      this.view.drawInstruments(this.t, this.instrumentData(s));
      this.listenForWalls(s, dt);
      this.listenFromCamera(s, dt);
      this.touch?.setMode(this.photoPanel ? 'photo' : this.state !== 'playing' || this.replay ? 'off' : 'fly');
      if (this.touch && this.state === 'playing') this.touchKeyStates(s);
      if (this.state === 'playing') this.watchPlaces(s, dt);
      this.audio.update(this.audioState(this.state !== 'playing' && (!this.replay || !!this.photoPanel)), dt);
    } else {
      // 菜单背景：长焦、贴着地面绕直升机慢慢转，直升机在画面右边（左边是标题和菜单），背后是谷地和雪山
      this.idleAngle += dt * 0.022;
      const c = this.view.heli.root.position;
      const r = 21;
      const a = 2.5 + 0.55 * Math.sin(this.idleAngle);
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      this.idlePose.pos.set(c.x + sx * r, c.y + 0.5, c.z + cz * r);
      this.idlePose.target.set(c.x - cz * 3.6, c.y + 2.6, c.z + sx * 3.6);
      this.view.render(null, { dt, t: this.t, alpha: 1 }, this.idlePose);
      this.touch?.setMode('off');
      this.audio.update(this.audioState(true), dt);
    }
  }

  /** 每秒一次：飞行中帧率连续撑不住，自动降一档（玩家自己选过画质就不管） */
  private watchFrameRate(): void {
    const flying = this.state === 'playing' && this.session?.state === 'running' && !document.hidden;
    this.lowFps = flying && this.settings.autoQuality && this.fps < 30 ? this.lowFps + 1 : 0;
    if (this.lowFps < 8) return;
    this.lowFps = 0;
    const s = this.settings;
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    const at = order.indexOf(s.quality);
    if (s.rayTracing) s.rayTracing = false;
    else if (at > 0) s.quality = order[at - 1];
    else return;
    this.view.applySettings(s);
    this.save.save();
    this.hud.toast(`帧率偏低，画质已自动调到“${QUALITY[s.quality].label}”${s.rayTracing ? '' : '（光线追踪关闭）'}`, 'info', 5000);
  }

  private readInput(s: GameSession, dt: number): void {
    const I = this.input;
    s.input.pitch = I.axis('back', 'forward');
    s.input.turn = I.axis('left', 'right');
    s.input.lateral = I.axis('strafeLeft', 'strafeRight');
    s.input.vertical = I.axis('down', 'up');
    this.tutorial?.filter(s.input);
    if (this.cruise) {
      if (s.input.pitch || s.input.turn || s.input.lateral || s.input.vertical) {
        this.cruise = null;
        this.hud.toast('已取消自动巡航，你来飞', 'info', 2500);
      } else this.cruise.update();
    }
    this.hud.autoFlight = this.cruise !== null;
    const [dx, dy] = I.takeLook(dt);
    if (dx || dy) this.view.rig.look(dx, dy);
    if (I.sim) this.simControls(s, dt);
    else this.padSpot = null;
    this.tutorialCtx.pad = I.device === 'pad';
    this.showReticle(I.sim && I.device === 'pad');
  }

  /** 屏幕上的开关键自己显示状态：手机上写着这些的大面板放不下 */
  private touchKeyStates(s: GameSession): void {
    const t = this.touch;
    if (!t) return;
    const b = s.buffs;
    t.setKey('hover', s.flight.telemetry.hover !== 'off');
    t.setKey('boost', b.boostActive, !b.boostActive && b.boostCharges <= 0, b.boostCharges > 1 ? `增强 ×${b.boostCharges}` : '增强');
    t.setKey('cruise', this.cruise !== null);
  }

  /** 超仿真用手柄时屏幕中间的准星 */
  private showReticle(on: boolean): void {
    if (on && !this.padReticle) {
      this.padReticle = document.createElement('div');
      this.padReticle.className = 'pad-reticle';
      this.root.appendChild(this.padReticle);
    }
    this.padReticle?.classList.toggle('on', on && this.state === 'playing');
  }

  /** 手机、平板：屏幕上的摇杆，超仿真藏起来（要用鼠标按开关），第一次点屏幕时进全屏、锁横屏 */
  private setupTouch(rollback: Array<() => void>): void {
    const t = (this.touch = new TouchControls(this.root));
    rollback.push(() => t.dispose());
    this.input.touch = t;
    t.onEdge = (a) => {
      if (this.state === 'playing') this.onEdge(a);
    };
    t.onLook = (dx, dy) => {
      this.input.lookDX += dx;
      this.input.lookDY += dy;
    };
    t.onTouch = () => this.input.noteTouch();
    useTouchNames(true);
    rollback.push(() => useTouchNames(false));
    this.ui.touch = true;
    this.tutorialCtx.touch = true;
    this.root.classList.add('touch-device');
    if (this.settings.assist === 'sim') this.settings.assist = 'standard';
    window.addEventListener('pointerup', () => {
      const el = document.documentElement;
      void el.requestFullscreen?.({ navigationUI: 'hide' })
        ?.then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    }, { once: true, signal: this.lifetime.signal });
  }

  /** 背景音乐放多大：菜单里放，任务和训练里不放（要听发动机和告警），休闲飞行垫在风景底下，让它自己飞的时候大一点 */
  private musicLevel(): number {
    if (this.replay) return 0.8;
    if (this.state === 'loading') return 0.6;
    if (this.state !== 'playing' && this.state !== 'ready') return this.state === 'paused' ? 0.7 : 1;
    if (!this.run?.free || this.tutorial) return 0;
    return this.cruise ? 0.85 : 0.4;
  }

  private audioState(paused: boolean) {
    const s = this.session;
    const music = this.musicLevel();
    if (!s) return { rpm: 0, load: 0, power: 0, airspeed: 0, gust: 0, rain: 0, inCockpit: true, paused, bank: 0, descent: 0, music };
    const tel = s.flight.telemetry;
    const y = s.sys;
    const c = y?.c;
    // 音频面板决定耳机里有什么：要有电，要选中 COM1，电台开着
    const audio = !!y && y.feeds('ob_audio');
    const com = audio && y!.avionics && y!.feeds('cb_com') ? (c!.aCom1 > 0.5 ? c!.comVol * c!.audioVol : 0) : 0;
    const sim = y
      ? {
          n1: y.n1 / 100,
          lit: y.lit,
          starter: y.starter,
          ignite: y.igniting,
          torque: tel.torque,
          tail: Math.min(1, Math.abs(tel.pedal - 0.1) + 0.45 * tel.collective),
          vib: tel.vibration,
          bus: y.powered,
          pump: c!.fuelP > 0.5 && y.feeds('cb_fuel'),
          hyd: y.hydP > 10,
          vent: y.powered ? c!.vent : 0,
          heat: c!.cabHt > 0.5 && y.feeds('ob_cabht') ? c!.heat : 0,
          radio: com,
          ics: audio && c!.aIcs > 0.5 && y.feeds('cb_ics') ? c!.audioVol : 0,
          squelch: c!.audioSql,
          morse: audio && y.avionics && (c!.aNav > 0.5 || c!.aAdf > 0.5) ? c!.audioVol : 0,
          // 紧急频率 121.5 上能听到自己的定位发射机
          siren: com > 0 && c!.elt > 1.5 && c!.comActive === 121500 ? com : 0,
          headset: audio ? c!.audioVol : 0.4,
          horn: (tel.rotorRpm < 0.93 && tel.rotorRpm > 0.3 && s.gear.weightOnSkids < 0.3 && c!.hornMute < 0.5 && y.feeds('ob_horn')) || y.hornTest > 0,
        }
      : null;
    return {
      sim,
      music,
      agl: s.agl,
      echo: this.echo,
      plane: this.view.traffic?.sound ?? null,
      far: this.far,
      closing: this.closing,
      // （旋翼撞坏了，转速几秒内慢慢没了）
      rpm: s.state === 'crashed' && !this.replay ? tel.rotorRpm * Math.exp(-s.wreckAge * 1.1) : tel.rotorRpm,
      load: tel.thrust / (s.totalMass() * 9.81),
      power: tel.powerFrac,
      airspeed: tel.airspeed,
      gust: s.windInfo.gust,
      rain: s.weather.current.rain,
      inCockpit: this.view.rig.mode === 'cockpit',
      paused,
      bank: tel.roll,
      descent: -s.body.vel.y,
    };
  }

  private instrumentData(s: GameSession): InstrumentData {
    const tel = s.flight.telemetry;
    const nav = s.nav.info;
    this.instrumentLists.update(s);
    return {
      pitch: tel.pitch,
      roll: tel.roll,
      heading: ((tel.heading * 180) / Math.PI + 360) % 360,
      airspeed: tel.airspeed,
      groundSpeed: s.groundSpeed,
      altitudeMSL: s.altitudeMSL(),
      oat: s.oat(),
      agl: s.agl,
      vs: s.body.vel.y,
      // 机体系偏航角速度（与飞行模型一致：-ωy 为向右）
      yawRate: (-_wB.copy(s.body.angVel).applyQuaternion(_qInv.copy(s.body.quat).invert()).y * 180) / Math.PI,
      slip: tel.sideslip,
      targetAlt: nav.mode === 'complete' ? null : nav.targetAlt + s.world.map.altitudeOffset,
      targetSpeed: nav.speed,
      navBearing: nav.mode === 'complete' ? null : nav.bearing,
      navDistance: nav.mode === 'complete' ? null : nav.distance,
      navLabel: nav.label,
      windDirFrom: s.windInfo.dirFrom,
      windSpeed: s.windInfo.speed,
      sys: s.sys,
      caution: s.sys ? s.sys.caution(s.flight.nr, s.flight.shaft, s.gear.weightOnSkids > 0.3) : null,
      torque: tel.torque,
      powerFrac: tel.powerFrac,
      hoverPowerFrac: tel.hoverPowerFrac,
      rpm: tel.rotorRpm,
      durability: s.damage.durability,
      statusLabel: { normal: '正常', damaged: '受损', critical: '严重受损', destroyed: '坠毁' }[s.damage.status],
      torqueLimited: tel.torqueLimited,
      hover: tel.hover,
      boost: s.buffs.boostActive,
      boostStored: s.buffs.boostCharges > 0,
      shield: s.buffs.shieldActive,
      terrainWarn: s.terrainWarning !== null,
      cargo: s.mission.cargo,
      collective: tel.collective,
      heliX: s.body.pos.x,
      heliZ: s.body.pos.z,
      route: this.instrumentLists.route,
      objectives: this.instrumentLists.objectives,
      pickups: this.instrumentLists.pickups,
      mapSize: s.world.map.flightSize ?? s.world.map.size,
      speedUnit: this.settings.speedUnit,
    };
  }

  private handleEvents(events: GameEvent[]): void {
    const hud = this.hud;
    const A = this.audio;
    for (const e of events) {
      switch (e.type) {
        case 'caution':
          A.alert('caution');
          break;
        case 'damage': {
          const d = e.ev;
          // 休闲模式不提耐久，磕一下有声音和震动就够了
          if (this.run?.free) {
            A.impact(d.severity * 0.5);
            this.shake(Math.min(1, d.amount / 20));
          } else if (d.blocked) {
            if (this.t - this.lastBlocked > 1.5) hud.toast(`护盾吸收了碰撞（${CAUSE_LABEL[d.cause]}）`, 'info', 2000);
            this.lastBlocked = this.t;
            A.impact(d.severity * 0.5);
            this.shake(Math.min(1, d.severity / 10));
          } else {
            hud.toast(`耐久 -${Math.round(d.amount)}：${CAUSE_LABEL[d.cause]}`, d.amount > 15 ? 'bad' : 'warn', 2600);
            if (d.cause === 'rotor' || d.cause === 'tailRotor') A.rotorStrike();
            else if (d.cause === 'scrape') A.scrape();
            else A.impact(d.severity);
            this.shake(Math.min(1.5, d.amount / 20));
          }
          break;
        }
        case 'pickup':
          A.pickup(e.kind);
          hud.toast(
            e.kind === 'boost' ? `获得动力增强（按 ${keyName(this.settings.bindings.boost[0])} 使用）` : e.kind === 'shield' ? (e.result === 'shieldExtended' ? '护盾时间延长' : '免伤护盾已生效') : '维修补给：耐久 +25',
            'good',
          );
          break;
        case 'boost':
          A.boost();
          hud.toast('动力增强启动：可用动力提高 25%', 'good', 2500);
          break;
        case 'checkpoint':
          A.checkpoint();
          hud.toast(`检查点：${e.label}`, 'info', 2200);
          break;
        case 'touchdown':
          A.touchdown(e.metrics.descent);
          if (e.metrics.safe) {
            const log = this.save.data.log;
            log.landings++;
            const soft = Math.max(0.01, e.metrics.descent);
            if (log.softest !== null && soft < log.softest && !this.tutorial) hud.toast(`最轻的一次接地：${soft.toFixed(2)} m/s`, 'good', 3000);
            log.softest = Math.min(log.softest ?? Infinity, soft);
            this.checkMedals();
          }
          if (e.padId && e.metrics.safe) hud.toast(`接地：${GRADE_LABEL[e.metrics.grade]}（下降 ${e.metrics.descent.toFixed(1)} m/s）`, 'info', 2200);
          break;
        case 'status':
          if (this.run?.free) break;
          if (e.status === 'damaged' && e.prev === 'normal') {
            A.alert('damaged');
            hud.toast('机体受损：动力与爬升性能开始下降', 'warn', 4000);
          } else if (e.status === 'critical') {
            A.alert('critical');
            hud.toast('严重受损：性能明显下降，仍可控制，请前往维修点', 'bad', 5000);
          } else if (e.status === 'normal' || (e.status === 'damaged' && e.prev === 'critical')) hud.toast('维修完成，性能恢复', 'good');
          break;
        case 'crash':
          if (!this.tutorial && this.session) A.crash?.(this.session.body.pos.y < (this.session.world.map.waterLevel ?? -1e9) + 3);
          A.fail();
          hud.toast(`坠毁：${e.label}`, 'bad', 3000);
          break;
        case 'weather':
          hud.toast(`天气变化：${e.label}`, 'warn', 4000);
          break;
        case 'message':
          hud.toast(e.text, e.level === 'good' ? 'good' : e.level === 'warn' ? 'warn' : 'info');
          break;
        case 'repair':
          A.pickup('repair');
          hud.toast(`${e.station ? '维修站' : '维修补给'}：耐久 +${Math.round(e.amount)}`, 'good');
          break;
        case 'hover':
          hud.toast(e.on ? '悬停辅助：开启（逐渐减速并保持位置）' : e.auto ? '已着陆，悬停辅助自动关闭' : '悬停辅助：关闭', 'info', 2000);
          break;
        case 'hoverHint':
          // 教学有自己的说明；自动巡航和回放里的输入不是玩家的
          if (!this.tutorial && !this.cruise && !this.replay) hud.toast(`想停稳一点？按 ${keyName(this.settings.bindings.hover[0])} 开启悬停辅助：它会帮你刹车，顶着风把飞机定在原地`, 'info', 6000);
          break;
        case 'mission': {
          const m = e.ev;
          if (m.type === 'objectiveDone') {
            A.success();
            hud.toast(`${m.optional ? '可选任务完成' : '任务完成'}：${m.obj.def.title}${m.landing ? `（降落${GRADE_LABEL[m.landing.grade]}）` : ''}`, 'good', 4000);
          } else if (m.type === 'objectiveStart') hud.toast(`新任务：${m.obj.def.title}`, 'info', 4000);
          else if (m.type === 'landingRejected') hud.toast(`着陆不合格：${m.metrics.reasons.join('，')}。请起飞后重新降落`, 'bad', 5000);
          else if (m.type === 'landingAccepted') hud.toast(`着陆合格（${GRADE_LABEL[m.metrics.grade]}），保持停稳…`, 'good', 2500);
          else if (m.type === 'inspectPoint') hud.toast(`巡查完成：${m.label}（剩余 ${m.remaining}）`, 'good');
          else if (m.type === 'cargo') hud.toast(m.action === 'load' ? '物资已装载' : m.action === 'drop' ? '物资已投放' : '物资已卸载', 'good');
          else if (m.type === 'lockedPad') hud.toast(m.message, 'warn', 4000);
          break;
        }
        case 'complete':
          break;
      }
    }
    const s = this.session;
    if (s && s.terrainWarning !== null && s.terrainWarning <= 4) A.alert('terrain');
    if (s && s.windInfo.gustIn !== null && s.windInfo.gustIn < 2) A.alert('gust');
  }

  /** 教学里撞了不算失败：回到这一课的安全点，耐久补满，再来一次 */
  private tutorialRecover(s: GameSession): void {
    const t = this.tutorial;
    if (!t) return;
    const last = s.checkpoints.length - 1;
    s.restoreCheckpoint(last, 'safe');
    s.damage.repair(100);
    this.failTimer = -1;
    t.rewind(s);
    this.hud.toast('没关系，回到这一课的开头，再来一次', 'info', 4000);
  }

  private showFailure(): void {
    const s = this.session;
    if (!s || !this.run) return;
    this.state = 'failed';
    this.refreshControlHint();
    this.input.active = false;
    this.input.exitLock();
    const cause = s.crashCause ?? 'impact';
    const detail: Record<string, string> = {
      rotor: '旋翼撞到了障碍物。注意旋翼半径约 5.3 m，靠近峭壁、树冠和建筑时要留足余量。',
      tailRotor: '尾桨撞击。转弯和倒飞时注意机尾方向的障碍物。',
      impact: '机身与地形或障碍物发生了严重撞击。高速时提前减速，转弯半径会随速度增大。',
      scrape: '持续擦碰导致耐久耗尽。',
      hardLanding: '接地时下降速度过大。降落时把下降速度控制在 2.5 m/s 以内。',
      sideLoad: '接地时水平速度过大。降落前先悬停稳定。',
      attitude: '接地时机身倾斜过大，导致事故。',
      rollover: '机体侧翻。在坡地或带着侧向速度接地时容易发生。',
      water: '机体落水。在水面附近飞行时保持安全高度。',
    };
    this.ui.failed(
      { cause: `失败原因：${CAUSE_LABEL[cause]}`, detail: detail[cause] ?? '', checkpoints: s.restoreOptions() },
      {
        checkpoint: (i, mode) => this.restoreCheckpoint(i, mode),
        restart: () => void this.restart(),
        quit: () => this.quitToMenu(),
        replay: this.tape.seconds >= REPLAY_MIN
          ? () => this.openReplay(() => {
              this.hud.show(true);
              this.showFailure();
            }, 15)
          : undefined,
      },
    );
  }

  private showResult(): void {
    const s = this.session;
    const run = this.run;
    if (!s || !run) return;
    this.state = 'result';
    this.refreshControlHint();
    this.input.active = false;
    this.input.exitLock();
    this.tutBox.classList.add('hidden');
    const score = computeScore({
      mainDone: s.mission.complete || (this.tutorial?.done ?? false),
      optionalDone: s.mission.optionalDone,
      optionalTotal: s.mission.optional.length,
      durability: s.damage.durability,
      collisions: s.damage.collisions,
      finalLanding: s.mission.finalLanding,
      safeRecoveries: s.stats.safeRecoveries,
    });
    let best = false;
    if (run.tutorial) {
      this.save.data.tutorialDone = true;
      this.save.save();
      this.tutBox.classList.add('hidden');
      this.hud.setTutorial?.(null);
      this.ui.trainingDone(s.mission.finalLanding, run.course === 'sim', {
        next: () => {
          this.quitToMenu();
          this.briefing(getMap('japan'));
        },
        free: () => {
          this.quitToMenu();
          this.freeSelect();
        },
        again: () => {
          this.quitToMenu();
          this.trainingMenu(run.course ?? 'flight');
        },
        menu: () => this.quitToMenu(),
      });
      return;
    } else best = this.save.recordResult(run.map.id, score.total, score.rating, s.mission.optional.filter((o) => o.status === 'done').map((o) => o.def.id), s.t);
    const medals = newMedals(this.save.data, this.medalWorld()).map((m) => m.name);
    if (medals.length) this.save.save();
    const idx = CAMPAIGN.indexOf(run.map.id);
    const nextId = run.tutorial ? 'japan' : idx >= 0 && idx < CAMPAIGN.length - 1 ? CAMPAIGN[idx + 1] : null;
    const next = nextId && MAPS.find((m) => m.id === nextId) ? getMap(nextId) : null;
    const show = (): void => this.ui.result(
      {
        map: run.map,
        score,
        best,
        time: s.t,
        landing: s.mission.finalLanding,
        optional: s.mission.optional.map((o) => ({ title: o.def.title, done: o.status === 'done' })),
        next,
        tutorial: run.tutorial,
        medals,
      },
      {
        replay: this.tape.seconds >= REPLAY_MIN
          ? () => this.openReplay(() => {
              this.state = 'result';
              this.hud.show(true);
              show();
            })
          : undefined,
        again: () => void this.restart(),
        maps: () => {
          this.quitToMenu();
          this.mapSelect();
        },
        next: () => next && this.briefing(next),
        menu: () => this.quitToMenu(),
      },
    );
    show();
  }
}
