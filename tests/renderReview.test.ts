import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewLog, captureCanvasPng, reviewStatus } from '../tools/renderReviewState';

afterEach(() => vi.useRealTimers());

describe('渲染验收记录', () => {
  it('近期日志满 300 条后，下一场景仍记录新错误并使用递增序号', () => {
    const log = new ReviewLog(300);
    for (let i = 0; i < 350; i++) log.append('warn', `历史 ${i}`);
    const scenario = log.capture();
    const error = log.append('error', 'GPU validation failed');
    expect(log.recent).toHaveLength(300);
    expect(scenario.afterSequence).toBe(350);
    expect(error.sequence).toBe(351);
    expect(scenario.entries).toEqual([error]);
    scenario.close();
    log.append('error', '后一场景错误');
    expect(scenario.entries).toHaveLength(1);
    expect(log.totals).toEqual({ warn: 350, error: 2 });
  });

  it('场景中大量警告挤掉近期错误时，独立记录仍保留该错误', () => {
    const log = new ReviewLog(300);
    const scenario = log.capture();
    const first = log.append('error', '最早的绘制错误');
    for (let i = 0; i < 600; i++) log.append('warn', `连续警告 ${i}`);
    expect(log.recent.includes(first)).toBe(false);
    expect(scenario.entries[0]).toBe(first);
    expect(scenario.entries).toHaveLength(601);
    scenario.close();
  });

  it('中止的部分采样不会因已有渲染帧而被判为通过', () => {
    expect(reviewStatus(true, 0, 120, true)).toBe('cancelled');
    expect(reviewStatus(true, 0, 0, true)).toBe('cancelled');
    expect(reviewStatus(false, 0, 120, true)).toBe('ok');
    expect(reviewStatus(false, 1, 120, true)).toBe('error');
    expect(reviewStatus(false, 0, 0, true)).toBe('error');
    expect(reviewStatus(false, 0, 120, false)).toBe('error');
  });
});

describe('PNG 捕获边界', () => {
  it('等待绘制回调后编码，返回完整 Blob 并清理超时计时器', async () => {
    vi.useFakeTimers();
    let draw: (() => void) | undefined;
    const blob = new Blob(['png'], { type: 'image/png' });
    const canvas = { toBlob: vi.fn((cb: BlobCallback) => cb(blob)) };
    const promise = captureCanvasPng(canvas, { requestFrame: (cb) => { draw = cb; return 7; }, cancelFrame: vi.fn() });
    expect(canvas.toBlob).not.toHaveBeenCalled();
    draw!();
    await expect(promise).resolves.toBe(blob);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('后台窗口不执行绘制回调时会超时，迟到回调不会继续编码', async () => {
    vi.useFakeTimers();
    let draw: (() => void) | undefined;
    const cancelFrame = vi.fn();
    const canvas = { toBlob: vi.fn() };
    const promise = captureCanvasPng(canvas, { timeoutMs: 20, requestFrame: (cb) => { draw = cb; return 7; }, cancelFrame });
    const check = expect(promise).rejects.toThrow('已停止等待');
    await vi.advanceTimersByTimeAsync(20);
    await check;
    expect(cancelFrame).toHaveBeenCalledWith(7);
    draw!();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it('浏览器不回调编码结果时会超时，迟到 Blob 不会重新成功', async () => {
    vi.useFakeTimers();
    let encode: BlobCallback | undefined;
    const canvas = { toBlob: (cb: BlobCallback) => { encode = cb; } };
    const promise = captureCanvasPng(canvas, { timeoutMs: 20, requestFrame: (cb) => { cb(); return 1; }, cancelFrame: vi.fn() });
    const check = expect(promise).rejects.toThrow('已停止等待');
    await vi.advanceTimersByTimeAsync(20);
    await check;
    encode!(new Blob(['late png']));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('空编码结果和跨源安全异常不会生成可下载的伪成功结果', async () => {
    vi.useFakeTimers();
    const frame = { requestFrame: (cb: () => void) => { cb(); return 1; }, cancelFrame: vi.fn() };
    await expect(captureCanvasPng({ toBlob: (cb: BlobCallback) => cb(null) }, frame)).rejects.toThrow('有效 PNG');
    await expect(captureCanvasPng({ toBlob: () => { throw new Error('SecurityError'); } }, frame)).rejects.toThrow('SecurityError');
    expect(vi.getTimerCount()).toBe(0);
  });
});
