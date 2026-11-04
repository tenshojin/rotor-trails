// 人眼适应（自动曝光）：把画面缩成 64 个小格、异步读回各格的亮度，按中央权重算出“眼睛看到的平均亮度”，
// 曝光慢慢向它靠拢——转头看暗的后舱时画面慢慢提亮，转回窗外时先亮一下再收回来；
// 太阳落到山后、飞进峡谷的阴影里，暗部也不会死黑。只补偿一部分：黄昏还是黄昏，不会被提成白天。
//
// 读回是异步的（几帧之后才拿到结果），不会让 CPU 等 GPU；适应本来就是秒级的慢动作，这点延迟看不出来。

import * as THREE from 'three/webgpu';
import { clamp, dot, exp2, float, floor, Fn, log2, Loop, max, mod, texture, uv, vec2, vec3, vec4 } from 'three/tsl';

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

export const EYE_DEFAULT: EyeAdaptOptions = { key: 0.23, strength: 0.62, min: 0.7, max: 2.3, tauUp: 2.6, tauDown: 1.1 };

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
    this.fresh = true;
  }

  /** 这帧画面（线性 HDR，色调映射之前）画完之后调用 */
  sample(r: THREE.WebGPURenderer, tex: THREE.Texture | null): void {
    if (!tex || this.dead) return;
    if (++this.count < EVERY || this.busy) return;
    this.count = 0;
    this.src.value = tex;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    this.quad.render(r);
    r.setRenderTarget(prev);
    this.busy = true;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, CELLS, 1)
      .then((px) => {
        if (px) this.consume(px as Uint8Array);
      })
      .catch(() => {
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

  /** 每帧调用：曝光按时间常数靠向目标 */
  update(dt: number): number {
    const tau = this.target > this.value ? this.opt.tauUp : this.opt.tauDown;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / tau));
    return this.value;
  }

  dispose(): void {
    this.rt.dispose();
    this.material.dispose();
  }
}
