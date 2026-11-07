import { describe, expect, it } from 'vitest';
import { GRAND_CANYON } from '../src/maps/grandcanyon';
import { packLum } from '../src/render/terrainLayers';
import { hasTile, ringOrigin, ringRadius, RingTiles, type HiIndex, type TileIo } from '../src/world/hiTiles';

const INDEX: HiIndex = { tile: 160, px: 512, n: 64, sun: [100, 41] };

/** 假的下载和上传：手动决定每一块什么时候到 */
class FakeIo implements TileIo<string> {
  waiting = new Map<string, { resolve(v: string): void; reject(e: Error): void; signal: AbortSignal }>();
  uploaded: Array<[string, number, number]> = [];
  dropped: string[] = [];
  load(col: number, row: number, signal: AbortSignal): Promise<string> {
    const key = `${col},${row}`;
    return new Promise((resolve, reject) => {
      this.waiting.set(key, { resolve, reject, signal });
      signal.addEventListener('abort', () => reject(new Error('abort')));
    });
  }
  upload(item: string, sx: number, sy: number): void {
    this.uploaded.push([item, sx, sy]);
  }
  drop(item: string): void {
    this.dropped.push(item);
  }
  /** 让正在下载的块全部到货 */
  async arrive(): Promise<void> {
    for (const [key, w] of this.waiting) w.resolve(key);
    this.waiting.clear();
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** 一直走到不再有新的下载 */
async function settle(ring: RingTiles<string>, io: FakeIo, x: number, z: number): Promise<void> {
  for (let i = 0; i < 80; i++) {
    ring.update(x, z, 0.016, 8);
    await io.arrive();
  }
}

describe('数据', () => {
  it('地址是目录：文件名直接接在后面', () => {
    expect(GRAND_CANYON.real!.hi).toMatch(/^https:.*\/$/);
  });
});

describe('窗口', () => {
  it('中心挪到哪儿，保证的半径以内都在窗口里', () => {
    const S = 6;
    const half = 5120;
    const R = ringRadius(160, S);
    expect(R).toBe(400);
    for (let c = -3000; c < 3000; c += 37) {
      const i0 = ringOrigin(c, half, 160, S);
      expect(i0 * 160 - half).toBeLessThanOrEqual(c - R + 1e-6);
      expect((i0 + S) * 160 - half).toBeGreaterThanOrEqual(c + R - 1e-6);
    }
  });
});

describe('有哪些块', () => {
  it('十六进制串一位一块，最高位是第 0 列', () => {
    const index: HiIndex = { ...INDEX, n: 8, have: ['80', '01', '00', 'a5', '00', '00', '00', '00'] };
    expect(hasTile(index, 0, 0)).toBe(true);
    expect(hasTile(index, 1, 0)).toBe(false);
    expect(hasTile(index, 7, 1)).toBe(true);
    expect(hasTile(index, 0, 1)).toBe(false);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((c) => hasTile(index, c, 3))).toEqual([true, false, true, false, false, true, false, true]);
    expect(hasTile(index, 8, 0)).toBe(false);
    expect(hasTile(index, -1, 0)).toBe(false);
  });

  it('没写 have 就是全都有', () => {
    expect(hasTile(INDEX, 63, 63)).toBe(true);
    expect(hasTile(INDEX, 64, 0)).toBe(false);
  });
});

describe('环形贴图的调度', () => {
  it('窗口里的块全部到位，每块写在坐标取模的格子里，权重淡入到 1', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    await settle(ring, io, 0, 0);
    expect(io.uploaded.length).toBe(16);
    for (const [key, sx, sy] of io.uploaded) {
      const [c, r] = key.split(',').map(Number);
      expect(sx).toBe(c % 4);
      expect(sy).toBe(r % 4);
    }
    expect(ring.missing).toBe(0);
    expect(Math.min(...ring.weights)).toBe(1);
  });

  it('离中心近的先下载，同时下载的数量有上限', () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 8, io);
    ring.update(40, 40, 0.016);
    expect(io.waiting.size).toBe(6);
    // 中心在第 32 块里
    expect([...io.waiting.keys()]).toContain('32,32');
  });

  it('飞过一块的距离只换一排，别的格子不动', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    await settle(ring, io, 0, 0);
    io.uploaded.length = 0;
    await settle(ring, io, 160, 0);
    expect(io.uploaded.length).toBe(4);
    expect(Math.min(...ring.weights)).toBe(1);
  });

  it('一帧写的块数不超过预算', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    ring.update(0, 0, 0.016, 1);
    await io.arrive();
    ring.update(0, 0, 0.016, 1);
    expect(io.uploaded.length).toBe(1);
  });

  it('下载到一半飞走了：取消，晚到的结果不写进贴图', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    ring.update(0, 0, 0.016);
    const old = [...io.waiting.values()];
    ring.update(4000, 4000, 0.016);
    expect(old.every((w) => w.signal.aborted)).toBe(true);
    await settle(ring, io, 4000, 4000);
    for (const [key] of io.uploaded) expect(Number(key.split(',')[0])).toBeGreaterThan(50);
  });

  it('解码好还没写的块要释放', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    ring.update(0, 0, 0.016, 0);
    await io.arrive();
    ring.update(4000, 4000, 0.016, 0);
    expect(io.dropped.length).toBeGreaterThan(0);
    ring.dispose();
  });

  it('下载失败不影响别的块，过一会儿再试', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    ring.update(0, 0, 0.016);
    const [, first] = [...io.waiting.entries()][0];
    first.reject(new Error('404'));
    await Promise.resolve();
    await Promise.resolve();
    io.waiting.delete([...io.waiting.keys()][0]);
    expect(ring.missing).toBeGreaterThan(0);
    ring.update(0, 0, 10);
    await settle(ring, io, 0, 0);
    expect(ring.missing).toBe(0);
    expect(Math.min(...ring.weights)).toBe(1);
  });

  it('数据里没有的块不下载，权重一直是 0', async () => {
    const have = Array.from({ length: 64 }, () => '0'.repeat(16));
    have[32] = 'ffffffffffffffff';
    const io = new FakeIo();
    const ring = new RingTiles({ ...INDEX, have }, 4, io);
    await settle(ring, io, 0, 0);
    expect(io.uploaded.length).toBe(4);
    expect(ring.missing).toBe(0);
    expect(ring.weights.filter((w) => w === 1).length).toBe(4);
    expect(ring.weights.filter((w) => w === 0).length).toBe(12);
  });

  it('关掉以后不下载，权重清零，再打开重新来', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    await settle(ring, io, 0, 0);
    ring.setEnabled(false);
    expect(Math.max(...ring.weights)).toBe(0);
    io.uploaded.length = 0;
    ring.update(0, 0, 0.016);
    expect(io.waiting.size).toBe(0);
    ring.setEnabled(true);
    await settle(ring, io, 0, 0);
    expect(io.uploaded.length).toBe(16);
  });

  it('飞出核心区：外面没有块，不会写错位置', async () => {
    const io = new FakeIo();
    const ring = new RingTiles(INDEX, 4, io);
    await settle(ring, io, 5100, 0);
    for (const [key] of io.uploaded) expect(Number(key.split(',')[0])).toBeLessThan(64);
    expect(ring.missing).toBe(0);
  });
});

describe('细节层合并', () => {
  it('明暗写进 B 通道：相对平均亮度的倍数除以 2，只动 B', () => {
    // 中灰（线性约 0.216）、黑、白；平均亮度当 0.216
    const rgba = new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const dst = new Uint8Array(12).fill(7);
    packLum(dst, 0, rgba, 0.2158);
    expect(dst[2]).toBe(128);
    // 和着色器以前的 clamp(亮度 / 平均, 0.3, 2) 一样封顶
    expect(dst[6]).toBe(38);
    expect(dst[10]).toBe(255);
    expect([dst[0], dst[1], dst[3], dst[4], dst[5]]).toEqual([7, 7, 7, 7, 7]);
  });
});
