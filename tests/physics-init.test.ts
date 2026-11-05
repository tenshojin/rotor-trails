import { expect, it, vi } from 'vitest';

const init = vi.hoisted(() => vi.fn());
vi.mock('@dimforge/rapier3d-compat', () => ({ default: { init } }));
import { initPhysics } from '../src/sim/physics';

it('初始化请求合并，失败后下一次请求可以重试', async () => {
  init.mockRejectedValueOnce(new Error('temporary WASM failure')).mockResolvedValueOnce(undefined);
  const first = initPhysics();
  const concurrent = initPhysics();
  expect(concurrent).toBe(first);
  await expect(first).rejects.toThrow('temporary WASM failure');
  expect(init).toHaveBeenCalledOnce();
  await expect(initPhysics()).resolves.toBeUndefined();
  expect(init).toHaveBeenCalledTimes(2);
  await initPhysics();
  expect(init).toHaveBeenCalledTimes(2);
});
