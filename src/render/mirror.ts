// 水面倒影：沿反射方向在屏幕上步进，碰到画面里的山、树、房子就取那里的颜色（水面本身是平的，这样做又便宜又准）；
// 碰不到的地方退回环境贴图里的天空。海面、峡湾、河面共用。

import * as THREE from 'three/webgpu';
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  float,
  Fn,
  Loop,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionWorld,
  reflect,
  screenUV,
  select,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';

type N<T extends string> = THREE.Node<T>;

/** 步数、第一步长度（米）、每步放大的倍数、最后的二分次数 */
const STEPS = 17;
const T0 = 4;
const GROW = 1.5;
const REFINE = 3;

/** 场景深度：同一个水面的所有采样共用一份拷贝（深度格式要和渲染通道一致） */
export function sceneDepthNode(reversedDepth: boolean): THREE.TextureNode {
  const depthCopy = new THREE.DepthTexture(1, 1);
  if (reversedDepth) depthCopy.type = THREE.FloatType;
  return (viewportDepthTexture as unknown as (u: N<'vec2'>, l: null, d: THREE.DepthTexture) => THREE.TextureNode)(screenUV, null, depthCopy);
}

/**
 * 返回 vec4(倒影颜色, 倒影权重)。权重 0 的地方（碰不到东西、白沫上）由材质自己的环境反射负责。
 * nW：世界空间的波浪法线（这里会压平一些，否则远处的倒影会碎成一片噪点）
 */
export function screenMirror(nW: N<'vec3'>, foam: N<'float'>, depthNode: THREE.TextureNode, on: N<'float'>): N<'vec4'> {
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
      // 光线从画面顶上出去时，就当它继续撞在画面顶边那一列的东西上：贴近水面时山壁高出画面，倒影不能在半路断掉
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.015, 1.0)).toVar();
      const sz = viewZ(uvc);
      const onScreen = step(0.0, uvq.x).mul(step(uvq.x, 1.0)).mul(step(uvq.y, 1.0));
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
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.015, 1.0)).toVar();
      const sz = viewZ(uvc);
      const behind = step(sz, c.w).mul(step(3.0, sz));
      huv.assign(mix(huv, uvc, behind.mul(hit)));
      t1.assign(select(behind.greaterThan(0.5), mid, t1));
      t0.assign(select(behind.greaterThan(0.5), t0, mid));
    });
    // 贴着画面左右和底边的倒影淡出，否则画面外的东西突然断掉
    const e = min(min(huv.x, float(1).sub(huv.x)), float(1).sub(huv.y));
    const k = hit.mul(smoothstep(0.0, 0.05, e)).mul(float(1).sub(foam)).mul(on);
    return vec4(viewportSharedTexture(huv).rgb, k);
  })();
}
