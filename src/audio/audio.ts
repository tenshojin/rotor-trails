// 程序化音频（WebAudio 实时合成，无外部音频文件）。旋翼、涡轮、传动、风雨在音频线程里合成（heliSynth.js），
// 这里管总线和一次性的声音：雷声、碰撞、擦碰、旋翼撞击、着陆、告警、开关、地图环境音（海浪/海鸥/鸟鸣/虫鸣/河流/山风）。

import type { AmbienceDef } from '../maps/types';
import synthUrl from './heliSynth.js?url';

const volume = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** 超仿真多出来的声源（其他模式不传，发动机一直在转） */
export interface SimAudio {
  /** N1（0..1） */
  n1: number;
  lit: boolean;
  starter: boolean;
  ignite: boolean;
  torque: number;
  /** 尾桨推力 0..1 */
  tail: number;
  /** 机身振动 0..1 */
  vib: number;
  /** 汇流条有电（陀螺和风扇） */
  bus: boolean;
  pump: boolean;
  hyd: boolean;
  vent: number;
  heat: number;
  /** 电台音量、机内通话、静噪门限、摩尔斯、紧急频率 */
  radio: number;
  ics: number;
  squelch: number;
  morse: number;
  siren: number;
  /** 耳机音量 0..1 */
  headset: number;
  /** 低转速喇叭 */
  horn: boolean;
}

export interface AudioState {
  /** 离地高度（贴地时的反射声） */
  agl?: number;
  sim?: SimAudio | null;
  rpm: number;
  load: number; // 推力/重量
  power: number; // 0..1
  airspeed: number;
  gust: number;
  rain: number;
  inCockpit: boolean;
  paused: boolean;
  bank: number; // rad
  descent: number; // m/s
}

export interface Volumes {
  master: number;
  engine: number;
  ambience: number;
  alerts: number;
}

function smooth01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return b;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private ambBus!: GainNode;
  private alertBus!: GainNode;
  private cabinFilter!: BiquadFilterNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  /** 旋翼、涡轮、传动、风雨都在音频线程里合成（heliSynth.js） */
  private synth: AudioWorkletNode | null = null;
  private synthLoading = false;
  /** 低转速喇叭、火警铃：响着的时候一直响 */
  private horn: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private wasLit = false;
  private ambNodes: AudioNode[] = [];
  private ambSources = new Set<AudioScheduledSourceNode>();
  private transient = new Map<AudioScheduledSourceNode, AudioNode[]>();
  private targets = new WeakMap<AudioParam, number>();
  private ambTimer = 0;
  private ambience: AmbienceDef = {};
  private volumes: Volumes = { master: 0.8, engine: 0.8, ambience: 0.7, alerts: 0.8 };
  private alertCooldown: Record<string, number> = {};
  private paused = true;
  enabled = true;

  /** 必须在用户手势中调用（浏览器自动播放策略）。 */
  init(): void {
    if (this.ctx?.state === 'closed') this.dispose();
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.resume();
      return;
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) {
      this.enabled = false;
      return;
    }
    try {
      this.ctx = new AC();
    } catch {
      this.enabled = false;
      return;
    }
    const ctx = this.ctx;
    try {
      this.white = noiseBuffer(ctx, 2);
      this.brown = noiseBuffer(ctx, 3, true);
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      this.cabinFilter = ctx.createBiquadFilter();
      this.cabinFilter.type = 'lowpass';
      this.cabinFilter.frequency.value = 3800;
      this.cabinFilter.connect(this.master);
      this.engineBus = ctx.createGain();
      this.engineBus.gain.value = 0;
      // 发动机一路已经在合成器里按舱内 / 舱外滤过了
      this.engineBus.connect(this.master);
      this.ambBus = ctx.createGain();
      this.ambBus.gain.value = 0;
      this.ambBus.connect(this.cabinFilter);
      this.alertBus = ctx.createGain();
      this.alertBus.connect(this.master);
      this.loadSynth();
      this.applyVolumes(this.volumes);
      this.setAmbience(this.ambience);
      this.enabled = true;
    } catch {
      // Audio-node/buffer creation can fail after the context itself succeeds.
      // Keep the game usable and close the partial graph instead of leaking it.
      this.dispose();
      this.enabled = false;
    }
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start();
    return s;
  }

  /** 加载音频线程的合成器。加载失败只是没有发动机声，游戏照常可玩 */
  private loadSynth(): void {
    const ctx = this.ctx;
    if (!ctx?.audioWorklet || this.synth || this.synthLoading) return;
    this.synthLoading = true;
    ctx.audioWorklet
      .addModule(new URL(synthUrl, document.baseURI).href)
      .then(() => {
        this.synthLoading = false;
        if (this.ctx !== ctx || ctx.state === 'closed') return;
        const node = new AudioWorkletNode(ctx, 'heli-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        node.connect(this.engineBus);
        this.synth = node;
      })
      .catch((e) => {
        this.synthLoading = false;
        console.warn('发动机声音加载失败：', e);
      });
  }

  /** 切换地图环境音。 */
  setAmbience(a: AmbienceDef): void {
    this.ambience = a;
    this.ambTimer = 0;
    for (const source of this.ambSources) {
      this.stopSource(source);
      this.releaseTransient(source);
    }
    this.ambSources.clear();
    for (const node of this.ambNodes) node.disconnect();
    this.ambNodes = [];
    if (!this.ctx || this.ctx.state === 'closed') return;
    const ctx = this.ctx;
    const addLoop = (buf: AudioBuffer, rate: number, type: BiquadFilterType, freq: number, q: number, level: number, lfoHz = 0) => {
      const s = this.loop(buf, rate);
      this.ambSources.add(s);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      s.connect(f).connect(g).connect(this.ambBus);
      if (lfoHz > 0) {
        const l = ctx.createOscillator();
        l.frequency.value = lfoHz;
        const lg = ctx.createGain();
        lg.gain.value = level * 0.6;
        l.connect(lg).connect(g.gain);
        l.start();
        this.ambSources.add(l);
        this.ambNodes.push(lg);
      }
      this.ambNodes.push(f, g);
    };
    if (a.sea) addLoop(this.brown, 0.8, 'lowpass', 600, 0.5, 0.25 * a.sea, 0.09);
    if (a.river) addLoop(this.white, 0.5, 'bandpass', 700, 0.6, 0.08 * a.river, 0.3);
    if (a.insects) addLoop(this.white, 1, 'bandpass', 5200, 6, 0.1 * a.insects, 23);
    if (a.wind) addLoop(this.brown, 0.5, 'bandpass', 240, 1.5, 0.18 * a.wind, 0.05);
  }

  applyVolumes(v: Volumes): void {
    this.volumes = { master: volume(v.master), engine: volume(v.engine), ambience: volume(v.ambience), alerts: volume(v.alerts) };
    if (!this.ctx) return;
    const current = this.volumes;
    this.smooth(this.master.gain, current.master, 0.03);
    this.smooth(this.engineBus.gain, this.paused ? 0 : current.engine, 0.03);
    this.smooth(this.ambBus.gain, this.paused ? 0 : current.ambience, 0.03);
    this.smooth(this.alertBus.gain, current.alerts, 0.03);
  }

  private smooth(param: AudioParam, value: number, tc = 0.08): void {
    if (!this.ctx || !Number.isFinite(value) || this.targets.get(param) === value) return;
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
    this.targets.set(param, value);
  }

  /** 每帧更新持续声源。 */
  update(s: AudioState, dt: number): void {
    this.paused = s.paused;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    this.smooth(this.engineBus.gain, s.paused ? 0 : this.volumes.engine, 0.1);
    this.smooth(this.ambBus.gain, s.paused ? 0 : this.volumes.ambience, 0.1);
    if (s.paused) {
      return;
    }
    this.smooth(this.cabinFilter.frequency, s.inCockpit ? 3400 : 12000, 0.2);
    const y = s.sim;
    const speed = s.airspeed;
    // 桨叶拍击：撞上自己的尾涡。典型工况是带速度的小下降率、压坡度的转弯；太快时前行桨尖的激波也有类似的声音
    const bvi = smooth01(0.8, 3.2, s.descent) * (1 - smooth01(7, 11, s.descent)) * smooth01(10, 28, speed);
    const turn = Math.abs(s.bank) * 0.9 * Math.max(0, s.load - 0.9) * smooth01(12, 30, speed);
    const fast = smooth01(62, 80, speed) * 0.7;
    const slap = Math.min(1, bvi + turn + fast + (y?.vib ?? 0) * 0.3);
    this.synth?.port.postMessage({
      nr: s.rpm,
      n1: y ? y.n1 : 0.72 + 0.28 * Math.min(1, s.power),
      lit: y ? (y.lit ? 1 : 0) : 1,
      starter: y?.starter ? 1 : 0,
      ignite: y?.ignite ? 1 : 0,
      load: Math.max(0, Math.min(1.6, s.load)),
      torque: y ? y.torque : s.power,
      tail: y ? y.tail : 0.4 + 0.3 * Math.min(1, s.power),
      slap,
      air: speed,
      gust: Math.min(1, s.gust / 15),
      rain: s.rain,
      vib: y?.vib ?? 0,
      bus: y?.bus ? 1 : 0,
      pump: y?.pump ? 1 : 0,
      hyd: y?.hyd ? 1 : 0,
      vent: y?.vent ?? 0,
      heat: y?.heat ?? 0,
      cabin: s.inCockpit ? 1 : 0,
      agl: s.agl ?? 500,
      radio: y?.radio ?? 0,
      ics: y?.ics ?? 0,
      squelch: y?.squelch ?? 0.5,
      morse: y?.morse ?? 0,
      siren: y?.siren ?? 0,
      volume: y ? 0.45 + 0.75 * y.headset : 1,
    });
    if (y) {
      if (y.lit && !this.wasLit) this.burst(0.7, 0.22, 'lowpass', 170, this.engineBus);
      this.wasLit = y.lit;
      this.setHorn(y.horn);
    } else this.setHorn(false);
    // 偶发环境音（海鸥、鸟鸣、蛙鸣）
    this.ambTimer -= dt;
    if (this.ambTimer <= 0) {
      this.ambTimer = 1.5 + Math.random() * 4;
      const a = this.ambience;
      if (a.gulls && Math.random() < a.gulls) this.chirp(1300, 2300, 0.35, 0.05, 'triangle');
      if (a.birds && Math.random() < a.birds) for (let i = 0; i < 3; i++) this.chirp(2600 + Math.random() * 1500, 3800 + Math.random() * 900, 0.09, 0.025, 'sine', i * 0.12);
      if (a.insects && Math.random() < 0.4) this.chirp(160, 120, 0.25, 0.04, 'square');
    }
  }

  /** Release short effects as soon as they finish; scheduled birds belong to their map. */
  private track(source: AudioScheduledSourceNode, nodes: AudioNode[], ambient = false): void {
    this.transient.set(source, nodes);
    if (ambient) this.ambSources.add(source);
    source.onended = () => this.releaseTransient(source);
  }

  private releaseTransient(source: AudioScheduledSourceNode): void {
    const nodes = this.transient.get(source);
    if (!nodes) return;
    this.transient.delete(source);
    this.ambSources.delete(source);
    source.onended = null;
    source.disconnect();
    for (const node of nodes) node.disconnect();
  }

  private stopSource(source: AudioScheduledSourceNode): void {
    try { source.stop(); } catch { /* Already stopped, or a partially initialized source. */ }
    source.disconnect();
  }

  private tone(freq: number, dur: number, peak: number, type: OscillatorType = 'sine', bus?: GainNode, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    o.connect(g).connect(bus ?? this.alertBus);
    this.track(o, [g]);
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chirp(f0: number, f1: number, dur: number, peak: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + dur);
    const g = ctx.createGain();
    o.connect(g).connect(this.ambBus);
    this.track(o, [g], true);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, peak: number, type: BiquadFilterType, freq: number, bus?: GainNode, delay = 0, brown = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    // A thunder roll can last longer than the reusable noise buffer.
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(bus ?? this.engineBus);
    this.track(s, [f, g], bus === this.ambBus);
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  impact(strength: number): void {
    const v = Math.min(1, strength / 10);
    this.burst(0.35 + v * 0.4, 0.3 + v * 0.7, 'lowpass', 700 + v * 1200);
    this.tone(70, 0.4, 0.25 + v * 0.5, 'sine', this.engineBus);
  }

  scrape(): void {
    this.burst(0.25, 0.18, 'bandpass', 1700);
  }

  rotorStrike(): void {
    this.burst(0.6, 0.9, 'bandpass', 900);
    for (const f of [310, 470, 655, 830]) this.tone(f, 0.5, 0.12, 'square', this.engineBus);
  }

  touchdown(descent: number): void {
    const v = Math.min(1, descent / 3);
    this.tone(55, 0.22, 0.15 + v * 0.45, 'sine', this.engineBus);
    this.burst(0.18, 0.05 + v * 0.2, 'lowpass', 400);
  }

  private canAlert(key: string, cd: number): boolean {
    const t = this.ctx?.currentTime ?? 0;
    if ((this.alertCooldown[key] ?? -100) + cd > t) return false;
    this.alertCooldown[key] = t;
    return true;
  }

  alert(kind: 'damaged' | 'critical' | 'terrain' | 'gust' | 'limit' | 'water' | 'caution'): void {
    if (!this.ctx) return;
    if (kind === 'caution' && this.canAlert(kind, 2.5)) {
      // 主告警：一声低、一声高的提示音
      this.tone(660, 0.16, 0.14, 'triangle');
      this.tone(880, 0.22, 0.14, 'triangle', undefined, 0.17);
      return;
    }
    if (kind === 'damaged' && this.canAlert(kind, 4)) {
      this.tone(880, 0.25, 0.25);
      this.tone(660, 0.35, 0.25, 'sine', undefined, 0.28);
    } else if (kind === 'critical' && this.canAlert(kind, 8)) {
      for (let i = 0; i < 3; i++) this.tone(1040, 0.14, 0.28, 'square', undefined, i * 0.22);
    } else if (kind === 'terrain' && this.canAlert(kind, 1.2)) {
      this.tone(1250, 0.12, 0.22, 'square');
      this.tone(1250, 0.12, 0.22, 'square', undefined, 0.2);
    } else if (kind === 'gust' && this.canAlert(kind, 5)) {
      this.tone(520, 0.3, 0.12, 'triangle');
    } else if (kind === 'limit' && this.canAlert(kind, 6)) {
      this.tone(740, 0.18, 0.15, 'triangle');
    } else if (kind === 'water' && this.canAlert(kind, 2)) {
      this.tone(600, 0.4, 0.25, 'sawtooth');
    }
  }

  pickup(kind: 'boost' | 'shield' | 'repair'): void {
    if (!this.ctx) return;
    if (kind === 'boost') [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 0.2, 'triangle', undefined, i * 0.07));
    else if (kind === 'shield') [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, 0.6, 0.1, 'sine', undefined, i * 0.04));
    else for (let i = 0; i < 5; i++) this.tone(300 + i * 60, 0.08, 0.15, 'square', undefined, i * 0.09);
  }

  boost(): void {
    if (!this.ctx) return;
    this.burst(1.2, 0.3, 'bandpass', 1200, this.alertBus);
    this.tone(220, 1.0, 0.15, 'sawtooth');
  }

  checkpoint(): void {
    this.tone(784, 0.18, 0.15);
    this.tone(1047, 0.3, 0.15, 'sine', undefined, 0.15);
  }

  success(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 0.18, 'triangle', undefined, i * 0.12));
  }

  fail(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.5, 0.2, 'sawtooth', undefined, i * 0.2));
  }

  thunder(delay: number, strength: number): void {
    if (!this.ctx) return;
    this.burst(2.5 + strength * 2, 0.6 * strength, 'lowpass', 160, this.ambBus, Math.min(8, delay), true);
    this.burst(0.6, 0.35 * strength, 'lowpass', 500, this.ambBus, Math.min(8, delay), true);
  }

  /** 座舱开关的声音：每一种都由“金属/塑料的一声脆响 + 底座传来的一声闷响”组成 */
  control(kind: 'rocker' | 'toggle' | 'button' | 'detent' | 'breaker' | 'lever' | 'guard' | 'none'): void {
    if (!this.ctx || kind === 'none') return;
    const bus = this.alertBus;
    if (kind === 'rocker') {
      this.burst(0.012, 0.13, 'bandpass', 2400, bus);
      this.tone(190, 0.035, 0.1, 'sine', bus);
      this.burst(0.008, 0.06, 'highpass', 5200, bus, 0.006);
    } else if (kind === 'toggle') {
      this.burst(0.008, 0.16, 'bandpass', 3600, bus);
      this.tone(5400, 0.012, 0.04, 'sine', bus);
      this.burst(0.02, 0.06, 'bandpass', 1500, bus, 0.004);
    } else if (kind === 'button') {
      this.burst(0.006, 0.07, 'bandpass', 1700, bus);
      this.tone(260, 0.015, 0.04, 'sine', bus);
    } else if (kind === 'detent') {
      this.burst(0.004, 0.05, 'bandpass', 3000, bus);
    } else if (kind === 'breaker') {
      this.burst(0.018, 0.18, 'bandpass', 900, bus);
      this.tone(320, 0.03, 0.13, 'sine', bus);
    } else if (kind === 'lever') {
      this.burst(0.14, 0.04, 'bandpass', 1100, bus);
      this.tone(150, 0.05, 0.13, 'sine', bus, 0.13);
      this.burst(0.012, 0.13, 'lowpass', 1600, bus, 0.13);
    } else {
      this.burst(0.016, 0.13, 'bandpass', 1200, bus);
      this.tone(240, 0.03, 0.08, 'sine', bus);
    }
  }

  /** 低转速喇叭：一直响到转速回来或者静音 */
  private setHorn(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.horn) {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(this.alertBus);
      const osc = [590, 880].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(gain);
        o.start();
        return o;
      });
      gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.02);
      this.horn = { osc, gain };
    } else if (!on && this.horn) {
      const h = this.horn;
      this.horn = null;
      h.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      for (const o of h.osc) {
        try {
          o.stop(ctx.currentTime + 0.12);
        } catch {
          /* 已经停了 */
        }
      }
      setTimeout(() => h.gain.disconnect(), 300);
    }
  }

  click(): void {
    this.init();
    this.tone(1400, 0.05, 0.08, 'square');
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    void this.ctx?.resume().catch(() => undefined);
  }

  dispose(): void {
    this.setAmbience({});
    for (const source of this.transient.keys()) {
      this.stopSource(source);
      this.releaseTransient(source);
    }
    this.transient.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.synth?.disconnect();
    this.synth = null;
    this.synthLoading = false;
    this.horn = null;
    this.wasLit = false;
    this.alertCooldown = {};
    this.targets = new WeakMap();
    this.paused = true;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
