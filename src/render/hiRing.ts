// 30 厘米影像：镜头周围一张环形贴图，飞到哪儿解码哪块（调度见 world/hiTiles.ts，数据见 tools/real/prep_hires.py）。
// RGB 是没有影子的地面颜色，A 是这里在航拍里晒得到太阳的程度。
// 大尺度的颜色和 core.webp 一样，所以边上只是清晰度慢慢变，看不到接缝；块晚到一点，也只是这一块晚一点变清楚。

import * as THREE from 'three/webgpu';
import { dot, float, floor, int, length, mod, smoothstep, texture, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import type { RealTerrainDef } from '../maps/types';
import { RingTiles, ringRadius, type HiIndex, type TileIo } from '../world/hiTiles';

type N<T extends string> = THREE.Node<T>;

/** 写几级缩小版：一块 512 像素，写到一块 8 像素。再远的地方已经淡回 1.25 米的影像了 */
const LEVELS = 7;
/** 窗口的中心往镜头前方挪多少（占半径的比例）：看得见的地方大都在前面 */
const LEAD = 0.3;
/** 离地这么高以上一个像素已经比 1.25 米的影像还粗，不用再下载 */
const MAX_AGL = 1200;

/** COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT */
const TEXTURE_USAGE = 0x02 | 0x04 | 0x10;

const DOWNSAMPLE = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = vec2i(p.xy) * 2;
  return (textureLoad(src, c, 0) + textureLoad(src, c + vec2i(1, 0), 0) + textureLoad(src, c + vec2i(0, 1), 0) + textureLoad(src, c + vec2i(1, 1), 0)) * 0.25;
}`;

function sunVector(az: number, el: number): THREE.Vector3 {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export interface HiSample {
  rgb: N<'vec3'>;
  /** 航拍里这里晒不晒得到太阳 */
  sun: N<'float'>;
  /** 这里用多少 30 厘米的影像 */
  k: N<'float'>;
  /** 模糊一点的颜色：取第几级缩小版，一级大一倍。 */
  soft(level: number): N<'vec3'>;
}

export class HiRing {
  /** 太阳和拍摄时差得不多的时候才用照片里的影子（1 = 用） */
  readonly sunMatch = uniform(1);
  /** 窗口里还有多少块没写进贴图 */
  get missing(): number {
    return this.tiles.missing;
  }
  private readonly tex: THREE.ExternalTexture;
  private readonly tiles: RingTiles<ImageBitmap>;
  private readonly weights: ReturnType<typeof uniformArray>;
  private readonly center = uniform(new THREE.Vector2());
  private readonly at = new THREE.Vector2(NaN, NaN);
  private readonly photoSun: THREE.Vector3;
  private readonly radius: number;
  private readonly width: number;
  private readonly bindGroups: GPUBindGroup[] = [];
  private readonly views: GPUTextureView[] = [];
  private readonly pipeline: GPURenderPipeline;

  /** 没有数据、不是 WebGPU 时返回 null：地形继续用 1.25 米的影像 */
  static async create(renderer: THREE.WebGPURenderer, def: RealTerrainDef, slots: number): Promise<HiRing | null> {
    const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; compatibilityMode?: boolean; device?: GPUDevice };
    // （兼容模式下一张贴图同时读一级、写一级是不允许的，缩小版算不了）
    if (!def.hi || slots <= 0 || !backend.isWebGPUBackend || backend.compatibilityMode || !backend.device) return null;
    if (new URLSearchParams(location.search).get('hires') === '0') return null;
    // （可以是完整的网址：数据放在别的仓库）
    const base = new URL(/^https?:/.test(def.hi) ? def.hi : def.base + def.hi, document.baseURI).href;
    try {
      const res = await fetch(base + 'index.json');
      if (!res.ok) return null;
      return new HiRing(backend.device, base, (await res.json()) as HiIndex, slots);
    } catch (e) {
      console.warn('30 厘米影像的索引读不到，继续用 1.25 米的：', e);
      return null;
    }
  }

  private constructor(
    private readonly device: GPUDevice,
    private readonly base: string,
    private readonly index: HiIndex,
    private readonly S: number,
  ) {
    const size = S * index.px;
    this.width = S * index.tile;
    this.radius = ringRadius(index.tile, S);
    this.photoSun = sunVector(index.sun[0], index.sun[1]);
    const gpu = device.createTexture({
      label: 'HiRing',
      size: [size, size],
      format: 'rgba8unorm-srgb',
      mipLevelCount: LEVELS,
      usage: TEXTURE_USAGE,
    });
    const tex = new THREE.ExternalTexture(gpu);
    tex.name = 'HiRing';
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 16;
    this.tex = tex;
    const module = device.createShaderModule({ label: 'HiRing mip', code: DOWNSAMPLE });
    this.pipeline = device.createRenderPipeline({
      label: 'HiRing mip',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm-srgb' }] },
      primitive: { topology: 'triangle-list' },
    });
    for (let l = 0; l < LEVELS; l++) this.views.push(gpu.createView({ baseMipLevel: l, mipLevelCount: 1 }));
    for (let l = 0; l + 1 < LEVELS; l++) this.bindGroups.push(device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.views[l] }] }));
    const io: TileIo<ImageBitmap> = {
      load: (col, row, signal) => this.load(col, row, signal),
      upload: (bitmap, sx, sy) => this.upload(gpu, bitmap, sx, sy),
      drop: (bitmap) => bitmap.close(),
    };
    this.tiles = new RingTiles(index, S, io);
    this.weights = uniformArray(Array.from(this.tiles.weights), 'float');
  }

  private async load(col: number, row: number, signal: AbortSignal): Promise<ImageBitmap> {
    const res = await fetch(`${this.base}${row}/${col}.webp`, { signal });
    if (!res.ok) throw new Error(String(res.status));
    return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  private upload(gpu: GPUTexture, bitmap: ImageBitmap, sx: number, sy: number): void {
    const px = this.index.px;
    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: gpu, origin: [sx * px, sy * px], premultipliedAlpha: false }, [px, px]);
    bitmap.close();
    const enc = this.device.createCommandEncoder({ label: 'HiRing mip' });
    for (let l = 1; l < LEVELS; l++) {
      const w = px >> l;
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.views[l], loadOp: 'load', storeOp: 'store' }] });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroups[l - 1]);
      pass.setViewport(sx * w, sy * w, w, w, 0, 1);
      pass.setScissorRect(sx * w, sy * w, w, w);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([enc.finish()]);
  }

  /** 世界坐标 → 贴图坐标和这里用多少 30 厘米的影像 */
  private locate(x: N<'float'>, z: N<'float'>): { uv: N<'vec2'>; k: N<'float'> } {
    const { tile, n } = this.index;
    const S = this.S;
    const half = (tile * n) / 2;
    const wx = x.add(half);
    const wz = z.add(half);
    const sx = mod(floor(wx.div(tile)), S);
    const sz = mod(floor(wz.div(tile)), S);
    const w = this.weights.element(int(sz.mul(S).add(sx))) as unknown as N<'float'>;
    const d = length(vec2(x, z).sub(this.center));
    return { uv: vec2(wx, wz).div(this.width), k: float(1).sub(smoothstep(this.radius * 0.68, this.radius, d)).mul(w) };
  }

  /** 着色器里取样。P 是世界坐标 */
  sample(P: N<'vec3'>): HiSample {
    const { uv, k } = this.locate(P.x, P.z);
    const t = texture(this.tex, uv);
    return { rgb: t.rgb, sun: t.a, k, soft: (level) => this.smooth(uv, level) };
  }

  /** 缩小版放大很多倍来用：线性插值看得出一格一格的方块，这里用三次 B 样条（四次取样）。
   * 指定级别就不走各向异性，贴地看过去不会拉出放射状的条纹 */
  private smooth(uv: N<'vec2'>, level: number): N<'vec3'> {
    const size = (this.S * this.index.px) >> level;
    const st = uv.mul(size).sub(0.5).toVar();
    const i = floor(st).toVar();
    const f = st.sub(i).toVar();
    const f2 = f.mul(f).toVar();
    const f3 = f2.mul(f).toVar();
    const w0 = float(1).sub(f.mul(3)).add(f2.mul(3)).sub(f3).div(6);
    const w1 = float(4).sub(f2.mul(6)).add(f3.mul(3)).div(6);
    const w2 = float(1).add(f.mul(3)).add(f2.mul(3)).sub(f3.mul(3)).div(6);
    const w3 = f3.div(6);
    const g0 = w0.add(w1).toVar();
    const g1 = w2.add(w3).toVar();
    const p0 = i.sub(0.5).add(w1.div(g0)).div(size).toVar();
    const p1 = i.add(1.5).add(w3.div(g1)).div(size).toVar();
    const tap = (x: N<'float'>, y: N<'float'>): N<'vec3'> => texture(this.tex, vec2(x, y)).level(float(level)).rgb;
    const top = tap(p0.x, p0.y).mul(g0.x).add(tap(p1.x, p0.y).mul(g1.x));
    const bottom = tap(p0.x, p1.y).mul(g0.x).add(tap(p1.x, p1.y).mul(g1.x));
    return top.mul(g0.y).add(bottom.mul(g1.y));
  }

  /** 这里是不是一丛东西（地面散布用，顶点着色器里查）。k：这里用多少 30 厘米的影像 */
  bushAt(x: N<'float'>, z: N<'float'>): { bush: N<'float'>; k: N<'float'> } {
    const { uv, k } = this.locate(x, z);
    const LUM = vec3(0.2126, 0.7152, 0.0722);
    // 颜色里影子已经提亮了，比周围十来米的地面暗一大截的就是树冠和灌木
    const here = dot(texture(this.tex, uv).level(float(1)).rgb, LUM);
    const around = dot(texture(this.tex, uv).level(float(5)).rgb, LUM);
    return { bush: float(1).sub(smoothstep(0.45, 0.8, here.div(around.max(0.02)))), k };
  }

  /** 画质降到低的时候关掉 */
  setEnabled(on: boolean): void {
    this.tiles.setEnabled(on);
    this.syncWeights();
  }

  update(cam: THREE.Vector3, forward: THREE.Vector3, sunDir: THREE.Vector3, agl: number, dt: number): void {
    const flat = Math.hypot(forward.x, forward.z) || 1;
    const lead = this.radius * LEAD;
    const tx = cam.x + (forward.x / flat) * lead;
    const tz = cam.z + (forward.z / flat) * lead;
    // 窗口慢慢跟过去，转头的时候不用把一圈块全换掉。跳得太远（传送）就直接过去
    if (!(Math.hypot(tx - this.at.x, tz - this.at.y) < this.radius)) this.at.set(tx, tz);
    else {
      const a = 1 - Math.exp(-dt / 0.8);
      this.at.x += (tx - this.at.x) * a;
      this.at.y += (tz - this.at.y) * a;
    }
    this.center.value.copy(this.at);
    if (agl < MAX_AGL) this.tiles.update(this.at.x, this.at.y, dt);
    this.syncWeights();
    // 太阳偏出去十几度以后影子方向就不对了，到三十多度完全不用
    const a = (Math.acos(Math.min(1, Math.max(-1, this.photoSun.dot(sunDir)))) * 180) / Math.PI;
    const t = Math.min(1, Math.max(0, (a - 15) / 20));
    this.sunMatch.value = 1 - t * t * (3 - 2 * t);
  }

  private syncWeights(): void {
    const a = this.weights.array as number[];
    const w = this.tiles.weights;
    for (let i = 0; i < w.length; i++) a[i] = w[i];
  }

  dispose(): void {
    this.tiles.dispose();
    (this.tex.sourceTexture as GPUTexture).destroy();
    this.tex.dispose();
  }
}
