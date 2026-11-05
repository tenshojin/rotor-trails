import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { GameSession } from '../src/sim/session';
import { PhysicsWorld, initPhysics } from '../src/sim/physics';
import { generateWorld, type WorldData } from '../src/world/worldgen';
import { FLAT } from './testmap';

let world: WorldData;
beforeAll(async () => {
  await initPhysics();
  world = await generateWorld({
    ...FLAT, size: 512, res: 33, props: [], nodes: [], legs: [], pickups: [],
    pads: [FLAT.pads[0]],
    mission: { startCargo: 0, optional: [], main: [{ id: 'land', kind: 'land', title: '', detail: '', padId: 'S', dwell: 2, approach: [0, 30, 0] }] },
  }, false);
});
afterEach(() => vi.restoreAllMocks());

describe('WASM 仿真资源异常路径', () => {
  it.each(['addTerrain', 'addBox', 'createHeli', 'readBody'] as const)('%s 中途失败时释放已创建的物理世界与事件队列', async (stage) => {
    let allocated: PhysicsWorld | undefined;
    const injection = vi.spyOn(PhysicsWorld.prototype, stage).mockImplementationOnce(function (this: PhysicsWorld) {
      allocated = this;
      throw new Error(`injected ${stage}`);
    } as never);
    const freeWorld = vi.spyOn(RAPIER.World.prototype, 'free');
    const freeEvents = vi.spyOn(RAPIER.EventQueue.prototype, 'free');
    try {
      await expect(GameSession.create(world, 'calm', 'standard')).rejects.toThrow(`injected ${stage}`);
      expect(freeWorld).toHaveBeenCalledOnce();
      expect(freeEvents).toHaveBeenCalledOnce();
    } finally {
      injection.mockRestore();
      // 原实现失败时也清理测试自己制造的真实 WASM 分配。
      if (allocated && freeWorld.mock.calls.length === 0) allocated.dispose();
    }
  });

  it('World 配置失败时释放刚分配的 WASM 世界', () => {
    let allocated: RAPIER.World | undefined;
    vi.spyOn(RAPIER.World.prototype, 'timestep', 'set').mockImplementationOnce(function (this: RAPIER.World) {
      allocated = this;
      throw new Error('injected timestep configuration');
    });
    const free = vi.spyOn(RAPIER.World.prototype, 'free');
    try {
      expect(() => new PhysicsWorld()).toThrow('injected timestep configuration');
      expect(free).toHaveBeenCalledOnce();
    } finally {
      if (free.mock.calls.length === 0) allocated?.free();
    }
  });

  it('会话重复销毁只释放一次，晚到的仿真步不再访问 WASM', async () => {
    const session = await GameSession.create(world, 'calm', 'standard');
    const freeWorld = vi.spyOn(session.phys.world, 'free');
    const freeEvents = vi.spyOn(session.phys.events, 'free');
    const t = session.t;
    session.dispose();
    expect(() => session.dispose()).not.toThrow();
    expect(freeWorld).toHaveBeenCalledOnce();
    expect(freeEvents).toHaveBeenCalledOnce();
    expect(() => session.step()).not.toThrow();
    expect(session.t).toBe(t);
    expect(() => session.restoreCheckpoint(0, 'safe')).not.toThrow();
    expect(() => session.teleport(0, 30, 0, 0)).not.toThrow();
    expect(session.t).toBe(t);
  });
});
