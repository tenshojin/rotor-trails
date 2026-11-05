import { afterEach, expect, it, vi } from 'vitest';
import { waitForOperation } from '../src/game/pending';

afterEach(() => vi.useRealTimers());

it('已停止的实例即使操作已完成也不会继续', async () => {
  const owner = new AbortController();
  owner.abort();
  await expect(waitForOperation(Promise.resolve(42), owner.signal, 100, 'GPU')).rejects.toThrow('已停止');
});

it('GPU 操作无结果时按时失败并清理等待计时器', async () => {
  vi.useFakeTimers();
  const pending = waitForOperation(new Promise(() => {}), new AbortController().signal, 100, 'GPU');
  const check = expect(pending).rejects.toThrow('GPU超时');
  await vi.advanceTimersByTimeAsync(100);
  await check;
  expect(vi.getTimerCount()).toBe(0);
});

it('停止实例立即结束等待，晚到的失败不会成为未处理拒绝', async () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  let fail!: (error: Error) => void;
  const work = new Promise<never>((_, reject) => { fail = reject; });
  const pending = waitForOperation(work, owner.signal, 100, 'GPU');
  owner.abort();
  await expect(pending).rejects.toThrow('已停止');
  fail(new Error('late GPU failure'));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});

it('正常完成不遗留超时或 abort 监听', async () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  const remove = vi.spyOn(owner.signal, 'removeEventListener');
  await expect(waitForOperation(Promise.resolve(42), owner.signal, 100, 'GPU')).resolves.toBe(42);
  expect(remove).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
