/** Bound a startup/GPU wait and stop waiting when its owning app is disposed. */
export async function waitForOperation<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number, label: string): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    throw new Error('游戏实例已停止');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('游戏实例已停止'));
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error(`${label}超时，请重试或降低画质`)), timeoutMs);
  });
  try {
    // race also observes a late rejection from work after cancellation/timeout.
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
  }
}
