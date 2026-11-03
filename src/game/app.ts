// 游戏总控：界面状态机、渲染循环、固定步长仿真（1/60 s，渲染插值）、暂停/后台处理、事件反馈、存档。

import * as THREE from 'three';
import { AudioEngine } from '../audio/audio';
import { MAPS, CAMPAIGN, getMap } from '../maps/index';
import type { MapDef, MapId } from '../maps/types';
import { CAUSE_LABEL } from '../sim/damage';
import { GRADE_LABEL } from '../sim/mission';
import { computeScore } from '../sim/scoring';
import { GameSession, STEP, type GameEvent } from '../sim/session';
import { WorldView } from '../render/worldView';
import { DEFAULT_PITCH } from '../render/cameraRig';
import type { InstrumentData } from '../render/instruments';
import { Hud } from '../ui/hud';
import { UI } from '../ui/menus';
import { generateWorld, type WorldData } from '../world/worldgen';
import type { AssistId } from '../config/flight';
import { Input } from './input';
import { SaveStore } from './save';
import { keyName, type Settings } from './settings';
import { Tutorial } from './tutorial';

type State = 'boot' | 'menu' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed' | 'result';

interface RunConfig {
  map: MapDef;
  weather: string;
  assist: AssistId;
  tutorial: boolean;
}

const MAX_STEPS = 6;

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
  private acc = 0;
  private last = 0;
  private t = 0;
  private idleAngle = 0;
  private tutBox: HTMLDivElement;
  private failTimer = -1;
  private completeTimer = -1;
  private lastBlocked = -10;
  private resumeAfterSettings: State | null = null;
  private frames = 0;
  private fpsT = 0;
  fps = 0;

  constructor(root: HTMLElement) {
    this.save = new SaveStore();
    this.settings = this.save.data.settings;
    const canvas = document.createElement('canvas');
    canvas.className = 'gl';
    root.appendChild(canvas);
    this.view = new WorldView(canvas, this.settings);
    this.hud = new Hud(root);
    this.hud.setOpacity(this.settings.hudOpacity);
    this.tutBox = document.createElement('div');
    this.tutBox.className = 'tutorial hidden';
    root.appendChild(this.tutBox);
    this.ui = new UI(root);
    this.ui.onClick = () => this.audio.click();
    this.input = new Input(canvas, this.settings);
    this.input.onEdge = (a) => this.onEdge(a);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.lockFailed) this.pause();
    };
    this.view.onThunder = (delay, strength) => this.audio.thunder(delay, strength);
    window.addEventListener('resize', () => {
      this.view.resize();
      this.hud.resize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else if (this.state !== 'playing') this.audio.resume();
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.state === 'playing' && this.tutorial && this.session) {
        this.tutorial.skip(this.session);
        e.preventDefault();
      }
      if (e.code === 'F3') {
        this.hud.showDebug = !this.hud.showDebug;
        e.preventDefault();
      }
    });
    this.hud.resize();
  }

  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const auto = params.get('map') as MapId | null;
    if (!auto) {
      // 菜单背景：训练场
      this.ui.loading('生成训练场', 0.1);
      const w = await generateWorld(getMap('training'), true, (p, l) => this.ui.loading(l, p * 0.9));
      await this.view.load(w, (p, l) => this.ui.loading(l, p));
      this.world = w;
      const pad = w.pads.get(w.map.spawn.padId)!;
      this.view.heli.root.position.set(pad.pos[0], pad.pos[1] + 1.32, pad.pos[2]);
      this.view.heli.root.quaternion.identity();
    }
    requestAnimationFrame(this.frame);
    if (auto && MAPS.find((m) => m.id === auto)) {
      const m = getMap(auto);
      await this.startRun({ map: m, weather: params.get('weather') ?? m.defaultWeather, assist: (params.get('assist') as AssistId) ?? this.settings.assist, tutorial: auto === 'training' && params.get('tutorial') !== '0' });
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
    this.hud.show(false);
    this.tutBox.classList.add('hidden');
    this.input.active = false;
    this.input.exitLock();
    this.ui.main(
      { warning: this.save.warning, tutorialDone: this.save.data.tutorialDone },
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
      start: (weather, assist) => void this.startRun({ map: m, weather, assist, tutorial: false }),
      back: () => this.mapSelect(),
    });
  }

  openSettings(): void {
    this.ui.settings(this.settings, {
      change: (s) => this.applySettings(s),
      capture: (cb) => this.input.captureNextKey(cb),
      close: () => {
        this.save.save();
        if (this.resumeAfterSettings) this.resumeAfterSettings = null;
      },
    });
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.save.data.settings = s;
    this.view.applySettings(s);
    this.input.setSettings(s);
    this.hud.setOpacity(s.hudOpacity);
    this.audio.applyVolumes({ master: s.volMaster, engine: s.volEngine, ambience: s.volAmbience, alerts: s.volAlerts });
    this.save.save();
  }

  async startRun(cfg: RunConfig): Promise<void> {
    this.audio.init();
    this.audio.applyVolumes({ master: this.settings.volMaster, engine: this.settings.volEngine, ambience: this.settings.volAmbience, alerts: this.settings.volAlerts });
    this.state = 'loading';
    this.hud.show(false);
    this.tutBox.classList.add('hidden');
    this.session?.dispose();
    this.session = null;
    this.run = cfg;
    if (!this.world || this.world.map.id !== cfg.map.id) {
      this.ui.loading('生成地形', 0.02);
      const w = await generateWorld(cfg.map, true, (p, l) => this.ui.loading(l, p));
      await this.view.load(w, (p, l) => this.ui.loading(l, p));
      this.world = w;
    }
    this.ui.loading('初始化物理', 0.98);
    this.session = await GameSession.create(this.world, cfg.weather, cfg.assist);
    this.tutorial = cfg.tutorial ? new Tutorial(this.settings) : null;
    this.audio.setAmbience(cfg.map.ambience);
    this.acc = 0;
    this.view.rig.setMode('cockpit');
    this.view.rig.yaw = 0;
    this.view.rig.pitch = DEFAULT_PITCH;
    this.state = 'ready';
    this.hud.show(true);
    const k = (a: keyof Settings['bindings']) => keyName(this.settings.bindings[a][0]);
    this.ui.clickToStart(
      cfg.tutorial ? '飞行训练' : cfg.map.name,
      `${cfg.tutorial ? '跟随屏幕提示一步步完成操作。' : (this.session.mission.current()?.def.title ?? '')}<br>按住 <kbd>${k('up')}</kbd> 起飞 · <kbd>${k('forward')}</kbd><kbd>${k('back')}</kbd><kbd>${k('left')}</kbd><kbd>${k('right')}</kbd> 飞行 · 鼠标观察 · <kbd>Esc</kbd> 暂停`,
      () => this.beginFlight(),
    );
  }

  beginFlight(): void {
    if (!this.session) return;
    this.audio.init();
    this.ui.clear();
    this.state = 'playing';
    this.input.active = true;
    this.input.clear();
    this.input.requestLock();
    this.last = performance.now();
    this.acc = 0;
    if (this.tutorial) {
      this.tutorial.start(this.session);
      this.tutBox.classList.remove('hidden');
    }
    if (this.input.lockFailed) this.hud.toast('鼠标锁定不可用：按住鼠标拖动或使用方向键观察', 'warn', 6000);
  }

  pause(): void {
    if (this.state !== 'playing' || !this.session) return;
    this.state = 'paused';
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
    if (!this.session) return;
    this.ui.clear();
    this.state = 'playing';
    this.input.active = true;
    this.input.clear();
    this.input.requestLock();
    this.last = performance.now();
    this.acc = 0;
  }

  restoreCheckpoint(i: number, mode: 'exact' | 'safe'): void {
    if (!this.session) return;
    this.session.restoreCheckpoint(i, mode);
    this.failTimer = -1;
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
    this.mainMenu();
  }

  private onEdge(a: 'hover' | 'boost' | 'center' | 'pause' | 'view' | 'nav' | 'mapRange'): void {
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
    else if (a === 'mapRange') {
      const r = [1000, 2000, 4000];
      const c = this.view.cockpit;
      c.mapRange = r[(r.indexOf(c.mapRange) + 1) % r.length];
      this.hud.toast(`地图范围 ${c.mapRange / 1000} km`, 'info', 1500);
    }
  }

  // ---------------- 主循环 ----------------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    this.frames++;
    this.fpsT += dt;
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
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        s.step();
        steps++;
        this.acc -= STEP;
        this.handleEvents(s.drainEvents());
        if (s.state !== 'running') break;
      }
      if (steps >= MAX_STEPS) this.acc = 0;
      alpha = Math.min(1, this.acc / STEP);
      if (this.tutorial) {
        s.mission.locked = this.tutorial.index < 7;
        this.tutorial.update(s, dt);
        this.tutBox.innerHTML = this.tutorial.html();
        if (this.tutorial.done && this.completeTimer < 0 && !s.mission.complete) {
          this.completeTimer = 0.5;
        }
      }
    }
    if (this.state === 'playing' && s && s.state !== 'running') {
      if (s.state === 'crashed' && this.failTimer < 0) this.failTimer = 1.4;
      if (s.state === 'complete' && this.completeTimer < 0) this.completeTimer = 1.6;
    }
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) this.showFailure();
    }
    if (this.completeTimer > 0) {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.showResult();
    }
    if (s && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready' || this.state === 'failed')) {
      this.view.render(s, { dt: renderDt, t: this.t, alpha });
      this.hud.update(s, this.view, this.settings, this.t);
      this.view.drawInstruments(this.t, this.instrumentData(s));
      this.audio.update(this.audioState(this.state !== 'playing'), dt);
    } else {
      // 菜单背景：绕停机坪缓慢环绕
      this.idleAngle += dt * 0.05;
      const c = this.view.heli.root.position;
      const r = 28;
      const pos = new THREE.Vector3(c.x + Math.sin(this.idleAngle) * r, c.y + 7, c.z + Math.cos(this.idleAngle) * r);
      this.view.render(null, { dt, t: this.t, alpha: 1 }, { pos, target: new THREE.Vector3(c.x, c.y + 1.5, c.z) });
      this.audio.update(this.audioState(true), dt);
    }
  };

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
    const route: Array<[number, number]> = [[s.body.pos.x, s.body.pos.z], ...nav.preview.map((p) => [p.pos[0], p.pos[2]] as [number, number])];
    const objs = s.mission.optional.filter((o) => o.status !== 'done').map((o) => {
      const g = s.mission.goalOf(o, s.body.pos);
      return { x: g[0], z: g[2], main: false };
    });
    const cur = s.mission.current();
    if (cur) {
      const g = s.mission.goalOf(cur, s.body.pos);
      objs.push({ x: g[0], z: g[2], main: true });
    }
    return {
      pitch: tel.pitch,
      roll: tel.roll,
      heading: ((tel.heading * 180) / Math.PI + 360) % 360,
      airspeed: tel.airspeed,
      groundSpeed: s.groundSpeed,
      altitudeMSL: s.altitudeMSL(),
      agl: s.agl,
      vs: s.body.vel.y,
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
      route,
      objectives: objs,
      pickups: s.world.map.pickups.filter((p) => !s.pickupsTaken.has(p.id)).map((p) => ({ x: p.pos[0], z: p.pos[2], kind: p.kind })),
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
            e.kind === 'boost' ? '获得动力增强（按 Shift 使用）' : e.kind === 'shield' ? (e.result === 'shieldExtended' ? '护盾时间延长' : '免伤护盾已生效') : '维修补给：耐久 +25',
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
