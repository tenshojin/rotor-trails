// 游戏总控：界面状态机、渲染循环、固定步长仿真（1/60 s，渲染插值）、暂停/后台处理、事件反馈、存档。

import * as THREE from 'three';
import { AudioEngine } from '../audio/audio';
import { MAPS, CAMPAIGN, getMap } from '../maps/index';
import type { MapDef } from '../maps/types';
import { CAUSE_LABEL } from '../sim/damage';
import { GRADE_LABEL } from '../sim/mission';
import { computeScore } from '../sim/scoring';
import { GameSession, STEP, type GameEvent } from '../sim/session';
import { FixedStepper } from '../core/stepper';
import { WorldView } from '../render/worldView';
import { DEFAULT_PITCH } from '../render/cameraRig';
import type { InstrumentData } from '../render/instruments';
import { Hud } from '../ui/hud';
import { UI } from '../ui/menus';
import { generateWorld, type WorldData } from '../world/worldgen';
import type { AssistId } from '../config/flight';
import { Input } from './input';
import { SaveStore, type StorageLike } from './save';
import { keyName, type Settings } from './settings';
import { Tutorial } from './tutorial';
import { isTimeOfDay, type TimeOfDay } from '../render/timeOfDay';
import { waitForOperation } from './pending';
import { InstrumentLists } from './instrumentLists';

type State = 'boot' | 'menu' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed' | 'result' | 'disposed';

interface RunConfig {
  map: MapDef;
  weather: string;
  assist: AssistId;
  tutorial: boolean;
  /** 时段（只影响画面） */
  time?: TimeOfDay;
}

const _wB = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

// 显卡名称：WebGL2 后端是驱动报告的型号（如 “NVIDIA GeForce RTX 4070”）；
// WebGPU 后端只给厂商与架构（如 “nvidia blackwell”），所以两种写法都要能识别。
const isIntegrated = (gpu: string) =>
  (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Vega \d+ Graphics|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpu) && !/Arc|xe-hpg|alchemist|battlemage/i.test(gpu)) ||
  /^intel gen-|^intel xe-lp/i.test(gpu);

/** 按显卡挑默认画质：独立显卡“高”，集成显卡/软件渲染“低”，其余“中” */
function pickQuality(gpu: string): Settings['quality'] {
  if (/RTX|GTX 1[6-9]|GTX [2-9]\d|Radeon RX ?[5-9]|Apple M[1-9]|Arc A[57]|nvidia (turing|ampere|lovelace|ada|blackwell|hopper|rubin)|amd rdna-?[2-9]|apple metal-?3|xe-hpg|battlemage/i.test(gpu)) return 'high';
  if (isIntegrated(gpu)) return 'low';
  return 'medium';
}

/** 浏览器跑在集成显卡上时的提示（笔记本常见：有独显但浏览器默认用核显） */
function gpuWarning(gpu: string): string | null {
  if (!isIntegrated(gpu)) return null;
  return '浏览器当前使用集成显卡（' + gpu.replace(/^ANGLE \(|\)$/g, '').slice(0, 60) + '），画面可能卡顿。电脑有独立显卡时：Windows 设置 → 系统 → 屏幕 → 显示卡，把浏览器设为“高性能”，重启浏览器即可。';
}


/** 只有触屏、没有精确指针（手机/平板）时提示：本游戏需要键盘和鼠标 */
function touchOnlyWarning(): string | null {
  try {
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) {
      return '检测到触屏设备：本游戏需要键盘和鼠标操作，请在电脑浏览器中打开同一个链接。';
    }
  } catch {
    /* 旧浏览器不支持 matchMedia：不提示 */
  }
  return null;
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
  private readonly instrumentLists = new InstrumentLists();
  private loadingRun = false;
  private loadWarning: string | null = null;
  private tutorialHtml = '';
  private controlHintHtml = '';
  private frames = 0;
  private fpsT = 0;
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
      const canvas = this.canvas = document.createElement('canvas');
      rollback.push(() => canvas.remove());
      canvas.className = 'gl';
      root.appendChild(canvas);
      this.view = new WorldView(canvas, this.settings);
      rollback.push(() => this.view.dispose());
      this.hud = new Hud(root);
      rollback.push(() => this.hud.dispose());
      this.hud.setOpacity(this.settings.hudOpacity);
      this.tutBox = document.createElement('div');
      rollback.push(() => this.tutBox.remove());
      this.tutBox.className = 'tutorial hidden';
      root.appendChild(this.tutBox);
      this.ui = new UI(root);
      rollback.push(() => this.ui.dispose());
      this.ui.onClick = () => this.audio.click();
      this.input = new Input(canvas, this.settings);
      rollback.push(() => this.input.dispose());
      this.input.onEdge = (a) => this.onEdge(a);
      this.input.onLockChange = (locked) => {
        if (!locked && this.state === 'playing' && !this.input.lockFailed) this.pause();
      };
      this.view.onThunder = (delay, strength) => this.audio.thunder(delay, strength);
      const listenerOptions = { signal: this.lifetime.signal };
      window.addEventListener('resize', () => {
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
      window.addEventListener('beforeunload', (e) => {
        this.flushSettingsSave();
        if (this.state === 'playing' || this.state === 'paused') {
          e.preventDefault();
          e.returnValue = '';
        }
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
    this.input.onEdge = this.input.onLockChange = null;
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
    this.canvas.remove();
    if (this.pendingOperations === 0) this.disposeView();
  }

  private async startApp(): Promise<void> {
    // 先初始化 GPU（WebGPU，不可用时自动退回 WebGL2），再按显卡选默认画质
    await this.view.init();
    this.assertActive();
    this.gpu = this.view.gpuInfo().name;
    if (this.save.fresh) {
      this.settings.quality = pickQuality(this.gpu);
      this.view.applySettings(this.settings);
      this.save.save();
    }
    const params = new URLSearchParams(location.search);
    const auto = MAPS.find((m) => m.id === params.get('map'));
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
      await this.startRun({ map: m, weather, assist: assist === 'novice' || assist === 'standard' || assist === 'challenge' ? assist : this.settings.assist, tutorial: auto.id === 'training' && params.get('tutorial') !== '0', time: isTimeOfDay(tp) ? tp : 'day' });
      if (params.get('autostart') === '1') this.beginFlight();
    } else this.mainMenu();
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
      { warning: [this.loadWarning, touchOnlyWarning(), gpuWarning(this.gpu), this.save.warning].filter(Boolean).join('<br>') || null, tutorialDone: this.save.data.tutorialDone },
      {
        play: () => this.mapSelect(),
        tutorial: () => void this.startRun({ map: getMap('training'), weather: 'clear', assist: 'novice', tutorial: true }),
        settings: () => this.openSettings(),
        help: () => this.ui.help(this.settings.bindings),
        about: () => this.ui.about(),
      },
    );
  }

  mapSelect(): void {
    this.state = 'menu';
    const list = [...CAMPAIGN.filter((id) => MAPS.find((m) => m.id === id)).map((id) => getMap(id)), getMap('training')];
    this.ui.mapSelect(list, this.save.data.maps, { pick: (m) => this.briefing(m), back: () => this.mainMenu() });
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
    this.audio.applyVolumes({ master: s.volMaster, engine: s.volEngine, ambience: s.volAmbience, alerts: s.volAlerts });
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
      ? `<kbd>${k('hover')}</kbd> 悬停 · <kbd>${k('view')}</kbd> 切换视角 · <kbd>${k('nav')}</kbd> 导航 · <kbd>${k('pause')}</kbd> 暂停`
      : '';
    if (html === this.controlHintHtml) return;
    this.controlHintHtml = html;
    this.hud.setHint(html);
  }

  async startRun(cfg: RunConfig): Promise<void> {
    if (this.disposed || this.loadingRun) return;
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
    this.audio.applyVolumes({ master: this.settings.volMaster, engine: this.settings.volEngine, ambience: this.settings.volAmbience, alerts: this.settings.volAlerts });
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
      const w = await generateWorld(cfg.map, true, (p, l) => this.ui.loading(l, p, cfg.map));
      this.assertActive();
      await this.view.load(w, (p, l) => this.ui.loading(l, p, cfg.map));
      this.assertActive();
      this.world = w;
    }
    this.ui.loading('初始化物理', 0.98, cfg.map);
    const session = await GameSession.create(this.world, cfg.weather, cfg.assist);
    if (this.disposed) {
      session.dispose();
      return;
    }
    this.session = session;
    // 先推进一个物理步（停在坪上，无副作用），让 HUD 在“点击开始”画面里就显示真实的密度、航点等数值
    this.session.step();
    this.session.drainEvents();
    this.tutorial = cfg.tutorial ? new Tutorial(this.settings) : null;
    this.tutorialHtml = '';
    this.audio.setAmbience(cfg.map.ambience);
    this.stepper.reset();
    this.view.rig.setMode('cockpit');
    this.view.rig.yaw = 0;
    this.view.rig.pitch = DEFAULT_PITCH;
    this.state = 'ready';
    this.ui.loading('编译着色器（第一次进入会慢一些）', 0.99, cfg.map);
    await this.warmUp();
    this.assertActive();
    this.hud.show(true);
    const k = (a: keyof Settings['bindings']) => keyName(this.settings.bindings[a][0]);
    const controls = this.settings.hints ? `<br>按住 <kbd>${k('up')}</kbd> 起飞 · <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('left')}</kbd><kbd>${k('right')}</kbd> 飞行 · 鼠标观察 · <kbd>${k('pause')}</kbd> 暂停` : '';
    this.ui.clickToStart(
      cfg.tutorial ? '飞行训练' : cfg.map.name,
      `${cfg.tutorial ? '跟随屏幕提示一步步完成操作。' : (this.session.mission.current()?.def.title ?? '')}${controls}`,
      () => this.beginFlight(),
    );
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
    if (this.tutorial) {
      this.tutorial.start(this.session);
      this.tutBox.classList.remove('hidden');
    }
    if (this.input.lockFailed) this.hud.toast('鼠标锁定不可用：按住鼠标拖动或使用方向键观察', 'warn', 6000);
  }

  pause(): void {
    if (this.state !== 'playing' || !this.session) return;
    this.state = 'paused';
    this.refreshControlHint();
    this.input.active = false;
    this.input.clear();
    this.input.exitLock();
    this.audio.update(this.audioState(true), 0);
    this.ui.pause(
      { tutorial: !!this.tutorial, checkpoints: this.session.restoreOptions() },
      {
        resume: () => this.resume(),
        checkpoint: (i, mode) => this.restoreCheckpoint(i, mode),
        restart: () => void this.restart(),
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
    this.session?.dispose();
    this.session = null;
    this.tutorial = null;
    this.failTimer = this.completeTimer = -1;
    this.audio.update(this.audioState(true), 0);
    this.audio.setAmbience({});
    this.mainMenu();
  }

  private onEdge(a: 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange' | 'hud'): void {
    const s = this.session;
    if (a === 'pause') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && !this.ui.hasModal) this.resume();
      return;
    }
    if (this.state !== 'playing' || !s) return;
    if (a === 'hover') s.toggleHover();
    else if (a === 'boost') s.useBoost();
    else if (a === 'center') this.view.rig.center();
    else if (a === 'view') this.view.rig.setMode(this.view.rig.mode === 'cockpit' ? 'chase' : 'cockpit');
    else if (a === 'nav') s.cycleNav();
    else if (a === 'hud') this.hud.toast(`HUD：${this.hud.cycleMode()}`, 'info', 1500);
    else if (a === 'mapRange') {
      const r = [1000, 2000, 4000];
      const c = this.view.cockpit;
      c.mapRange = r[(r.indexOf(c.mapRange) + 1) % r.length];
      this.hud.toast(`地图范围 ${c.mapRange / 1000} km`, 'info', 1500);
    }
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
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    const frameSeconds = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    const dt = Math.min(frameSeconds, 0.1);
    this.frames++;
    // Report actual elapsed time; the simulation clamp must not hide long stalls.
    this.fpsT += frameSeconds;
    if (this.fpsT >= 1) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
    }
    const s = this.session;
    let alpha = 1;
    const running = this.state === 'playing' && s && s.state === 'running';
    const renderDt = this.state === 'paused' ? 0 : dt;
    this.t += renderDt;
    if (s && running) {
      this.readInput(s, dt);
      const steps = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) {
        s.step();
        this.handleEvents(s.drainEvents());
        if (s.state !== 'running') break;
      }
      alpha = this.stepper.alpha;
      if (this.tutorial) {
        s.mission.locked = this.tutorial.index < 7;
        this.tutorial.update(s, dt);
        const html = this.tutorial.html();
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
      if (s.state === 'crashed' && this.failTimer < 0) this.failTimer = 1.4;
      if (s.state === 'complete' && this.completeTimer < 0) this.completeTimer = 1.6;
    }
    if (this.state === 'playing' && this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) this.showFailure();
    }
    if (this.state === 'playing' && this.completeTimer > 0) {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.showResult();
    }
    if (s && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready' || this.state === 'failed')) {
      this.view.render(s, { dt: renderDt, t: this.t, alpha });
      this.hud.update(s, this.view, this.settings, this.t);
      this.view.drawInstruments(this.t, this.instrumentData(s));
      this.audio.update(this.audioState(this.state !== 'playing'), dt);
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
      this.audio.update(this.audioState(true), dt);
    }
  }

  private readInput(s: GameSession, dt: number): void {
    const I = this.input;
    s.input.pitch = I.axis('back', 'forward');
    s.input.turn = I.axis('left', 'right');
    s.input.lateral = I.axis('strafeLeft', 'strafeRight');
    s.input.vertical = I.axis('down', 'up');
    const [dx, dy] = I.takeLook(dt);
    if (dx || dy) this.view.rig.look(dx, dy);
  }

  private audioState(paused: boolean) {
    const s = this.session;
    if (!s) return { rpm: 0, load: 0, power: 0, airspeed: 0, gust: 0, rain: 0, inCockpit: true, paused, bank: 0, descent: 0 };
    const tel = s.flight.telemetry;
    return {
      rpm: s.state === 'crashed' ? 0.2 : tel.rotorRpm,
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
      mapSize: s.world.map.size,
      speedUnit: this.settings.speedUnit,
    };
  }

  private handleEvents(events: GameEvent[]): void {
    const hud = this.hud;
    const A = this.audio;
    for (const e of events) {
      switch (e.type) {
        case 'damage': {
          const d = e.ev;
          if (d.blocked) {
            if (this.t - this.lastBlocked > 1.5) hud.toast(`护盾吸收了碰撞（${CAUSE_LABEL[d.cause]}）`, 'info', 2000);
            this.lastBlocked = this.t;
            A.impact(d.severity * 0.5);
            this.view.rig.kick(Math.min(1, d.severity / 10));
          } else {
            hud.toast(`耐久 -${Math.round(d.amount)}：${CAUSE_LABEL[d.cause]}`, d.amount > 15 ? 'bad' : 'warn', 2600);
            if (d.cause === 'rotor' || d.cause === 'tailRotor') A.rotorStrike();
            else if (d.cause === 'scrape') A.scrape();
            else A.impact(d.severity);
            this.view.rig.kick(Math.min(1.5, d.amount / 20));
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
          if (e.padId && e.metrics.safe) hud.toast(`接地：${GRADE_LABEL[e.metrics.grade]}（下降 ${e.metrics.descent.toFixed(1)} m/s）`, 'info', 2200);
          break;
        case 'status':
          if (e.status === 'damaged' && e.prev === 'normal') {
            A.alert('damaged');
            hud.toast('机体受损：动力与爬升性能开始下降', 'warn', 4000);
          } else if (e.status === 'critical') {
            A.alert('critical');
            hud.toast('严重受损：性能明显下降，仍可控制，请前往维修点', 'bad', 5000);
          } else if (e.status === 'normal' || (e.status === 'damaged' && e.prev === 'critical')) hud.toast('维修完成，性能恢复', 'good');
          break;
        case 'crash':
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
      { checkpoint: (i, mode) => this.restoreCheckpoint(i, mode), restart: () => void this.restart(), quit: () => this.quitToMenu() },
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
    } else best = this.save.recordResult(run.map.id, score.total, score.rating, s.mission.optional.filter((o) => o.status === 'done').map((o) => o.def.id), s.t);
    const idx = CAMPAIGN.indexOf(run.map.id);
    const nextId = run.tutorial ? 'japan' : idx >= 0 && idx < CAMPAIGN.length - 1 ? CAMPAIGN[idx + 1] : null;
    const next = nextId && MAPS.find((m) => m.id === nextId) ? getMap(nextId) : null;
    this.ui.result(
      {
        map: run.map,
        score,
        best,
        time: s.t,
        landing: s.mission.finalLanding,
        optional: s.mission.optional.map((o) => ({ title: o.def.title, done: o.status === 'done' })),
        next,
        tutorial: run.tutorial,
      },
      {
        again: () => void this.restart(),
        maps: () => {
          this.quitToMenu();
          this.mapSelect();
        },
        next: () => next && this.briefing(next),
        menu: () => this.quitToMenu(),
      },
    );
  }
}
