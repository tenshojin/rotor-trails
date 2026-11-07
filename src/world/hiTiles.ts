// 30 厘米影像的流式调度：镜头周围该放哪些块、谁先下载、什么时候写进贴图。
// 这里只管账，不碰显卡（下载和上传由 TileIo 给），所以能单独测。
//
// 环形贴图是 S×S 个格子。世界上第 (列, 行) 块永远放在第 (列 mod S, 行 mod S) 个格子：
// 飞过去的时候只有新进来的那一排要写，别的格子不动，着色器也不用查表，世界坐标取模就是贴图坐标。

export interface HiIndex {
  /** 一块多大（米） */
  tile: number;
  /** 一块多少像素 */
  px: number;
  /** 一边多少块 */
  n: number;
  /** 拍摄时的太阳：方位、高度（度） */
  sun: [number, number];
  /** 哪些块有数据：一行一个十六进制串，每位一块。全有的话可以不写 */
  have?: string[];
}

export interface TileIo<T> {
  /** 下载并解码，取消或失败时 reject */
  load(col: number, row: number, signal: AbortSignal): Promise<T>;
  /** 写到环里第 sx 列、第 sy 行的格子 */
  upload(item: T, sx: number, sy: number): void;
  /** 用不上了，释放 */
  drop(item: T): void;
}

const enum State {
  /** 这个格子现在没有要放的块 */
  Empty,
  Want,
  Loading,
  /** 解码好了，排队等着写进贴图 */
  Ready,
  Done,
  /** 下载失败，等一会儿再试 */
  Failed,
}

interface Slot<T> {
  id: number;
  state: State;
  item: T | null;
  abort: AbortController | null;
  /** 失败之后再等多久 */
  wait: number;
}

/** 同时下载几块 */
const MAX_LOADING = 6;
/** 块写好之后淡入的时间（秒） */
const FADE = 0.4;
const RETRY = 6;

/** 窗口的第一块：窗口是 S 块宽，中心尽量靠近 c */
export function ringOrigin(c: number, half: number, tile: number, slots: number): number {
  return Math.round((c + half) / tile - slots / 2);
}

/** 不管窗口停在哪儿，离中心这么远的地方一定在窗口里 */
export function ringRadius(tile: number, slots: number): number {
  return ((slots - 1) / 2) * tile;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 十六进制串里第 col 位：最高位是第 0 列 */
export function hasTile(index: HiIndex, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= index.n || row >= index.n) return false;
  if (!index.have) return true;
  const s = index.have[row];
  if (!s) return false;
  const c = s.charCodeAt(col >> 2);
  const v = c >= 97 ? c - 87 : c - 48;
  return ((v >> (3 - (col & 3))) & 1) === 1;
}

export class RingTiles<T> {
  /** 每个格子现在有多实（0 = 没有，1 = 完全显示），给着色器用 */
  readonly weights: Float32Array;
  private readonly slots: Array<Slot<T>> = [];
  private i0 = NaN;
  private j0 = NaN;
  private loading = 0;
  private pending = false;
  private enabled = true;
  private readonly half: number;

  constructor(
    private readonly index: HiIndex,
    private readonly S: number,
    private readonly io: TileIo<T>,
  ) {
    this.half = (index.tile * index.n) / 2;
    this.weights = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) this.slots.push({ id: -1, state: State.Empty, item: null, abort: null, wait: 0 });
  }

  /** 关掉：什么都不下载，贴图里有的也不用（画质降到低的时候） */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      for (let i = 0; i < this.slots.length; i++) this.reset(i, -1);
      this.i0 = this.j0 = NaN;
    }
  }

  /** 窗口里还有多少块没写进贴图 */
  get missing(): number {
    let n = 0;
    for (const s of this.slots) if (s.id >= 0 && s.state !== State.Done && s.state !== State.Failed) n++;
    return n;
  }

  /** cx、cz 是窗口的中心。budget：这一帧最多写几块 */
  update(cx: number, cz: number, dt: number, budget = 1): void {
    if (!this.enabled) return;
    const { S, index } = this;
    const i0 = ringOrigin(cx, this.half, index.tile, S);
    const j0 = ringOrigin(cz, this.half, index.tile, S);
    if (i0 !== this.i0 || j0 !== this.j0) {
      this.i0 = i0;
      this.j0 = j0;
      for (let j = j0; j < j0 + S; j++)
        for (let i = i0; i < i0 + S; i++) {
          const slot = mod(j, S) * S + mod(i, S);
          const id = hasTile(index, i, j) ? j * index.n + i : -1;
          if (this.slots[slot].id !== id) this.reset(slot, id);
        }
      this.pending = true;
    }
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.state === State.Failed && (s.wait -= dt) <= 0) {
        s.state = State.Want;
        this.pending = true;
      }
      if (s.state === State.Done && this.weights[i] < 1) this.weights[i] = Math.min(1, this.weights[i] + dt / FADE);
    }
    if (this.pending) this.start(cx, cz);
    this.flush(cx, cz, budget);
  }

  private reset(slot: number, id: number): void {
    const s = this.slots[slot];
    s.abort?.abort();
    s.abort = null;
    if (s.item !== null) this.io.drop(s.item);
    s.item = null;
    s.id = id;
    s.state = id >= 0 ? State.Want : State.Empty;
    s.wait = 0;
    this.weights[slot] = 0;
  }

  private dist(id: number, cx: number, cz: number): number {
    const { n, tile } = this.index;
    const x = ((id % n) + 0.5) * tile - this.half;
    const z = (Math.floor(id / n) + 0.5) * tile - this.half;
    return Math.hypot(x - cx, z - cz);
  }

  /** 从离中心最近的开始下载 */
  private start(cx: number, cz: number): void {
    const want: number[] = [];
    this.slots.forEach((s, i) => {
      if (s.state === State.Want) want.push(i);
    });
    want.sort((a, b) => this.dist(this.slots[a].id, cx, cz) - this.dist(this.slots[b].id, cx, cz));
    this.pending = false;
    for (const i of want) {
      if (this.loading >= MAX_LOADING) {
        this.pending = true;
        return;
      }
      this.load(i);
    }
  }

  private load(slot: number): void {
    const s = this.slots[slot];
    const { n } = this.index;
    const abort = new AbortController();
    const id = s.id;
    s.abort = abort;
    s.state = State.Loading;
    this.loading++;
    this.io.load(id % n, Math.floor(id / n), abort.signal).then(
      (item) => {
        this.loading--;
        this.pending = true;
        if (s.abort !== abort) {
          this.io.drop(item);
          return;
        }
        s.abort = null;
        s.item = item;
        s.state = State.Ready;
      },
      () => {
        this.loading--;
        this.pending = true;
        if (s.abort !== abort) return;
        s.abort = null;
        s.state = State.Failed;
        s.wait = RETRY;
      },
    );
  }

  private flush(cx: number, cz: number, budget: number): void {
    while (budget > 0) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        if (s.state !== State.Ready) continue;
        const d = this.dist(s.id, cx, cz);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return;
      const s = this.slots[best];
      this.io.upload(s.item as T, best % this.S, Math.floor(best / this.S));
      s.item = null;
      s.state = State.Done;
      budget--;
    }
  }

  dispose(): void {
    for (let i = 0; i < this.slots.length; i++) this.reset(i, -1);
  }
}
