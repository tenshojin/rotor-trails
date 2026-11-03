// 后期管线（three.js WebGPU 渲染器 + TSL 节点）：按画质分档组合，并提供“光线追踪”开关。
//
//   低：     场景 → 色调映射 → FXAA（不开多重渲染目标，最省）
//   中：     场景（法线 + 运动向量）→ GTAO 环境光遮蔽（采样较少）→ TRAA 时间抗锯齿
//   高：     GTAO 全分辨率 → TRAA → 泛光
//   极高：   同“高”，GTAO 采样更多、泛光更细
//   光线追踪（任意画质可开）：屏幕空间光线追踪的全局光照 SSGI（间接漫反射 + 遮蔽，取代 GTAO）
//            + 屏幕空间反射 SSR（水面、玻璃、金属）+ 屏幕空间接触阴影 SSS，由 TRAA 做时间累积降噪。
//
// 说明：浏览器（WebGPU）目前没有硬件光线追踪接口，这里的“光线追踪”都是在着色器里沿屏幕深度做光线步进，
// 只能看到屏幕上可见的物体；屏幕外的信息由环境贴图补足。

import * as THREE from 'three/webgpu';
import { clamp, convertToTexture, diffuseColor, dot, float, int, length, max, min, luminance, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, perspectiveDepthToViewZ, reference, renderOutput, roughness, sample, screenUV, smoothstep, unpackRGBToNormal, vec2, vec3, vec4, velocity, vibrance } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { sss } from 'three/addons/tsl/display/SSSNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';

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
}

export interface Post {
  pipeline: THREE.RenderPipeline;
  /** 闪电等全局亮度变化（乘在最终颜色上） */
  dispose(): void;
}

/** 各档光线追踪参数：SSGI 切片 × 步数、SSR 质量、是否开接触阴影 */
const RT = {
  low: { slices: 1, steps: 8, ssrQ: 0.3, sss: false },
  medium: { slices: 1, steps: 12, ssrQ: 0.4, sss: true },
  high: { slices: 2, steps: 12, ssrQ: 0.5, sss: true },
  ultra: { slices: 3, steps: 16, ssrQ: 0.7, sss: true },
};

/** 开发调试：window.__postDebug = { ao, aoScale, aoTemporal, traa } 覆盖默认值（重建管线后生效） */
interface PostDebug {
  ao?: boolean;
  aoScale?: number;
  aoTemporal?: boolean;
  traa?: boolean;
  gi?: number;
  giAo?: number;
  giRadius?: number;
  contrast?: number;
  vibrance?: number;
  vignette?: number;
  bloom?: boolean;
  /** 直接显示某个通道：normal / velocity / color */
  view?: string;
}

export function buildPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, cfg: PostConfig): Post {
  const dbg: PostDebug = (globalThis as { __postDebug?: PostDebug }).__postDebug ?? {};
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const disposers: Array<{ dispose(): void }> = [scenePass];
  if (cfg.quality === 'low' && !cfg.rayTracing) {
    // 只有一个输出也显式设成多渲染目标：透明材质的 keepGBuffer 才能与它合并（否则会生成没有成员的结构体）
    scenePass.setMRT(mrt({ output }));
    // FXAA 要在色调映射与色彩空间转换之后做
    pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(grade(renderOutput(scenePass), dbg));
    return { pipeline, dispose: () => disposers.forEach((d) => d.dispose()) };
  }
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
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');
  const nTex = scenePass.getTextureNode('normal');
  const sceneNormal = sample((uv: THREE.Node) => unpackRGBToNormal(nTex.sample(uv)));
  // 离镜头 1.2~2.5 m 以内（座舱内部）不叠加屏幕空间遮蔽 / 全局光照：座舱模型已经烘焙了环境光遮蔽，再叠一遍仪表会发黑
  const viewDist = perspectiveDepthToViewZ(depth, reference('near', 'float', camera), reference('far', 'float', camera)).negate();
  const outside = smoothstep(1.2, 2.5, viewDist);
  let composite: THREE.Node<'vec4'> = color;
  if (cfg.rayTracing) {
    const P = RT[cfg.quality];
    const gi = ssgi(color, depth, sceneNormal, camera);
    gi.sliceCount.value = P.slices;
    gi.stepCount.value = P.steps;
    // 户外：天空环境光已经由环境贴图提供，SSGI 只补近处的反弹光与遮蔽（默认强度是给室内点光源场景的，户外会发白）
    gi.radius.value = dbg.giRadius ?? 5;
    gi.thickness.value = 1.5;
    gi.giIntensity.value = dbg.gi ?? 1.2;
    gi.aoIntensity.value = dbg.giAo ?? 1.0;
    gi.useTemporalFiltering = true;
    disposers.push(gi);
    const diffuse = scenePass.getTextureNode('diffuse');
    const lit = vec4(color.rgb.mul(mix(float(1), gi.a, outside)).add(diffuse.rgb.mul(gi.rgb).mul(outside)), color.a);
    const refl = ssr(color, depth, sceneNormal, { metalnessNode: nTex.a, roughnessNode: diffuse.a, camera });
    refl.quality.value = P.ssrQ;
    refl.maxDistance.value = 260;
    refl.thickness.value = 0.6;
    disposers.push(refl);
    composite = lit.add(vec4(refl.rgb, 0));
    if (P.sss) {
      const contact = sss(depth, camera, sun);
      disposers.push(contact);
      composite = vec4(composite.rgb.mul(mix(float(1), contact.r, outside.mul(0.7))), 1);
    }
  } else if (dbg.ao !== false) {
    const q = cfg.quality;
    const aoPass = ao(depth, sceneNormal, camera);
    // 半分辨率的 GTAO 在远处（天空、远海）升采样时会出现竖条纹，所以各档都用全分辨率、只调采样数
    aoPass.resolutionScale = dbg.aoScale ?? 1;
    aoPass.radius.value = 1.6;
    aoPass.distanceExponent.value = 1.5;
    aoPass.thickness.value = 2;
    aoPass.samples.value = q === 'ultra' ? 24 : q === 'high' ? 16 : 8;
    aoPass.useTemporalFiltering = dbg.aoTemporal ?? true;
    disposers.push(aoPass);
    composite = vec4(color.rgb.mul(mix(float(1), aoPass.r, outside.mul(0.85))), color.a);
  }
  let aa: THREE.Node<'vec4'> = composite;
  if (dbg.traa !== false) {
    const t = traa(composite, depth, vel, camera);
    disposers.push(t);
    aa = t;
  }
  let out: THREE.Node<'vec4'> = aa;
  if (cfg.motionBlur) {
    // 强度 0.5，单帧位移限制在画面的 3.5% 以内（急转头时不会拖出很长的条纹）
    const v = vel.xy.mul(0.5);
    const vClamped = v.mul(min(float(1), float(0.035).div(max(length(v), 1e-5))));
    out = motionBlur(convertToTexture(aa), vClamped, int(cfg.quality === 'ultra' ? 12 : 8));
  }
  if ((cfg.quality === 'high' || cfg.quality === 'ultra') && dbg.bloom !== false) {
    // 阈值较高：只有太阳、强镜面反光、灯光会晕开（阳光下的白色表面本身也有约 3 的亮度）
    const b = bloom(out, cfg.quality === 'ultra' ? 0.22 : 0.18, 0.5, 4.0);
    disposers.push(b);
    out = out.add(b);
  }
  if (dbg.view) {
    pipeline.outputColorTransform = false;
    pipeline.outputNode = dbg.view === 'normal' ? vec4(nTex.rgb, 1) : dbg.view === 'velocity' ? vec4(vel.xy.mul(50).add(0.5), 0.5, 1) : vec4(color.rgb, 1);
    return { pipeline, dispose: () => disposers.forEach((d) => d.dispose()) };
  }
  // 色调映射 + 色彩空间转换之后再调色（在显示空间里调对比度、饱和度更直观）
  pipeline.outputColorTransform = false;
  pipeline.outputNode = grade(renderOutput(out), dbg);
  return { pipeline, dispose: () => disposers.forEach((d) => d.dispose()) };
}

/**
 * 调色（显示空间）：轻微 S 曲线提对比、按饱和程度加“自然饱和度”（已经很艳的颜色加得少）、
 * 高光略暖 / 暗部略冷的分离色调，以及很轻的暗角——让画面通透而不发灰，又不至于像滤镜。
 */
function grade(c: THREE.Node<'vec4'>, dbg: PostDebug): THREE.Node<'vec4'> {
  const contrast = dbg.contrast ?? 1.08;
  const vib = dbg.vibrance ?? 0.12;
  const rgb0 = clamp(c.rgb, 0.0, 1.0);
  // S 曲线：以 0.5 为中点的对比度，再与原值按 contrast 混合，避免暗部死黑
  const s = rgb0.sub(0.5).mul(contrast).add(0.5);
  const curved = mix(rgb0, smoothstep(0.0, 1.0, rgb0), contrast - 1.0).add(s.sub(rgb0).mul(0.5));
  let rgb: THREE.Node<'vec3'> = vibrance(clamp(curved, 0.0, 1.0), float(vib));
  const l = luminance(rgb);
  // 分离色调：高光偏暖、暗部偏冷（幅度很小）
  rgb = rgb.add(mix(vec3(-0.008, 0.0, 0.014), vec3(0.012, 0.004, -0.01), smoothstep(0.15, 0.85, l)));
  // 暗角
  const d = screenUV.sub(0.5).mul(vec2(1.0, 0.82));
  rgb = rgb.mul(float(1).sub(dot(d, d).mul(dbg.vignette ?? 0.28)));
  return vec4(clamp(rgb, 0.0, 1.0), c.a);
}
