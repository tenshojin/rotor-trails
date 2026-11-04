// 天空穹顶：Preetham 大气散射（晴空颜色随太阳位置变化：太阳一侧地平线更亮更暖、天顶深蓝）
// + 阴天/暴雨/低能见度时向灰色过渡 + 云 + 高亮太阳圆盘（供泛光）+ 闪电。
// 云分两种：高画质用光线步进的体积积云（三维噪声塑形，向太阳方向步进算自阴影，
// Henyey-Greenstein 相函数的逆光银边 + “粉末”效应的暗边）；低、中画质用平面投影的二维云层。
// 同一个材质也渲染进 PMREM 环境贴图，给所有 PBR 材质提供与天气一致的环境光与反射。
// 天空在地平线处的颜色在 CPU 端用同一套公式算出，作为大气雾的颜色（远山与天空自然衔接）。
// 散射公式参照 three.js examples/jsm/objects/Sky.js（MIT）。

import * as THREE from 'three/webgpu';
import { abs, acos, Break, clamp, cos, dot, exp, float, Fn, If, int, interleavedGradientNoise, Loop, max, min, mix, normalize, positionLocal, pow, screenCoordinate, screenUV, select, smoothstep, step, texture, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { getCloudNoise3D } from './cloudNoise';
import { CloudPass } from './cloudPass';
import type { WeatherParams } from '../sim/weather';
import { getNoiseTexture } from './textures';

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734;
const STEEP = 1.5;
const EE = 1000;

/**
 * 体积云的共享参数：天空里看到的云、地面上的云影、体积雾里的云影（光束）用同一份，三者始终对得上。
 * 同一时间只有一个天空穹顶，由它每帧更新。
 */
export const CLOUD = {
  /** 云层底 / 顶高度（米，世界坐标） */
  base: uniform(1500),
  top: uniform(2800),
  /** 云量 0..1 */
  cover: uniform(0.3),
  /** 风吹过的距离（米） */
  windM: uniform(new THREE.Vector2()),
  /** 指向太阳的单位向量 */
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  /** 1 = 开启体积云（高、极高画质）：地面与体积雾里才有云影 */
  on: uniform(0),
};

/** 云核心的消光系数（1/米） */
const CLOUD_SIGMA = 0.03;

/**
 * 体积云密度（0..~1.6）。p：世界坐标。
 * 气象图（几十公里的晴区 / 云区 + 几公里的云团）决定这里有多少云、云能长多高：同一片天空里有成片的晴空、
 * 零散的小积云和几团高耸的浓积云，而不是铺满一层一样大的棉花。
 * 再乘高度轮廓（底平、顶圆）、三维 Perlin-Worley 形状（两个尺度，单朵云有大有小），最后用高频 Worley 侵蚀边缘。
 */
export function cloudDensity(p: THREE.Node<'vec3'>): THREE.Node<'float'> {
  const noise3 = getCloudNoise3D();
  const noise2 = getNoiseTexture();
  const span = CLOUD.top.sub(CLOUD.base);
  const q = p.xz.add(CLOUD.windM);
  const w1 = texture(noise2, q.div(120000.0)).level(float(0)).r;
  const w2 = texture(noise2, q.div(34000.0).add(0.37)).level(float(0)).r;
  const field = w1.mul(0.58).add(w2.mul(0.42));
  const cluster = smoothstep(0.38, 0.62, field);
  const cov = min(CLOUD.cover.mul(mix(0.45, 1.6, cluster)), 1.0);
  const tall = smoothstep(0.46, 0.6, field);
  const hn = clamp(p.y.sub(CLOUD.base).div(span.mul(mix(0.42, 1.0, tall))), 0.0, 1.0);
  // 积云的高度轮廓：底部平整（很快变浓），往上逐渐收窄成圆顶
  const prof = smoothstep(0.0, 0.09, hn).mul(float(1).sub(smoothstep(0.28, 1.0, hn)));
  // 三维 Perlin-Worley 团块（菜花状）：一大一小两个尺度混合
  const uvw = vec3(q.x, p.y.mul(1.4), q.y).div(3400.0);
  const shape = texture3D(noise3, uvw).level(float(0));
  const big = texture3D(noise3, uvw.mul(0.29).add(0.13)).level(float(0));
  const d0 = mix(big.r, shape.r.mul(shape.a.mul(0.35).add(0.65)), 0.62).mul(prof);
  // 阈值：云量 0.3 时约三成天空有云，云量 1 时连成一片
  const th = mix(float(0.74), float(0.1), pow(cov, 1.3));
  const base = clamp(d0.sub(th).div(float(1).sub(th)), 0.0, 1.0);
  // 高频 Worley 侵蚀边缘（越靠云边侵蚀越多），底部的侵蚀更强，显出絮状；再叠一层更细的，云边才有“菜花”的小疙瘩
  const det = texture3D(noise3, uvw.mul(4.3).add(0.21)).level(float(0));
  const fine = texture3D(noise3, uvw.mul(13.7).add(0.57)).level(float(0));
  const ero = mix(det.g, det.b, hn).mul(0.5).add(fine.g.mul(0.2)).mul(float(1).sub(base.mul(0.8)));
  return clamp(base.mul(1.15).sub(ero.mul(0.62)), 0.0, 1.0).mul(1.6);
}

/** 天空着色用的 uniform 节点（CPU 端每帧更新 .value） */
function makeSkyUniforms(sunDir: THREE.Vector3, wind: THREE.Vector2) {
  return {
    sunDir: uniform(sunDir),
    betaR: uniform(new THREE.Vector3()),
    betaM: uniform(new THREE.Vector3()),
    sunE: uniform(0),
    mieG: uniform(0.8),
    skyScale: uniform(1),
    ovZenith: uniform(new THREE.Color()),
    ovHorizon: uniform(new THREE.Color()),
    overcast: uniform(0),
    haze: uniform(new THREE.Color()),
    hazeK: uniform(0),
    ground: uniform(new THREE.Color()),
    sunColor: uniform(new THREE.Color()),
    sunVis: uniform(1),
    cloudLit: uniform(new THREE.Color()),
    cloudDark: uniform(new THREE.Color()),
    cover: CLOUD.cover,
    flash: uniform(0),
    /** 1 = 画太阳圆盘；烘焙环境贴图时设为 0（阳光高光由方向光负责） */
    disc: uniform(1),
    /** 1 = 叠加 CloudPass 的体积云（主画面）；0 = 不叠加（低、中画质，烘焙环境贴图时用二维云层） */
    useTex: uniform(0),
    /** 高空卷云的浓度 0..1 */
    cirrus: uniform(0.5),
    wind: uniform(wind),
    /** 体积云：相机世界坐标、云层底 / 顶高度（米）、步进次数（0 = 用二维云层）、风吹过的距离（米） */
    camPos: uniform(new THREE.Vector3()),
    cloudBase: CLOUD.base,
    cloudTop: CLOUD.top,
    steps: uniform(0),
    /** 云的阳光颜色向白色靠拢的程度（1 = 正午） */
    cloudWhite: uniform(1),
    windM: CLOUD.windM,
    /** 云的环境光（天顶 / 地平线）与帧序号（抖动起点，配合时间抗锯齿收敛） */
    ambTop: uniform(new THREE.Color(0.5, 0.6, 0.75)),
    ambBottom: uniform(new THREE.Color(0.45, 0.5, 0.55)),
    frame: uniform(0),
  };
}

type SkyU = ReturnType<typeof makeSkyUniforms>;

/** 天空颜色（线性 HDR，色调映射在后期统一做）。d：视线方向（单位向量）。 */
function skyColorNode(U: SkyU, noise: THREE.Texture, cloudTex: THREE.TextureNode) {
  const PI_ = Math.PI;
  const preetham = Fn(([d]: [THREE.Node<'vec3'>]) => {
    const dd = vec3(d);
    const za = acos(max(0.0, dd.y));
    const inv = float(1).div(cos(za).add(float(0.15).mul(pow(float(93.885).sub(za.mul(180 / PI_)), -1.253))));
    const Fex = exp(U.betaR.mul(8.4e3 * 1).mul(inv).add(U.betaM.mul(1.25e3).mul(inv)).negate());
    const ct = dot(dd, U.sunDir);
    const rp = float(0.05968310365946075).mul(float(1).add(pow(ct.mul(0.5).add(0.5), 2.0)));
    const g2 = U.mieG.mul(U.mieG);
    const mp = float(0.07957747154594767).mul(float(1).sub(g2).div(pow(float(1).sub(U.mieG.mul(2).mul(ct)).add(g2), 1.5)));
    const bt = U.betaR.mul(rp).add(U.betaM.mul(mp)).div(U.betaR.add(U.betaM));
    const Lin = pow(U.sunE.mul(bt).mul(float(1).sub(Fex)), vec3(1.5)).toVar();
    Lin.mulAssign(mix(vec3(1.0), pow(U.sunE.mul(bt).mul(Fex), vec3(0.5)), clamp(pow(float(1).sub(U.sunDir.y), 5.0), 0.0, 1.0)));
    const c = Lin.add(Fex.mul(0.1)).mul(0.04).add(vec3(0.0, 0.0003, 0.00075));
    return pow(c, vec3(1.0 / 2.4)).mul(U.skyScale);
  });
  const fbm = (p: THREE.Node<'vec2'>) => {
    let sum: THREE.Node<'float'> = float(0);
    let a = 0.5;
    let q: THREE.Node<'vec2'> = vec2(p);
    for (let i = 0; i < 5; i++) {
      sum = sum.add(texture(noise, q).r.mul(a));
      q = q.mul(2.03).add(vec2(0.17, 0.31));
      a *= 0.5;
    }
    return sum.div(0.96875);
  };
  return Fn(() => {
    const d = normalize(positionLocal);
    const h = d.y;
    const dh = normalize(vec3(d.x, max(h, 0.0), d.z));
    const col = vec3(preetham(dh)).toVar();
    // 阴天：天顶与地平线之间的灰色渐变
    const ov = mix(U.ovHorizon, U.ovZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    col.assign(mix(col, ov, U.overcast));
    // 低能见度：地平线附近被雾霾吞没
    col.assign(mix(col, U.haze, U.hazeK.mul(float(1).sub(smoothstep(0.0, 0.35, h)))));
    // 地平线以下（远景地形之外）
    col.assign(mix(col, U.ground, float(1).sub(smoothstep(-0.18, 0.0, h))));
    const sd = max(dot(d, U.sunDir), 0.0);
    // 云层（平面投影，地平线处变薄）
    const hh = max(h, 0.0);
    const cuv = d.xz.div(hh.add(0.1)).mul(0.06).add(U.wind);
    // 一个噪声周期约对应天空里一朵积云的大小（原来的 0.5 太大：整片天空只有一两个起伏，只剩一道弧线状的云）
    const n = fbm(cuv.mul(3.0));
    const cov = smoothstep(float(1).sub(U.cover).sub(0.2), float(1).sub(U.cover).add(0.22), n);
    const fade = smoothstep(-0.02, 0.14, h);
    const thick = smoothstep(float(1).sub(U.cover), 1.0, n);
    // 厚处暗、薄处亮，朝太阳一侧有逆光银边
    const cc = mix(U.cloudLit, U.cloudDark, thick.mul(0.85)).add(
      U.sunColor.mul(U.sunVis).mul(pow(sd, 8.0).mul(0.6).mul(float(1).sub(thick)).add(pow(sd, 2.0).mul(0.08))),
    );
    // 开体积云时二维云层不画
    const flat2d = step(U.steps, 0.5);
    col.assign(mix(col, cc, cov.mul(fade).mul(0.95).mul(step(0.01, U.cover)).mul(flat2d)));
    // 太阳圆盘（高亮，后期泛光会让它自然晕开）+ 宽光晕
    const disc = smoothstep(0.99955, 0.99975, sd);
    col.addAssign(U.sunColor.mul(disc.mul(38.0).mul(U.disc).add(pow(sd, 400.0).mul(1.2).mul(U.disc)).add(pow(sd, 24.0).mul(0.12))).mul(U.sunVis));
    // 高空卷云：万米高空的冰晶云，一缕一缕顺着高空风拉长，薄到能透出蓝天，在积云之上给天空添一层纵深
    const ciuv = d.xz.div(hh.add(0.08));
    const ci0 = fbm(vec2(ciuv.x.mul(0.05).add(ciuv.y.mul(0.02)), ciuv.y.mul(0.16).sub(ciuv.x.mul(0.05))).add(U.wind.mul(0.4)));
    const ci1 = texture(noise, ciuv.mul(0.31).add(vec2(ci0.mul(0.2), 0.1))).r;
    const ciA = smoothstep(0.5, 0.78, ci0.mul(0.7).add(ci1.mul(0.3))).mul(smoothstep(0.03, 0.3, h)).mul(U.cirrus).mul(0.42).mul(float(1).sub(U.overcast)).mul(step(0.5, U.steps));
    col.assign(mix(col, U.sunColor.mul(U.sunVis.mul(0.85).add(0.1)).add(col.mul(0.25)), ciA));
    // 体积云盖在天空与太阳之上（rgb = 散射光，a = 透过率）
    const cl = cloudTex.sample(screenUV);
    col.assign(mix(col, col.mul(cl.a).add(cl.rgb), U.useTex));
    col.addAssign(vec3(0.55, 0.6, 0.75).mul(U.flash));
    return col;
  })();
}

/**
 * 体积积云：在 [cloudBase, cloudTop] 的云层里沿视线步进（步长由近到远逐渐变大）。
 * 每个有云的采样点向太阳方向步进 4 次，算出阳光穿过云体的光学厚度：
 * 直射部分按比尔-朗伯衰减，相函数取前向 + 后向两个 HG 的混合（逆光银边）；
 * 云的反照率接近 1，多次散射的光能钻到很深的地方——用二流近似 T ≈ 1 / (1 + 0.11 τ) 单独算这一部分，
 * 云的背光面才是柔和的灰白，而不是一块平的深色。“粉末”效应让朝阳面的薄边略暗、显出体积感。
 * 返回 vec4(散射光, 透过率)。
 */
function volumetricClouds(U: SkyU) {
  const SIGMA = CLOUD_SIGMA;
  const hg = (c: THREE.Node<'float'>, g: number) => float(1 - g * g).div(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5));
  const density = cloudDensity;
  return Fn(([dIn]: [THREE.Node<'vec3'>]) => {
    const d = vec3(dIn);
    const acc = vec3(0.0).toVar();
    const trans = float(1.0).toVar();
    const cam = U.camPos;
    const dy = select(abs(d.y).lessThan(1e-4), float(1e-4), d.y);
    const tA = U.cloudBase.sub(cam.y).div(dy);
    const tB = U.cloudTop.sub(cam.y).div(dy);
    const t0 = max(min(tA, tB), 0.0).toVar();
    const t1 = min(max(tA, tB), t0.add(15000.0)).toVar();
    If(t1.greaterThan(t0).and(U.steps.greaterThan(0.5)), () => {
      const len = t1.sub(t0).toVar();
      // 每像素每帧不同的起点抖动（由时间累积抹平）
      const jit = interleavedGradientNoise(screenCoordinate.add(U.frame.mul(5.588238)));
      const cosT = dot(d, U.sunDir);
      const phase = min(mix(hg(cosT, 0.62), hg(cosT, -0.25), 0.28).mul(1.6), 2.4);
      // 太阳高的时候阳光接近白色（云不该是奶油色），太阳低时才保留暖色
      const sunCol = U.sunColor as unknown as THREE.Node<'vec3'>;
      const sunC = mix(sunCol, vec3(dot(sunCol, vec3(0.3, 0.55, 0.15))), U.cloudWhite).mul(U.sunVis).mul(1.5);
      Loop({ start: int(0), end: int(U.steps), type: 'int', condition: '<' }, ({ i }: { i: THREE.Node<'int'> }) => {
        // 步长按 s^0.7 增长：近处细、远处粗
        const s = float(i).add(jit).div(U.steps);
        const t = t0.add(len.mul(pow(s, 1.7)));
        const dt = len.mul(1.7).mul(pow(s, 0.7)).div(U.steps).add(1.0);
        const p = U.camPos.add(d.mul(t));
        const den = density(p).toVar();
        If(den.greaterThan(0.004), () => {
          // 向太阳步进 4 次（步长逐次加倍，共约 900 m）。用真循环：密度函数很大，着色器里多一份就多编译几秒
          const od = float(0).toVar();
          const stepLen = float(60).toVar();
          const off = float(30).toVar();
          Loop(4, () => {
            od.addAssign(density(p.add(U.sunDir.mul(off))).mul(stepLen));
            off.addAssign(stepLen.mul(1.5));
            stepLen.mulAssign(2.0);
          });
          const tau = od.mul(SIGMA);
          const tSun = exp(tau.mul(-0.9));
          const tMs = float(1).div(tau.mul(0.16).add(1.0));
          const powder = float(1).sub(exp(den.mul(-SIGMA * 2.0 * 220.0)));
          const hn = clamp(p.y.sub(U.cloudBase).div(U.cloudTop.sub(U.cloudBase)), 0.0, 1.0);
          const amb0 = mix(U.ambBottom as unknown as THREE.Node<'vec3'>, U.ambTop as unknown as THREE.Node<'vec3'>, smoothstep(0.0, 0.5, hn)).mul(0.62);
          const amb = mix(amb0, vec3(dot(amb0, vec3(0.3, 0.55, 0.15))), 0.45);
          // 阴天时云层就是天空：亮度要和灰色的天顶、地平线一致，否则厚云会把整个世界（和环境贴图）压成一片黑
          const ovc = mix(U.ovHorizon as unknown as THREE.Node<'vec3'>, U.ovZenith as unknown as THREE.Node<'vec3'>, hn).mul(U.overcast.mul(1.05));
          const S = sunC.mul(tSun.mul(phase).mul(mix(float(1), powder, 0.5)).add(tMs.mul(0.3))).add(amb).add(ovc);
          const a = exp(den.mul(-SIGMA).mul(dt));
          acc.addAssign(S.mul(trans).mul(float(1).sub(a)));
          trans.mulAssign(a);
        });
        If(trans.lessThan(0.02), () => {
          Break();
        });
      });
      // 远处的云融进地平线的雾霾里；视线贴近地平线时淡出（大气透视）
      const far = float(1).sub(exp(t0.div(-20000.0)));
      const horizon = smoothstep(-0.02, 0.1, abs(d.y));
      const keep = float(1).sub(far).mul(horizon);
      const o = float(1).sub(trans).toVar();
      acc.assign(mix(U.haze.mul(o), acc, keep));
      trans.assign(mix(mix(trans, float(1), 0.6), trans, keep));
    });
    return vec4(acc, trans);
  });
}

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
const _warm = new THREE.Color();
const _dusk = new THREE.Color(0x6a5a72);

export class SkyDome {
  /** 体积云的渲染通道（高、极高画质） */
  readonly clouds: CloudPass;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly u: SkyU;
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
  /** 太阳高度带来的“白天程度”：0 = 贴着地平线，1 = 高于约 25°（清晨、黄昏时天空、阳光、环境光都更暗） */
  dayK = 1;
  /** 晴空的天顶/地平线/朝阳地平线颜色与阳光透射（只与太阳位置、浑浊度有关，加载时算一次） */
  private clear = { zenith: new THREE.Color(), horizon: new THREE.Color(), horizonSun: new THREE.Color(), sunTint: new THREE.Color() };

  constructor(sunAzimuthDeg: number, sunElevationDeg: number, fogTint: number, groundTint: number) {
    this.fogTint = c(fogTint);
    this.groundTint = c(groundTint);
    this.setSun(sunAzimuthDeg, sunElevationDeg);
    this.u = makeSkyUniforms(this.sunDir, this.windOffset);
    this.u.betaR.value = this.betaR;
    this.u.betaM.value = this.betaM;
    this.material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.clouds = new CloudPass(volumetricClouds(this.u));
    this.material.colorNode = skyColorNode(this.u, getNoiseTexture(), this.clouds.tex);
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

  /** 太阳方位角 / 高度角（度）：换时段（清晨、黄昏）时调用，重新计算大气参数（sunDir 是同一个对象，着色器自动跟随） */
  setSun(azDeg: number, elDeg: number): void {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.dayK = Math.max(0, Math.min(1, (elDeg - 1.5) / 23.5));
    this.setAtmosphere(2.4, 1.6, 0.005);
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
    // 太阳很低时天空整体更暗（清晨、黄昏）
    this.skyScale = (0.62 * (0.4 + 0.6 * this.dayK ** 0.7)) / Math.max(0.05, 0.2126 * L.r + 0.7152 * L.g + 0.0722 * L.b);
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
    const ovZen = c(0x7a828c).lerp(c(0x4a525c), storm);
    const ovHor = c(0xa6adb4).lerp(this.fogTint, 0.25).lerp(c(0x70787f), storm);
    const haze = c(0xc9cfd4).lerp(this.fogTint, 0.35).lerp(ovHor, oc);
    C.zenith.copy(this.clear.zenith).lerp(ovZen, oc);
    C.horizon.copy(this.clear.horizon).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.fog.copy(C.horizon);
    C.fogSun.copy(this.clear.horizonSun).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.ground.copy(this.groundTint).multiplyScalar(0.55).lerp(C.horizon, 0.55);
    const sunVis = Math.max(0, 1 - oc * 0.92) * (1 - fogK * 0.55);
    C.sun.copy(this.clear.sunTint).lerp(c(0xfff3e4), 0.25);
    // 太阳越低，穿过的大气越厚：直射光变弱（6° 时约为正午的六成，同时由大气透射变成橙红）
    C.sunIntensity = 3.3 * (0.12 + 0.88 * sunVis) * (0.32 + 0.68 * this.dayK ** 0.65);
    C.hemiSky.copy(C.zenith).lerp(C.horizon, 0.5);
    C.hemiGround.copy(this.groundTint).multiplyScalar(0.6);
    C.hemiIntensity = (0.5 + 0.6 * oc) * (0.45 + 0.55 * this.dayK) + flash * 2.5;
    const u = this.u;
    u.ovZenith.value.copy(ovZen);
    u.ovHorizon.value.copy(ovHor);
    u.overcast.value = oc;
    u.haze.value.copy(haze);
    u.hazeK.value = fogK * 0.85;
    u.ground.value.copy(C.ground);
    u.sunColor.value.copy(C.sun);
    u.sunVis.value = sunVis;
    u.sunE.value = this.sunE;
    u.skyScale.value = this.skyScale;
    u.cloudLit.value.copy(c(0xf6f7f9)).lerp(c(0x9aa0a8), oc).lerp(c(0x585e66), storm);
    u.cloudDark.value.copy(c(0xa3abb7)).lerp(c(0x6c727a), oc).lerp(c(0x30353c), storm);
    // 清晨、黄昏：二维云层的亮面被斜阳染暖，暗面偏紫灰
    const low = (1 - this.dayK) * (1 - oc);
    u.cloudLit.value.lerp(_warm.copy(C.sun).multiplyScalar(0.95), low * 0.55);
    u.cloudDark.value.lerp(_dusk, low * 0.5);
    u.cover.value = Math.min(1, w.cloudCover + oc * 0.4);
    u.cloudWhite.value = this.dayK * this.dayK;
    u.cirrus.value = 0.35 + 0.65 * Math.min(1, w.cloudCover * 2);
    u.flash.value = flash;
    // 体积云：环境光取天顶与地平线颜色，风把云整体吹走（米），帧序号用于步进抖动
    u.ambTop.value.copy(C.zenith).multiplyScalar(1.1);
    // 云底：天空散射光被云体挡住大半，呈平整的灰色底部
    u.ambBottom.value.copy(C.horizon).lerp(C.ground, 0.45).multiplyScalar(0.5);
    u.windM.value.x -= windX * dt;
    u.windM.value.y -= windZ * dt;
    u.frame.value = (u.frame.value + 1) % 64;
    CLOUD.sunDir.value.copy(this.sunDir);
    this.windOffset.x += windX * dt * 0.00004;
    this.windOffset.y += windZ * dt * 0.00004;
  }

  /** 体积云的步进次数（0 = 用二维云层）与云层高度（米） */
  setVolumetric(steps: number, base?: number, top?: number): void {
    this.u.steps.value = steps;
    this.u.useTex.value = steps > 0 ? 1 : 0;
    CLOUD.on.value = steps > 0 ? 1 : 0;
    if (base !== undefined) this.u.cloudBase.value = base;
    if (top !== undefined) this.u.cloudTop.value = top;
  }

  follow(camPos: THREE.Vector3): void {
    this.u.camPos.value.copy(camPos);
    this.mesh.position.copy(camPos);
  }

  /** 烘焙环境贴图时：CloudPass 的纹理是屏幕空间的，这里改用二维云层；返回的函数用来恢复 */
  beginEnvBake(): () => void {
    const steps = this.u.steps.value;
    const tex = this.u.useTex.value;
    this.u.useTex.value = 0;
    this.u.steps.value = 0;
    this.u.disc.value = 0;
    return () => {
      this.u.useTex.value = tex;
      this.u.steps.value = steps;
      this.u.disc.value = 1;
    };
  }
}
