// 直升机声音的实时合成，运行在音频线程（AudioWorklet）里，一个样本一个样本地算。
// 全部是数学合成，没有录音文件。每个声源都按它真实的发声机理来：
//   主旋翼   三片桨，每转 3 次压力脉冲（约 19.4 Hz）。脉冲是一正一负的 N 形波，三片桨略有差异（真机也调不到完全一样）。
//            下降时桨叶撞上前一片的尾涡（BVI），脉冲变尖，就是“哒哒哒”的拍击声。
//   桨尖     随每片桨通过一起一伏的宽带噪声（“唰唰”）。
//   尾桨     两片桨，约 67 Hz 的脉冲串，推力越大越响。
//   涡轮     压气机高频啸叫随 N1 升高，燃烧室的低频隆隆声，排气的嘶声。
//   传动     主减速器齿轮啮合的音调，被旋翼转速调制出边带，座舱里最明显的就是它。
//   起动机   电机的呜呜声 + 点火器的咔哒声。
//   机内     电动陀螺、燃油泵、液压泵、通风。
//   气流     速度的 2.4 次方，高速时门缝的哨音。
//   雨       一滴一滴打在风挡上（泊松过程），不是一片白噪声。
//   电台     静噪、话音（基频 + 两个移动的共振峰，听不清内容，就像耳机里的通话）、摩尔斯识别码、紧急频率的扫频音。
// 这个文件是普通 JavaScript：音频线程不走打包器，只能原样加载。tests/audio-synth.test.ts 直接测 HeliSynth。

const TAU = Math.PI * 2;
/** 主旋翼每秒转数（100%）、桨叶数；尾桨同理 */
const ROTOR_HZ = 6.46;
const BLADES = 3;
const TAIL_HZ = 33.5;
/** 三片桨的差异：幅度、位置 */
const BLADE_AMP = [1.0, 0.93, 1.06];
const BLADE_OFF = [0.0, 0.004, -0.003];
/** 主减速器的啮合频率（100% 转速时，Hz） */
const GEAR = [362, 1147, 2294, 3056];

const MORSE = { R: '.-.', T: '-', '7': '--...' };

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 状态变量滤波器：一次算出低通、带通、高通 */
class SVF {
  constructor() {
    this.low = 0;
    this.band = 0;
  }

  /** f = 2 sin(π fc / sr)，q = 1 / Q */
  run(x, f, q) {
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return this.band;
  }
}

export class HeliSynth {
  constructor(sr) {
    this.sr = sr;
    this.dt = 1 / sr;
    this.seed = 0x2f6e2b1;
    /** 目标值（主线程设），下面的 p 是平滑后的当前值 */
    this.t = {
      nr: 0, n1: 0, lit: 0, starter: 0, ignite: 0, load: 0.6, torque: 0, tail: 0.4, slap: 0, air: 0, gust: 0, rain: 0, vib: 0,
      bus: 0, pump: 0, hyd: 0, vent: 0, heat: 0, cabin: 1, agl: 500, radio: 0, ics: 0, squelch: 0.5, morse: 0, siren: 0, volume: 1,
    };
    this.p = { ...this.t };
    this.rotor = 0;
    this.tailPh = 0;
    this.gearPh = new Float64Array(GEAR.length);
    this.whine = [0, 0, 0];
    this.starterPh = 0;
    this.gyroPh = 0;
    this.gyro = 0;
    this.pumpPh = 0;
    this.hydPh = 0;
    this.ignT = 0;
    this.ignEnv = 0;
    this.swish = new SVF();
    this.swish2 = new SVF();
    this.slapN = new SVF();
    this.comb = new SVF();
    this.exh = new SVF();
    this.wind = new SVF();
    this.wind2 = new SVF();
    this.whistle = new SVF();
    this.tailF = new SVF();
    this.rainL = new SVF();
    this.rainR = new SVF();
    this.vent = new SVF();
    this.hiss = new SVF();
    this.f1 = new SVF();
    this.f2 = new SVF();
    this.rattle = new SVF();
    this.rainEnvL = 0;
    this.rainEnvR = 0;
    this.outL = 0;
    this.outR = 0;
    this.out2L = 0;
    this.out2R = 0;
    this.bass = 0;
    this.rattleEnv = 0;
    // 贴地时地面反射回来的那一下
    this.echo = new Float32Array(Math.ceil(sr * 0.25));
    this.echoAt = 0;
    // 话音
    this.talkT = 3;
    this.talkLeft = 0;
    this.sylT = 0;
    this.syl = 0;
    this.sylGoal = 0;
    this.ff1 = 600;
    this.ff2 = 1500;
    this.f1g = 600;
    this.f2g = 1500;
    this.pitchPh = 0;
    this.pitch = 120;
    this.clickEnv = 0;
    // 摩尔斯
    this.morseT = 0;
    this.morseAt = 0;
    this.morseSeq = [];
    this.morsePh = 0;
    this.sirenPh = 0;
    this.sirenT = 0;
    for (const c of 'RT7') {
      for (const s of MORSE[c]) this.morseSeq.push(s === '.' ? 1 : 3, -1);
      this.morseSeq.push(-3);
    }
    this.morseSeq.push(-40);
  }

  set(v) {
    Object.assign(this.t, v);
  }

  noise() {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s;
    return (s | 0) / 2147483648;
  }

  /** 填满左右声道 */
  render(L, R, n) {
    const P = this.p;
    const T = this.t;
    const sr = this.sr;
    const dt = this.dt;
    // 控制量每块更新一次：主线程 60 Hz 给数，这里插值
    const k = 1 - Math.exp(-n * dt * 18);
    for (const key in T) P[key] += (T[key] - P[key]) * k;
    const nr = P.nr;
    const n1 = P.n1;
    const cabin = P.cabin;
    const load = P.load;
    const lit = P.lit;
    const air = P.air;
    const nrAmp = nr * nr;
    // ---------- 这一块的增益 ----------
    const thumpA = nrAmp * (0.42 + 0.30 * clamp(load, 0, 1.6)) * (0.8 + 0.5 * (1 - cabin));
    // （中频这一层：笔记本和手机的喇叭放不出 200 Hz 以下，“哒哒哒”的节奏全靠它）
    const bodyA = nrAmp * (0.24 + 0.17 * load + 0.42 * P.slap);
    const slapA = nrAmp * P.slap * (0.36 + 0.3 * (1 - cabin));
    const swishA = nrAmp * (0.05 + 0.04 * load) * (cabin > 0.5 ? 0.8 : 1.5);
    const tailA = nr * nr * (0.012 + 0.05 * P.tail) * (cabin > 0.5 ? 0.45 : 2.2);
    const gearA = nr * (0.45 + 0.55 * clamp(P.torque, 0, 1.2)) * (cabin > 0.5 ? 1 : 0.18);
    const whineA = smooth(0.05, 0.6, n1) * (0.022 + 0.03 * n1 * n1) * (cabin > 0.5 ? 0.6 : 1.3);
    const combA = lit * n1 * (0.05 + 0.09 * clamp(P.torque, 0, 1.2)) * (cabin > 0.5 ? 0.75 : 1.1);
    const exhA = lit * n1 * n1 * (cabin > 0.5 ? 0.012 : 0.05);
    const windN = clamp(air / 62, 0, 1.6);
    // （飞得再快也不能盖过旋翼：风噪一大，五十多米每秒时只听得到一片“沙沙”，听不出是直升机）
    const windA = 0.34 * Math.pow(windN, 2.4) * (cabin > 0.5 ? 0.42 : 0.45) + 0.05 * P.gust * windN;
    const whistleA = 0.02 * Math.pow(clamp(air / 72, 0, 1.3), 4) * cabin;
    const rainRate = P.rain * P.rain * 1400 + P.rain * 300;
    // ---------- 频率 ----------
    const fRotor = ROTOR_HZ * nr;
    const fSwish = 2 * Math.sin(Math.PI * Math.min(1500, 240 + 380 * clamp(load, 0, 1.4) + 500 * P.slap) / sr);
    const fSwish2 = 2 * Math.sin(Math.PI * 1150 / sr);
    const fSlap = 2 * Math.sin(Math.PI * 1500 / sr);
    const fComb = 2 * Math.sin(Math.PI * (110 + 200 * n1) / sr);
    const fExh = 2 * Math.sin(Math.PI * 3100 / sr);
    const fWind = 2 * Math.sin(Math.PI * Math.min(1400, 180 + air * 11 + P.gust * 120) / sr);
    const fWind2 = 2 * Math.sin(Math.PI * Math.min(5000, 500 + air * 38) / sr);
    const fWhistle = 2 * Math.sin(Math.PI * (1250 + air * 5) / sr);
    const fTail = 2 * Math.sin(Math.PI * 720 / sr);
    const fRain = 2 * Math.sin(Math.PI * 3400 / sr);
    const fVent = 2 * Math.sin(Math.PI * 900 / sr);
    const fHiss = 2 * Math.sin(Math.PI * 2100 / sr);
    const fRattle = 2 * Math.sin(Math.PI * 1900 / sr);
    const whineF = [n1 * 6150, n1 * 9840, n1 * 13200];
    const starterF = 170 + 1500 * clamp(n1 / 0.22, 0, 1);
    // 舱里的声音被壳体和耳机削掉高频：
    const cut = cabin > 0.5 ? 2600 + (1 - cabin) * 9000 : 13000 - cabin * 9000;
    const cutK = 1 - Math.exp(-TAU * cut / sr);
    const near = 1 - smooth(4, 45, P.agl);
    const echoD = clamp(Math.floor((2 * Math.max(P.agl, 2) / 343) * sr), 40, this.echo.length - 1);
    const pumpF = 118;
    const hydF = 1870 * nr;
    // 电动陀螺：通电以后几十秒才转到全速
    this.gyro += ((P.bus > 0.5 ? 1 : 0) - this.gyro) * (n * dt) * (P.bus > 0.5 ? 0.06 : 0.03);
    const gyroF = 90 + 1060 * this.gyro;
    const gyroA = 0.0035 * this.gyro * this.gyro;

    for (let i = 0; i < n; i++) {
      this.rotor += fRotor * dt;
      if (this.rotor >= 1) this.rotor -= 1;
      // ---------- 主旋翼 ----------
      const blade = this.rotor * BLADES;
      const bi = Math.floor(blade) % BLADES;
      const w = blade - Math.floor(blade) + BLADE_OFF[bi];
      const x1 = (w - 0.5) / 0.052;
      const x2 = (w - 0.5) / 0.017;
      const x3 = (w - 0.5) / 0.0075;
      const ba = BLADE_AMP[bi];
      // N 形的压力波：x·exp(-x²)
      let rotor = ba * (thumpA * x1 * Math.exp(-x1 * x1) + bodyA * x2 * Math.exp(-x2 * x2) + slapA * x3 * Math.exp(-x3 * x3) * 1.6);
      const nz = this.noise();
      const env = 0.32 + 0.68 * Math.exp(-(((w - 0.46) / 0.2) ** 2));
      rotor += swishA * env * ba * this.swish.run(nz, fSwish, 0.9);
      // 桨尖的高频（舱外才明显）
      rotor += swishA * 0.45 * env * env * this.swish2.run(nz, fSwish2, 1.1) * (1.15 - cabin * 0.75);
      // 拍击时一起出来的噪声
      const sl = Math.exp(-(((w - 0.5) / 0.03) ** 2));
      rotor += slapA * 0.55 * sl * this.slapN.run(this.noise(), fSlap, 0.7);

      // ---------- 尾桨：2 片，脉冲串 ----------
      this.tailPh += TAIL_HZ * nr * dt;
      if (this.tailPh >= 1) this.tailPh -= 1;
      const tw = this.tailPh * 2;
      const tf = tw - Math.floor(tw);
      const tx = (tf - 0.5) / 0.09;
      const tailS = tailA * (tx * Math.exp(-tx * tx) * 1.8 + 0.5 * this.tailF.run(this.noise(), fTail, 1.2) * (0.3 + Math.exp(-tx * tx)));

      // ---------- 主减速器：被旋翼转速调制（每转一次的边带） ----------
      let gear = 0;
      const am = 0.82 + 0.18 * Math.sin(TAU * this.rotor);
      for (let g = 0; g < GEAR.length; g++) {
        this.gearPh[g] += GEAR[g] * nr * dt;
        if (this.gearPh[g] >= 1) this.gearPh[g] -= 1;
      }
      gear = gearA * am * (0.020 * Math.sin(TAU * this.gearPh[0]) + 0.026 * Math.sin(TAU * this.gearPh[1]) + 0.010 * Math.sin(TAU * this.gearPh[2]) + 0.004 * Math.sin(TAU * this.gearPh[3]));

      // ---------- 涡轮 ----------
      let turb = 0;
      for (let j = 0; j < 3; j++) {
        this.whine[j] += whineF[j] * dt;
        if (this.whine[j] >= 1) this.whine[j] -= 1;
      }
      turb += whineA * (0.6 * Math.sin(TAU * this.whine[0]) + 0.3 * Math.sin(TAU * this.whine[1]) + 0.12 * Math.sin(TAU * this.whine[2]));
      turb += combA * this.comb.run(this.noise(), fComb, 0.7);
      turb += exhA * this.exh.run(this.noise(), fExh, 1.0);

      // ---------- 起动机、点火器 ----------
      let start = 0;
      if (P.starter > 0.01) {
        this.starterPh += starterF * dt;
        if (this.starterPh >= 1) this.starterPh -= 1;
        const sw = this.starterPh * 2 - 1;
        start = P.starter * 0.05 * (sw + 0.35 * Math.sin(TAU * this.starterPh * 3)) * (0.75 + 0.25 * this.noise());
      }
      if (P.ignite > 0.5) {
        this.ignT += dt;
        if (this.ignT > 0.17) {
          this.ignT = 0;
          this.ignEnv = 1;
        }
      }
      if (this.ignEnv > 0.001) {
        start += this.ignEnv * 0.11 * this.noise();
        this.ignEnv *= 0.992;
      }

      // ---------- 机内设备 ----------
      this.gyroPh += gyroF * dt;
      if (this.gyroPh >= 1) this.gyroPh -= 1;
      let inside = gyroA * Math.sin(TAU * this.gyroPh);
      this.pumpPh += pumpF * dt;
      if (this.pumpPh >= 1) this.pumpPh -= 1;
      inside += P.pump * (0.012 * Math.sin(TAU * this.pumpPh) + 0.008 * Math.sin(TAU * this.pumpPh * 2) + 0.005 * Math.sin(TAU * this.pumpPh * 5) * (0.6 + 0.4 * this.noise()));
      this.hydPh += hydF * dt;
      if (this.hydPh >= 1) this.hydPh -= 1;
      inside += P.hyd * 0.0035 * Math.sin(TAU * this.hydPh);
      inside += (P.vent * 0.03 + P.heat * 0.022) * this.vent.run(this.noise(), fVent, 1.3);

      // ---------- 气流 ----------
      const wn = this.noise();
      let wind = windA * (this.wind.run(wn, fWind, 0.8) * 1.5 + 0.3 * this.wind2.run(wn, fWind2, 1.2));
      wind += whistleA * this.whistle.run(this.noise(), fWhistle, 0.06);

      // ---------- 振动：松动的面板和门 ----------
      let rattle = 0;
      if (P.vib > 0.03) {
        if (w < 0.03 && this.rattleEnv < 0.2) this.rattleEnv = P.vib * (0.7 + 0.3 * this.noise());
        this.rattleEnv *= 0.9965;
        rattle = this.rattleEnv * 0.09 * this.rattle.run(this.noise(), fRattle, 0.8);
      }

      // ---------- 贴地：下洗气流打到地面又反射回来 ----------
      const dry = rotor + tailS;
      const back = this.echo[(this.echoAt + this.echo.length - echoD) % this.echo.length];
      this.echo[this.echoAt] = dry;
      this.echoAt = (this.echoAt + 1) % this.echo.length;
      const refl = back * near * 0.5;

      // 高频被舱壁和耳机削掉；低频（旋翼）直接穿过来
      const body = dry + refl + gear + turb + start + rattle;
      this.outL += ((body + wind * 0.9) - this.outL) * cutK;
      this.outR += ((body * 0.96 + wind * 1.05 + refl * 0.15) - this.outR) * cutK;
      this.out2L += (this.outL - this.out2L) * Math.min(1, cutK * 2.2);
      this.out2R += (this.outR - this.out2R) * Math.min(1, cutK * 2.2);
      let l = this.out2L;
      let r = this.out2R;

      // ---------- 雨：一滴一滴（不过舱壁滤波，它就打在眼前的风挡上） ----------
      if (rainRate > 0) {
        const hit = rainRate * dt;
        if (Math.random() < hit) {
          const a = 0.35 + 0.65 * Math.random();
          if (Math.random() < 0.5) this.rainEnvL = Math.max(this.rainEnvL, a);
          else this.rainEnvR = Math.max(this.rainEnvR, a);
        }
        this.rainEnvL *= 0.965;
        this.rainEnvR *= 0.965;
        l += 0.10 * this.rainEnvL * this.rainL.run(this.noise(), fRain, 0.9) * (0.6 + 0.4 * cabin);
        r += 0.10 * this.rainEnvR * this.rainR.run(this.noise(), fRain, 0.9) * (0.6 + 0.4 * cabin);
      }
      const insideGain = cabin;
      l += inside * insideGain;
      r += inside * insideGain;

      // ---------- 耳机里的电台 ----------
      if (cabin > 0.5 && (P.radio > 0.01 || P.ics > 0.01 || P.morse > 0.01 || P.siren > 0.01)) {
        const ear = this.earphone();
        l += ear;
        r += ear;
      }
      // 软限幅：猛提总距时不要削波
      const lim = 0.86;
      L[i] = lim * Math.tanh(l * P.volume * 1.15);
      R[i] = lim * Math.tanh(r * P.volume * 1.15);
    }
    this.controlTalk(n * dt);
  }

  /** 电台（一次播放几秒的话音）的节奏：主循环每块调一次 */
  controlTalk(dt) {
    if (this.talkLeft > 0) {
      this.talkLeft -= dt;
      if (this.talkLeft <= 0) {
        this.clickEnv = 1;
        this.talkT = 6 + Math.random() * 22;
      }
      this.sylT -= dt;
      if (this.sylT <= 0) {
        // 音节：约每 0.18 秒换一次共振峰，偶尔停一下
        this.sylT = 0.09 + Math.random() * 0.2;
        this.sylGoal = Math.random() < 0.18 ? 0 : 0.5 + 0.5 * Math.random();
        this.f1g = 320 + Math.random() * 520;
        this.f2g = 950 + Math.random() * 1450;
        this.pitch = 104 + Math.random() * 36;
      }
    } else {
      this.talkT -= dt;
      this.sylGoal = 0;
      if (this.talkT <= 0 && this.p.radio > 0.05) {
        this.talkLeft = 1.4 + Math.random() * 3.2;
        this.clickEnv = 1;
      }
    }
  }

  /** 耳机一路：静噪底噪、话音、识别码、紧急频率 */
  earphone() {
    const P = this.p;
    const dt = this.dt;
    let s = 0;
    // 机内通话的底噪：很轻的嘶声，静噪门限调低时变大
    const open = 1 - P.squelch;
    const hiss = this.hiss.run(this.noise(), 2 * Math.sin(Math.PI * 2100 / this.sr), 1.1);
    s += hiss * (P.ics * 0.004 + P.radio * open * open * 0.05);
    if (P.radio > 0.01) {
      // 话音：基频的脉冲穿过两个共振峰，音节决定响度
      this.syl += (this.sylGoal - this.syl) * 0.0016;
      this.ff1 += (this.f1g - this.ff1) * 0.002;
      this.ff2 += (this.f2g - this.ff2) * 0.002;
      this.pitchPh += this.pitch * dt;
      let g = 0;
      if (this.pitchPh >= 1) {
        this.pitchPh -= 1;
        g = 1;
      }
      const src = g * 5 + this.noise() * 0.12;
      const a = this.f1.run(src, 2 * Math.sin(Math.PI * this.ff1 / this.sr), 0.14);
      const b = this.f2.run(src, 2 * Math.sin(Math.PI * this.ff2 / this.sr), 0.18);
      const voice = (a + 0.7 * b) * this.syl * 0.1;
      const talking = this.talkLeft > 0 ? 1 : 0;
      s += P.radio * (voice + talking * hiss * 0.02);
      if (this.clickEnv > 0.001) {
        s += P.radio * this.clickEnv * 0.09 * this.noise();
        this.clickEnv *= 0.994;
      }
    }
    if (P.morse > 0.01) {
      this.morseT -= dt;
      if (this.morseT <= 0) {
        this.morseAt = (this.morseAt + 1) % this.morseSeq.length;
        this.morseT = Math.abs(this.morseSeq[this.morseAt]) * 0.11;
      }
      if (this.morseSeq[this.morseAt] > 0) {
        this.morsePh += 1020 * dt;
        if (this.morsePh >= 1) this.morsePh -= 1;
        s += P.morse * 0.03 * Math.sin(TAU * this.morsePh);
      }
    }
    if (P.siren > 0.01) {
      // 紧急定位发射机的扫频音：每秒三次从高滑到低
      this.sirenT += dt * 3;
      if (this.sirenT >= 1) this.sirenT -= 1;
      this.sirenPh += (1300 - 1000 * this.sirenT) * dt;
      if (this.sirenPh >= 1) this.sirenPh -= 1;
      s += P.siren * 0.03 * Math.sin(TAU * this.sirenPh);
    }
    return s;
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor(
    'heli-synth',
    class extends AudioWorkletProcessor {
      constructor() {
        super({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.synth = new HeliSynth(sampleRate);
        this.port.onmessage = (e) => this.synth.set(e.data);
      }

      process(_inputs, outputs) {
        const o = outputs[0];
        this.synth.render(o[0], o[1] ?? o[0], o[0].length);
        return true;
      }
    },
  );
}
