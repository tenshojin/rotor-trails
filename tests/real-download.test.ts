import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadRealFiles } from '../src/world/realData';
import type { RealTerrainDef } from '../src/maps/types';

const def = { base: 'real/', bytes: 120, levels: Array.from({ length: 4 }, (_, i) => ({ heights: 'h' + i, image: 'i' + i })) } as RealTerrainDef;
afterEach(() => vi.unstubAllGlobals());

describe('大地图预取的资源和生命周期', () => {
  it('同时最多四个请求，重复资源只下载一次，进度统计实际字节', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    let active = 0, peak = 0;
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url); active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(10)); controller.close(); active--; },
      }), { headers: { 'content-length': '10' } });
    });
    const progress: number[] = [];
    await downloadRealFiles({ ...def, trees: 'h0' }, (done) => progress.push(done));
    expect(peak).toBeLessThanOrEqual(4);
    expect(urls.length).toBe(8);
    expect(new Set(urls).size).toBe(8);
    expect(progress.at(-1)).toBe(80);
  });

  it('终止会取消已开始请求、不再启动余下文件，也不再上报旧进度', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    const controller = new AbortController();
    let requested = 0;
    const progress = vi.fn();
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      requested++;
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const work = downloadRealFiles(def, progress, controller.signal);
    expect(requested).toBe(4);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(requested).toBe(4);
    expect(progress).not.toHaveBeenCalled();
  });

  it('HTTP 错误正文不算下载进度，预取失败不会阻止必要加载器自行重试', async () => {
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    const fetcher = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const progress = vi.fn();
    await downloadRealFiles({ ...def, levels: [def.levels[0]] }, progress);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(progress).not.toHaveBeenCalled();
  });
});
