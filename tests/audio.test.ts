import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio';

class Param {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  playbackRate = new Param();
  start = vi.fn();
  stop = vi.fn();
  disconnect = vi.fn();
  onended: (() => void) | null = null;
  connect(node: Node): Node { return node; }
}
class Context {
  sampleRate = 32;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  sources: Node[] = [];
  nodes: Node[] = [];
  close = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  createGain(): Node { const n = new Node(); this.nodes.push(n); return n; }
  createBiquadFilter(): Node { return this.createGain(); }
  createWaveShaper(): Node { return this.createGain(); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource(): Node { const n = this.createGain(); this.sources.push(n); return n; }
  createOscillator(): Node { return this.createBufferSource(); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('环境音资源生命周期', () => {
  const running = { rpm: 1, load: 1, power: 0.5, airspeed: 0, gust: 0, rain: 0, inCockpit: true, paused: false, bank: 0, descent: 0 };

  it('暂停只静音飞行与环境总线，菜单点击和结算提示仍可听见', () => {
    vi.stubGlobal('window', { AudioContext: Context });
    const a = new AudioEngine();
    a.click();
    const ctx = a.ctx as unknown as Context;
    const [master, , engine, ambience, alerts] = ctx.nodes;
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0, 0.03);
    expect(engine.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.03);
    expect(ambience.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.03);
    expect(alerts.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, 0, 0.03);
    a.update(running, 0.016);
    a.update({ ...running, paused: true }, 0.016);
    expect(engine.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.1);
    expect(master.gain.setTargetAtTime).not.toHaveBeenCalledWith(0, 0, expect.anything());
    const previous = ctx.sources.length;
    a.success();
    expect(ctx.sources.length - previous).toBe(4);
    a.dispose();
  });

  it('状态不变的连续帧不重复排入音频自动化事件', () => {
    vi.stubGlobal('window', { AudioContext: Context });
    const a = new AudioEngine();
    a.init();
    const ctx = a.ctx as unknown as Context;
    a.update(running, 0.016);
    const count = () => ctx.nodes.reduce((sum, node) => sum + [node.gain, node.frequency, node.Q, node.playbackRate].reduce((n, param) => n + param.setTargetAtTime.mock.calls.length, 0), 0);
    const initial = count();
    for (let i = 0; i < 300; i++) a.update(running, 0.016);
    expect(count()).toBe(initial);
    a.update({ ...running, rpm: 0.9 }, 0.016);
    expect(count()).toBeGreaterThan(initial);
    a.dispose();
  });

  it('部分初始化失败会关闭上下文；释放短音完整节点链且可重复调用', () => {
    let failed!: Context;
    class BrokenContext extends Context {
      constructor() { super(); failed = this; }
      override createBuffer(): never { throw new Error('audio allocation failed'); }
    }
    vi.stubGlobal('window', { AudioContext: BrokenContext });
    const a = new AudioEngine();
    expect(() => a.init()).not.toThrow();
    expect(a.ctx).toBeNull();
    expect(a.enabled).toBe(false);
    expect(failed.close).toHaveBeenCalledOnce();
    a.dispose();
    expect(failed.close).toHaveBeenCalledOnce();

    vi.stubGlobal('window', { AudioContext: Context });
    a.init();
    expect(a.enabled).toBe(true);
    const ctx = a.ctx as unknown as Context;
    const before = ctx.nodes.length;
    a.checkpoint();
    const effects = ctx.nodes.slice(before);
    const ended = ctx.sources.at(-1)!.onended;
    a.dispose();
    a.dispose();
    ended?.();
    expect(ctx.close).toHaveBeenCalledOnce();
    for (const node of effects) expect(node.disconnect).toHaveBeenCalled();
  });

  it('切换地图停止旧地图的循环声源，保留发动机并可关闭音频上下文', () => {
    vi.stubGlobal('window', { AudioContext: Context });
    const a = new AudioEngine();
    a.init();
    const ctx = a.ctx as unknown as Context;
    const base = ctx.sources.length;
    a.setAmbience({ sea: 1, wind: 1 });
    const ambience = ctx.sources.slice(base);
    expect(ambience.length).toBe(4);
    a.setAmbience({ river: 1 });
    for (const source of ambience) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalled();
    }
    for (const engine of ctx.sources.slice(0, base)) expect(engine.stop).not.toHaveBeenCalled();
    a.dispose();
    expect(ctx.close).toHaveBeenCalledOnce();
    expect(a.ctx).toBeNull();
  });

  it('连续鸟鸣用音频时间调度，换图后全部取消，不遗留后台定时器', () => {
    vi.stubGlobal('window', { AudioContext: Context });
    vi.useFakeTimers();
    const a = new AudioEngine();
    a.init();
    const ctx = a.ctx as unknown as Context;
    a.setAmbience({ birds: 1 });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const base = ctx.sources.length;
    a.update({ rpm: 1, load: 1, power: 0.5, airspeed: 0, gust: 0, rain: 0, inCockpit: true, paused: false, bank: 0, descent: 0 }, 0.016);
    const birds = ctx.sources.slice(base);
    expect(birds.length).toBe(3);
    expect(birds.map((n) => n.start.mock.calls[0][0])).toEqual([0, 0.12, 0.24]);
    expect(vi.getTimerCount()).toBe(0);
    a.setAmbience({});
    for (const bird of birds) expect(bird.stop).toHaveBeenCalled();
    a.dispose();
  });
});
