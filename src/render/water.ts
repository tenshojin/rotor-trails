// 水面（WebGPU 节点版）：PBR（环境贴图反射天空、方向光高光、分层阴影、大气雾）+ 解析法线的波浪：
//   · 顺风方向的几组深水波（色散关系 ω = √(gk)，长波走得快）+ 两层滚动噪声细节；
//   · 法线用解析梯度而不是屏幕空间求导，远处随距离平滑过渡成镜面，不会闪烁；
//   · 按水深着色、岸边泡沫带（向岸推进的泡沫线）、雨点涟漪；河流（亚马孙）是泥水：反射弱、浪小；
//   · 倒影：沿反射方向在屏幕上步进，碰到画面里的山、树、房子就取那里的颜色（水面本身是平的，这样做又便宜又准）；
//     碰不到的地方才退回环境贴图里的天空。峡湾里的山影、河面上的林影都来自这里；
//   · 太阳的碎金：不用普通的高光（远处是一团光斑）。按“这一点的小波面要倾斜多少才能把太阳反射进眼睛”和海面波面坡度的
//     统计分布（Cox-Munk）算：画得出来的波浪直接比较，比像素还细的波浪按概率算，所以近处是一粒粒闪光，远处是一条光带；
//   · 水面写入深度（屏幕空间反射 / 环境光遮蔽 / 时间抗锯齿都能正确作用在水面上），
//     “透明”改为折射采样：取水面之下已画好的场景颜色（按波浪法线偏移），浅水通透、深水被水色吸收。

import * as THREE from 'three/webgpu';
import {
  BRDF_Lambert,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  diffuseColor,
  dot,
  exp,
  float,
  Fn,
  fwidth,
  If,
  length,
  max,
  min,
  mix,
  mrt,
  normalize,
  normalView,
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
import { HELI } from '../config/flight';
import type { MapDef } from '../maps/types';
import { FOG } from './atmosphere';
import { sceneDepthNode, screenMirror } from './mirror';
import type { ReflectField } from './reflectMap';
import type { SkyDome } from './sky';
import { getNoiseTexture } from './textures';

type N<T extends string> = THREE.Node<T>;

// 8 组波：波长从 61 m 到 2.9 m（非整数比，避免规则叠加），方向在风向左右不规则散开
const WL = [61.0, 37.3, 23.1, 14.2, 8.9, 5.7, 4.1, 2.9];
const AN = [0.05, 0.47, -0.38, 0.83, -0.71, 0.29, -1.05, 1.18];
const AM = [0.42, 0.27, 0.17, 0.1, 0.065, 0.04, 0.028, 0.02];
const WaterOut = struct({ albedo: 'vec3', transmit: 'float', nrm: 'vec3', rough: 'float', foam: 'float', glint: 'float' });

/** 碎金颗粒的归一化：噪声贴图 a 通道双线性插值后 x³ 的均值（两层相乘再三次方，乘上 1 / 它的平方，平均亮度不变） */
function sparkNorm(noise: THREE.DataTexture): number {
  const N = noise.image.width;
  const d = noise.image.data as Uint8Array;
  const a = (x: number, y: number): number => d[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + 3] / 255;
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const M = 20000;
  let s = 0;
  for (let k = 0; k < M; k++) {
    const u = rnd() * N - 0.5;
    const v = rnd() * N - 0.5;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const val = (a(x0, y0) * (1 - fx) + a(x0 + 1, y0) * fx) * (1 - fy) + (a(x0, y0 + 1) * (1 - fx) + a(x0 + 1, y0 + 1) * fx) * fy;
    s += val ** 3;
  }
  const m3 = s / M;
  return 1 / (m3 * m3);
}

/** 白浪的门槛表：白浪场 = 0.6 × r + 0.4 × g（噪声贴图两个通道，双线性插值），覆盖 cover 的那部分就是分位数 1 - cover。
 *  按贴图本身的分布算一次，覆盖比例才准 */
let capTable: Array<[number, number]> | null = null;
function capThresholds(noise: THREE.DataTexture): Array<[number, number]> {
  if (capTable) return capTable;
  const N = noise.image.width;
  const d = noise.image.data as Uint8Array;
  const ch = (x: number, y: number, c: number): number => d[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + c] / 255;
  const bil = (u: number, v: number, c: number): number => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    return (ch(x0, y0, c) * (1 - fx) + ch(x0 + 1, y0, c) * fx) * (1 - fy) + (ch(x0, y0 + 1, c) * (1 - fx) + ch(x0 + 1, y0 + 1, c) * fx) * fy;
  };
  let seed = 4242;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const M = 30000;
  const vals = new Float32Array(M);
  for (let k = 0; k < M; k++) vals[k] = 0.6 * bil(rnd() * N, rnd() * N, 0) + 0.4 * bil(rnd() * N, rnd() * N, 1);
  vals.sort();
  capTable = [];
  for (let e = -4; e <= -0.5; e += 0.25) {
    const cover = 10 ** e;
    capTable.push([cover, vals[Math.min(M - 1, Math.floor((1 - cover) * M))]]);
  }
  return capTable;
}

/** 风速（m/s）→ 白浪覆盖海面的比例（Monahan & O'Muircheartaigh 1980：W = 3.84e-6 · U^3.41） */
export function whitecapCover(windSpeed: number): number {
  return Math.min(0.2, 3.84e-6 * Math.max(0, windSpeed) ** 3.41);
}

/** 各组波的坡度方差（1/2 · (振幅 · 波数)²）的总和：把“画出来的波有多大一部分”换算成比例 */
const SLOPE_ALL = WL.reduce((s, w, i) => s + (AM[i] * 2 * Math.PI / w) ** 2, 0);

/**
 * 水面的光照：太阳的漫反射照常算（白沫、水里的散射），高光换成碎金（glint）。
 * lightColor 里已经乘过山影、云影和分层阴影，所以影子里没有碎金。
 */
class WaterLighting extends THREE.PhysicalLightingModel {
  constructor(private readonly glint: N<'float'>) {
    super();
  }

  direct(data: Parameters<THREE.PhysicalLightingModel['direct']>[0]): void {
    const { lightDirection, lightColor, reflectedLight } = data as unknown as { lightDirection: N<'vec3'>; lightColor: N<'vec3'>; reflectedLight: { directDiffuse: N<'vec3'>; directSpecular: N<'vec3'> } };
    const irradiance = (normalView.dot(lightDirection).clamp() as N<'float'>).mul(lightColor);
    reflectedLight.directDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as N<'vec3'>));
    reflectedLight.directSpecular.addAssign(lightColor.mul(this.glint));
  }
}

export class WaterView {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshPhysicalNodeMaterial;
  /** 倒影开关（低画质关闭） */
  readonly ssr = uniform(1);
  private u = {
    time: uniform(0),
    wind: uniform(new THREE.Vector2(1, 0)),
    wave: uniform(0.5),
    rain: uniform(0),
    /** 旋翼下洗：x、z、强度（0..1）、桨盘半径 */
    wash: uniform(new THREE.Vector4(0, 0, 0, HELI.rotorRadius)),
    /** 白浪：门槛（白浪场高于它的地方是白的）、覆盖比例（远处按平均算） */
    capThr: uniform(1.0),
    capCover: uniform(0),
  };
  private readonly caps: Array<[number, number]>;

  constructor(map: MapDef, depthTex: THREE.Texture, reversedDepth: boolean, field: ReflectField | null, sky: SkyDome) {
    const level = map.waterLevel ?? 0;
    // 水面一直铺到地平线，否则在地图外几公里就到头了，再往外是一条灰色的天空底边。
    // 网格不能跟着镜头走：那样它在画面里是不动的，运动向量全是 0，而波纹其实在高速后退。
    // 时间抗锯齿按 0 去对齐上一帧，全错位，飞得越快，远处的细波和倒影的抖动窜得越快。镜头飞不出地图，铺大一点就够了
    const size = 80000;
    // （分成小格：一整块几十公里的面，像素的世界坐标是从几十公里外的顶点插值出来的，远处不够准）
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const muddy = map.id === 'amazon' ? 1 : 0;
    const noise = getNoiseTexture();
    this.caps = capThresholds(noise);
    const U = this.u;
    const deep = new THREE.Color().setHex(map.biome.waterDeep);
    const shallow = new THREE.Color().setHex(map.biome.waterShallow);
    this.material = new THREE.MeshPhysicalNodeMaterial({
      roughness: muddy ? 0.16 : 0.12,
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
      // （地图外没有水深图：海按深水算；浑水河按河心算，否则河水一出地图就换了个颜色）
      // （水深图只到地图边：外面用一个定值，在边上慢慢过渡，不然河面上横着一条直线）
      const edgeIn = min(min(muv.x, float(1).sub(muv.x)), min(muv.y, float(1).sub(muv.y)));
      const wDepth = mix(float(muddy ? 0.22 : 1), texture(depthTex, muv).r, smoothstep(0.0, 0.035, edgeIn).mul(inside)).toVar();
      const wDist = length(positionWorld.sub(cameraPosition)).toVar();
      // 一个像素覆盖的水面尺寸（米）：波长小于约 6 个像素的波逐渐淡出，否则远处会出现规则的摩尔纹
      const foot = length(fwidth(p)).toVar();
      const wl = length(U.wind);
      const wd = U.wind.div(wl.max(0.001)).mul(step(0.001, wl)).add(vec2(1, 0).mul(float(1).sub(step(0.001, wl))));
      // 浪的大小：随风变大，浅水、河流变小
      const amp = U.wave.mul(0.9).add(0.22).mul(1 - 0.65 * muddy).mul(smoothstep(0.0, 0.3, wDepth).mul(0.6).add(0.4));
      const g = vec2(0).toVar();
      // 画得出来的波占全部波坡度的多少（剩下的比像素还细，只能按概率算）
      const drawn = float(0).toVar();
      // 阵风吹过的地方小浪更碎、更暗（水面上一片片的“猫爪”），这是开阔水面最耐看的纹理
      const paw = smoothstep(0.34, 0.7, texture(noise, p.mul(0.0011).add(wd.mul(t).mul(0.0035))).r.mul(0.7).add(texture(noise, p.mul(0.0043).add(wd.mul(t).mul(0.006))).g.mul(0.3))).mul(1.05).add(0.45).toVar();
      // 浪是一群一群来的：这一片有、那一片没有。几列正弦波老老实实叠在一起，从高处看太阳的反光是一张方格布
      const grpA = texture(noise, p.mul(0.0057).add(wd.mul(t).mul(0.011)));
      const grpB = texture(noise, p.mul(0.0131).add(0.37).sub(wd.mul(t).mul(0.017)));
      // （浪群的起伏：0.55~1.45 倍。以前是 0~1.7 倍，近处逆光的碎金被切成一团团棉花似的白斑，远处又是一条平的光带）
      const groups: Array<N<'float'>> = [grpA.r, grpA.g, grpB.r, grpB.g, grpA.a].map((v) => smoothstep(0.24, 0.76, v).mul(0.9).add(0.55));
      for (let i = 0; i < 8; i++) {
        // （淡出区间放宽到 4 倍像素尺寸：远近之间看不出哪一圈突然少了一层浪）
        const fade = float(1).sub(smoothstep(WL[i] * 0.05, WL[i] * 0.2, foot));
        const c = Math.cos(AN[i]);
        const s = Math.sin(AN[i]);
        const d = vec2(wd.x.mul(c).sub(wd.y.mul(s)), wd.x.mul(s).add(wd.y.mul(c)));
        const k = (2 * Math.PI) / WL[i];
        // 相位里加一点低频噪声，打散整齐的波峰线
        const ph = dot(d, p).mul(k).sub(t.mul(Math.sqrt(9.81 * k))).add(i * 1.7).add(texture(noise, p.mul(0.0037).add(i * 0.13)).r.mul(6.0));
        g.addAssign(d.mul(cos(ph).mul(AM[i] * k)).mul(fade).mul(i >= 3 ? paw : float(1)).mul(i < groups.length ? groups[i] : float(1)));
        drawn.addAssign(fade.mul(fade).mul((AM[i] * k) ** 2 / SLOPE_ALL));
      }
      g.mulAssign(amp);
      // 海面坡度的方差（Cox-Munk，每个方向）：大浪、细纹、比像素还细的毛细波加起来就是这么多。
      // 哪一层因为太远、比像素还细而淡掉，它那份就挪进粗糙度和碎金的统计里——远近总的起伏是同一个量，
      // 不会近处一片细纹、过了某一圈突然变成一面镜子
      const s2 = U.wave.mul(14.0 * 0.00512).add(0.003).mul(0.5).mul(1 - 0.65 * muddy).mul(paw.mul(0.5).add(0.5)).toVar();
      // 两层滚动噪声细纹（特征 0.1~0.9 米、0.04~0.3 米），按一个像素盖住多大淡出；远处再收一点防闪
      const far = float(1).sub(smoothstep(300.0, 3000.0, wDist));
      const det1 = float(1).sub(smoothstep(0.05, 0.45, foot)).mul(far).toVar();
      const det2 = float(1).sub(smoothstep(0.02, 0.16, foot)).mul(far).toVar();
      const det = det1;
      const noiseGrad = (uv: N<'vec2'>, e: number) => {
        const hx = texture(noise, uv.add(vec2(e, 0))).g.sub(texture(noise, uv.sub(vec2(e, 0))).g);
        const hy = texture(noise, uv.add(vec2(0, e))).g.sub(texture(noise, uv.sub(vec2(0, e))).g);
        return vec2(hx, hy).div(2 * e);
      };
      const o1 = wd.mul(t).mul(0.9);
      const o2 = vec2(wd.y.negate(), wd.x).mul(t).mul(0.5);
      // （噪声贴图 g 通道的 uv 坡度均方根约 10：除掉它，两层都是“均方根 1”，再按海面的坡度方差定幅度。
      // 以前直接乘 0.9、0.45，近处坡度均方根有 0.25~0.4，比真实海面粗糙两三倍）
      const g1 = noiseGrad(p.add(o1.mul(3.0)).mul(0.035), 0.004).mul(0.1);
      const g2 = noiseGrad(p.sub(o2.mul(2.0)).mul(0.11).add(0.31), 0.004).mul(0.1);
      const sd = s2.sqrt();
      g.addAssign(g1.mul(det1.mul(0.5)).add(g2.mul(det2.mul(0.35))).mul(sd));
      g.addAssign(noiseGrad(p.mul(0.7).add(vec2(t.mul(0.37), t.mul(-0.53))), 0.01).mul(0.12).mul(U.rain).mul(det));
      // 太阳的碎金。Hh：把太阳反射进眼睛的小波面的法线，need：那个小波面的坡度
      const Vv = normalize(cameraPosition.sub(positionWorld)).toVar();
      const Hh = normalize(Vv.add(FOG.sunDir)).toVar();
      const need = vec2(Hh.x.negate(), Hh.z.negate()).div(max(Hh.y, 0.05));
      // 细到只剩闪烁的小波：两层反向滚动的噪声，一明一灭
      const micro = vec2(
        texture(noise, p.mul(0.019).add(wd.mul(t).mul(0.021))).a.sub(texture(noise, p.mul(0.027).sub(wd.mul(t).mul(0.033)).add(0.4)).a),
        texture(noise, p.mul(0.023).add(vec2(wd.y, wd.x).mul(t).mul(0.026)).add(0.7)).a.sub(texture(noise, p.mul(0.031).sub(vec2(wd.y, wd.x).mul(t).mul(0.037)).add(0.2)).a),
      ).mul(float(1).sub(smoothstep(0.05, 0.6, foot)).mul(0.62)).mul(sd.mul(1.6));
      const microK = float(1).sub(smoothstep(0.05, 0.6, foot));
      const dS = need.sub(g.mul(0.85)).sub(micro);
      // （像素覆盖的范围再大，坡度的方差也就是海面本身那么大：不封顶的话几十公里外的海面朝哪个方向都反光，
      // 海天线上是一条发亮的带子）
      // 已经画出来的部分：大浪（8 组波的坡度方差 × 画出来的比例）、两层细纹、闪烁的小波；剩下的按概率算。
      // 总量守恒：近处画出来的多、剩下的少，远处反过来，平均亮度和光带的宽度一路接得上
      const waveVar = drawn.mul(amp.mul(amp)).mul(SLOPE_ALL * 0.5 * 0.72);
      const shown = waveVar.add(s2.mul(det1.mul(det1).mul(0.25).add(det2.mul(det2).mul(0.12)).add(microK.mul(microK).mul(0.17))));
      const sg = max(s2.sub(shown), max(s2.mul(0.45), 0.0009)).add(min(foot.mul(foot).mul(0.0002), 0.01)).toVar();
      const VoH = clamp(dot(Vv, Hh), 0.0, 1.0);
      const fG = float(0.02).add(float(0.98).mul(pow(float(1).sub(VoH), 5.0)));
      const P = exp(dot(dS, dS).div(sg.mul(-2.0))).div(sg.mul(2 * Math.PI));
      const cB = Hh.y.mul(Hh.y);
      // 碎金的颗粒：一个像素里的小波面是有限的几个，近处看是一粒粒很亮的闪光、中间露出暗的水；越远一个像素里的小波面越多，
      // 平均成一条光带。两层白噪声相乘再三次方（均值正好是 1/16，乘回来平均亮度不变），按像素大小淡出——远近接得上
      // （颗粒约半米：低空一两个像素大。总用最清楚的一级贴图采样，远处不会被平均成一片灰；颗粒按像素大小慢慢淡出）
      const spA = texture(noise, p.mul(0.0078).add(wd.mul(t).mul(0.0026)).add(vec2(0.37, 0.11))).level(float(0)).a;
      const spB = texture(noise, p.mul(0.0109).sub(vec2(wd.y, wd.x).mul(t).mul(0.0036)).add(vec2(0.13, 0.71))).level(float(0)).a;
      const spark = pow(spA.mul(spB), 3.0).mul(sparkNorm(noise));
      const sparkK = float(1).sub(smoothstep(0.12, 1.4, foot)).mul(0.9);
      const glint = min(fG.mul(P).div(max(Vv.y, 0.04).mul(cB).mul(cB).mul(4.0)), 42.0).mul(mix(float(1), spark, sparkK)).mul(FOG.glint).toVar();
      // 旋翼下洗：桨盘正下方的水面被压平，四周是一圈向外跑的急促碎浪和白沫
      const washFoam = float(0).toVar();
      If(U.wash.z.greaterThan(0.01), () => {
        const dv = p.sub(U.wash.xy);
        const dr = length(dv).max(0.01);
        const dir = dv.div(dr);
        const rn = dr.div(U.wash.w);
        const env = smoothstep(0.35, 0.95, rn).mul(float(1).sub(smoothstep(1.5, 3.6, rn))).mul(U.wash.z);
        const nz = texture(noise, p.mul(0.021).sub(dir.mul(t).mul(0.02))).r;
        g.mulAssign(float(1).sub(float(1).sub(smoothstep(0.1, 0.9, rn)).mul(U.wash.z).mul(0.75)));
        g.addAssign(dir.mul(cos(dr.mul(1.5).sub(t.mul(8.5)).add(nz.mul(8.0)))).mul(0.5).mul(env));
        g.addAssign(noiseGrad(p.mul(0.42).sub(dir.mul(t).mul(1.3)), 0.01).mul(0.34).mul(env));
        washFoam.assign(env.mul(smoothstep(0.5, 0.82, texture(noise, p.mul(0.085).sub(dir.mul(t).mul(0.22))).g)).mul(0.75));
      });
      const nW = normalize(vec3(g.x.negate(), 1.0, g.y.negate()));
      // 水色：按水深在浅水色与深水色之间；泡沫：浅水带 + 向岸推进的泡沫线
      const fn = texture(noise, p.mul(0.05).add(U.wind.mul(t).mul(0.015))).g;
      const band = float(1).sub(smoothstep(0.0, fn.mul(0.05).add(0.06), wDepth));
      const lines = smoothstep(0.55, 0.95, sin(wDepth.mul(140.0).add(t.mul(1.6)).add(fn.mul(5.0))))
        .mul(float(1).sub(smoothstep(0.02, 0.14, wDepth)))
        .mul(fn);
      // 白浪：风大了浪头破碎，一块块白沫顺着风拉长，跟着浪往下风走，几秒钟就散了。
      // 覆盖比例按风速（whitecapCover），门槛按噪声贴图的分布算好（capThresholds）；比像素还小的地方按平均亮度
      const along = dot(p, wd);
      const across = dot(p, vec2(wd.y.negate(), wd.x));
      const cr = texture(noise, vec2(along.mul(0.022), across.mul(0.055)).sub(vec2(t.mul(0.09), 0.0))).r;
      const cg = texture(noise, vec2(along.mul(0.061), across.mul(0.13)).add(vec2(0.37, 0.61)).sub(vec2(t.mul(0.19), t.mul(0.013)))).g;
      const capField = cr.mul(0.6).add(cg.mul(0.4));
      const capNear = smoothstep(U.capThr, U.capThr.add(0.035), capField);
      const caps = mix(capNear, U.capCover.mul(0.85), smoothstep(0.35, 1.3, foot)).mul(1 - muddy);
      const foam = clamp(clamp(band.add(lines.mul(0.8)), 0.0, 1.0).mul(inside).mul(1 - 0.6 * muddy).add(washFoam).add(caps.mul(0.9)), 0.0, 1.0);
      const col = mix(vec3(shallow.r, shallow.g, shallow.b), vec3(deep.r, deep.g, deep.b), smoothstep(0.0, 0.55, wDepth));
      const albedo = mix(col, vec3(0.93, 0.95, 0.96), foam.mul(0.8));
      // 原来的不透明度 0.5（岸边）→ 0.96（深水），透过的部分改为折射
      const opacity = mix(0.5, 0.96, smoothstep(0.0, 0.22, wDepth));
      const transmit = float(1).sub(opacity).mul(float(1).sub(foam));
      // 粗糙度随距离变大：远处的小波浪细到像素以下，看到的是无数小镜面的平均——天空的倒影是一片柔和的渐变，
      // 只有太阳方向有一条宽宽的闪光带，而不是像镜子一样映出一块块云
      // 近处也有比法线更细的毛细波：细纹画出来的时候粗糙度留四成，细纹淡掉多少就补多少，远处再按距离加满
      const rough = max(float(1).sub(det1.mul(0.6)), smoothstep(40.0, 1400.0, wDist)).mul(U.wave.mul(0.16).add(0.24)).add(foam.mul(0.6)).add(U.rain.mul(0.06));
      return WaterOut(albedo.mul(opacity), transmit, nW, rough, foam, glint.mul(float(1).sub(foam)));
    });
    const res = result();
    const nW = res.get('nrm') as N<'vec3'>;
    const transmit = res.get('transmit') as N<'float'>;
    // 水色主要来自水体内部的散射，不是表面的漫反射：只留三成跟着阳光走（否则峭壁的影子落在深水上是一条生硬的直线），
    // 其余按环境光算
    const alb = res.get('albedo') as N<'vec3'>;
    const foamK = res.get('foam') as N<'float'>;
    this.material.colorNode = vec4(alb.mul(foamK.mul(0.7).add(0.3)), 1.0);
    this.material.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
    // 比画出来的波浪更细的毛细波都算进粗糙度里：太阳的倒影才是一片碎光，而不是一个圆盘
    this.material.roughnessNode = float(muddy ? 0.16 : 0.12).add(res.get('rough') as N<'float'>);
    // 折射：按波浪法线偏移屏幕坐标，取水下已画好的场景颜色（略带水色）
    const refrUV = screenUV.add(nW.xz.mul(0.03));
    const refr = viewportSharedTexture(refrUV).rgb;
    // 掠射处的海面：环境贴图模糊后混进了地平线以下的暗色，算出来偏黑；真实的远海反射的是地平线一带最亮的天空，
    // 越远越接近天色，海天之间才是一条柔和的过渡。按视线掠射的程度补上这部分反射（不看波浪法线，否则远处会闪）
    const flatNdv = clamp(cameraPosition.y.sub(positionWorld.y).div(length(positionWorld.sub(cameraPosition)).max(1.0)), 0.0, 1.0);
    const graze = pow(float(1).sub(flatNdv), 7.0);
    const foamN = res.get('foam') as N<'float'>;
    const depthNode = sceneDepthNode(reversedDepth);
    // 比像素还细的波把倒影上下拉开：越远、风越大拉得越长（离得近时波浪本身就把倒影揉碎了）
    const spread = smoothstep(20.0, 1100.0, length(positionWorld.sub(cameraPosition))).mul(0.05).add(0.002).mul(this.u.wave.add(0.35));
    const refl = screenMirror(nW, foamN, depthNode, this.ssr, field, spread, sky);
    const reflRgb = refl.get('rgb') as N<'vec3'>;
    const reflK = (refl.get('total') as N<'float'>).toVar();
    const hitK = refl.get('hit') as N<'float'>;
    const nReflV = normalize(cameraViewMatrix.mul(vec4(normalize(mix(nW, vec3(0.0, 1.0, 0.0), 0.5)), 0.0)).xyz);
    const ndvR = clamp(dot(nReflV, normalize(positionView).negate()), 0.0, 1.0);
    const fresR = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndvR), 5.0)));
    // 倒影取代环境贴图；被山、树挡住的方向水色也暗一些（那里没有天光）
    this.material.specularIntensityNode = float(1).sub(reflK);
    this.material.emissiveNode = refr.mul(transmit).mul(mix(vec3(1.0), vec3(shallow.r, shallow.g, shallow.b).mul(1.6).add(0.2), 0.35)).add(FOG.color.mul(graze.mul(0.55).mul(float(1).sub(reflK)))).add(alb.mul(float(1).sub(foamK).mul(0.7)).mul(FOG.color).mul(0.85));
    this.material.emissiveNode = (this.material.emissiveNode as N<'vec3'>).mul(float(1).sub(hitK.mul(0.75))).add(reflRgb.mul(fresR.mul(reflK).mul(1 - 0.25 * muddy)));
    this.material.opacityNode = float(1);
    const lit = new WaterLighting(res.get('glint') as N<'float'>);
    (this.material as unknown as { setupLightingModel(): THREE.PhysicalLightingModel }).setupLightingModel = () => lit;
    // 法线通道写波浪法线。其他透明材质不写这些通道（见 post.ts keepGBuffer）。
    const nView = normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
    // 反射全在材质里算完了（mirror.ts）：金属度写 0、漫反射色写黑，后期的反射和反弹光都不再碰水面
    this.material.mrtNode = mrt({ normal: vec4(packNormalToRGB(nView), 0), diffuse: vec4(0, 0, 0, 1) });
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
    const cover = whitecapCover(windSpeed);
    this.u.capCover.value = cover;
    let thr = 1.0;
    if (cover > this.caps[0][0]) {
      thr = this.caps[this.caps.length - 1][1];
      for (let i = 1; i < this.caps.length; i++) {
        const [c1, t1] = this.caps[i];
        if (cover <= c1) {
          const [c0, t0] = this.caps[i - 1];
          const k = (Math.log(cover) - Math.log(c0)) / (Math.log(c1) - Math.log(c0));
          thr = t0 + (t1 - t0) * k;
          break;
        }
      }
    }
    this.u.capThr.value = thr;
    this.u.rain.value = rain;
  }

  /** 旋翼下洗的中心与强度（0 = 不在水面上） */
  setWash(x: number, z: number, k: number): void {
    const w = this.u.wash.value as THREE.Vector4;
    w.x = x;
    w.y = z;
    w.z = k;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
