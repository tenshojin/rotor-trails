// 后期管线（three.js WebGPU 渲染器 + TSL 节点）：按画质分档组合，并提供“光线追踪”开关。
//
//   低：     场景 → 色调映射 → FXAA（不开多重渲染目标，最省）
//   中：     场景（法线 + 运动向量）→ GTAO 环境光遮蔽（采样较少）→ TRAA 时间抗锯齿
//   高：     GTAO 全分辨率 → TRAA → 泛光
//   极高：   同“高”，GTAO 采样更多、泛光更细
//   体积雾（中及以上，可在设置里关）：贴地薄雾 + 光束（丁达尔效应）+ 远处雾里的山影 / 云影，见 volumetricFog.ts
//   光线追踪（任意画质可开）：在不开时的画面上加东西，不换掉任何一层（遮蔽、水面倒影、雾都和不开时一样）：
//            · 全局光照：加载时在地形高度图里追踪真实光线，算出每个地方接到的反弹光（giField.ts），画面外的山也算得到；
//            · 反射：金属、玻璃上的光线同样在高度图里走，映得出地形和水面（水面有自己的三段倒影，见 mirror.ts）。
//
// 说明：浏览器（WebGPU）目前没有硬件光线追踪接口，这些光线都是在着色器里沿地形高度图走的，看得到画面外的东西。
// 试过 three 的 SSGI / SSR / SSS，都不合适：屏幕空间全局光照把天空也当成光源，阴影全被冲灰；
// 反射在屋檐和门板边上是一排锯齿；接触阴影在白色机身上是一片噪点。

import * as THREE from 'three/webgpu';
import { abs, clamp, convertToTexture, cos, sin, screenSize, Fn, If, diffuseColor, dot, float, getViewPosition, int, length, max, min, luminance, metalness, mix, mrt, normalize, normalView, output, packNormalToRGB, pass, perspectiveDepthToViewZ, reference, renderOutput, roughness, sample, screenUV, smoothstep, uniform, unpackRGBToNormal, vec2, vec3, vec4, velocity, vibrance, toneMappingExposure, Break, interleavedGradientNoise, Loop, screenCoordinate } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import type { SunShadows } from './sunShadows';
import { applyVolumetricFog, FOG_QUALITY, volumetricFog, type VolumetricFogNode } from './volumetricFog';
import { cloudShadowDebug } from './cloudShadowMap';
import { giBounce, giReflect } from './giField';
import { gt7ToneMapping } from './toneMap';
import { fixInstancedVelocity } from './instancing';

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/**
 * 透明材质（玻璃、光柱、雨、云、光点等）只写最终颜色：辅助通道（法线、漫反射、运动向量）写入 alpha = 0 的值。
 * 这些通道在 buildPost 里设成“跟随材质混合”——不透明物体照常直接写入，透明物体按 alpha = 0 混合就等于保持原样；
 * 否则透明物体会把后面不透明物体的数据冲掉（例如风挡玻璃让整片外景被当成玻璃来算全局光照和反射）。
 * 注意：WebGPU 后端按整条渲染通道上的设置决定逐通道混合，材质自己的 mrtNode 只能改输出值、改不了混合方式。
 */
export function keepGBuffer(mat: THREE.Material): void {
  const m = mat as THREE.Material & { mrtNode?: THREE.Node | null };
  if (m.mrtNode || mat.userData.gbuffer) return;
  m.mrtNode = mrt({ normal: vec4(0), diffuse: vec4(0), velocity: vec4(0) });
  mat.needsUpdate = true;
}

/** 给场景里所有透明材质套上 keepGBuffer（水面等自己写辅助通道的材质用 userData.gbuffer = true 排除）。 */
export function protectTransparent(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.transparent) keepGBuffer(m);
  });
}

export interface PostConfig {
  quality: QualityTier;
  rayTracing: boolean;
  /** 按运动向量的动态模糊（只沿画面里物体相对镜头的实际运动方向模糊，座舱随镜头一起动所以不糊） */
  motionBlur?: boolean;
  /** 体积雾与光束（中及以上画质） */
  volumetric?: boolean;
  /** 渲染分辨率（小于 1 时用时间超分还原到屏幕分辨率） */
  upscale?: number;
  /** 景深（超仿真模式） */
  dof?: boolean;
  /** 景深一个像素看周围多少个点：拍照模式要多一些，圈大了才不花 */
  dofTaps?: number;
}

export interface Post {
  pipeline: THREE.RenderPipeline;
  /** 色调映射之前的线性画面（人眼适应用它测亮度） */
  hdr(): THREE.Texture | null;
  /** 体积雾节点（没开时为 null；调试用） */
  fog: VolumetricFogNode | null;
  dispose(): void;
}

/** 月光下人眼看不出多少颜色（0 = 白天，1 = 夜晚）：暗处往蓝灰靠，灯光和屏幕够亮，保持原色 */
export const SCOTOPIC = uniform(0);

/** 屏幕空间接触阴影：太阳方向（世界坐标）、阴影压暗多少、帧序号（抖动） */
export const CONTACT = { sun: uniform(new THREE.Vector3(0, 1, 0)), strength: uniform(0.4), frame: uniform(0) };

/** 走几步（够用的最少步数：抖动由时间抗锯齿抹平） */
const CONTACT_STEPS = 10;

/**
 * 接触阴影：沿太阳方向在画面的深度里走一小段，碰到东西就算在影子里。
 * 阴影贴图离得远了一格好几米，树、石头、屋檐落在地上的影子就糊没了（远处一级的树干脆不进阴影贴图）；
 * 这一段的长度随距离变长，远处一棵棵树、一道道山棱也有自己的影子，画面立刻有了层次。
 */
function contactShadow(depth: THREE.TextureNode, nTex: THREE.TextureNode, camera: THREE.PerspectiveCamera): THREE.Node<'float'> {
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const projInv = uniform(camera.projectionMatrixInverse);
  const proj = uniform(camera.projectionMatrix);
  const toView = uniform(camera.matrixWorldInverse);
  return Fn(() => {
    const P = getViewPosition(screenUV, depth.sample(screenUV).r, projInv).toVar();
    const dist = P.z.negate().toVar();
    const sunV = normalize(toView.mul(vec4(CONTACT.sun, 0.0)).xyz).toVar();
    const facing = smoothstep(0.02, 0.3, dot(unpackRGBToNormal(nTex.sample(screenUV).rgb), sunV));
    const occ = float(0).toVar();
    If(facing.greaterThan(0.01).and(dist.lessThan(3200.0)).and(dist.greaterThan(6.0)), () => {
      const len = clamp(dist.mul(0.045), 1.0, 70.0).toVar();
      const bias = dist.mul(0.0012).add(0.03).toVar();
      const thick = len.mul(0.7).add(0.6).toVar();
      const jit = interleavedGradientNoise(screenCoordinate.add(CONTACT.frame.mul(5.588238))).toVar();
      Loop(CONTACT_STEPS, ({ i }: { i: THREE.Node<'int'> }) => {
        const s = float(i).add(jit).div(CONTACT_STEPS);
        const Q = P.add(sunV.mul(len.mul(s).mul(s).add(bias))).toVar();
        const c = proj.mul(vec4(Q, 1.0)).toVar();
        const uvq = vec2(c.x.div(c.w).mul(0.5).add(0.5), float(0.5).sub(c.y.div(c.w).mul(0.5))).toVar();
        const sz = perspectiveDepthToViewZ(depth.sample(uvq).r, near, far).negate();
        const dz = Q.z.negate().sub(sz).toVar();
        If(dz.greaterThan(bias).and(dz.lessThan(thick)).and(uvq.x.greaterThan(0.0)).and(uvq.x.lessThan(1.0)).and(uvq.y.greaterThan(0.0)).and(uvq.y.lessThan(1.0)), () => {
          occ.assign(1);
          Break();
        });
      });
    });
    return occ.mul(facing).mul(float(1).sub(smoothstep(2000.0, 3200.0, dist)));
  })();
}

/** 模糊圈的上限（占画面高度的比例）：1080p 下约 4 个像素，眼睛余光的那种虚，不是长焦镜头的奶油 */
export const DOF_EYE = 0.0036;
/** 景深：对焦的距离（米）、光圈（0 就是关了）、模糊圈的上限。拍照模式的上限大得多 */
export const DOF = { focus: uniform(1000), aperture: uniform(0), max: uniform(DOF_EYE) };

/**
 * 景深（超仿真）：人眼对焦在一个距离上，别的地方微微发虚。
 * 每个像素看周围一圈采样点，谁的模糊圈够得着这里就算谁一份，所以前景的虚边能盖到背后的清晰物体上。
 */
function focusBlur(src: THREE.TextureNode, sharp: THREE.Node<'vec4'>, depth: THREE.TextureNode, camera: THREE.PerspectiveCamera, taps: number): THREE.Node<'vec4'> {
  const near = reference('near', 'float', camera);
  const far = reference('far', 'float', camera);
  const aspect = reference('aspect', 'float', camera);
  const inv = float(1).div(DOF.focus as unknown as THREE.Node<'float'>);
  const limit = DOF.max as unknown as THREE.Node<'float'>;
  const cocAt = (uvq: THREE.Node<'vec2'>): THREE.Node<'float'> => {
    const z = perspectiveDepthToViewZ(depth.sample(uvq).r, near, far).negate();
    return min(abs(inv.sub(float(1).div(max(z, 0.05)))).mul(DOF.aperture as unknown as THREE.Node<'float'>), limit);
  };
  return Fn(() => {
    const c0 = cocAt(screenUV).toVar();
    const sum = vec4(src.sample(screenUV).rgb, 1).toVar();
    const spin = interleavedGradientNoise(screenCoordinate).mul(6.2832).toVar();
    Loop(taps, ({ i }: { i: THREE.Node<'int'> }) => {
      const fi = float(i).add(0.5);
      const r = fi.div(taps).sqrt().mul(limit).toVar();
      const a = fi.mul(2.39996).add(spin);
      const uvq = screenUV.add(vec2(cos(a).div(aspect), sin(a)).mul(r)).toVar();
      const cs = cocAt(uvq);
      const w = smoothstep(r.mul(0.7), r.mul(1.15), cs);
      sum.addAssign(vec4(src.sample(uvq).rgb.mul(w), w));
    });
    const blurred = sum.rgb.div(sum.a);
    // 焦点上的像素保留锐化后的清晰结果
    return vec4(mix(sharp.rgb, blurred, smoothstep(float(0), limit.mul(0.35), max(c0, sum.a.sub(1).div(taps).mul(limit)))), 1);
  })();
}

/** 开发调试：window.__postDebug = { ao, aoScale, aoTemporal, traa } 覆盖默认值（重建管线后生效） */
interface PostDebug {
  ao?: boolean;
  aoScale?: number;
  aoTemporal?: boolean;
  traa?: boolean;
  /** 反弹光的强度倍数 */
  gi?: number;
  contrast?: number;
  vibrance?: number;
  vignette?: number;
  sharpen?: number;
  bloom?: boolean;
  fog?: boolean;
  /** 直接显示某个通道：normal / velocity / color / fog / gi / albedo */
  view?: string;
  /** 接触阴影 */
  contact?: boolean;
  /** 色调映射：gt7（默认）/ neutral / agx / aces */
  tone?: string;
  toneK?: number;
}

/**
 * 场景通道在重建后期管线时复用（配置相同的话）：three.js 给每个渲染上下文都建一套物体的绘制数据（统一缓冲、绑定），
 * 换一个新的场景通道，旧通道里那几百个物体的数据挂在物体上不会释放——以前每改一次动态模糊、景深（拍照模式）、
 * 体积雾，统一缓冲就多 500 多个、JS 内存涨二三十兆，改二十次帧率掉 8%。
 * 只有多渲染目标的格式（低画质 / 光线追踪）变了才换新的；渲染分辨率变了只改同一个通道的缩放。
 */
let sharedPass: { key: string; pass: ReturnType<typeof pass> } | null = null;

function scenePassFor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, cfg: PostConfig): { pass: ReturnType<typeof pass>; fresh: boolean } {
  const low = cfg.quality === 'low' && !cfg.rayTracing;
  const up = low ? 1 : (cfg.upscale ?? 1);
  const key = `${scene.id}_${camera.id}_${low ? 'low' : cfg.rayTracing ? 'rt' : 'std'}`;
  if (sharedPass && sharedPass.key === key) {
    sharedPass.pass.setResolutionScale(up);
    return { pass: sharedPass.pass, fresh: false };
  }
  sharedPass?.pass.dispose();
  const scenePass = pass(scene, camera);
  if (low) {
    // 只有一个输出也显式设成多渲染目标：透明材质的 keepGBuffer 才能与它合并（否则会生成没有成员的结构体）
    scenePass.setMRT(mrt({ output }));
  } else {
    // 多渲染目标：WebGPU 默认每像素最多 32 字节，所以金属度放进法线纹理的 A 通道、粗糙度放进漫反射纹理的 A 通道
    const att: Record<string, THREE.Node> = { output, normal: cfg.rayTracing ? vec4(packNormalToRGB(normalView), metalness) : packNormalToRGB(normalView), velocity };
    if (cfg.rayTracing) att.diffuse = vec4(diffuseColor.rgb, roughness);
    const passMRT = mrt(att);
    // 辅助通道跟随材质混合：不透明物体直接写入，透明物体（keepGBuffer 写 alpha = 0）保持原样
    for (const k of ['normal', 'diffuse', 'velocity']) if (att[k]) passMRT.setBlendMode(k, new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(passMRT);
    // 法线、漫反射色用 8 位纹理（省带宽）
    for (const k of ['normal', 'diffuse']) {
      const t = att[k] ? scenePass.getTexture(k) : null;
      if (t) t.type = THREE.UnsignedByteType;
    }
  }
  // 时间超分：场景和后期都按较低的分辨率算，每帧的采样位置错开一点，累积几帧还原出全分辨率（three 的 TAAU，思路和 FSR2 一样）
  scenePass.setResolutionScale(up);
  sharedPass = { key, pass: scenePass };
  return { pass: scenePass, fresh: true };
}

/** 世界视图整个释放时（退出）：连同复用的场景通道一起释放 */
export function disposeSharedPass(): void {
  sharedPass?.pass.dispose();
  sharedPass = null;
}

export function buildPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, shadows: SunShadows, cfg: PostConfig): Post {
  fixInstancedVelocity();
  const dbg: PostDebug = (globalThis as { __postDebug?: PostDebug }).__postDebug ?? {};
  const pipeline = new THREE.RenderPipeline(renderer);
  // 场景通道不放进 disposers：下一次重建还要用（配置变了时由 scenePassFor 换掉旧的）
  const { pass: scenePass } = scenePassFor(scene, camera, cfg);
  const disposers: Array<{ dispose(): void }> = [pipeline];
  // convertToTexture creates its own render target for computed nodes. Effects
  // only dispose their internal targets, not this caller-owned input texture.
  const asTexture = (node: THREE.Node<'vec4'>): THREE.TextureNode => {
    const tex = convertToTexture(node);
    if ((tex as THREE.TextureNode & { isRTTNode?: boolean }).isRTTNode) disposers.push(tex);
    return tex;
  };
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i].dispose();
  };
  if (cfg.quality === 'low' && !cfg.rayTracing) {
    // FXAA 要在色调映射与色彩空间转换之后做
    pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(asTexture(grade(display(scenePass, dbg), dbg, float(1))));
    return { pipeline, fog: null, hdr: () => scenePass.getTexture('output'), dispose };
  }
  const up = cfg.upscale ?? 1;
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');
  const nTex = scenePass.getTextureNode('normal');
  const sceneNormal = sample((uv: THREE.Node) => unpackRGBToNormal(nTex.sample(uv)));
  // 离镜头 1.2~2.5 m 以内（座舱内部）不叠加屏幕空间遮蔽 / 全局光照：座舱模型已经烘焙了环境光遮蔽，再叠一遍仪表会发黑
  const viewDist = perspectiveDepthToViewZ(depth, reference('near', 'float', camera), reference('far', 'float', camera)).negate();
  const outside = smoothstep(1.2, 2.5, viewDist);
  let composite: THREE.Node<'vec4'> = color;
  let aoK: THREE.Node<'float'> = float(1);
  if (dbg.ao !== false) {
    const q = cfg.quality;
    const aoPass = ao(depth, sceneNormal, camera);
    // 半分辨率的 GTAO 在远处（天空、远海）升采样时会出现竖条纹，所以各档都用全分辨率、只调采样数
    aoPass.resolutionScale = dbg.aoScale ?? up;
    aoPass.radius.value = 1.6;
    aoPass.distanceExponent.value = 1.5;
    aoPass.thickness.value = 2;
    aoPass.samples.value = q === 'ultra' ? 16 : q === 'high' ? 12 : 8;
    aoPass.useTemporalFiltering = dbg.aoTemporal ?? true;
    disposers.push(aoPass);
    aoK = mix(float(1), aoPass.r, outside.mul(0.85));
    composite = vec4(color.rgb.mul(aoK), color.a);
  }
  if ((cfg.quality === 'high' || cfg.quality === 'ultra') && dbg.contact !== false && new URLSearchParams(globalThis.location?.search ?? '').get('contact') !== '0') {
    const shade = contactShadow(depth, nTex, camera).mul(CONTACT.strength).mul(outside);
    composite = vec4(composite.rgb.mul(float(1).sub(shade)), composite.a);
  }
  let giView: THREE.Node<'vec3'> | null = null;
  let albedoView: THREE.Node<'vec3'> | null = null;
  if (cfg.rayTracing) {
    const diffuse = scenePass.getTextureNode('diffuse');
    // 反弹光：按这个像素在世界里的位置和朝向去探针图里取，再乘上它自己的颜色
    const camWorld = uniform(camera.matrixWorld);
    const projInv = uniform(camera.projectionMatrixInverse);
    const worldPos = camWorld.mul(vec4(getViewPosition(screenUV, depth.r, projInv), 1.0)).xyz;
    const worldN = normalize(camWorld.mul(vec4(unpackRGBToNormal(nTex.rgb), 0.0)).xyz);
    const bounce = giBounce(worldPos, worldN).mul(dbg.gi ?? 1);
    giView = bounce;
    albedoView = diffuse.rgb;
    const lit = composite.rgb.add(diffuse.rgb.mul(bounce).mul(aoK).mul(outside));
    // 金属、玻璃：镜面方向上碰到地形就映出地形（够光滑才映，粗糙的金属是一片模糊的亮斑，环境贴图已经够了）
    const eye = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const mirrorK = nTex.a.mul(float(1).sub(smoothstep(0.25, 0.6, diffuse.a))).mul(outside).toVar();
    composite = Fn(() => {
      const c = lit.toVar();
      If(mirrorK.greaterThan(0.02), () => {
        const r = giReflect(worldPos, worldN, eye).toVar();
        c.assign(mix(c, r.rgb.mul(mix(vec3(1), diffuse.rgb, 0.6)), r.a.mul(mirrorK).mul(0.85)));
      });
      return vec4(c, color.a);
    })();
  }
  // 体积雾：在遮蔽 / 全局光照之后、时间抗锯齿之前叠加（TRAA 顺便把步进抖动的噪点抹平）
  let fogNode: VolumetricFogNode | null = null;
  if (cfg.volumetric && cfg.quality !== 'low' && dbg.fog !== false) {
    fogNode = volumetricFog(depth, camera, shadows, FOG_QUALITY[cfg.quality]);
    disposers.push(fogNode);
    composite = applyVolumetricFog(composite, fogNode, depth, camera);
  }
  let aa: THREE.Node<'vec4'> = composite;
  let hdr = (): THREE.Texture | null => scenePass.getTexture('output');
  let aaTex: THREE.TextureNode | null = null;
  if (dbg.traa !== false) {
    const beauty = asTexture(composite);
    if (up < 1) (beauty as THREE.TextureNode & { setResolutionScale(s: number): void }).setResolutionScale(up);
    const t = (up < 1 ? taau : traa)(beauty, depth, vel, camera);
    disposers.push(t);
    aa = t;
    // 时间抗锯齿的结果已经叠好了雾和遮蔽，就是眼睛最后看到的亮度
    aaTex = (t as unknown as { getTextureNode(): THREE.TextureNode }).getTextureNode();
    const node = aaTex;
    hdr = () => node.value as THREE.Texture;
  }
  let out: THREE.Node<'vec4'> = aa;
  if (cfg.motionBlur) {
    // 强度 0.5，单帧位移限制在画面的 3.5% 以内（急转头时不会拖出很长的条纹）
    const v = vel.xy.mul(0.5);
    const vClamped = v.mul(min(float(1), float(0.035).div(max(length(v), 1e-5))));
    out = motionBlur(aaTex ?? asTexture(aa), vClamped, int(cfg.quality === 'ultra' ? 12 : 8));
  }
  // 时间抗锯齿让画面略微发软：补一道受限的锐化（结果不超出周围像素的明暗范围，边缘不会有白边）
  let sharp = aaTex && !cfg.motionBlur ? sharpen(aaTex, dbg.sharpen ?? 0.8) : out;
  if (cfg.dof && aaTex) sharp = focusBlur(aaTex, sharp, depth, camera, cfg.dofTaps ?? 22);
  if ((cfg.quality === 'high' || cfg.quality === 'ultra') && dbg.bloom !== false) {
    // 阈值较高：只有太阳、强镜面反光、灯光会晕开（阳光下的白色表面本身也有约 3 的亮度）
    const b = bloom(out, cfg.quality === 'ultra' ? 0.22 : 0.18, 0.5, 4.0);
    disposers.push(b);
    out = sharp.add(b);
  } else {
    out = sharp;
  }
  if (dbg.view) {
    pipeline.outputColorTransform = false;
    const fogView = fogNode ? fogNode.getTextureNode() : vec4(0, 0, 0, 1);
    pipeline.outputNode =
      dbg.view === 'normal' ? vec4(nTex.rgb, 1) : dbg.view === 'velocity' ? vec4(vel.xy.mul(50).add(0.5), 0.5, 1) : dbg.view === 'fog' ? vec4(fogView.rgb.mul(4).add(0.25), 1) : dbg.view === 'fogT' ? vec4(vec3(fogView.a), 1) : dbg.view === 'cloud' ? cloudShadowDebug(screenUV) : dbg.view === 'gi' && giView ? vec4(giView.mul(2), 1) : dbg.view === 'albedo' && albedoView ? vec4(albedoView, 1) : vec4(color.rgb, 1);
    return { pipeline, fog: fogNode, hdr, dispose };
  }
  // 色调映射 + 色彩空间转换之后再调色（在显示空间里调对比度、饱和度更直观）
  pipeline.outputColorTransform = false;
  pipeline.outputNode = grade(display(out, dbg), dbg, outside);
  return { pipeline, fog: fogNode, hdr, dispose };
}

/** 线性 HDR → 显示器：曝光、色调映射、sRGB */
function display(c: THREE.Node<'vec4'>, dbg: PostDebug): THREE.Node<'vec4'> {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const mode = dbg.tone ?? q.get('tone') ?? 'gt7';
  if (mode === 'neutral') return renderOutput(c);
  if (mode === 'agx') return renderOutput(c, THREE.AgXToneMapping);
  if (mode === 'aces') return renderOutput(c, THREE.ACESFilmicToneMapping);
  const k = Number(q.get('toneK') ?? dbg.toneK ?? 1.9);
  const exposure = toneMappingExposure as unknown as THREE.Node<'float'>;
  return renderOutput(vec4(gt7ToneMapping(c.rgb.mul(exposure).mul(k)), c.a), THREE.NoToneMapping);
}

/** 受限的反锐化：中心像素减去周围四点的平均，再限制在这五个像素的明暗范围之内 */
function sharpen(src: THREE.TextureNode, amount: number): THREE.Node<'vec4'> {
  return Fn(() => {
    const px = vec2(1.0).div(screenSize);
    const c = src.sample(screenUV).rgb.toVar();
    const a = src.sample(screenUV.add(vec2(px.x, 0))).rgb.toVar();
    const b = src.sample(screenUV.sub(vec2(px.x, 0))).rgb.toVar();
    const d = src.sample(screenUV.add(vec2(0, px.y))).rgb.toVar();
    const e = src.sample(screenUV.sub(vec2(0, px.y))).rgb.toVar();
    const lo = min(min(min(a, b), min(d, e)), c);
    const hi = max(max(max(a, b), max(d, e)), c);
    const avg = a.add(b).add(d).add(e).mul(0.25);
    return vec4(clamp(c.add(c.sub(avg).mul(amount)), lo, hi), 1.0);
  })();
}

/** 拍照模式的风格：饱和度、冷暖（-1..1）、黑位抬高。不拍照的时候是 1、0、0 */
export const LOOK = { sat: uniform(1), warm: uniform(0), fade: uniform(0) };

/**
 * 调色（显示空间）：轻微 S 曲线提对比、按饱和程度加“自然饱和度”（已经很艳的颜色加得少）、
 * 高光略暖 / 暗部略冷的分离色调，以及很轻的暗角——让画面通透而不发灰，又不至于像滤镜。
 */
function grade(c: THREE.Node<'vec4'>, dbg: PostDebug, outside: THREE.Node<'float'>): THREE.Node<'vec4'> {
  const contrast = dbg.contrast ?? 1.08;
  const vib = dbg.vibrance ?? 0.12;
  const rgb0 = clamp(c.rgb, 0.0, 1.0);
  // S 曲线：以 0.5 为中点的对比度，再与原值按 contrast 混合，避免暗部死黑
  const s = rgb0.sub(0.5).mul(contrast).add(0.5);
  const curved = mix(rgb0, smoothstep(0.0, 1.0, rgb0), contrast - 1.0).add(s.sub(rgb0).mul(0.5));
  // （夜里画面本来就暗，S 曲线再压一道，山谷就成了死黑）
  let rgb: THREE.Node<'vec3'> = vibrance(clamp(mix(curved, rgb0, SCOTOPIC.mul(0.75)), 0.0, 1.0), float(vib));
  const l = luminance(rgb);
  // （舱内的仪表灯就在眼前，颜色看得清）
  rgb = mix(rgb, vec3(l).mul(vec3(0.84, 0.94, 1.16)), float(1).sub(smoothstep(0.08, 0.42, l)).mul(SCOTOPIC).mul(outside).mul(0.68));
  // 分离色调：高光偏暖、暗部偏冷（幅度很小）
  rgb = rgb.add(mix(vec3(-0.008, 0.0, 0.014), vec3(0.012, 0.004, -0.01), smoothstep(0.15, 0.85, l)));
  // 暗角
  const d = screenUV.sub(0.5).mul(vec2(1.0, 0.82));
  rgb = rgb.mul(float(1).sub(dot(d, d).mul(dbg.vignette ?? 0.22)));
  // 拍照的风格
  rgb = mix(vec3(luminance(rgb)), rgb, LOOK.sat).mul(vec3(LOOK.warm.mul(0.07).add(1.0), 1.0, LOOK.warm.mul(-0.09).add(1.0)));
  rgb = rgb.mul(float(1).sub(LOOK.fade)).add(LOOK.fade);
  return vec4(clamp(rgb, 0.0, 1.0), c.a);
}
