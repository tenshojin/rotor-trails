// heliSynth.js 是给音频线程直接加载的普通 JavaScript，这里给测试和主线程一份类型。
export class HeliSynth {
  constructor(sampleRate: number);
  t: Record<string, number>;
  p: Record<string, number>;
  set(values: Record<string, number>): void;
  render(left: Float32Array, right: Float32Array, frames: number): void;
}
