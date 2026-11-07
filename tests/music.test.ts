import { describe, expect, it } from 'vitest';
import { CHORD_COUNT, chordAfter, chordNotes, nextMotif, scaleNote } from '../src/audio/music';

/** 伪随机：测试结果每次一样 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** D 大调五声音阶的音级 */
const PENTATONIC = new Set([2, 4, 6, 9, 11]);
const D_MAJOR = new Set([2, 4, 6, 7, 9, 11, 1]);

describe('背景音乐', () => {
  it('旋律永远走在五声音阶上，不出音域', () => {
    const r = rng(7);
    let at = 4;
    for (let i = 0; i < 4000; i++) {
      const m = nextMotif(at, r);
      expect(m.length).toBeGreaterThanOrEqual(1);
      expect(m.length).toBeLessThanOrEqual(4);
      for (const n of m) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(10);
        expect(PENTATONIC.has(scaleNote(n) % 12)).toBe(true);
      }
      at = m[m.length - 1];
    }
  });

  it('一段旋律里步子不大：听起来像唱的，不是乱跳', () => {
    const r = rng(11);
    let at = 4;
    let big = 0;
    let steps = 0;
    for (let i = 0; i < 2000; i++) {
      for (const n of nextMotif(at, r)) {
        if (Math.abs(n - at) > 2) big++;
        steps++;
        at = n;
      }
    }
    expect(big / steps).toBeLessThan(0.3);
  });

  it('所有和弦都在 D 大调里，低音区没有挤在一起的音', () => {
    for (let c = 0; c < CHORD_COUNT; c++) {
      const notes = chordNotes(c);
      for (const n of notes) expect(D_MAJOR.has(n % 12)).toBe(true);
      const [root, ...pad] = notes;
      expect(pad[0] - root).toBeGreaterThanOrEqual(7);
      // 低音区（G3 以下）的音之间至少隔一个纯四度，否则发浑
      const low = pad.filter((n) => n < 55);
      for (let i = 1; i < low.length; i++) expect(low[i] - low[i - 1]).toBeGreaterThanOrEqual(5);
    }
  });

  it('和弦走得开：几百次之后每个和弦都出现过，也不会原地不动', () => {
    const r = rng(3);
    const seen = new Set<number>();
    let c = 0;
    for (let i = 0; i < 500; i++) {
      const n = chordAfter(c, r);
      expect(n).not.toBe(c);
      seen.add(n);
      c = n;
    }
    expect(seen.size).toBe(CHORD_COUNT);
  });
});
