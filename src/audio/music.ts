// 背景音乐：全部实时生成，没有录音文件，也就没有版权问题。
// 慢慢换的和弦垫底，偶尔几个像钢琴的音落在上面，带一点回声。从不重复，也没有节拍：
// 休闲飞行时它要能垫在风景底下，不抢旋翼的声音。
// 音只取 D 大调五声音阶（D E F♯ A B），和所有和弦都不冲突，随便怎么走都不会难听。

/** 和弦：低音 + 四个中音（MIDI 音高）。开放排列，没有三度挤在一起的低音 */
const CHORDS: ReadonlyArray<{ root: number; pad: readonly number[]; next: readonly number[] }> = [
  { root: 38, pad: [50, 57, 64, 66], next: [2, 1, 3] }, // D add9
  { root: 35, pad: [47, 54, 62, 64], next: [2, 4] }, // Bm add11
  { root: 43, pad: [50, 59, 62, 66], next: [0, 3, 4] }, // G maj7
  { root: 45, pad: [52, 57, 62, 64], next: [0, 1] }, // A sus4
  { root: 40, pad: [50, 55, 59, 66], next: [3, 2] }, // Em9
];
/** 旋律用的五声音阶，两个八度多一点 */
const SCALE: readonly number[] = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86];

/** 一个和弦停多久（秒） */
const CHORD_S: readonly [number, number] = [10, 14];
/** 提前排多久的音：主线程卡一下也不断 */
const AHEAD = 1.2;

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export interface Rng {
  (): number;
}

/** 下一段旋律：从现在的音阶位置出发走几步，步子小，偶尔跳一下。纯逻辑，测试直接调 */
export function nextMotif(from: number, rnd: Rng): number[] {
  const n = 1 + Math.floor(rnd() * 4);
  const out: number[] = [];
  let at = from;
  for (let i = 0; i < n; i++) {
    const step = rnd() < 0.8 ? (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)) : (rnd() < 0.5 ? -1 : 1) * 3;
    at += step;
    // 碰到边就折回来
    if (at < 0) at = -at;
    if (at >= SCALE.length) at = 2 * (SCALE.length - 1) - at;
    out.push(at);
  }
  return out;
}

export function scaleNote(i: number): number {
  return SCALE[Math.max(0, Math.min(SCALE.length - 1, i))];
}

export function chordAfter(i: number, rnd: Rng): number {
  const next = CHORDS[i].next;
  return next[Math.floor(rnd() * next.length)];
}

export const CHORD_COUNT = CHORDS.length;
export const chordNotes = (i: number): readonly number[] => [CHORDS[i].root, ...CHORDS[i].pad];

/** 混响：一段衰减的噪声，越往后高频越少。不用文件 */
function hallImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.5 * (1 - t) ** 2 + 0.02;
      low += ((Math.random() * 2 - 1) - low) * k;
      d[i] = low * (1 - t) ** 2.6 * Math.min(1, i / (0.012 * ctx.sampleRate));
    }
  }
  return b;
}

export class Music {
  private readonly out: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly echo: DelayNode;
  private readonly padTone: PeriodicWave;
  private readonly keyTone: PeriodicWave;
  private chord = 0;
  private nextChord = 0;
  private nextNote = 0;
  private walk = 4;
  private level = 0;
  private on = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly rnd: Rng = Math.random,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.72;
    this.dry.connect(this.out);
    const hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx, 3.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(hall);
    hall.connect(this.out);
    // 钢琴的音后面跟一声回声，回声也进混响
    this.echo = ctx.createDelay(1.2);
    this.echo.delayTime.value = 0.62;
    const back = ctx.createGain();
    back.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1900;
    this.echo.connect(damp).connect(back).connect(this.echo);
    back.connect(this.dry);
    back.connect(this.wet);
    // 垫底的音色：前几个泛音，没有高频；钢琴的音色：多几个泛音
    this.padTone = ctx.createPeriodicWave(new Float32Array(7), Float32Array.from([0, 1, 0.34, 0.16, 0.07, 0.03, 0.012]), { disableNormalization: false });
    this.keyTone = ctx.createPeriodicWave(new Float32Array(8), Float32Array.from([0, 1, 0.5, 0.19, 0.11, 0.05, 0.022, 0.01]), { disableNormalization: false });
  }

  /** 音量 0..1。到 0 之后不再排新的音，已经响着的自己放完 */
  setLevel(v: number, tc = 1.2): void {
    if (v === this.level) return;
    this.level = v;
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  /** 每帧调一次：把接下来一秒多的音排好 */
  update(): void {
    const now = this.ctx.currentTime;
    if (this.level <= 0.001) {
      this.on = false;
      return;
    }
    if (!this.on) {
      this.on = true;
      this.nextChord = now + 0.05;
      this.nextNote = now + 3 + this.rnd() * 3;
    }
    while (this.nextChord < now + AHEAD) this.playChord(Math.max(this.nextChord, now + 0.02));
    while (this.nextNote < now + AHEAD) this.playMotif(Math.max(this.nextNote, now + 0.02));
  }

  private playChord(t: number): void {
    const c = CHORDS[this.chord];
    const hold = CHORD_S[0] + this.rnd() * (CHORD_S[1] - CHORD_S[0]);
    // 前后两个和弦交叉淡入淡出，听不到换的那一下
    const up = 4.2;
    const down = 5.5;
    const end = t + hold + down;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.linearRampToValueAtTime(780 + this.rnd() * 260, t + hold * 0.6);
    filter.frequency.linearRampToValueAtTime(360, end);
    filter.connect(this.dry);
    filter.connect(this.wet);
    const voices: AudioNode[] = [filter];
    const voice = (midi: number, gain: number, detune: number, wave: PeriodicWave | 'sine', stop: boolean): void => {
      const o = this.ctx.createOscillator();
      if (wave === 'sine') o.type = 'sine';
      else o.setPeriodicWave(wave);
      o.frequency.value = hz(midi);
      o.detune.value = detune;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + up);
      g.gain.setValueAtTime(gain, t + hold);
      g.gain.linearRampToValueAtTime(0, end);
      o.connect(g).connect(filter);
      o.start(t);
      o.stop(end + 0.1);
      voices.push(g);
      if (stop) o.onended = () => voices.forEach((n) => n.disconnect());
    };
    voice(c.root, 0.11, 0, 'sine', true);
    c.pad.forEach((n, i) => {
      voice(n, 0.038, 3 + i, this.padTone, false);
      voice(n, 0.038, -3 - i, this.padTone, false);
    });
    this.nextChord = t + hold;
    this.chord = chordAfter(this.chord, this.rnd);
  }

  private playMotif(t: number): void {
    const notes = nextMotif(this.walk, this.rnd);
    let at = t;
    for (const i of notes) {
      this.playKey(scaleNote(i), at, 0.5 + this.rnd() * 0.5);
      at += 0.55 + this.rnd() * 1.25;
    }
    this.walk = notes[notes.length - 1];
    // 一段之后留白：音少才好听
    this.nextNote = at + 3.5 + this.rnd() * 9;
  }

  private playKey(midi: number, t: number, loud: number): void {
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.keyTone);
    o.frequency.value = hz(midi);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    // 按下去亮，很快暗下来，这是钢琴音色的一半
    f.frequency.setValueAtTime(1200 + 2600 * loud, t);
    f.frequency.exponentialRampToValueAtTime(520, t + 1.6);
    const g = this.ctx.createGain();
    const peak = 0.16 * loud;
    const tail = 3.4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.009);
    g.gain.exponentialRampToValueAtTime(peak * 0.34, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0002, t + tail);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (this.rnd() - 0.5) * 0.7;
    o.connect(f).connect(g).connect(pan);
    pan.connect(this.dry);
    pan.connect(this.wet);
    pan.connect(this.echo);
    o.start(t);
    o.stop(t + tail + 0.05);
    o.onended = () => {
      o.disconnect();
      f.disconnect();
      g.disconnect();
      pan.disconnect();
    };
  }

  dispose(): void {
    this.out.disconnect();
  }
}
