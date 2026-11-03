// 天空穹顶：Preetham 大气散射（晴空颜色随太阳位置变化：太阳一侧地平线更亮更暖、天顶深蓝）
// + 阴天/暴雨/低能见度时向灰色过渡 + 程序化云层（随风移动，逆光“银边”、厚处暗底）+ 高亮太阳圆盘（供泛光）+ 闪电。
// 同一个材质也渲染进 PMREM 环境贴图，给所有 PBR 材质提供与天气一致的环境光与反射。
// 天空在地平线处的颜色在 CPU 端用同一套公式算出，作为大气雾的颜色（远山与天空自然衔接）。
// 散射公式参照 three.js examples/jsm/objects/Sky.js（MIT）。

import * as THREE from 'three';
import type { WeatherParams } from '../sim/weather';
import { getNoiseTexture } from './textures';

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734;
const STEEP = 1.5;
const EE = 1000;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform float uSunE;
uniform float uMieG;
uniform float uSkyScale;
uniform vec3 uOvZenith;
uniform vec3 uOvHorizon;
uniform float uOvercast;
uniform vec3 uHaze;
uniform float uHazeK;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uCover;
uniform float uFlash;
uniform float uDisc;
uniform vec2 uWind;
uniform sampler2D uNoise;
varying vec3 vDir;
const float PI = 3.141592653589793;
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * texture2D(uNoise, p).r; p = p * 2.03 + vec2(0.17, 0.31); a *= 0.5; }
  return s / 0.96875;
}
vec3 preetham(vec3 d) {
  float za = acos(max(0.0, d.y));
  float inv = 1.0 / (cos(za) + 0.15 * pow(93.885 - za * 180.0 / PI, -1.253));
  vec3 Fex = exp(-(uBetaR * 8.4e3 * inv + uBetaM * 1.25e3 * inv));
  float ct = dot(d, uSunDir);
  float rp = 0.05968310365946075 * (1.0 + pow(ct * 0.5 + 0.5, 2.0));
  float g2 = uMieG * uMieG;
  float mp = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * uMieG * ct + g2, 1.5));
  vec3 bt = (uBetaR * rp + uBetaM * mp) / (uBetaR + uBetaM);
  vec3 Lin = pow(uSunE * bt * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(uSunE * bt * Fex, vec3(0.5)), clamp(pow(1.0 - uSunDir.y, 5.0), 0.0, 1.0));
  vec3 c = (Lin + 0.1 * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(c, vec3(1.0 / 2.4)) * uSkyScale;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 dh = normalize(vec3(d.x, max(h, 0.0), d.z));
  vec3 col = preetham(dh);
  // 阴天：天顶与地平线之间的灰色渐变
  vec3 ov = mix(uOvHorizon, uOvZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, ov, uOvercast);
  // 低能见度：地平线附近被雾霾吞没
  col = mix(col, uHaze, uHazeK * (1.0 - smoothstep(0.0, 0.35, h)));
  // 地平线以下（远景地形之外）
  col = mix(col, uGround, smoothstep(0.0, -0.18, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // 云层（平面投影，地平线处变薄）
  if (h > -0.02 && uCover > 0.01) {
    float hh = max(h, 0.0);
    vec2 uv = d.xz / (hh + 0.1) * 0.06 + uWind;
    float n = fbm(uv * 0.5);
    float c = smoothstep(1.0 - uCover - 0.08, 1.0 - uCover + 0.32, n);
    float fade = smoothstep(-0.02, 0.14, h);
    float thick = smoothstep(1.0 - uCover, 1.0, n);
    // 厚处暗、薄处亮，朝太阳一侧有逆光银边
    vec3 cc = mix(uCloudLit, uCloudDark, thick * 0.85);
    cc += uSunColor * uSunVis * (pow(sd, 8.0) * 0.6 * (1.0 - thick) + pow(sd, 2.0) * 0.08);
    col = mix(col, cc, c * fade * 0.95);
  }
  // 太阳圆盘（高亮，后期泛光会让它自然晕开）+ 宽光晕
  float disc = smoothstep(0.99955, 0.99975, sd);
  col += uSunColor * (disc * 38.0 * uDisc + pow(sd, 400.0) * 1.2 * uDisc + pow(sd, 24.0) * 0.12) * uSunVis;
  col += uFlash * vec3(0.55, 0.6, 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  /** 雾的基础颜色（背对太阳的地平线） */
  fog: THREE.Color;
  /** 朝太阳方向的地平线颜色 */
  fogSun: THREE.Color;
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
  private betaR = new THREE.Vector3();
  private betaM = new THREE.Vector3();
  private sunE = 0;
  private readonly mieG = 0.8;
  private skyScale = 1;
  /** 晴空的天顶/地平线/朝阳地平线颜色与阳光透射（只与太阳位置、浑浊度有关，加载时算一次） */
  private clear = { zenith: new THREE.Color(), horizon: new THREE.Color(), horizonSun: new THREE.Color(), sunTint: new THREE.Color() };

  constructor(sunAzimuthDeg: number, sunElevationDeg: number, fogTint: number, groundTint: number) {
    const az = (sunAzimuthDeg * Math.PI) / 180;
    const el = (sunElevationDeg * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.fogTint = c(fogTint);
    this.groundTint = c(groundTint);
    this.setAtmosphere(2.4, 1.6, 0.005);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uBetaR: { value: this.betaR },
        uBetaM: { value: this.betaM },
        uSunE: { value: this.sunE },
        uMieG: { value: this.mieG },
        uSkyScale: { value: this.skyScale },
        uOvZenith: { value: new THREE.Color() },
        uOvHorizon: { value: new THREE.Color() },
        uOvercast: { value: 0 },
        uHaze: { value: new THREE.Color() },
        uHazeK: { value: 0 },
        uGround: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uSunVis: { value: 1 },
        uCloudLit: { value: new THREE.Color() },
        uCloudDark: { value: new THREE.Color() },
        uCover: { value: 0.3 },
        uFlash: { value: 0 },
        uDisc: { value: 1 },
        uWind: { value: this.windOffset },
        uNoise: { value: getNoiseTexture() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 32), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.colors = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      fog: new THREE.Color(),
      fogSun: new THREE.Color(),
      sun: new THREE.Color(),
      sunIntensity: 3,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 0.6,
    };
  }

  /** 大气参数：浑浊度（越大越朦胧发白）、瑞利系数（越大越蓝）、米氏系数 */
  private setAtmosphere(turbidity: number, rayleigh: number, mie: number): void {
    this.betaR.set(TOTAL_RAYLEIGH[0], TOTAL_RAYLEIGH[1], TOTAL_RAYLEIGH[2]).multiplyScalar(rayleigh);
    const k = 0.434 * (0.2 * turbidity * 10e-18) * mie;
    this.betaM.set(MIE_CONST[0] * k, MIE_CONST[1] * k, MIE_CONST[2] * k);
    const zc = Math.max(-1, Math.min(1, this.sunDir.y));
    this.sunE = EE * Math.max(0, 1 - Math.exp(-((CUTOFF - Math.acos(zc)) / STEEP)));
    // 亮度标定：与太阳垂直方向的地平线亮度约 0.62（与场景的光照强度匹配）
    this.skyScale = 1;
    const side = new THREE.Vector3(-this.sunDir.z, 0.06, this.sunDir.x).normalize();
    const L = this.radiance(side, new THREE.Color());
    this.skyScale = 0.62 / Math.max(0.05, 0.2126 * L.r + 0.7152 * L.g + 0.0722 * L.b);
    const sunFlat = new THREE.Vector3(this.sunDir.x, 0.03, this.sunDir.z).normalize();
    this.radiance(new THREE.Vector3(0, 1, 0), this.clear.zenith);
    this.radiance(side, this.clear.horizon);
    this.radiance(sunFlat, this.clear.horizonSun);
    // 阳光颜色：太阳方向的大气透射（太阳越低越暖）
    const inv = this.invOptical(Math.acos(Math.max(0.0, this.sunDir.y)));
    const t = (i: 0 | 1 | 2) => Math.exp(-([this.betaR.x, this.betaR.y, this.betaR.z][i] * 8.4e3 * inv + [this.betaM.x, this.betaM.y, this.betaM.z][i] * 1.25e3 * inv));
    const tr = t(0);
    const tg = t(1);
    const tb = t(2);
    const m = Math.max(tr, tg, tb);
    this.clear.sunTint.setRGB(tr / m, tg / m, tb / m);
  }

  private invOptical(za: number): number {
    return 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  }

  /** 与着色器 preetham() 相同的公式（CPU 端），返回线性颜色 */
  private radiance(d: THREE.Vector3, out: THREE.Color): THREE.Color {
    const za = Math.acos(Math.max(0, d.y));
    const inv = this.invOptical(za);
    const ct = d.dot(this.sunDir);
    const rp = 0.05968310365946075 * (1 + Math.pow(ct * 0.5 + 0.5, 2));
    const g = this.mieG;
    const mp = 0.07957747154594767 * ((1 - g * g) / Math.pow(1 - 2 * g * ct + g * g, 1.5));
    const fade = Math.min(1, Math.max(0, Math.pow(1 - this.sunDir.y, 5)));
    const ch = (bR: number, bM: number, add: number) => {
      const Fex = Math.exp(-(bR * 8.4e3 * inv + bM * 1.25e3 * inv));
      const bt = (bR * rp + bM * mp) / (bR + bM);
      let Lin = Math.pow(this.sunE * bt * (1 - Fex), 1.5);
      Lin *= 1 + (Math.pow(this.sunE * bt * Fex, 0.5) - 1) * fade;
      return Math.pow((Lin + 0.1 * Fex) * 0.04 + add, 1 / 2.4) * this.skyScale;
    };
    return out.setRGB(ch(this.betaR.x, this.betaM.x, 0), ch(this.betaR.y, this.betaM.y, 0.0003), ch(this.betaR.z, this.betaM.z, 0.00075));
  }

  /** 根据天气计算天空与光照颜色。flash：闪电亮度 0..1。 */
  update(w: WeatherParams, windX: number, windZ: number, dt: number, flash: number): void {
    const C = this.colors;
    const oc = Math.min(1, w.overcast);
    const storm = Math.min(1, w.rain * w.overcast * 1.2);
    const fogK = Math.min(1, 1500 / Math.max(200, w.visibility));
    // 阴天的灰色天空
    const ovZen = c(0x7a828c).lerp(c(0x3a4048), storm);
    const ovHor = c(0xa6adb4).lerp(this.fogTint, 0.25).lerp(c(0x5f666e), storm);
    const haze = c(0xc9cfd4).lerp(this.fogTint, 0.35).lerp(ovHor, oc);
    C.zenith.copy(this.clear.zenith).lerp(ovZen, oc);
    C.horizon.copy(this.clear.horizon).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.fog.copy(C.horizon);
    C.fogSun.copy(this.clear.horizonSun).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.ground.copy(this.groundTint).multiplyScalar(0.55).lerp(C.horizon, 0.55);
    const sunVis = Math.max(0, 1 - oc * 0.92) * (1 - fogK * 0.55);
    C.sun.copy(this.clear.sunTint).lerp(c(0xfff3e4), 0.25);
    C.sunIntensity = 3.3 * (0.12 + 0.88 * sunVis);
    C.hemiSky.copy(C.zenith).lerp(C.horizon, 0.5);
    C.hemiGround.copy(this.groundTint).multiplyScalar(0.6);
    C.hemiIntensity = 0.5 + 0.6 * oc + flash * 2.5;
    const u = this.material.uniforms;
    (u.uOvZenith.value as THREE.Color).copy(ovZen);
    (u.uOvHorizon.value as THREE.Color).copy(ovHor);
    u.uOvercast.value = oc;
    (u.uHaze.value as THREE.Color).copy(haze);
    u.uHazeK.value = fogK * 0.85;
    (u.uGround.value as THREE.Color).copy(C.ground);
    (u.uSunColor.value as THREE.Color).copy(C.sun);
    u.uSunVis.value = sunVis;
    u.uSunE.value = this.sunE;
    u.uSkyScale.value = this.skyScale;
    (u.uCloudLit.value as THREE.Color).copy(c(0xf6f7f9)).lerp(c(0x9aa0a8), oc).lerp(c(0x585e66), storm);
    (u.uCloudDark.value as THREE.Color).copy(c(0xa3abb7)).lerp(c(0x6c727a), oc).lerp(c(0x30353c), storm);
    u.uCover.value = Math.min(0.98, w.cloudCover + oc * 0.4);
    u.uFlash.value = flash;
    this.windOffset.x += windX * dt * 0.00004;
    this.windOffset.y += windZ * dt * 0.00004;
  }

  follow(camPos: THREE.Vector3): void {
    this.mesh.position.copy(camPos);
  }
}
