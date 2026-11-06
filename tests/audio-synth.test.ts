import { describe, expect, it } from 'vitest';
import { HeliSynth } from '../src/audio/heliSynth.js';

const SR = 48000;

function render(params: Record<string, number>, seconds = 2, warm = 1): Float32Array {
  const s = new HeliSynth(SR);
  s.set(params);
  // 控制量是平滑过去的：先空跑一会儿
  const block = new Float32Array(128);
  const block2 = new Float32Array(128);
  for (let i = 0; i < (warm * SR) / 128; i++) s.render(block, block2, 128);
  const n = Math.floor((seconds * SR) / 128);
  const out = new Float32Array(n * 128);
  for (let i = 0; i < n; i++) {
    s.render(block, block2, 128);
    out.set(block, i * 128);
  }
  return out;
}

/** 这个频率上的幅度（单频的傅里叶系数） */
function tone(x: Float32Array, f: number): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * f) / SR;
  for (let i = 0; i < x.length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length);
    re += x[i] * h * Math.cos(w * i);
    im += x[i] * h * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / (x.length / 2);
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
const peak = (x: Float32Array) => x.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
/** 这一段频率的能量：一阶高通看高频多不多 */
function highEnergy(x: Float32Array): number {
  let e = 0;
  for (let i = 1; i < x.length; i++) e += (x[i] - x[i - 1]) ** 2;
  return Math.sqrt(e / x.length);
}

const HOVER = { nr: 1, n1: 0.86, lit: 1, load: 1, torque: 0.75, tail: 0.5, cabin: 1, bus: 1, hyd: 1 };

describe('声音合成', () => {
  it('冷舱：什么都没开，一点声音都没有', () => {
    expect(peak(render({ nr: 0, n1: 0, lit: 0, cabin: 1 }, 1))).toBeLessThan(1e-3);
  });

  it('旋翼的声音落在三片桨的通过频率及其谐波上', () => {
    const x = render(HOVER, 4);
    const f0 = 6.46 * 3;
    const line = tone(x, f0 * 2);
    // 谐波比旁边的频率高一大截：这是一个周期信号，不是噪声
    expect(line).toBeGreaterThan(tone(x, f0 * 2.5) * 4);
    expect(tone(x, f0 * 3)).toBeGreaterThan(tone(x, f0 * 3.5) * 4);
  });

  it('转速掉下来，拍频跟着掉', () => {
    const x = render({ ...HOVER, nr: 0.7 }, 4);
    const f0 = 6.46 * 3 * 0.7;
    expect(tone(x, f0 * 3)).toBeGreaterThan(tone(x, 6.46 * 3 * 3) * 2.5);
  });

  it('桨叶拍击让高频多出来：下降时那种“哒哒哒”', () => {
    expect(highEnergy(render({ ...HOVER, slap: 1 }))).toBeGreaterThan(highEnergy(render({ ...HOVER, slap: 0 })) * 1.3);
  });

  it('涡轮的啸叫跟着 N1 走（舱外听得最清楚）', () => {
    const a = render({ ...HOVER, cabin: 0, n1: 0.9 }, 2);
    const b = render({ ...HOVER, cabin: 0, n1: 0.6 }, 2);
    expect(tone(a, 6150 * 0.9)).toBeGreaterThan(tone(a, 6150 * 0.6) * 3);
    expect(tone(b, 6150 * 0.6)).toBeGreaterThan(tone(b, 6150 * 0.9) * 3);
  });

  it('座舱里主减速器的音调是最明显的高频：1147 Hz', () => {
    const x = render(HOVER, 3);
    expect(tone(x, 1147)).toBeGreaterThan(tone(x, 1250) * 3);
  });

  it('舱外尾桨比舱内响得多', () => {
    const inside = render(HOVER, 3);
    const outside = render({ ...HOVER, cabin: 0 }, 3);
    expect(tone(outside, 67)).toBeGreaterThan(tone(inside, 67));
  });

  it('风噪随速度明显变大', () => {
    const quiet = render({ nr: 0, n1: 0, lit: 0, cabin: 1, air: 15 }, 1);
    const loud = render({ nr: 0, n1: 0, lit: 0, cabin: 1, air: 70 }, 1);
    expect(rms(loud)).toBeGreaterThan(rms(quiet) * 8);
  });

  it('雨是一滴一滴的：包络起伏很大，不是一片白噪声', () => {
    const x = render({ nr: 0, n1: 0, lit: 0, cabin: 1, rain: 0.3 }, 2);
    expect(rms(x)).toBeGreaterThan(0.002);
    expect(peak(x) / rms(x)).toBeGreaterThan(5);
  });

  it('起动：起动机和点火器的声音只在起动时有', () => {
    expect(rms(render({ nr: 0, n1: 0.15, starter: 1, ignite: 1, cabin: 1 }, 1))).toBeGreaterThan(rms(render({ nr: 0, n1: 0.15, cabin: 1 }, 1)) * 2);
  });

  it('任何工况都不削波、不出现 NaN', () => {
    const x = render({ ...HOVER, load: 1.6, torque: 1.2, slap: 1, air: 90, rain: 1, vib: 1, gust: 1, starter: 1, ignite: 1, radio: 1, ics: 1, morse: 1, siren: 1, cabin: 0, agl: 5 }, 2);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeLessThan(0.9);
  });
});
