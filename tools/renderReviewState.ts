/** 验收工具的可测试状态：页面最多显示近期日志，每个场景保留独立且不截断的记录。 */
export type ReviewLogEntry = { sequence: number; at: string; level: 'error' | 'warn'; text: string };

export class ReviewLog {
  readonly recent: ReviewLogEntry[] = [];
  readonly totals = { error: 0, warn: 0 };
  private sequence = 0;
  private captures = new Set<ReviewLogEntry[]>();

  constructor(private readonly limit = 300) {}

  append(level: ReviewLogEntry['level'], text: string): ReviewLogEntry {
    const entry = { sequence: ++this.sequence, at: new Date().toISOString(), level, text };
    this.totals[level]++;
    this.recent.push(entry);
    if (this.recent.length > this.limit) this.recent.shift();
    for (const capture of this.captures) capture.push(entry);
    return entry;
  }

  capture(): { afterSequence: number; entries: ReviewLogEntry[]; close: () => void } {
    const entries: ReviewLogEntry[] = [];
    this.captures.add(entries);
    return { afterSequence: this.sequence, entries, close: () => { this.captures.delete(entries); } };
  }
}

export function reviewStatus(cancelled: boolean, errorCount: number, renderedFrames: number, assetsComplete: boolean): 'ok' | 'error' | 'cancelled' {
  if (cancelled) return 'cancelled';
  return errorCount > 0 || renderedFrames <= 0 || !assetsComplete ? 'error' : 'ok';
}

/** 最多等待 timeoutMs，后台不执行 RAF 或浏览器不回调 toBlob 时也会释放工具控件。 */
export function captureCanvasPng(
  canvas: Pick<HTMLCanvasElement, 'toBlob'>,
  options: {
    timeoutMs?: number;
    requestFrame?: (callback: () => void) => number;
    cancelFrame?: (id: number) => void;
  } = {},
): Promise<Blob> {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  return new Promise((resolve, reject) => {
    let settled = false;
    let frame = 0;
    const finish = (error: Error | null, blob?: Blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(blob!);
    };
    const timer = setTimeout(() => {
      cancelFrame(frame);
      finish(new Error('PNG 生成超过 15 秒，已停止等待并恢复控件。请保持页面在前台后重试。'));
    }, options.timeoutMs ?? 15000);
    frame = requestFrame(() => {
      if (settled) return;
      try {
        canvas.toBlob((blob) => {
          if (!blob || blob.size === 0) finish(new Error('浏览器未返回有效 PNG，已恢复控件，请重试。'));
          else finish(null, blob);
        }, 'image/png');
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
