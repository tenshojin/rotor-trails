// 加载时不卡：后台线程生成的地形和主线程逐位相同、后台线程不可用时退回主线程、预热时每帧只新建一部分材质。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameGate, WorldView } from '../src/render/worldView';
import { getMap, MAPS } from '../src/maps';
import { generateWorld, type WorldData } from '../src/world/worldgen';
import { shapeJob, shapedBuffers } from '../src/world/genJobs';
import { shapeOffThread } from '../src/world/genWorker';
import { terrainMacroData } from '../src/world/terrainMacroData';
import { cloudNoiseData } from '../src/render/cloudNoiseData';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 后台线程那边做的事（结构化克隆、移交内存块）在测试里直接调用 shapeJob 代替 */
const inThread = (map: Parameters<typeof shapeJob>[0], stage: Parameters<typeof shapeJob>[1]) => shapeJob(map, stage);

function sameWorld(a: WorldData, b: WorldData): void {
  expect(b.terrain.data).toEqual(a.terrain.data);
  expect(b.surface).toEqual(a.surface);
  expect(b.flow.n).toBe(a.flow.n);
  expect(b.flow.data).toEqual(a.flow.data);
  expect(b.map.rivers?.map((r) => r.pts)).toEqual(a.map.rivers?.map((r) => r.pts));
  expect(b.map.nodes.map((n) => n.pos)).toEqual(a.map.nodes.map((n) => n.pos));
  expect(b.colliders.length).toBe(a.colliders.length);
  expect(b.trees.count).toBe(a.trees.count);
  expect(Array.from(b.trees.x)).toEqual(Array.from(a.trees.x));
}

describe('地形成形放到后台线程', () => {
  it('和主线程上生成的世界逐位相同（训练场：河流下切、雨水侵蚀、河道）', async () => {
    const map = getMap('training');
    const main = await generateWorld(map, false);
    const stages: string[] = [];
    const off = await generateWorld(map, false, (_p, label) => stages.push(label), { offThread: inThread });
    sameWorld(main, off);
    // 宏观图在后台线程里顺手算好了，和画面那边当场算的一样
    expect(off.macro).toEqual(terrainMacroData(main.terrain));
    expect(main.macro).toBeUndefined();
    expect(stages).toContain('河流下切');
    expect(stages).toContain('雨水侵蚀');
  });

  it('岩体造型、最后的地表也一样（雪域山口）', async () => {
    const map = getMap('himalaya');
    const main = await generateWorld(map, false);
    const off = await generateWorld(map, false, undefined, { offThread: inThread });
    sameWorld(main, off);
  }, 60000);

  it('不改共享的地图配方（河道高程、航点高度都只改副本）', async () => {
    const map = getMap('training');
    const before = JSON.stringify({ rivers: map.rivers, nodes: map.nodes, pickups: map.pickups });
    await generateWorld(map, false, undefined, { offThread: inThread });
    expect(JSON.stringify({ rivers: map.rivers, nodes: map.nodes, pickups: map.pickups })).toBe(before);
  });

  it('后台线程失败就在主线程上照常生成', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map = getMap('training');
    const main = await generateWorld(map, false);
    const off = await generateWorld(map, false, undefined, { offThread: () => Promise.reject(new Error('脚本加载失败')) });
    sameWorld(main, off);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('只把注册表里的原配方交给后台线程；没有 Worker 的环境直接报不可用', async () => {
    const map = getMap('training');
    await expect(shapeOffThread({ ...map })).rejects.toThrow('不在后台线程');
    await expect(shapeOffThread(getMap('grandcanyon'))).rejects.toThrow('不在后台线程');
    vi.stubGlobal('Worker', undefined);
    await expect(shapeOffThread(map)).rejects.toThrow('后台线程不可用');
  });

  it('移交的内存块就是结果里的几块数组', async () => {
    const r = await shapeJob(MAPS[0]);
    const buffers = shapedBuffers(r);
    expect(buffers).toEqual([r.data.buffer, r.surface.buffer, r.flow.data.buffer, r.macro.buffer]);
    expect(new Set(buffers).size).toBe(4);
  });

  it('云的三维噪声每次算出来都一样（后台线程和主线程可以互换）', () => {
    const a = cloudNoiseData();
    expect(a.length).toBe(64 ** 3 * 4);
    expect(cloudNoiseData()).toEqual(a);
  });
});

/** 一个最小的 three.js 渲染器替身：只有分批建材质用到的几样 */
function fakeRenderer(costMs: number) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const cache = new Map<string, object>();
  const objects = new Map<string, { _nodeBuilderState: object | null; initialCacheKey: string }>();
  const drawn: string[] = [];
  const before: string[] = [];
  const R = {
    _currentRenderContext: {},
    _currentRenderBundle: null,
    _objects: {
      get(object: { id: string; key?: string }) {
        let ro = objects.get(object.id);
        if (!ro) objects.set(object.id, (ro = { _nodeBuilderState: null, initialCacheKey: object.key ?? object.id }));
        return ro;
      },
    },
    _nodes: {
      nodeBuilderCache: cache,
      updateBefore: (ro: { initialCacheKey: string }) => before.push(ro.initialCacheKey),
    },
    _renderObjectDirect(object: { id: string; key?: string }) {
      const ro = R._objects.get(object);
      if (!ro._nodeBuilderState) {
        const key = ro.initialCacheKey;
        if (!cache.has(key)) {
          // 新建节点图：花时间
          now += costMs;
          cache.set(key, {});
        }
        ro._nodeBuilderState = cache.get(key)!;
      }
      drawn.push(object.id);
    },
  };
  return { R, drawn, before, original: R._renderObjectDirect };
}

describe('预热时分批新建材质', () => {
  function setup(costMs: number) {
    const f = fakeRenderer(costMs);
    const view = Object.assign(Object.create(WorldView.prototype), { renderer: f.R, frames: 0 }) as WorldView;
    const gate = new FrameGate();
    const unbuild = (view as unknown as { budgetBuild(g: FrameGate, ms: number): () => void }).budgetBuild(gate, 90);
    const frame = (ids: Array<string | { id: string; key: string }>) => {
      f.drawn.length = 0;
      f.before.length = 0;
      for (const o of ids) f.R._renderObjectDirect(typeof o === 'string' ? { id: o } : o);
      view.frames++;
    };
    return { ...f, view, gate, unbuild, frame };
  }

  it('每帧只新建约 90 ms 的量（至少一个），其余这一帧不画；一帧下来没有推迟就是建完了', async () => {
    const t = setup(40);
    const ids = Array.from({ length: 8 }, (_, i) => `o${i}`);
    let done = false;
    void t.gate.done.then(() => (done = true));
    t.frame(ids);
    // 40 + 40 + 40 = 120 > 90：第三个建完已经超了，其余推迟
    expect(t.drawn).toEqual(['o0', 'o1', 'o2']);
    expect(t.gate.deferred).toBe(5);
    t.frame(ids);
    // 建好的不再提交绘制，只走 updateBefore（嵌套的渲染通道靠它往下走）
    expect(t.before).toEqual(['o0', 'o1', 'o2']);
    expect(t.drawn).toEqual(['o3', 'o4', 'o5']);
    t.frame(ids);
    expect(t.drawn).toEqual(['o6', 'o7']);
    await Promise.resolve();
    expect(done).toBe(false);
    t.frame(ids);
    await t.gate.done;
    expect(done).toBe(true);
    t.unbuild();
    expect(t.R._renderObjectDirect).toBe(t.original);
  });

  it('一个就超预算的大材质也照建（每帧至少一个），不会永远推迟', () => {
    const t = setup(500);
    t.frame(['big1', 'big2']);
    expect(t.drawn).toEqual(['big1']);
    t.frame(['big1', 'big2']);
    expect(t.drawn).toEqual(['big2']);
    t.unbuild();
  });

  it('缓存里已有节点图的物体（同一种材质）照常处理，不占预算、不推迟', () => {
    const t = setup(100);
    t.frame([{ id: 'a', key: 'shared' }, { id: 'b', key: 'shared' }, { id: 'c', key: 'shared' }, 'x']);
    // a 新建（100 ms），b、c 用缓存；x 是新的、预算已经用完：推迟
    expect(t.drawn).toEqual(['a', 'b', 'c']);
    expect(t.gate.deferred).toBe(1);
    t.unbuild();
  });

  it('renderer 不是 three.js 的（单元测试替身）：不装钩子，直接算建完', async () => {
    const view = Object.assign(Object.create(WorldView.prototype), { renderer: {}, frames: 0 }) as WorldView;
    const gate = new FrameGate();
    const unbuild = (view as unknown as { budgetBuild(g: FrameGate, ms: number): () => void }).budgetBuild(gate, 90);
    await gate.done;
    unbuild();
  });

  it('同一时间只有一轮预热编译：再开一轮先撤掉上一轮的钩子', () => {
    const getForRender = vi.fn();
    const draw = vi.fn();
    const pipelines = { getForRender };
    const backend = { isWebGPUBackend: true, get: () => ({ pipeline: {} }), draw };
    const view = Object.assign(Object.create(WorldView.prototype), { renderer: { _pipelines: pipelines, backend }, frames: 0 }) as WorldView;
    const first = view.parallelCompile();
    const hooked = pipelines.getForRender;
    expect(hooked).not.toBe(getForRender);
    const second = view.parallelCompile();
    // 第二轮套在原函数上，不是套在第一轮的钩子上
    second.cancel();
    expect(pipelines.getForRender).toBe(getForRender);
    expect(backend.draw).toBe(draw);
    expect(view.compiling).toBe(false);
    first.cancel();
    expect(pipelines.getForRender).toBe(getForRender);
  });
});
