// 水面（WebGPU 节点版）：PBR（环境贴图反射天空、方向光高光、分层阴影、大气雾）+ 解析法线的波浪：
//   · 顺风方向的几组深水波（色散关系 ω = √(gk)，长波走得快）+ 两层滚动噪声细节；
//   · 法线用解析梯度而不是屏幕空间求导，远处随距离平滑过渡成镜面，不会闪烁；
//   · 按水深着色、岸边泡沫带（向岸推进的泡沫线）、雨点涟漪；河流（亚马孙）是泥水：反射弱、浪小；
//   · 水面写入深度（屏幕空间反射 / 环境光遮蔽 / 时间抗锯齿都能正确作用在水面上），
//     “透明”改为折射采样：取水面之下已画好的场景颜色（按波浪法线偏移），浅水通透、深水被水色吸收。

import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  Fn,
  fwidth,
  length,
  mix,
  mrt,
  normalize,
  packNormalToRGB,
  positionView,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  step,
  struct,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
} from 'three/tsl';
import type { MapDef } from '../maps/types';
import { getNoiseTexture } from './textures';

type N<T extends string> = THREE.Node<T>;

// 8 组波：波长从 61 m 到 2.9 m（非整数比，避免规则叠加），方向在风向左右不规则散开
const WL = [61.0, 37.3, 23.1, 14.2, 8.9, 5.7, 4.1, 2.9];
const AN = [0.05, 0.47, -0.38, 0.83, -0.71, 0.29, -1.05, 1.18];
const AM = [0.42, 0.27, 0.17, 0.1, 0.065, 0.04, 0.028, 0.02];
const WaterOut = struct({ albedo: 'vec3', transmit: 'float', nrm: 'vec3', rough: 'float', foam: 'float' });

export class WaterView {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshPhysicalNodeMaterial;
  private u = {
    time: uniform(0),
    wind: uniform(new THREE.Vector2(1, 0)),
    wave: uniform(0.5),
    rain: uniform(0),
  };

  constructor(map: MapDef, depthTex: THREE.Texture) {
    const level = map.waterLevel ?? 0;
    const size = map.size * 3.4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const muddy = map.id === 'amazon' ? 1 : 0;
    const noise = getNoiseTexture();
    const U = this.u;
    const deep = new THREE.Color().setHex(map.biome.waterDeep);
    const shallow = new THREE.Color().setHex(map.biome.waterShallow);
    this.material = new THREE.MeshPhysicalNodeMaterial({
      roughness: muddy ? 0.16 : 0.05,
      metalness: 0,
      ior: 1.333,
      envMapIntensity: muddy ? 0.7 : 1.15,
      // 不透明（直接写入法线、反射率等辅助通道）；renderOrder = 1 保证在其他不透明物体之后画，折射才取得到水下已画好的场景
      depthWrite: true,
    });

    const result = Fn(() => {
      const p = positionWorld.xz;
      const t = U.time;
      const muv = p.div(map.size).add(0.5);
      const inside = step(0.0, muv.x).mul(step(muv.x, 1.0)).mul(step(0.0, muv.y)).mul(step(muv.y, 1.0));
      const wDepth = mix(float(1), texture(depthTex, muv).r, inside).toVar();
      const wDist = length(positionWorld.sub(cameraPosition)).toVar();
      // 一个像素覆盖的水面尺寸（米）：波长小于约 6 个像素的波逐渐淡出，否则远处会出现规则的摩尔纹
      const foot = length(fwidth(p)).toVar();
      const wl = length(U.wind);
      const wd = U.wind.div(wl.max(0.001)).mul(step(0.001, wl)).add(vec2(1, 0).mul(float(1).sub(step(0.001, wl))));
      // 浪的大小：随风变大，浅水、河流变小
      const amp = U.wave.mul(0.9).add(0.22).mul(1 - 0.65 * muddy).mul(smoothstep(0.0, 0.3, wDepth).mul(0.6).add(0.4));
      const g = vec2(0).toVar();
      for (let i = 0; i < 8; i++) {
        const fade = float(1).sub(smoothstep(WL[i] * 0.06, WL[i] * 0.16, foot));
        const c = Math.cos(AN[i]);
        const s = Math.sin(AN[i]);
        const d = vec2(wd.x.mul(c).sub(wd.y.mul(s)), wd.x.mul(s).add(wd.y.mul(c)));
        const k = (2 * Math.PI) / WL[i];
        // 相位里加一点低频噪声，打散整齐的波峰线
        const ph = dot(d, p).mul(k).sub(t.mul(Math.sqrt(9.81 * k))).add(i * 1.7).add(texture(noise, p.mul(0.0037).add(i * 0.13)).r.mul(6.0));
        g.addAssign(d.mul(cos(ph).mul(AM[i] * k)).mul(fade));
      }
      g.mulAssign(amp);
      // 近处的滚动噪声细节与雨点涟漪（远处细节小于像素时只会闪烁，按距离与像素尺寸淡出）
      const det = float(1).sub(smoothstep(60.0, 700.0, wDist)).mul(float(1).sub(smoothstep(0.08, 0.3, foot)));
      const noiseGrad = (uv: N<'vec2'>, e: number) => {
        const hx = texture(noise, uv.add(vec2(e, 0))).g.sub(texture(noise, uv.sub(vec2(e, 0))).g);
        const hy = texture(noise, uv.add(vec2(0, e))).g.sub(texture(noise, uv.sub(vec2(0, e))).g);
        return vec2(hx, hy).div(2 * e);
      };
      const o1 = wd.mul(t).mul(0.9);
      const o2 = vec2(wd.y.negate(), wd.x).mul(t).mul(0.5);
      const g1 = noiseGrad(p.add(o1.mul(3.0)).mul(0.035), 0.004).mul(0.035);
      const g2 = noiseGrad(p.sub(o2.mul(2.0)).mul(0.11).add(0.31), 0.004).mul(0.11);
      g.addAssign(g1.mul(0.9).add(g2.mul(0.45)).mul(U.wave.add(0.5)).mul(det));
      g.addAssign(noiseGrad(p.mul(0.7).add(vec2(t.mul(0.37), t.mul(-0.53))), 0.01).mul(0.12).mul(U.rain).mul(det));
      const nW = normalize(vec3(g.x.negate(), 1.0, g.y.negate()));
      // 水色：按水深在浅水色与深水色之间；泡沫：浅水带 + 向岸推进的泡沫线
      const fn = texture(noise, p.mul(0.05).add(U.wind.mul(t).mul(0.015))).g;
      const band = float(1).sub(smoothstep(0.0, fn.mul(0.05).add(0.06), wDepth));
      const lines = smoothstep(0.55, 0.95, sin(wDepth.mul(140.0).add(t.mul(1.6)).add(fn.mul(5.0))))
        .mul(float(1).sub(smoothstep(0.02, 0.14, wDepth)))
        .mul(fn);
      const foam = clamp(band.add(lines.mul(0.8)), 0.0, 1.0).mul(inside).mul(1 - 0.6 * muddy);
      const col = mix(vec3(shallow.r, shallow.g, shallow.b), vec3(deep.r, deep.g, deep.b), smoothstep(0.0, 0.55, wDepth));
      const albedo = mix(col, vec3(0.93, 0.95, 0.96), foam.mul(0.8));
      // 原来的不透明度 0.5（岸边）→ 0.96（深水），透过的部分改为折射
      const opacity = mix(0.5, 0.96, smoothstep(0.0, 0.22, wDepth));
      const transmit = float(1).sub(opacity).mul(float(1).sub(foam));
      const rough = smoothstep(150.0, 2200.0, wDist).mul(0.07).add(foam.mul(0.6)).add(U.rain.mul(0.06));
      return WaterOut(albedo.mul(opacity), transmit, nW, rough, foam);
    });
    const res = result();
    const nW = res.get('nrm') as N<'vec3'>;
    const transmit = res.get('transmit') as N<'float'>;
    this.material.colorNode = vec4(res.get('albedo') as N<'vec3'>, 1.0);
    this.material.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
    this.material.roughnessNode = float(muddy ? 0.16 : 0.05).add(res.get('rough') as N<'float'>);
    // 折射：按波浪法线偏移屏幕坐标，取水下已画好的场景颜色（略带水色）
    const refrUV = screenUV.add(nW.xz.mul(0.03));
    const refr = viewportSharedTexture(refrUV).rgb;
    this.material.emissiveNode = refr.mul(transmit).mul(mix(vec3(1.0), vec3(shallow.r, shallow.g, shallow.b).mul(1.6).add(0.2), 0.35));
    this.material.opacityNode = float(1);
    // 屏幕空间反射：水面在“金属度”通道写入菲涅尔反射率（正视约 2%，掠射接近 100%），光滑表面才反射；
    // 法线通道写波浪法线。其他透明材质不写这些通道（见 post.ts keepGBuffer）。
    const nView = normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
    const ndv = clamp(dot(nView, normalize(positionView).negate()), 0.0, 1.0);
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndv), 5.0)));
    this.material.mrtNode = mrt({ normal: vec4(packNormalToRGB(nView), fres.mul(1 - 0.6 * muddy).mul(float(1).sub(res.get('foam') as N<'float'>))) });
    this.material.userData.gbuffer = true;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  update(t: number, windX: number, windZ: number, windSpeed: number, rain: number): void {
    this.u.time.value = t;
    this.u.wind.value.set(windX, windZ);
    this.u.wave.value = Math.min(1, windSpeed / 14);
    this.u.rain.value = rain;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
