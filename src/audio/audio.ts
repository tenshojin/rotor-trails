// 程序化音频（WebAudio 实时合成，无外部音频文件）：旋翼拍击声、涡轮发动机、尾桨、风噪、雨声与暴雨、
// 雷声、碰撞、擦碰、旋翼撞击、着陆、耐久告警、地形告警、阵风提示、Buff 提示、地图环境音（海浪/海鸥/鸟鸣/虫鸣/河流/山风）。

import type { AmbienceDef } from '../maps/types';

export interface AudioState {
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
  // 持续声源
  private rotorNoiseGain!: GainNode;
  private rotorAM!: GainNode;
  private rotorLfo!: OscillatorNode;
  private rotorFilter!: BiquadFilterNode;
  private thump!: OscillatorNode;
  private thumpGain!: GainNode;
  private turbine: OscillatorNode[] = [];
  private turbineGain!: GainNode;
  private hum!: OscillatorNode;
  private humGain!: GainNode;
  private tailGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private rainLow!: GainNode;
  private amb: Array<{ gain: GainNode; base: number }> = [];
  private ambTimer = 0;
  private ambience: AmbienceDef = {};
  private volumes: Volumes = { master: 0.8, engine: 0.8, ambience: 0.7, alerts: 0.8 };
  private alertCooldown: Record<string, number> = {};
  enabled = true;

  /** 必须在用户手势中调用（浏览器自动播放策略）。 */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
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
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 3800;
    this.cabinFilter.connect(this.master);
    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.cabinFilter);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.cabinFilter);
    this.alertBus = ctx.createGain();
    this.alertBus.connect(this.master);
    this.buildEngine();
    this.buildWeather();
    this.applyVolumes(this.volumes);
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start();
    return s;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    // 旋翼：带通噪声，被桨叶通过频率的低频振荡调制 → “哒哒哒”的拍击声
    const n = this.loop(this.white);
    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'bandpass';
    this.rotorFilter.frequency.value = 420;
    this.rotorFilter.Q.value = 0.7;
    this.rotorAM = ctx.createGain();
    this.rotorAM.gain.value = 0.5;
    this.rotorNoiseGain = ctx.createGain();
    this.rotorNoiseGain.gain.value = 0;
    n.connect(this.rotorFilter).connect(this.rotorAM).connect(this.rotorNoiseGain).connect(this.engineBus);
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'sawtooth';
    this.rotorLfo.frequency.value = 19;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.pow(Math.max(0, x), 3) * 1.4 - 0.25;
    }
    shaper.curve = curve;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.55;
    this.rotorLfo.connect(shaper).connect(lfoGain).connect(this.rotorAM.gain);
    this.rotorLfo.start();
    // 低频“砰砰”声
    this.thump = ctx.createOscillator();
    this.thump.type = 'sine';
    this.thump.frequency.value = 38;
    this.thumpGain = ctx.createGain();
    this.thumpGain.gain.value = 0;
    this.thump.connect(this.thumpGain).connect(this.engineBus);
    this.thump.start();
    // 涡轮啸声
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    hp.connect(this.turbineGain).connect(this.engineBus);
    for (const f of [5600, 5640, 8400]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(hp);
      o.start();
      this.turbine.push(o);
    }
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 112;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 500;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(humLp).connect(this.humGain).connect(this.engineBus);
    this.hum.start();
    // 尾桨嗡声
    const tn = this.loop(this.white, 0.9);
    const tbp = ctx.createBiquadFilter();
    tbp.type = 'bandpass';
    tbp.frequency.value = 900;
    tbp.Q.value = 2;
    const tam = ctx.createGain();
    const tl = ctx.createOscillator();
    tl.frequency.value = 98;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.4;
    tl.connect(tlg).connect(tam.gain);
    tl.start();
    this.tailGain = ctx.createGain();
    this.tailGain.gain.value = 0;
    tn.connect(tbp).connect(tam).connect(this.tailGain).connect(this.engineBus);
  }

  private buildWeather(): void {
    const ctx = this.ctx!;
    const wn = this.loop(this.brown, 1.4);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wn.connect(this.windFilter).connect(this.windGain).connect(this.ambBus);
    const rn = this.loop(this.white, 0.7);
    const rhp = ctx.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rn.connect(rhp).connect(this.rainGain).connect(this.ambBus);
    const rl = this.loop(this.brown, 0.6);
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 260;
    this.rainLow = ctx.createGain();
    this.rainLow.gain.value = 0;
    rl.connect(rlp).connect(this.rainLow).connect(this.ambBus);
  }

  /** 切换地图环境音。 */
  setAmbience(a: AmbienceDef): void {
    this.ambience = a;
    if (!this.ctx) return;
    for (const x of this.amb) x.gain.disconnect();
    this.amb = [];
    const ctx = this.ctx;
    const addLoop = (buf: AudioBuffer, rate: number, type: BiquadFilterType, freq: number, q: number, level: number, lfoHz = 0) => {
      const s = this.loop(buf, rate);
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
      }
      this.amb.push({ gain: g, base: level });
    };
    if (a.sea) addLoop(this.brown, 0.8, 'lowpass', 600, 0.5, 0.25 * a.sea, 0.09);
    if (a.river) addLoop(this.white, 0.5, 'bandpass', 700, 0.6, 0.08 * a.river, 0.3);
    if (a.insects) addLoop(this.white, 1, 'bandpass', 5200, 6, 0.1 * a.insects, 23);
    if (a.wind) addLoop(this.brown, 0.5, 'bandpass', 240, 1.5, 0.18 * a.wind, 0.05);
  }

  applyVolumes(v: Volumes): void {
    this.volumes = v;
    if (!this.ctx) return;
    this.master.gain.value = v.master;
    this.engineBus.gain.value = v.engine;
    this.ambBus.gain.value = v.ambience;
    this.alertBus.gain.value = v.alerts;
  }

  /** 每帧更新持续声源。 */
  update(s: AudioState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const k = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, now, tc);
    if (s.paused) {
      k(this.master.gain, 0, 0.1);
      return;
    }
    k(this.master.gain, this.volumes.master, 0.2);
    k(this.cabinFilter.frequency, s.inCockpit ? 3400 : 12000, 0.2);
    const rpm = s.rpm;
    const load = Math.max(0, Math.min(1.6, s.load));
    // 拍击声：载荷越大、坡度越大、下降越快越明显
    const slap = Math.min(1, 0.25 + load * 0.45 + Math.abs(s.bank) * 0.5 + Math.max(0, s.descent - 2) * 0.08);
    k(this.rotorLfo.frequency, 19 * rpm);
    k(this.rotorNoiseGain.gain, 0.33 * rpm * (0.6 + slap * 0.6));
    k(this.rotorFilter.frequency, 280 + slap * 520);
    k(this.thump.frequency, 38 * rpm);
    k(this.thumpGain.gain, 0.12 * rpm * (0.5 + load * 0.5));
    for (let i = 0; i < this.turbine.length; i++) k(this.turbine[i].frequency, [5600, 5640, 8400][i] * (0.85 + 0.15 * rpm + 0.04 * s.power));
    k(this.turbineGain.gain, 0.018 * Math.min(1, rpm * 1.2) * (0.6 + s.power * 0.6));
    k(this.hum.frequency, 112 * (0.9 + 0.1 * rpm + 0.05 * s.power));
    k(this.humGain.gain, 0.05 * rpm * (0.5 + s.power));
    k(this.tailGain.gain, 0.05 * rpm);
    const ws = Math.min(1.5, s.airspeed / 55 + s.gust / 20);
    k(this.windGain.gain, 0.5 * ws * ws, 0.2);
    k(this.windFilter.frequency, 250 + s.airspeed * 22 + s.gust * 30, 0.2);
    k(this.rainGain.gain, 0.22 * s.rain, 0.5);
    k(this.rainLow.gain, 0.3 * Math.max(0, s.rain - 0.5), 0.5);
    // 偶发环境音（海鸥、鸟鸣、蛙鸣）
    this.ambTimer -= dt;
    if (this.ambTimer <= 0) {
      this.ambTimer = 1.5 + Math.random() * 4;
      const a = this.ambience;
      if (a.gulls && Math.random() < a.gulls) this.chirp(1300, 2300, 0.35, 0.05, 'triangle');
      if (a.birds && Math.random() < a.birds) for (let i = 0; i < 3; i++) setTimeout(() => this.chirp(2600 + Math.random() * 1500, 3800 + Math.random() * 900, 0.09, 0.025, 'sine'), i * 120);
      if (a.insects && Math.random() < 0.4) this.chirp(160, 120, 0.25, 0.04, 'square');
    }
  }

  private tone(freq: number, dur: number, peak: number, type: OscillatorType = 'sine', bus?: GainNode, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    o.connect(g).connect(bus ?? this.alertBus);
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chirp(f0: number, f1: number, dur: number, peak: number, type: OscillatorType): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + dur);
    const g = ctx.createGain();
    o.connect(g).connect(this.ambBus);
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
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(bus ?? this.engineBus);
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
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

  alert(kind: 'damaged' | 'critical' | 'terrain' | 'gust' | 'limit' | 'water'): void {
    if (!this.ctx) return;
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

  click(): void {
    this.tone(1400, 0.05, 0.08, 'square');
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}
