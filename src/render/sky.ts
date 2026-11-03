// 天空穹顶：渐变天空 + 太阳 + 程序化云层（随风移动）+ 阴天/暴雨变暗 + 闪电。
// 同一个材质也渲染进 PMREM 环境贴图，给所有 PBR 材质提供与天气一致的环境光与反射。

import * as THREE from 'three';
import type { WeatherParams } from '../sim/weather';
import { getNoiseTexture } from './textures';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uCover;
uniform float uSunVis;
uniform float uFlash;
uniform vec2 uWind;
uniform sampler2D uNoise;
varying vec3 vDir;
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * texture2D(uNoise, p).r; p = p * 2.03 + vec2(0.17, 0.31); a *= 0.5; }
  return s / 0.96875;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col = mix(col, uGround, smoothstep(0.0, -0.22, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 5.0) * 0.16 + pow(sd, 48.0) * 0.35) * uSunVis;
  col += uSunColor * smoothstep(0.99935, 0.9997, sd) * 10.0 * uSunVis;
  if (h > -0.02 && uCover > 0.01) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.1) * 0.06 + uWind;
    float n = fbm(uv * 0.5);
    float c = smoothstep(1.0 - uCover - 0.08, 1.0 - uCover + 0.32, n);
    float fade = smoothstep(-0.02, 0.14, h);
    float lit = clamp((n - 0.45) * 1.8 + sd * 0.35, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    col = mix(col, cc, c * fade * 0.94);
  }
  col += uFlash * vec3(0.55, 0.6, 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
}

const c = (hex: number) => new THREE.Color().setHex(hex);

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly sunDir = new THREE.Vector3();
  readonly colors: SkyColors;
  private fogTint: THREE.Color;
  private groundTint: THREE.Color;
  private windOffset = new THREE.Vector2();

  constructor(sunAzimuthDeg: number, sunElevationDeg: number, fogTint: number, groundTint: number) {
    const az = (sunAzimuthDeg * Math.PI) / 180;
    const el = (sunElevationDeg * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.fogTint = c(fogTint);
    this.groundTint = c(groundTint);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: this.sunDir },
        uSunColor: { value: new THREE.Color() },
        uCloudLit: { value: new THREE.Color() },
        uCloudDark: { value: new THREE.Color() },
        uCover: { value: 0.3 },
        uSunVis: { value: 1 },
        uFlash: { value: 0 },
        uWind: { value: this.windOffset },
        uNoise: { value: getNoiseTexture() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.colors = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      fog: new THREE.Color(),
      sun: new THREE.Color(),
      sunIntensity: 3,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 0.6,
    };
  }

  /** 根据天气计算天空与光照颜色。flash：闪电亮度 0..1。 */
  update(w: WeatherParams, windX: number, windZ: number, dt: number, flash: number): void {
    const C = this.colors;
    const oc = Math.min(1, w.overcast);
    const storm = Math.min(1, w.rain * w.overcast * 1.2);
    const fogK = Math.min(1, 1500 / Math.max(200, w.visibility));
    C.zenith.copy(c(0x2f62b8)).lerp(c(0x6b7480), oc).lerp(c(0x3a4048), storm);
    C.horizon.copy(c(0xb4cbe0)).lerp(this.fogTint, 0.35).lerp(c(0x9aa2aa), oc).lerp(c(0x5f666e), storm);
    C.horizon.lerp(c(0xc9cfd4).lerp(this.fogTint, 0.3), fogK * (1 - storm * 0.6));
    C.ground.copy(this.groundTint).multiplyScalar(0.55).lerp(C.horizon, 0.55);
    C.fog.copy(C.horizon);
    const sunVis = Math.max(0, 1 - oc * 0.92) * (1 - fogK * 0.55);
    C.sun.copy(c(0xfff1dc)).lerp(c(0xffe6c4), 0.3);
    C.sunIntensity = 3.2 * (0.12 + 0.88 * sunVis);
    C.hemiSky.copy(C.zenith).lerp(C.horizon, 0.5);
    C.hemiGround.copy(this.groundTint).multiplyScalar(0.6);
    C.hemiIntensity = 0.55 + 0.6 * oc + flash * 2.5;
    const u = this.material.uniforms;
    (u.uZenith.value as THREE.Color).copy(C.zenith);
    (u.uHorizon.value as THREE.Color).copy(C.horizon);
    (u.uGround.value as THREE.Color).copy(C.ground);
    (u.uSunColor.value as THREE.Color).copy(C.sun);
    (u.uCloudLit.value as THREE.Color).copy(c(0xf4f6f8)).lerp(c(0x9aa0a8), oc).lerp(c(0x585e66), storm);
    (u.uCloudDark.value as THREE.Color).copy(c(0xa8b0bc)).lerp(c(0x6c727a), oc).lerp(c(0x30353c), storm);
    u.uCover.value = Math.min(0.98, w.cloudCover + oc * 0.4);
    u.uSunVis.value = sunVis;
    u.uFlash.value = flash;
    this.windOffset.x += windX * dt * 0.00004;
    this.windOffset.y += windZ * dt * 0.00004;
  }

  follow(camPos: THREE.Vector3): void {
    this.mesh.position.copy(camPos);
  }
}
