// 水面倒影：沿反射方向在屏幕上步进，碰到画面里的山、树、房子就取那里的颜色（水面本身是平的，这样做又便宜又准）；
// 光线飞出画面（低头看水、山在画面外）时接着在地形高度图里走（倒影场，见 reflectMap.ts），山还是映得出来；
// 什么都没碰到就是天空：按方向算大气颜色，再盖上云层贴图里的云（云也映进水里）。海面、峡湾、河面共用。

import * as THREE from 'three/webgpu';
import {
  Break,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  Fn,
  If,
  interleavedGradientNoise,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionWorld,
  reflect,
  screenCoordinate,
  screenUV,
  select,
  smoothstep,
  step,
  struct,
  texture,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';
import { FOG } from './atmosphere';
import type { ReflectField } from './reflectMap';
import type { SkyDome } from './sky';
import { terrainSun } from './sunMap';
import { VFOG } from './volumetricFog';

type N<T extends string> = THREE.Node<T>;

const MirrorOut = struct({ rgb: 'vec3', total: 'float', hit: 'float' });

/** 步数、第一步长度（米）、每步放大的倍数、最后的二分次数 */
const STEPS = 17;
const T0 = 4;
const GROW = 1.5;
const REFINE = 3;
/** 倒影场：高度图里走的步数和最后的二分次数 */
const FIELD_STEPS = 20;
const FIELD_REFINE = 3;

let depthShared: THREE.TextureNode | null = null;

/** 场景深度：水面、河流、烟幕共用一份拷贝（每多一份，渲染通道就要多中断一次；深度格式要和渲染通道一致） */
export function sceneDepthNode(reversedDepth: boolean): THREE.TextureNode {
  if (depthShared) return depthShared;
  const depthCopy = new THREE.DepthTexture(1, 1);
  if (reversedDepth) depthCopy.type = THREE.FloatType;
  depthShared = (viewportDepthTexture as unknown as (u: N<'vec2'>, l: null, d: THREE.DepthTexture) => THREE.TextureNode)(screenUV, null, depthCopy);
  return depthShared;
}

/** 从 P0 沿 Rd 在地形高度图里走，返回 vec4(那里的颜色, 碰到了吗) */
function fieldMarch(P0: N<'vec3'>, Rd: N<'vec3'>, f: ReflectField): N<'vec4'> {
  const hTex = texture(f.height);
  const cTex = texture(f.color);
  const S = f.size;
  const hAt = (q: N<'vec2'>): N<'float'> => {
    const uvq = q.div(S).add(0.5);
    const inside = step(uvq.x.sub(0.5).abs(), float(0.5)).mul(step(uvq.y.sub(0.5).abs(), float(0.5)));
    return mix(float(-1e4), hTex.sample(uvq).level(float(0)).r, inside);
  };
  return Fn(() => {
    const out = vec4(0).toVar();
    // 光线升到最高的山顶之前才可能碰到东西：高仰角的光线走得短、步子小，贴水面的光线步子大
    const tMax = min(float(f.top).sub(P0.y).div(Rd.y), float(S * 1.4));
    const dt = tMax.div(FIELD_STEPS).toVar();
    const t0 = float(0).toVar();
    const t1 = dt.mul(interleavedGradientNoise(screenCoordinate.xy).mul(0.7).add(0.3)).toVar();
    const hit = float(0).toVar();
    Loop(FIELD_STEPS, () => {
      const p = P0.add(Rd.mul(t1)).toVar();
      If(p.y.lessThan(hAt(p.xz)), () => {
        hit.assign(1);
        Break();
      });
      t0.assign(t1);
      t1.addAssign(dt);
    });
    If(hit.greaterThan(0.5), () => {
      Loop(FIELD_REFINE, () => {
        const mid = t0.add(t1).mul(0.5).toVar();
        const p = P0.add(Rd.mul(mid)).toVar();
        const under = p.y.lessThan(hAt(p.xz));
        t1.assign(select(under, mid, t1));
        t0.assign(select(under, t0, mid));
      });
      const p = P0.add(Rd.mul(t1)).toVar();
      const e = 8.0;
      const hx = hAt(p.xz.add(vec2(e, 0))).sub(hAt(p.xz.sub(vec2(e, 0))));
      const hz = hAt(p.xz.add(vec2(0, e))).sub(hAt(p.xz.sub(vec2(0, e))));
      const nrm = normalize(vec3(hx.negate(), 2 * e, hz.negate()));
      const alb = cTex.sample(p.xz.div(S).add(0.5)).level(float(0));
      // 打光：太阳（山影里没有）+ 天光（山谷深处看得见的天少）
      const sun = VFOG.sun.mul(max(dot(nrm, FOG.sunDir), 0.0).mul(terrainSun(p)).mul(1 / Math.PI));
      const sky = FOG.color.mul(alb.a.mul(0.75).add(0.1));
      const lit = alb.rgb.mul(sun.add(sky));
      const dist = length(P0.sub(cameraPosition)).add(t1);
      const fogK = float(1).sub(exp(FOG.density.mul(FOG.density).add(FOG.cloud.mul(FOG.cloud)).mul(dist).mul(dist).negate()));
      out.assign(vec4(mix(lit, FOG.color, fogK), 1.0));
    });
    return out;
  })();
}

/**
 * 返回结构体：rgb = 倒影颜色，total = 倒影权重（白沫上是 0，由材质自己的环境反射负责），hit = 其中碰到山、树、房子的部分。
 * nW：世界空间的波浪法线（这里会压平一些，否则远处的倒影会碎成一片噪点）
 */
export function screenMirror(nW: N<'vec3'>, foam: N<'float'>, depthNode: THREE.TextureNode, on: N<'float'>, field: ReflectField | null, spread: N<'float'>, sky: SkyDome): ReturnType<typeof MirrorOut> {
  return Fn(() => {
    const P0 = positionWorld;
    const V = normalize(P0.sub(cameraPosition));
    const nR = normalize(mix(nW, vec3(0.0, 1.0, 0.0), 0.6));
    const r0 = reflect(V, nR);
    const Rd = vec3(r0.x, max(r0.y, 0.015), r0.z).toVar();
    const viewZ = (uvq: N<'vec2'>) => perspectiveDepthToViewZ(depthNode.sample(uvq).r, cameraNear, cameraFar).negate();
    const proj = (tt: N<'float'>) => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P0.add(Rd.mul(tt)), 1.0)));
    const toUV = (c: N<'vec4'>) => vec2(c.x.div(c.w).mul(0.5).add(0.5), float(0.5).sub(c.y.div(c.w).mul(0.5)));
    const t0 = float(0).toVar();
    const t1 = float(T0).toVar();
    const hit = float(0).toVar();
    const huv = vec2(0.5).toVar();
    Loop(STEPS, () => {
      const c = proj(t1).toVar();
      const uvq = toUV(c).toVar();
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.0, 1.0)).toVar();
      const sz = viewZ(uvc);
      const onScreen = step(0.0, uvq.x).mul(step(uvq.x, 1.0)).mul(step(uvq.y, 1.0)).mul(step(0.0, uvq.y));
      // 光线走到了画面里那个东西的后面（而且没有穿过去太多）= 碰到了。离镜头 3 m 以内是座舱，不算。
      // 容差要大：树冠很薄，容差小了光线一步就跨过去，倒影里会漏出一块块天空
      const behind = step(sz, c.w).mul(step(c.w.sub(sz), t1.add(24.0))).mul(step(3.0, sz)).mul(onScreen);
      const fresh = behind.mul(float(1).sub(hit));
      huv.assign(mix(huv, uvc, fresh));
      hit.assign(max(hit, behind));
      // 还没碰到就继续往前走；碰到之后 t0、t1 留在最后这一段里，下面用二分法把位置找准
      t0.assign(select(hit.greaterThan(0.5), t0, t1));
      t1.assign(select(hit.greaterThan(0.5), t1, t1.mul(GROW)));
    });
    Loop(REFINE, () => {
      const mid = t0.add(t1).mul(0.5).toVar();
      const c = proj(mid).toVar();
      const uvq = toUV(c).toVar();
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.0, 1.0)).toVar();
      const sz = viewZ(uvc);
      const behind = step(sz, c.w).mul(step(3.0, sz));
      huv.assign(mix(huv, uvc, behind.mul(hit)));
      t1.assign(select(behind.greaterThan(0.5), mid, t1));
      t0.assign(select(behind.greaterThan(0.5), t0, mid));
    });
    // 贴着画面边缘的倒影淡出，换成倒影场，否则画面外的东西突然断掉
    const e = min(min(huv.x, float(1).sub(huv.x)), min(huv.y, float(1).sub(huv.y)));
    const live = float(1).sub(foam).mul(on).toVar();
    const k = hit.mul(smoothstep(0.0, 0.08, e)).mul(live).toVar();
    const far = vec4(0).toVar();
    if (field) {
      If(k.lessThan(0.995).and(live.greaterThan(0.01)), () => {
        far.assign(fieldMarch(P0, Rd, field));
      });
    }
    const wFar = far.a.mul(live).mul(float(1).sub(k));
    // spread：波浪把倒影上下拉开多少（屏幕比例）。几点采样 + 每像素抖动（逐帧变化），时间抗锯齿再把它抹平
    const fr = (sky.u.frame as unknown as N<'float'>).mul(5.588238);
    const jit = interleavedGradientNoise(screenCoordinate.xy.add(fr)).sub(0.5).mul(0.66);
    const jx = interleavedGradientNoise(screenCoordinate.yx.add(fr.mul(1.7)).add(23.0)).sub(0.5);
    const sp = spread.toVar();
    const offs = [-0.66, 0, 0.66];
    const tap = (uvq: N<'vec2'>, o: number) => vec2(uvq.x, clamp(uvq.y.add(jit.add(o).mul(sp)), 0.002, 0.998));
    const seen = offs.map((o) => viewportSharedTexture(tap(huv, o)).rgb).reduce((a, b) => a.add(b)).mul(1 / 3);
    // 云的倒影：左右也要散开一点，否则竖着抹开的云是一块块直边的方块
    const cloudTap = (uvq: N<'vec2'>, ox: number, oy: number) => vec2(clamp(uvq.x.add(jx.add(ox).mul(sp).mul(0.62)), 0.0, 1.0), clamp(uvq.y.add(jit.add(oy).mul(sp)), 0.002, 0.998));
    // 天空：光线走到无穷远落在画面的哪里（云只有画面里才有）
    const cS = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(Rd, 0.0))).toVar();
    const uvS = toUV(cS).toVar();
    const eS = min(min(uvS.x, float(1).sub(uvS.x)), min(uvS.y, float(1).sub(uvS.y)));
    const uvC = vec2(clamp(uvS.x, 0.0, 1.0), clamp(uvS.y, 0.0, 1.0)).toVar();
    const skyRgb = sky.reflectedSky(Rd, [[-0.7, -0.66], [0.7, -0.33], [0, 0], [-0.7, 0.33], [0.7, 0.66]].map(([ox, oy]) => cloudTap(uvC, ox, oy)), step(0.01, cS.w).mul(smoothstep(0.0, 0.12, eS)));
    const wHit = k.add(wFar).toVar();
    const wSky = max(float(1).sub(wHit), 0.0).mul(live);
    const total = wHit.add(wSky).toVar();
    return MirrorOut(seen.mul(k).add(far.rgb.mul(wFar)).add(skyRgb.mul(wSky)).div(max(total, 0.001)), total, wHit);
  })();
}
