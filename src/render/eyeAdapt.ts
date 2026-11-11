// 人眼适应（自动曝光）：把画面缩成 64 个小格、异步读回各格的亮度，按中央权重算出“眼睛看到的平均亮度”，
// 曝光慢慢向它靠拢——转头看暗的后舱时画面慢慢提亮，转回窗外时先亮一下再收回来；
// 太阳落到山后、飞进峡谷的阴影里，暗部也不会死黑。只补偿一部分：黄昏还是黄昏，不会被提成白天。
//
// 读回是异步的（几帧之后才拿到结果），不会让 CPU 等 GPU；适应本来就是秒级的慢动作，这点延迟看不出来。
// 这只对 WebGPU 成立。WebGL2 没有真正的异步读回：读一次要让主线程停下来，等显卡把手上的活全干完，
// 实测一次 30～90 ms、每 5 帧一次，飞起来一顿一顿的（Linux 上的浏览器常常没有 WebGPU，走的就是 WebGL2）。
// 所以 WebGL2 上整个适应搬到显卡上做（GpuEye），CPU 不读回。

import * as THREE from 'three/webgpu';
import { clamp, dot, exp, exp2, float, floor, Fn, log2, Loop, max, mod, pow, select, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';

/** 格子数：8 × 8，排成一行（64 × 4 字节 = 256 字节，正好是 WebGPU 读回一行要求的对齐长度） */
const GRID = 8;
const CELLS = GRID * GRID;
/** 每格取样 4 × 4 个点 */
const TAPS = 4;
/** log2 亮度的编码范围 */
const LOG_MIN = -9;
const LOG_MAX = 7;
/** 多少帧读回一次 */
const EVERY = 5;

/** 中央权重：视线中心最重要，画面底部（仪表板）和四角权重低 */
const WEIGHT = new Float32Array(CELLS);
{
  let sum = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = (i + 0.5) / GRID - 0.5;
      // 画面坐标 y 向下：把重心放在中线略偏上
      const y = (j + 0.5) / GRID - 0.42;
      const w = Math.exp(-(x * x) / (2 * 0.3 * 0.3) - (y * y) / (2 * 0.26 * 0.26));
      WEIGHT[j * GRID + i] = w;
      sum += w;
    }
  }
  for (let i = 0; i < CELLS; i++) WEIGHT[i] /= sum;
}

export interface EyeAdaptOptions {
  /** 目标平均亮度（线性）：这个亮度下曝光不变 */
  key: number;
  /** 补偿程度：1 = 完全补偿到目标亮度，0 = 不补偿 */
  strength: number;
  min: number;
  max: number;
  /** 变亮（瞳孔放大）与变暗（瞳孔缩小）的时间常数（秒） */
  tauUp: number;
  tauDown: number;
}

export const EYE_DEFAULT: EyeAdaptOptions = { key: 0.23, strength: 0.62, min: 0.58, max: 2.3, tauUp: 2.6, tauDown: 1.1 };

/**
 * 显卡上的适应（WebGL2 用）：每帧把 64 格亮度按中央权重平均、算出目标曝光、按时间常数靠过去，
 * 和 CPU 那边 consume() + update() 是同一套算式。结果留在 1 × 1 的贴图里，后期乘在画面上（post.ts 的 display）。
 * 两张贴图来回倒：读上一帧的那张、写另一张。用 32 位浮点：每帧只挪千分之几，半精度会卡在离目标还差几个百分点的地方
 */
class GpuEye {
  private readonly rts: [THREE.RenderTarget, THREE.RenderTarget];
  private read = 0;
  /** 后期读的“当前值” */
  private readonly cur: THREE.TextureNode;
  /** 这一步读的“上一帧的值” */
  private readonly prev: THREE.TextureNode;
  private readonly material = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh(this.material);
  private readonly u = {
    dt: uniform(0),
    snap: uniform(1),
    key: uniform(EYE_DEFAULT.key),
    strength: uniform(EYE_DEFAULT.strength),
    min: uniform(EYE_DEFAULT.min),
    max: uniform(EYE_DEFAULT.max),
    tauUp: uniform(EYE_DEFAULT.tauUp),
    tauDown: uniform(EYE_DEFAULT.tauDown),
  };
  /** 1 = 画面乘上适应后的曝光；0 = 乘 1（设置里关了人眼适应，或者第一步还没算） */
  readonly on = uniform(0);
  /** 适应之后再加的一点（闪电那一下） */
  readonly add = uniform(0);
  /** 后期乘在画面上的倍数 */
  readonly node: THREE.Node<'float'>;
  /** 至少算过一步（贴图里有值了） */
  ready = false;

  constructor(cells: THREE.Texture) {
    const make = (): THREE.RenderTarget => {
      const rt = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.FloatType });
      rt.texture.name = 'EyeAdaptGpu';
      rt.texture.minFilter = THREE.NearestFilter;
      rt.texture.magFilter = THREE.NearestFilter;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.rts = [make(), make()];
    this.cur = texture(this.rts[0].texture);
    this.prev = texture(this.rts[0].texture);
    const u = this.u;
    const cell = texture(cells);
    this.material.name = 'EyeAdaptGpu';
    this.material.fragmentNode = Fn(() => {
      const m = float(0).toVar();
      for (let i = 0; i < CELLS; i++) m.addAssign(cell.sample(vec2((i + 0.5) / CELLS, 0.5)).r.mul(WEIGHT[i] * (LOG_MAX - LOG_MIN)));
      const lum = exp2(m.add(LOG_MIN));
      const target = clamp(pow(u.key.div(max(lum, 1e-3)), u.strength), u.min, u.max);
      const prev = this.prev.sample(vec2(0.5, 0.5)).r;
      const tau = select(target.greaterThan(prev), u.tauUp, u.tauDown);
      const next = prev.add(target.sub(prev).mul(float(1).sub(exp(u.dt.negate().div(tau)))));
      const v = select(u.snap.greaterThan(0.5), target, next);
      return vec4(v, v, v, 1);
    })();
    // （用 select 不用 mix：贴图里万一是 NaN，乘 0 还是 NaN，整个画面会黑掉）
    this.node = select(this.on.greaterThan(0.5), this.cur.sample(vec2(0.5, 0.5)).r.add(this.add), float(1));
  }

  /** 这一帧的 64 格亮度画好之后算一步 */
  step(r: THREE.WebGPURenderer, dt: number, snap: boolean, o: EyeAdaptOptions): void {
    const u = this.u;
    u.dt.value = Math.max(0, dt);
    u.snap.value = snap || !this.ready ? 1 : 0;
    u.key.value = o.key;
    u.strength.value = o.strength;
    u.min.value = o.min;
    u.max.value = o.max;
    u.tauUp.value = o.tauUp;
    u.tauDown.value = o.tauDown;
    this.prev.value = this.rts[this.read].texture;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.rts[1 - this.read]);
    try {
      this.quad.render(r);
    } finally {
      r.setRenderTarget(prevTarget);
    }
    this.read = 1 - this.read;
    this.cur.value = this.rts[this.read].texture;
    this.ready = true;
  }

  dispose(): void {
    for (const rt of this.rts) rt.dispose();
    this.material.dispose();
  }
}

export class EyeAdapt {
  /** 当前的曝光倍数 */
  value = 1;
  /** 上一次读回的中央加权亮度（线性，调试用） */
  luma = 0;
  readonly opt: EyeAdaptOptions = { ...EYE_DEFAULT };
  private readonly rt: THREE.RenderTarget;
  private readonly material = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh(this.material);
  private readonly src = texture(new THREE.Texture());
  private target = 1;
  private busy = false;
  private count = 0;
  private fresh = true;
  private dead = false;
  private generation = 0;
  /** WebGL2：在显卡上适应（见 GpuEye），不读回 */
  private gpu: GpuEye | null = null;

  constructor() {
    this.rt = new THREE.RenderTarget(CELLS, 1, { depthBuffer: false, type: THREE.UnsignedByteType });
    this.rt.texture.name = 'EyeAdapt';
    this.rt.texture.minFilter = THREE.NearestFilter;
    this.rt.texture.magFilter = THREE.NearestFilter;
    this.rt.texture.generateMipmaps = false;
    this.material.name = 'EyeAdapt';
    this.material.fragmentNode = Fn(() => {
      // 一行 64 个像素对应 8 × 8 的格子
      const idx = floor(uv().x.mul(CELLS));
      const cx = mod(idx, float(GRID));
      const cy = floor(idx.div(GRID));
      const acc = float(0).toVar();
      Loop(TAPS * TAPS, ({ i }: { i: THREE.Node<'int'> }) => {
        const fi = float(i);
        const tx = mod(fi, float(TAPS)).add(0.5).div(TAPS);
        const ty = floor(fi.div(TAPS)).add(0.5).div(TAPS);
        const p = vec2(cx.add(tx), cy.add(ty)).div(GRID);
        const c = this.src.sample(p).rgb;
        const l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
        acc.addAssign(log2(max(l, exp2(float(LOG_MIN)))));
      });
      const m = acc.div(TAPS * TAPS);
      const enc = clamp(m.sub(LOG_MIN).div(LOG_MAX - LOG_MIN), 0.0, 1.0);
      return vec4(enc, enc, enc, 1.0);
    })();
  }

  /** 瞬移、换地图之后：下一次读回的结果直接生效，不慢慢过渡 */
  snap(): void {
    this.generation++;
    this.fresh = true;
    this.count = 0;
  }

  /** 渲染器初始化以后按后端设一次：WebGL2 上在显卡上适应 */
  useGpu(on: boolean): void {
    if (on && !this.gpu && !this.dead) {
      this.gpu = new GpuEye(this.rt.texture);
      this.fresh = true;
    } else if (!on && this.gpu) {
      this.gpu.dispose();
      this.gpu = null;
    }
  }

  get onGpu(): boolean {
    return this.gpu !== null;
  }

  /** 后期乘在画面上的曝光（只在显卡上适应时有，否则 null：后期不乘，曝光全在 toneMappingExposure 里） */
  get gpuNode(): THREE.Node<'float'> | null {
    return this.gpu?.node ?? null;
  }

  /** 显卡上适应时每帧设：画面乘不乘适应后的曝光（设置里可以关），适应之后再加多少（闪电） */
  gpuOutput(active: boolean, add: number): void {
    if (!this.gpu) return;
    this.gpu.on.value = active && this.gpu.ready ? 1 : 0;
    this.gpu.add.value = add;
  }

  /** 这帧画面（线性 HDR，色调映射之前）画完之后调用 */
  sample(r: THREE.WebGPURenderer, tex: THREE.Texture | null, dt = 0): void {
    if (!tex || this.dead) return;
    if (this.gpu) {
      // 显卡上：每帧画 64 格，再算一步适应，全程不读回
      this.src.value = tex;
      const prevTarget = r.getRenderTarget();
      r.setRenderTarget(this.rt);
      try {
        this.quad.render(r);
      } finally {
        r.setRenderTarget(prevTarget);
      }
      this.gpu.step(r, dt, this.fresh, this.opt);
      this.fresh = false;
      return;
    }
    if (++this.count < EVERY || this.busy) return;
    this.count = 0;
    this.src.value = tex;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    try {
      this.quad.render(r);
    } finally {
      r.setRenderTarget(prev);
    }
    this.busy = true;
    const generation = this.generation;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, CELLS, 1)
      .then((px) => {
        // A readback from the previous map or time of day must not become the
        // first exposure sample of the new scene.
        if (px && !this.dead && generation === this.generation) this.consume(px as Uint8Array);
      })
      .catch(() => {
        if (this.dead || generation !== this.generation) return;
        // 读回失败（个别后端）：退回固定曝光
        this.dead = true;
        this.target = 1;
      })
      .finally(() => (this.busy = false));
  }

  private consume(px: Uint8Array): void {
    let m = 0;
    for (let i = 0; i < CELLS; i++) m += (px[i * 4] / 255) * (LOG_MAX - LOG_MIN) * WEIGHT[i];
    const lum = 2 ** (m + LOG_MIN);
    this.luma = lum;
    const o = this.opt;
    this.target = Math.min(o.max, Math.max(o.min, (o.key / Math.max(lum, 1e-3)) ** o.strength));
    if (this.fresh) {
      this.value = this.target;
      this.fresh = false;
    }
  }

  /** 夜里眼睛能放得更开 */
  setMax(max: number): void {
    this.opt.max = max;
  }

  /** 每帧调用：曝光按时间常数靠向目标 */
  update(dt: number): number {
    const tau = this.target > this.value ? this.opt.tauUp : this.opt.tauDown;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / tau));
    return this.value;
  }

  dispose(): void {
    this.dead = true;
    this.generation++;
    this.gpu?.dispose();
    this.gpu = null;
    this.rt.dispose();
    this.material.dispose();
  }
}
