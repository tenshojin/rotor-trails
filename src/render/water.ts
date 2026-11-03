// 水面：PBR 材质（环境贴图反射天空、方向光高光、分层阴影、大气雾）+ 解析法线的波浪：
//   · 顺风方向的几组深水波（色散关系 ω = √(gk)，长波走得快）+ 两层滚动噪声细节；
//   · 法线用解析梯度而不是屏幕空间求导，远处随距离平滑过渡成镜面，不会闪烁；
//   · 按水深着色（浅水透出水底）、岸边泡沫带（向岸推进的泡沫线）、雨点涟漪；
//   · 河流（亚马孙）是泥水：反射弱、浪小。

import * as THREE from 'three';
import type { MapDef } from '../maps/types';
import { getNoiseTexture } from './textures';

export class WaterView {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(map: MapDef, depthTex: THREE.Texture) {
    const level = map.waterLevel ?? 0;
    const size = map.size * 3.4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const muddy = map.id === 'amazon';
    this.uniforms = {
      uTime: { value: 0 },
      uNoise: { value: getNoiseTexture() },
      uDepth: { value: depthTex },
      uMapSize: { value: map.size },
      uDeep: { value: new THREE.Color().setHex(map.biome.waterDeep) },
      uShallow: { value: new THREE.Color().setHex(map.biome.waterShallow) },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWave: { value: 0.5 },
      uRain: { value: 0 },
      uMuddy: { value: muddy ? 1 : 0 },
    };
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: muddy ? 0.16 : 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 0.94,
      envMapIntensity: muddy ? 0.7 : 1.15,
    });
    const U = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
varying vec3 vWPos;
uniform float uTime, uMapSize, uWave, uRain, uMuddy;
uniform sampler2D uNoise, uDepth;
uniform vec3 uDeep, uShallow;
uniform vec2 uWind;
float wDepth = 1.0;
float wFoam = 0.0;
float wDist = 0.0;
// 顺风方向的深水波：返回水面高度的梯度 (dh/dx, dh/dz)。
// foot = 一个像素覆盖的水面尺寸（米）：波长小于约 6 个像素的波逐渐淡出，否则远处会出现规则的摩尔纹。
vec2 swellGrad(vec2 p, float t, vec2 wd, float amp, float foot) {
  vec2 g = vec2(0.0);
  // 8 组波：波长从 61 m 到 2.9 m（非整数比，避免规则叠加），方向在风向左右不规则散开
  const float WL[8] = float[8](61.0, 37.3, 23.1, 14.2, 8.9, 5.7, 4.1, 2.9);
  const float AN[8] = float[8](0.05, 0.47, -0.38, 0.83, -0.71, 0.29, -1.05, 1.18);
  const float AM[8] = float[8](0.42, 0.27, 0.17, 0.10, 0.065, 0.04, 0.028, 0.02);
  for (int i = 0; i < 8; i++) {
    float fade = 1.0 - smoothstep(WL[i] * 0.06, WL[i] * 0.16, foot);
    if (fade <= 0.0) continue;
    float c = cos(AN[i]);
    float s = sin(AN[i]);
    vec2 d = vec2(c * wd.x - s * wd.y, s * wd.x + c * wd.y);
    float k = 6.2831853 / WL[i];
    // 相位里加一点低频噪声，打散整齐的波峰线
    float ph = dot(d, p) * k - sqrt(9.81 * k) * t + float(i) * 1.7 + texture2D(uNoise, p * 0.0037 + float(i) * 0.13).r * 6.0;
    g += d * (AM[i] * k * cos(ph)) * fade;
  }
  return g * amp;
}
// 滚动噪声细节的梯度（中心差分）
vec2 noiseGrad(vec2 uv, float e) {
  float hx = texture2D(uNoise, uv + vec2(e, 0.0)).g - texture2D(uNoise, uv - vec2(e, 0.0)).g;
  float hy = texture2D(uNoise, uv + vec2(0.0, e)).g - texture2D(uNoise, uv - vec2(0.0, e)).g;
  return vec2(hx, hy) / (2.0 * e);
}`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `{
  vec2 muv = vWPos.xz / uMapSize + 0.5;
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  wDepth = mix(1.0, texture2D(uDepth, muv).r, inside);
  wDist = length(vWPos - cameraPosition);
  vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 0.55, wDepth));
  // 泡沫：浅水带 + 向岸推进的泡沫线（按水深的等值线随时间移动）
  float fn = texture2D(uNoise, vWPos.xz * 0.05 + uWind * uTime * 0.015).g;
  float band = 1.0 - smoothstep(0.0, 0.06 + fn * 0.05, wDepth);
  float lines = smoothstep(0.55, 0.95, sin(wDepth * 140.0 + uTime * 1.6 + fn * 5.0)) * (1.0 - smoothstep(0.02, 0.14, wDepth)) * fn;
  wFoam = clamp(band + lines * 0.8, 0.0, 1.0) * inside * (1.0 - uMuddy * 0.6);
  c = mix(c, vec3(0.93, 0.95, 0.96), wFoam * 0.8);
  diffuseColor.rgb *= c;
  diffuseColor.a *= mix(0.5, 0.96, smoothstep(0.0, 0.22, wDepth));
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
{
  float wl = length(uWind);
  vec2 wd = wl > 0.001 ? uWind / wl : vec2(1.0, 0.0);
  float t = uTime;
  vec2 p = vWPos.xz;
  // 浪的大小：随风变大，浅水、河流变小；远处逐渐平滑（细节小于像素时只会闪烁）
  float amp = (0.22 + 0.9 * uWave) * mix(1.0, 0.35, uMuddy) * (0.4 + 0.6 * smoothstep(0.0, 0.3, wDepth));
  float foot = length(fwidth(vWPos.xz));
  vec2 g = swellGrad(p, t, wd, amp, foot);
  float det = 1.0 - smoothstep(60.0, 700.0, wDist);
  det *= 1.0 - smoothstep(0.08, 0.3, foot);
  if (det > 0.01) {
    vec2 o1 = wd * t * 0.9;
    vec2 o2 = vec2(-wd.y, wd.x) * t * 0.5;
    vec2 g1 = noiseGrad((p + o1 * 3.0) * 0.035, 0.004) * 0.035;
    vec2 g2 = noiseGrad((p - o2 * 2.0) * 0.11 + 0.31, 0.004) * 0.11;
    g += (g1 * 0.9 + g2 * 0.45) * (0.5 + uWave) * det;
    // 雨点涟漪
    g += uRain * noiseGrad(p * 0.7 + vec2(t * 0.37, -t * 0.53), 0.01) * 0.12 * det;
  }
  vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness + 0.07 * smoothstep(150.0, 2200.0, wDist) + wFoam * 0.6 + uRain * 0.06;');
    };
    this.material.customProgramCacheKey = () => 'water-v2';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  update(t: number, windX: number, windZ: number, windSpeed: number, rain: number): void {
    this.uniforms.uTime.value = t;
    (this.uniforms.uWind.value as THREE.Vector2).set(windX, windZ);
    this.uniforms.uWave.value = Math.min(1, windSpeed / 14);
    this.uniforms.uRain.value = rain;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
