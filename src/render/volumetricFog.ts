// 体积雾与丁达尔效应（光束）：后期里沿每个像素的视线做光线步进（约半个屏幕分辨率，结果按深度升采样后合成）。
//
//   · 贴地薄雾：离地越高越稀（标高约 40 m，水面、谷底、林中最浓），林区更浓，团块随风缓慢飘动。
//     每个采样点用太阳的分层阴影（CSM）判断阳光有没有被树、房子、山挡住，再乘上云影：
//     阳光穿过树冠、屋檐、云缝的地方亮，被挡住的地方暗——这就是光束（丁达尔效应）。
//     散射用 Henyey-Greenstein 相函数（以前向散射为主）：迎着太阳看时光束最明显，背着太阳只剩淡淡的雾气。
//   · 低空的霾（标高约 1.5 km，一直到云底）：同样按阴影与云影照亮，迎着太阳时云缝、山脊后面透出一道道光（云隙光）。
//   · 低云层（山腰的云海）：沿视线和云层相交的那一段积分，碰到地形就停——云贴着山坡自然消失，没有和地形相交的硬线。
//   · 远处的大气雾（atmosphere.ts 的解析雾）自己不知道哪里有阴影：这里统计视线上“被挡住的比例”，
//     把雾里朝太阳一侧的那部分散射光按比例扣掉——山的阴影、云影在远处的雾里显出一道道暗带（云隙光）。
//
// 输出 vec4(增加的散射光（为负时表示扣掉的大气散射）, 薄雾透过率)；applyVolumetricFog 负责升采样与合成：
//   颜色 = 场景颜色 × 透过率 + 散射光。
// 步进起点每帧按像素抖动，由后面的 TRAA 做时间累积（与体积云相同的做法）。

import * as THREE from 'three/webgpu';
import { abs, clamp, context, dot, exp, float, floor, fract, Fn, If, interleavedGradientNoise, Loop, max, min, mix, normalize, passTexture, perspectiveDepthToViewZ, pow, reference, screenCoordinate, select, smoothstep, texture, texture3D, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { FOG } from './atmosphere';
import { getCloudNoise3D } from './cloudNoise';
import { cloudShadow } from './cloudShadowMap';
import { terrainSunHaze } from './sunMap';
import { SHADOW_SPLITS, type SunShadows } from './sunShadows';

/** 体积雾参数（WorldView 每帧按天气更新） */
export const VFOG = {
  /** 地面处薄雾的散射系数（1/米） */
  mist: uniform(0.0006),
  /** 薄雾的标高（米）：离地每高这么多，浓度降到 1/e */
  mistH: uniform(40),
  /** 低空气溶胶（霾）的散射系数（1/米，雾的基准高度处）：云隙光、山影里的光束主要靠它 */
  haze: uniform(2e-5),
  /** 霾的标高（米） */
  hazeH: uniform(1500),
  /** 阳光（颜色 × 强度，与太阳方向光一致） */
  sun: uniform(new THREE.Color(3, 3, 3)),
  /** 光束的强度（夜里月光的光束弱得多） */
  beam: uniform(1),
  /** 太阳很低（0 = 白天，1 = 日出日落）：树冠迎着斜阳发亮 */
  low: uniform(0),
  /** 天空光（薄雾被天空照亮的颜色） */
  amb: uniform(new THREE.Color(0.5, 0.6, 0.7)),
  /** 雾团随风飘动的偏移（米） */
  wind: uniform(new THREE.Vector3()),
  /** 地图边长（米）：高度图与森林图覆盖的范围 */
  mapSize: uniform(4000),
  /** 远处大气雾里阴影的强度（1 = 被挡住的部分完全扣掉朝阳散射） */
  shade: uniform(1),
  /** 低云层：浓度 0..1（0 = 没有）、底 / 顶高度（米） */
  lowK: uniform(0),
  lowBase: uniform(1200),
  lowTop: uniform(1450),
};

/** 当前地图的地表高度图与森林密度图（WorldView 加载地图时设置；换图后体积雾自动重建） */
export const fogMaps: { height: THREE.Texture | null; forest: THREE.Texture | null } = { height: null, forest: null };

export interface FogQuality {
  /** 渲染分辨率（相对屏幕的 CSS 像素） */
  scale: number;
  /** 近处（薄雾）步进次数 */
  near: number;
  /** 远处（只统计阴影）步进次数 */
  far: number;
  /** 薄雾的计算距离（米），往外淡出 */
  range: number;
}

export const FOG_QUALITY: Record<'medium' | 'high' | 'ultra', FogQuality> = {
  medium: { scale: 0.4, near: 16, far: 6, range: 800 },
  high: { scale: 0.5, near: 24, far: 8, range: 1200 },
  ultra: { scale: 0.5, near: 32, far: 12, range: 1500 },
};

/** 远处统计阴影的最远距离（米） */
const FAR_RANGE = 8000;
/** 低云层沿视线的采样数 */
const LOW_STEPS = 7;
/** 低云的消光系数（1/米） */
const LOW_SIGMA = 0.014;

const _size = /*@__PURE__*/ new THREE.Vector2();
let _state: THREE.RendererUtils.RendererState | undefined;

type V3 = THREE.Node<'vec3'>;
type F1 = THREE.Node<'float'>;

/** Henyey-Greenstein 相函数（归一化到 1/sr） */
const hg = (c: F1, g: number): F1 => float((1 - g * g) / (4 * Math.PI)).div(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5));

export class VolumetricFogNode extends THREE.Node {
  /** 结果纹理的像素尺寸（升采样用） */
  readonly size = uniform(new THREE.Vector2(1, 1));
  private readonly rt: THREE.RenderTarget;
  private readonly material = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh(this.material);
  private readonly texNode: THREE.TextureNode;
  private readonly camWorld: THREE.UniformNode<'mat4', THREE.Matrix4>;
  private readonly projInv: THREE.UniformNode<'mat4', THREE.Matrix4>;
  private readonly camPos = uniform(new THREE.Vector3());
  private readonly frameN = uniform(0);
  private ctx: unknown = null;
  private sig = '';
  private ready = false;

  constructor(
    private readonly depthNode: THREE.TextureNode,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sun: SunShadows,
    private readonly q: FogQuality,
  ) {
    super('vec4');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    this.rt = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
    this.rt.texture.name = 'VolumetricFog';
    this.material.name = 'VolumetricFog';
    this.texNode = passTexture(this as unknown as THREE.PassNode, this.rt.texture);
    this.camWorld = uniform(camera.matrixWorld);
    this.projInv = uniform(camera.projectionMatrixInverse);
  }

  getTextureNode(): THREE.TextureNode {
    return this.texNode;
  }

  /** 依赖的阴影贴图与地图纹理：任何一个换了就重建着色器（阴影贴图在第一次渲染后才创建、改阴影精度时会重建） */
  private signature(): string {
    const ids = this.sun.csm.lights.map((l) => l.shadow?.map?.depthTexture?.id ?? -1);
    return `${ids.join(',')}|${fogMaps.height?.id ?? -1}|${fogMaps.forest?.id ?? -1}`;
  }

  updateBefore(frame: THREE.NodeFrame): boolean | undefined {
    const r = frame.renderer as THREE.WebGPURenderer;
    const sig = this.signature();
    if (sig !== this.sig && this.ctx) {
      this.sig = sig;
      this.ready = this.rebuild();
    }
    r.getSize(_size);
    const w = Math.max(1, Math.round(_size.x * this.q.scale));
    const h = Math.max(1, Math.round(_size.y * this.q.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    this.size.value.set(w, h);
    _state = THREE.RendererUtils.resetRendererState(r, _state as THREE.RendererUtils.RendererState);
    try {
      r.setRenderTarget(this.rt);
      if (this.ready) {
        this.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
        this.frameN.value = (this.frameN.value + 1) % 64;
        this.quad.render(r);
      } else {
        // 阴影贴图还没准备好：输出“没有雾”（散射 0、透过率 1）
        r.setClearColor(0x000000, 1);
        r.clear();
      }
    } finally {
      THREE.RendererUtils.restoreRendererState(r, _state);
    }
    return undefined;
  }

  setup(builder: THREE.NodeBuilder): THREE.TextureNode {
    this.ctx = (builder as unknown as { getSharedContext(): unknown }).getSharedContext();
    this.sig = '';
    return this.texNode;
  }

  private rebuild(): boolean {
    const lights = this.sun.csm.lights;
    const heightTex = fogMaps.height;
    const forestTex = fogMaps.forest;
    if (lights.length < SHADOW_SPLITS.length || !heightTex || !forestTex) return false;
    const shadowTex = lights.map((l) => l.shadow?.map?.depthTexture ?? null);
    if (shadowTex.some((t) => !t)) return false;
    const mats = lights.map((l) => uniform(l.shadow!.matrix));
    const near = reference('near', 'float', this.camera);
    const far = reference('far', 'float', this.camera);
    const noise3 = getCloudNoise3D();
    const { near: N, far: NF, range } = this.q;

    // 阳光能否照到 p：按 p 在相机前方的深度 vz 选 CSM 的第 2~4 层（第 1 层只覆盖 4 m 内的座舱）
    const sunVis = (p: V3, vz: F1): F1 => {
      const v = float(1).toVar();
      const look = (i: number) => {
        const sp = mats[i].mul(vec4(p, 1.0));
        const c = vec3(sp.x, sp.y.oneMinus(), sp.z);
        const inside = c.x.greaterThanEqual(0).and(c.x.lessThanEqual(1)).and(c.y.greaterThanEqual(0)).and(c.y.lessThanEqual(1)).and(c.z.greaterThanEqual(0)).and(c.z.lessThanEqual(1));
        If(inside, () => {
          v.assign(texture(shadowTex[i]!, c.xy).compare(c.z));
        });
      };
      If(vz.lessThan(SHADOW_SPLITS[1]), () => look(1))
        .ElseIf(vz.lessThan(SHADOW_SPLITS[2]), () => look(2))
        .ElseIf(vz.lessThan(SHADOW_SPLITS[3]), () => look(3));
      return v;
    };

    // 贴地薄雾：返回 vec2(浓度, 森林密度)。浓度 = 离地高度（高度图）× 森林 × 随风飘动的团块
    const mistAt = (p: V3): THREE.Node<'vec2'> => {
      const muv = p.xz.div(VFOG.mapSize).add(0.5);
      const g = texture(heightTex, muv).level(float(0)).r;
      const f = texture(forestTex, muv).level(float(0)).r;
      const above = max(p.y.sub(g), 0.0);
      const n = texture3D(noise3, p.add(VFOG.wind).div(240.0)).level(float(0)).a;
      const patch = smoothstep(0.3, 0.7, n).mul(1.3).add(0.35);
      // 第二项：头顶有树冠的程度（只在树冠高度以下才算林下）
      return vec2(VFOG.mist.mul(exp(above.div(VFOG.mistH).negate())).mul(f.mul(1.7).add(0.3)).mul(patch), f.mul(float(1).sub(smoothstep(12.0, 36.0, above))));
    };

    const frag = Fn(() => {
      const uvN = uv();
      const dep = this.depthNode.sample(uvN).r;
      const viewZ = perspectiveDepthToViewZ(dep, near, far);
      const ndc = vec2(uvN.x, uvN.y.oneMinus()).mul(2.0).sub(1.0);
      const vp = this.projInv.mul(vec4(ndc, 0.5, 1.0));
      const vd = normalize(vp.xyz.div(vp.w));
      const fwd = vd.z.negate();
      const dist = viewZ.div(vd.z);
      const sky = dist.greaterThan(far.mul(0.95));
      const wd = normalize(this.camWorld.mul(vec4(vd, 0.0)).xyz);
      const cam = this.camPos;
      const cosT = dot(wd, FOG.sunDir);
      // 雾滴、气溶胶以前向散射为主（g ≈ 0.7）：迎着太阳时光束最亮
      const sunL = VFOG.sun.mul(VFOG.beam).mul(mix(hg(cosT, 0.72), float(1 / (4 * Math.PI)), 0.15));
      const sunH = VFOG.sun.mul(VFOG.beam).mul(mix(hg(cosT, 0.76), float(1 / (4 * Math.PI)), 0.1));
      const hazeAt = (p: V3): F1 => VFOG.haze.mul(exp(max(p.y.sub(FOG.baseY), 0.0).div(VFOG.hazeH).negate()));
      const jit = interleavedGradientNoise(screenCoordinate.add(this.frameN.mul(5.588238)));
      // 解析雾（atmosphere.ts）的光学厚度 τ(t) = D2·t²：D 按视线两端的平均高度
      const dEnd = min(dist, 30000.0);
      const hAvg = cam.y.mul(2.0).add(wd.y.mul(dEnd)).mul(0.5).sub(FOG.baseY);
      const hk = select(FOG.heightK.greaterThan(0), clamp(exp(max(hAvg, 0.0).negate().mul(FOG.heightK)), 0.16, 1.0), float(1));
      const D = FOG.density.mul(hk);
      const D2 = D.mul(D).add(FOG.cloud.mul(FOG.cloud));
      // —— 近处：贴地薄雾（光束），顺便统计近处的遮挡 ——
      const tA = min(dist, range);
      const Lm = vec3(0.0).toVar();
      const Tm = float(1).toVar();
      // 霾：只累加散射光（它的消光已经包含在解析雾里），自身的透过率只用来让散射光饱和
      const Lh = vec3(0.0).toVar();
      const Th = float(1).toVar();
      const Sn = float(0).toVar();
      const Sd = float(0).toVar();
      Loop(N, ({ i }: { i: THREE.Node<'int'> }) => {
        // 采样点按平方分布：近处密（树林、屋檐下的细光束），远处疏
        const s = float(i).add(jit).div(N);
        const t = tA.mul(s.mul(s));
        const dt = tA.mul(s.mul(2.0).add(1.0 / N)).div(N);
        const p = cam.add(wd.mul(t));
        const vis = sunVis(p, t.mul(fwd)).mul(cloudShadow(p)).mul(terrainSunHaze(p));
        const fade = float(1).sub(smoothstep(range * 0.55, range, t));
        const m = mistAt(p);
        const a = exp(m.x.mul(fade).mul(dt).negate());
        // 林下的天空光大半被树冠挡住：光束之间的雾气更暗，光束才显得出来
        const amb = VFOG.amb.mul(mix(float(1), float(0.3), m.y));
        Lm.addAssign(sunL.mul(vis).add(amb).mul(Tm.mul(float(1).sub(a))));
        Tm.mulAssign(a);
        const ah = exp(hazeAt(p).mul(dt).negate());
        Lh.addAssign(sunH.mul(vis).mul(Th.mul(Tm).mul(float(1).sub(ah))));
        Th.mulAssign(ah);
        const w = t.mul(exp(D2.mul(t).mul(t).negate())).mul(dt);
        Sn.addAssign(w.mul(float(1).sub(vis)));
        Sd.addAssign(w);
      });
      // —— 远处：只统计遮挡（山的阴影、云影）——
      const tB = min(dist, FAR_RANGE);
      If(tB.greaterThan(tA), () => {
        const seg = tB.sub(tA).div(NF);
        Loop(NF, ({ i }: { i: THREE.Node<'int'> }) => {
          const t = tA.add(float(i).add(jit).mul(seg));
          const p = cam.add(wd.mul(t));
          const vis = sunVis(p, t.mul(fwd)).mul(cloudShadow(p)).mul(terrainSunHaze(p));
          const ah = exp(hazeAt(p).mul(seg).negate());
          Lh.addAssign(sunH.mul(vis).mul(Th.mul(Tm).mul(float(1).sub(ah))));
          Th.mulAssign(ah);
          const w = t.mul(exp(D2.mul(t).mul(t).negate())).mul(seg);
          Sn.addAssign(w.mul(float(1).sub(vis)));
          Sd.addAssign(w);
        });
      });
      // 8 km 以外当作不被遮挡：∫ t·e^(−D2·t²) dt 的解析值
      const tail = exp(D2.mul(tB).mul(tB).negate()).sub(exp(D2.mul(dEnd).mul(dEnd).negate())).div(max(D2.mul(2.0), 1e-12));
      Sd.addAssign(max(tail, 0.0));
      const S = Sn.div(max(Sd, 1e-6));
      // 解析雾里朝太阳一侧的散射（与 atmosphere.ts 的 fogColorFactor 相同）；天空不受场景雾影响，不扣
      const F = float(1).sub(exp(D2.negate().mul(dEnd).mul(dEnd)));
      const lobe = max((FOG.sunColor as unknown as V3).sub(FOG.color as unknown as V3), vec3(0.0)).mul(pow(max(cosT, 0.0), 6.0)).mul(F);
      // 阴天没有阳光可以扣：解析雾里朝阳的那部分本来就很弱，再按云影扣会把雾扣成黑的
      const shade = select(sky, float(0.0), VFOG.shade);
      // —— 低云层 ——
      const Lc = vec3(0.0).toVar();
      const Tc = float(1).toVar();
      If(VFOG.lowK.greaterThan(0.005), () => {
        const dy = select(abs(wd.y).lessThan(1e-4), float(1e-4), wd.y);
        const a0 = VFOG.lowBase.sub(cam.y).div(dy);
        const a1 = VFOG.lowTop.sub(cam.y).div(dy);
        const c0 = max(min(a0, a1), 0.0).toVar();
        const c1 = min(max(a0, a1), min(dist, 16000.0));
        const seg = max(c1.sub(c0), 0.0).div(LOW_STEPS).toVar();
        If(seg.greaterThan(0.05), () => {
          const th = mix(float(0.66), float(0.26), VFOG.lowK);
          const lit = (VFOG.amb as unknown as V3).mul(1.15);
          const sunTop = (VFOG.sun as unknown as V3).mul(0.07);
          Loop(LOW_STEPS, ({ i }: { i: THREE.Node<'int'> }) => {
            const p = cam.add(wd.mul(c0.add(float(i).add(jit).mul(seg))));
            const hN = clamp(p.y.sub(VFOG.lowBase).div(VFOG.lowTop.sub(VFOG.lowBase)), 0.0, 1.0);
            const q = p.add(VFOG.wind);
            const shape = texture3D(noise3, q.div(1700.0)).level(float(0)).r.mul(0.72).add(texture3D(noise3, q.div(430.0).add(0.37)).level(float(0)).g.mul(0.28));
            const prof = smoothstep(0.0, 0.28, hN).mul(float(1).sub(smoothstep(0.5, 1.0, hN)));
            const den = smoothstep(th, th.add(0.3), shape.mul(prof.mul(0.5).add(0.62))).mul(prof);
            const a = exp(den.mul(seg).mul(-LOW_SIGMA));
            Lc.addAssign(lit.mul(hN.mul(0.5).add(0.55)).add(sunTop.mul(hN)).mul(Tc.mul(float(1).sub(a))));
            Tc.mulAssign(a);
          });
        });
      });
      return vec4(Lm.add(Lh).add(Lc.mul(Tm)).sub(lobe.mul(S).mul(shade)), Tm.mul(Tc));
    });

    this.material.contextNode = context(this.ctx as Record<string, unknown>);
    this.material.fragmentNode = frag();
    this.material.needsUpdate = true;
    return true;
  }

  dispose(): void {
    super.dispose();
    this.rt.dispose();
    this.material.dispose();
  }
}

/**
 * 合成：按深度升采样（四个相邻低分辨率像素的深度都接近时双线性插值，否则取深度最接近的那个，
 * 避免树叶、屋檐边缘的光晕），再按“颜色 × 透过率 + 散射光”叠到场景上。
 */
export function applyVolumetricFog(col: THREE.Node<'vec4'>, fog: VolumetricFogNode, depthNode: THREE.TextureNode, camera: THREE.PerspectiveCamera): THREE.Node<'vec4'> {
  const tex = fog.getTextureNode();
  const size = fog.size;
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  return Fn(() => {
    const uvN = uv();
    const lin = (u: THREE.Node<'vec2'>) => perspectiveDepthToViewZ(depthNode.sample(u).r, near, far).negate();
    const z = max(lin(uvN), 1e-3);
    const pix = uvN.mul(size).sub(0.5);
    const b = floor(pix);
    const f = fract(pix);
    const at = (ox: number, oy: number) => b.add(vec2(ox + 0.5, oy + 0.5)).div(size);
    const u00 = at(0, 0);
    const u10 = at(1, 0);
    const u01 = at(0, 1);
    const u11 = at(1, 1);
    const v00 = tex.sample(u00);
    const v10 = tex.sample(u10);
    const v01 = tex.sample(u01);
    const v11 = tex.sample(u11);
    const d00 = abs(lin(u00).sub(z)).div(z);
    const d10 = abs(lin(u10).sub(z)).div(z);
    const d01 = abs(lin(u01).sub(z)).div(z);
    const d11 = abs(lin(u11).sub(z)).div(z);
    const bil = mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
    const best = vec4(v00).toVar();
    const bd = float(d00).toVar();
    If(d10.lessThan(bd), () => {
      best.assign(v10);
      bd.assign(d10);
    });
    If(d01.lessThan(bd), () => {
      best.assign(v01);
      bd.assign(d01);
    });
    If(d11.lessThan(bd), () => {
      best.assign(v11);
    });
    const dmax = max(max(d00, d10), max(d01, d11));
    const fv = select(dmax.lessThan(0.08), bil, best);
    return vec4(max(col.rgb.mul(fv.a).add(fv.rgb), vec3(0.0)), col.a);
  })();
}

export function volumetricFog(depthNode: THREE.TextureNode, camera: THREE.PerspectiveCamera, sun: SunShadows, q: FogQuality): VolumetricFogNode {
  return new VolumetricFogNode(depthNode, camera, sun, q);
}
