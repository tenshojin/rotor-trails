// 云影贴图：每帧把头顶云层沿太阳方向的透过率画到一张 512² 的贴图上（覆盖相机周围 16 km），
// 地面、水面、树、建筑、座舱与体积雾都从这张图里查云影——每个像素只要一次纹理读取
// （直接在每个像素里穿过云层采样密度太贵：树叶的重复绘制很多，实测能让帧率减半）。
//
// 贴图定义在云底所在的水平面上：每个纹素记录从云底沿太阳方向穿过整层云的透过率。
// 查询时把点 p 沿太阳方向投到云底平面上再取值，所以同一朵云在山坡、谷底、水面上的影子位置都对。
// 云的密度与天空里看到的体积云是同一个函数（sky.ts 的 cloudDensity），云影跟着云一起飘。

import * as THREE from 'three/webgpu';
import { exp, float, Fn, If, Loop, max, min, smoothstep, texture, uniform, uv, vec3, vec4 } from 'three/tsl';
import { CLOUD, cloudDensity } from './sky';

const N = 512;
const EXTENT = 16000;
/** 沿太阳方向穿过云层的采样数 */
const STEPS = 6;
/** 云影用的消光系数：比云本身小（云内的多次散射让云下并不全黑，积云下的直射光约剩 10~30%） */
const SIGMA = 0.045 * 0.11;

const center = uniform(new THREE.Vector2());
const extent = uniform(EXTENT);

const rt = new THREE.RenderTarget(N, N, { depthBuffer: false, type: THREE.HalfFloatType });
rt.texture.name = 'CloudShadow';
rt.texture.minFilter = THREE.LinearFilter;
rt.texture.magFilter = THREE.LinearFilter;
rt.texture.generateMipmaps = false;

const material = new THREE.NodeMaterial();
material.name = 'CloudShadow';
material.fragmentNode = Fn(() => {
  const xz = center.add(uv().sub(0.5).mul(extent));
  const sy = max(CLOUD.sunDir.y, 0.05);
  const len = min(CLOUD.top.sub(CLOUD.base).div(sy), 3000.0);
  const od = float(0).toVar();
  Loop(STEPS, ({ i }: { i: THREE.Node<'int'> }) => {
    const p = vec3(xz.x, CLOUD.base, xz.y).add(CLOUD.sunDir.mul(len.mul(float(i).add(0.5).div(STEPS))));
    od.addAssign(cloudDensity(p));
  });
  return vec4(max(exp(od.mul(len).mul(-SIGMA / STEPS)), 0.08), 0, 0, 1);
})();
const quad = new THREE.QuadMesh(material);
const shadowTex = texture(rt.texture);

const _p = new THREE.Vector3();

/** 每帧在渲染场景之前调用：以相机在云底平面上的投影为中心重画云影贴图（只在开启体积云时） */
export function updateCloudShadowMap(renderer: THREE.WebGPURenderer, camPos: THREE.Vector3): void {
  if (CLOUD.on.value < 0.5) return;
  const s = CLOUD.sunDir.value;
  const k = Math.max(0, CLOUD.base.value - camPos.y) / Math.max(s.y, 0.05);
  _p.copy(camPos).addScaledVector(s, k);
  // 按纹素对齐，镜头移动时云影边缘不闪
  const texel = EXTENT / N;
  center.value.set(Math.round(_p.x / texel) * texel, Math.round(_p.z / texel) * texel);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  try {
    quad.render(renderer);
  } finally {
    renderer.setRenderTarget(prev);
  }
}

/**
 * 云影：从 p 沿太阳方向穿过云层的透过率（1 = 没有云挡住阳光）。p：世界坐标。
 * 只在开启体积云时有效（低、中画质的二维云层不在世界空间里，没有对应的云影）；贴图边缘之外渐变为没有云影。
 */
export const cloudShadow = Fn(([pIn]: [THREE.Node<'vec3'>]) => {
  const p = vec3(pIn);
  const res = float(1).toVar();
  If(CLOUD.on.greaterThan(0.5).and(p.y.lessThan(CLOUD.top)), () => {
    const sy = max(CLOUD.sunDir.y, 0.05);
    const k = max(CLOUD.base.sub(p.y), 0.0).div(sy);
    const xz = p.xz.add(CLOUD.sunDir.xz.mul(k));
    const muv = xz.sub(center).div(extent).add(0.5);
    const edge = max(muv.x.sub(0.5).abs(), muv.y.sub(0.5).abs());
    const t = shadowTex.sample(muv).level(float(0)).r;
    res.assign(t.add(float(1).sub(t).mul(smoothstep(0.42, 0.5, edge))));
  });
  return res;
});

/** 调试：直接显示云影贴图（window.__postDebug = { view: 'cloud' }） */
export function cloudShadowDebug(uvNode: THREE.Node<'vec2'>): THREE.Node<'vec4'> {
  return vec4(vec3(shadowTex.sample(uvNode).level(float(0)).r), 1);
}
