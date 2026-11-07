// 天空穹顶：物理大气（见 skyModel.ts：瑞利、米氏、臭氧和多次散射的查找表，亮度是真算出来的）
// + 阴天/暴雨/低能见度时向灰色过渡 + 云 + 高亮太阳圆盘（供泛光）+ 闪电。
// 云分两种：高画质用光线步进的体积积云（三维噪声塑形，向太阳方向步进算自阴影，
// Henyey-Greenstein 相函数的逆光银边 + “粉末”效应的暗边）；低、中画质用平面投影的二维云层。
// 同一个材质也渲染进 PMREM 环境贴图，给所有 PBR 材质提供与天气一致的环境光与反射。
// 天空在地平线处的颜色从同一张表里取，作为大气雾的颜色（远山与天空自然衔接），阳光的颜色和强度也是。

import * as THREE from 'three/webgpu';
import { abs, acos, asin, atan, Break, clamp, cross, dot, exp, float, floor, Fn, fract, hash, If, int, interleavedGradientNoise, length, Loop, max, min, mix, normalize, positionLocal, pow, screenCoordinate, screenUV, select, sign, sin, smoothstep, sqrt, step, texture, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { RING_N, ringColor } from './atmosphere';
import { getCloudNoise3D } from './cloudNoise';
import { CloudPass } from './cloudPass';
import type { WeatherParams } from '../sim/weather';
import { SKY_H, SKY_W, SkyModel } from './skyModel';
import { getNoiseTexture } from './textures';

/** 大气顶上的太阳照度（场景单位）：天空的亮度、地面的阳光都按它算，两者的比例才是真的 */
const SUN_E = 4.4;
/** 天空比真实略亮一点（相机里的天空，比肉眼对比弱） */
const SKY_GAIN = 1.8;

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
  /** 云团的尺度（米）：越大云越大、越少 */
  size: uniform(3400),
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
export function cloudDensity(p: THREE.Node<'vec3'>, fineDetail = false): THREE.Node<'float'> {
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
  const hn = clamp(p.y.sub(CLOUD.base).div(span.mul(mix(0.62, 1.0, tall))), 0.0, 1.0);
  // 积云的高度轮廓：底部平整（很快变浓），中段鼓起来，到顶才收成圆的。收得太早一朵云就是压扁的一张饼
  const prof = smoothstep(0.0, 0.07, hn).mul(float(1).sub(smoothstep(0.46, 1.0, hn)));
  // 三维 Perlin-Worley 团块（菜花状）：一大一小两个尺度混合
  const uvw = vec3(q.x, p.y, q.y).div(CLOUD.size);
  const shape = texture3D(noise3, uvw).level(float(0));
  const big = texture3D(noise3, uvw.mul(0.29).add(0.13)).level(float(0));
  const d0 = mix(big.r, shape.r.mul(shape.a.mul(0.35).add(0.65)), 0.62).mul(prof);
  // 阈值：云量 0.3 时约三成天空有云，云量 1 时连成一片
  const th = mix(float(0.74), float(0.1), pow(cov, 1.3));
  const base = clamp(d0.sub(th).div(float(1).sub(th)), 0.0, 1.0);
  // 高频 Worley 侵蚀边缘（越靠云边侵蚀越多），底部的侵蚀更强，显出絮状；再叠一层更细的，云边才有“菜花”的小疙瘩
  const det = texture3D(noise3, uvw.mul(4.3).add(0.21)).level(float(0));
  let ero: THREE.Node<'float'> = mix(det.g, det.b, hn).mul(0.5);
  if (fineDetail) {
    // 细节只在视线方向上算：云边一小团一小团的疙瘩，飞近了云才不是一块糊的。往太阳方向的采样不用（看不出来，却是开销的大头）
    const fine = texture3D(noise3, uvw.mul(13.7).add(0.57)).level(float(0));
    const tiny = texture3D(noise3, uvw.mul(41.0).add(0.31)).level(float(0));
    ero = ero.add(fine.g.mul(0.26)).add(tiny.g.mul(0.12));
  } else ero = ero.add(0.14);
  return clamp(base.mul(1.18).sub(ero.mul(float(1).sub(base.mul(0.8))).mul(0.72)), 0.0, 1.0).mul(1.6);
}

/** 天空着色用的 uniform 节点（CPU 端每帧更新 .value） */
function makeSkyUniforms(sunDir: THREE.Vector3, wind: THREE.Vector2, lut: THREE.Texture) {
  return {
    sunDir: uniform(sunDir),
    /** 烘焙环境贴图时地平线以下用的真实地表：颜色图、地图边长、照到地面的光（已除以 π）、镜头离地高度 */
    land: texture(BLANK),
    landSize: uniform(0),
    landLight: uniform(new THREE.Color()),
    eyeH: uniform(300),
    /** 天空查找表（见 skyModel.ts）、太阳的水平方向 */
    skyLut: texture(lut),
    sunFlat: uniform(new THREE.Vector2(0, 1)),
    /** 晴空天顶的颜色 */
    zenith: uniform(new THREE.Color()),
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
    /** 能见度很低时天空被雾盖住的程度 0..1，以及雾的颜色 */
    skyFog: uniform(0),
    fogCol: uniform(new THREE.Color()),
    flash: uniform(0),
    /** 1 = 画太阳圆盘；烘焙环境贴图时设为 0（阳光高光由方向光负责） */
    disc: uniform(1),
    /** 1 = 叠加 CloudPass 的体积云（主画面）；0 = 不叠加（低、中画质，烘焙环境贴图时用二维云层） */
    useTex: uniform(0),
    /** 高空卷云的浓度 0..1 */
    cirrus: uniform(0.5),
    /** 1 = 夜晚：天空压暗、偏蓝，出现星星；太阳圆盘换成月亮 */
    night: uniform(0),
    /** 这张图的夜里有没有极光（0..1） */
    aurora: uniform(0),
    time: uniform(0),
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

/** 夜空的颜色：白天的天空乘上它 */
const NIGHT_TINT = new THREE.Color(0.021, 0.025, 0.04);

/** 流星：多少秒抽一次、一颗亮多久 */
const METEOR_EVERY = 13;
const METEOR_LIFE = 0.85;

/**
 * 星星：按方向分格抽签，每格最多一颗，亮度和颜色各不相同，暗的多亮的少。
 * 银河是一条斜着的光带：中间亮、两边淡，银心那一段鼓起来，中线有一道弯弯曲曲的尘埃暗缝，带子里的星星也密一些
 */
function starField(d: THREE.Node<'vec3'>, noise: THREE.Texture, t: THREE.Node<'float'>): THREE.Node<'vec3'> {
  return Fn(() => {
    const out = vec3(0).toVar();
    const gal = normalize(vec3(0.42, 0.56, -0.71));
    const b = dot(d, gal);
    // 沿银河走一圈是贴图的整数倍（接缝对得上），横向比例和纵向一样：直接拿方向当坐标会把噪声拉成一道道细线，像天上的划痕
    const along = atan(dot(d, vec3(-0.8607, 0.0, -0.5091)), dot(d, vec3(-0.286, 0.8274, 0.4834))).div(2 * Math.PI).add(0.5);
    // （噪声取模糊过的那一级：这里要的是大片的明暗。原图对比太强，天上是一块块的脏斑）
    const lump = texture(noise, vec2(along.mul(3.0), b.mul(0.7).add(0.5))).level(float(3)).r;
    const wisp = texture(noise, vec2(along.mul(11.0), b.mul(2.6).add(0.3))).level(float(2)).g;
    const toCore = abs(fract(along.add(0.88)).sub(0.5));
    const core = exp(toCore.mul(toCore).mul(-46.0));
    const band = exp(b.mul(b).mul(mix(float(-52.0), float(-17.0), core)));
    const r = b.sub(lump.sub(0.5).mul(0.16)).div(mix(float(0.022), float(0.06), core));
    const rift = exp(r.mul(r).negate()).mul(wisp.mul(0.8).add(0.3));
    const body = band.mul(float(1).sub(min(rift, 1.0).mul(0.82))).mul(lump.mul(0.7).add(0.65)).toVar();
    out.addAssign(mix(vec3(0.4, 0.48, 0.68), vec3(0.74, 0.62, 0.5), core).mul(body.mul(0.03)));
    // 一颗星的半径（一格的几分之几）：比一个像素小就被时间抗锯齿抹没了
    for (const [scale, keep, gain, rad] of [[170, 0.93, 1.0, 0.2], [330, 0.9, 0.5, 0.3], [560, 0.955, 0.34, 0.42]] as Array<[number, number, number, number]>) {
      const p = d.mul(scale);
      const c = floor(p);
      const seed = c.x.mul(12.9898).add(c.y.mul(78.233)).add(c.z.mul(37.719));
      const h1 = hash(seed);
      const h2 = hash(seed.add(1.7));
      const h3 = hash(seed.add(3.1));
      const off = vec3(h2, h3, hash(seed.add(5.3))).mul(0.6).add(0.2);
      const dist = length(fract(p).sub(off));
      // 银河里的星星密得多
      const on = step(float(keep).sub(body.mul(0.3)), h1);
      const mag = pow(h2, 6.0).mul(2.4).add(0.1);
      const spot = float(1).sub(smoothstep(0.02, rad, dist));
      const tw = sin(t.mul(h3.mul(5.0).add(1.5)).add(h1.mul(40.0))).mul(0.16).add(0.84);
      const tint = mix(vec3(1.0, 0.82, 0.68), vec3(0.72, 0.84, 1.0), h3);
      out.addAssign(tint.mul(spot.mul(on).mul(mag).mul(tw).mul(gain)));
    }
    // 流星：十几秒抽一次签，天上随便哪里一闪而过，一条越来越长又淡下去的亮线
    const id = floor(t.div(METEOR_EVERY));
    const age = t.sub(id.mul(METEOR_EVERY)).div(METEOR_LIFE);
    const m1 = hash(id.add(0.13));
    const m2 = hash(id.add(1.71));
    const m3 = hash(id.add(3.37));
    const from = normalize(vec3(m1.sub(0.5), m2.mul(0.45).add(0.3), m3.sub(0.5)));
    const way = normalize(cross(from, vec3(m3.sub(0.5), 0.5, m1.sub(0.5))));
    // （沿大圆走：离这条线多远就是到大圆所在平面的距离）
    const run = dot(d, way);
    const across = abs(dot(d, cross(from, way)));
    const tip = age.mul(0.42);
    const tail = smoothstep(tip.sub(0.26), tip, run).mul(step(run, tip)).mul(step(0.0, dot(d, from)));
    // 头粗尾细（比一个像素细就断成一截一截的）
    const wide = mix(float(0.001), float(0.0042), tail);
    const flash = smoothstep(0.0, 0.12, age).mul(float(1).sub(smoothstep(0.6, 1.0, age))).mul(step(age, 1.0)).mul(step(0.3, m2));
    out.addAssign(vec3(0.9, 0.95, 1.0).mul(float(1).sub(smoothstep(wide.mul(0.25), wide, across)).mul(tail).mul(flash).mul(3.0)));
    return out;
  })();
}

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;

/** 晴空：d 方向的大气颜色（查表，见 skyModel.ts） */
function clearSky(U: SkyU) {
  return Fn(([d]: [THREE.Node<'vec3'>]) => {
    const dd = vec3(d);
    const flat = dd.xz.div(max(length(dd.xz), 1e-4));
    const u = acos(clamp(dot(flat, U.sunFlat), -1, 1)).div(Math.PI);
    const el = asin(clamp(dd.y, -1, 1));
    const v = sign(el).mul(sqrt(abs(el).div(Math.PI / 2))).mul(0.5).add(0.5);
    return U.skyLut.sample(vec2(u, v)).level(float(0)).rgb.mul(SUN_E * SKY_GAIN);
  });
}

/** 天空颜色（线性 HDR，色调映射在后期统一做）。d：视线方向（单位向量）。 */
function skyColorNode(U: SkyU, noise: THREE.Texture, cloudTex: THREE.TextureNode) {
  const clear = clearSky(U);
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
    const col = vec3(clear(dh)).toVar();
    // 阴天：天顶与地平线之间的灰色渐变
    const ov = mix(U.ovHorizon, U.ovZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    col.assign(mix(col, ov, U.overcast));
    // 低能见度：地平线附近被雾霾吞没
    col.assign(mix(col, U.haze, U.hazeK.mul(float(1).sub(smoothstep(0.0, 0.35, h)))));
    // 地平线以下（远景地形之外）：贴着地平线的那一段就是地平线的天色（雾也是这个颜色），再往下才是地面的颜色
    // 烘焙环境贴图（实时的 HDRI）时，下半球就是脚下真实的地表：机身底部、屋檐下映出的是这里的林子、雪地、海面
    const hitDist = U.eyeH.div(max(h.negate(), 0.03));
    const landUv = U.camPos.xz.add(d.xz.mul(hitDist)).div(max(U.landSize, 1.0)).add(0.5);
    const landCol = U.land.sample(landUv).level(float(0)).rgb.mul(U.landLight);
    const useLand = float(1).sub(U.disc).mul(step(1.0, U.landSize)).mul(step(0.0, landUv.x)).mul(step(landUv.x, 1.0)).mul(step(0.0, landUv.y)).mul(step(landUv.y, 1.0));
    col.assign(mix(col, mix(U.ground, landCol, useLand), smoothstep(-0.03, -0.2, h)));
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
    // 夜晚：天空压暗，先压再加星星和月亮
    col.mulAssign(mix(vec3(1.0), vec3(NIGHT_TINT.r, NIGHT_TINT.g, NIGHT_TINT.b), U.night));
    const starK = U.night.mul(smoothstep(0.015, 0.2, h)).mul(float(1).sub(U.overcast)).mul(U.disc);
    col.addAssign(starField(d, noise, U.time).mul(starK));
    If(U.aurora.mul(U.night).greaterThan(0.001), () => {
      col.addAssign(auroraGlow(d, noise, U.time, 20).mul(U.aurora.mul(U.night).mul(0.085)).mul(float(1).sub(U.overcast)).mul(U.disc));
    });
    // 太阳圆盘（高亮，后期泛光会让它自然晕开）+ 宽光晕；月亮小而清楚，表面有深浅
    // （真太阳的半径只有 0.27 度。画大了白天就是天上一个白盘子，亮度够高的话泛光自然会晕开）
    const disc = smoothstep(0.99982, 0.99992, sd);
    const moonFace = texture(noise, d.xz.mul(26.0)).r.mul(0.5).add(0.62);
    const discK = mix(float(38.0), moonFace.mul(11.0), U.night);
    const glowK = mix(float(0.85), float(0.09), U.night);
    const wideK = mix(float(0.05), float(0.018), U.night);
    col.addAssign(U.sunColor.mul(disc.mul(discK).mul(U.disc).add(pow(sd, 1300.0).mul(glowK).mul(U.disc)).add(pow(sd, 160.0).mul(glowK).mul(0.09).mul(U.disc)).add(pow(sd, 24.0).mul(wideK))).mul(U.sunVis));
    // 高空卷云：万米高空的冰晶云，一缕一缕顺着高空风拉长，薄到能透出蓝天，在积云之上给天空添一层纵深
    const ciuv = d.xz.div(hh.add(0.08));
    const ci0 = fbm(vec2(ciuv.x.mul(0.05).add(ciuv.y.mul(0.02)), ciuv.y.mul(0.16).sub(ciuv.x.mul(0.05))).add(U.wind.mul(0.4)));
    const ci1 = texture(noise, ciuv.mul(0.31).add(vec2(ci0.mul(0.2), 0.1))).r;
    const ciA = smoothstep(0.5, 0.78, ci0.mul(0.7).add(ci1.mul(0.3))).mul(smoothstep(0.03, 0.3, h)).mul(U.cirrus).mul(0.42).mul(float(1).sub(U.overcast)).mul(step(0.5, U.steps));
    // （月光下的卷云只是天上淡淡的一层，亮了就是一道道划痕）
    col.assign(mix(col, U.sunColor.mul(U.sunVis.mul(0.85).add(0.1)).add(col.mul(0.25)), ciA.mul(mix(float(1), float(0.025), U.night))));
    // 体积云盖在天空与太阳之上（rgb = 散射光，a = 透过率）
    const cl = cloudTex.sample(screenUV);
    col.assign(mix(col, col.mul(cl.a).add(cl.rgb), U.useTex));
    // 能见度很低时什么都看不见：天空就是雾的颜色，看不到云，也没有海天线
    col.assign(mix(col, U.fogCol, U.skyFog));
    col.addAssign(vec3(0.55, 0.6, 0.75).mul(U.flash));
    return col;
  })();
}

/**
 * 极光：东西向的光帘，都在北边的天上（-z）。把视线投影到一层层高度上，每一层取同一条弯弯曲曲的带子，
 * 层层叠起来就是竖着的帘子；底边亮绿，往上变成紫红。光柱只跟着帘子的走向变，不随高度变，所以是竖着的一道道。
 * layers：天空用得多，水里的倒影被波浪抹开了，几层就够。
 */
function auroraGlow(d: THREE.Node<'vec3'>, noise: THREE.Texture, t: THREE.Node<'float'>, layers: number): THREE.Node<'vec3'> {
  return Fn(() => {
    const out = vec3(0).toVar();
    const base = d.xz.div(max(d.y, 0.0).add(0.2)).toVar();
    Loop(layers, ({ i }: { i: THREE.Node<'int'> }) => {
      const f = float(i).add(0.5).div(layers);
      const q = base.mul(float(1).sub(f.mul(0.42)));
      const bend = texture(noise, q.mul(0.035).add(vec2(t.mul(0.0011), t.mul(-0.0007)))).level(float(0)).r;
      const bend2 = texture(noise, q.mul(0.11).add(vec2(t.mul(-0.002), 0.31))).level(float(0)).g;
      const y = q.y.add(bend.sub(0.5).mul(5.2)).add(bend2.sub(0.5).mul(1.1));
      const r1 = y.add(1.7).div(0.14);
      const r2 = y.add(3.4).div(0.24);
      const ribbon = exp(r1.mul(r1).negate()).add(exp(r2.mul(r2).negate()).mul(0.6));
      const rays = texture(noise, vec2(base.x.mul(0.22).add(bend.mul(0.6)).add(t.mul(0.004)), 0.37)).level(float(0)).g;
      const fine = pow(smoothstep(0.34, 0.72, rays), 1.6).mul(0.9).add(0.1);
      const fall = pow(float(1).sub(f), 1.7).mul(smoothstep(0.0, 0.06, f));
      out.addAssign(mix(vec3(0.1, 0.95, 0.38), vec3(0.62, 0.12, 0.62), smoothstep(0.35, 0.95, f)).mul(ribbon.mul(fine).mul(fall)));
    });
    return out.mul(2.4 / layers).mul(smoothstep(0.03, 0.2, d.y));
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
      // （月光下的云比天亮不了太多：亮成白棉花就像贴上去的）
      const sunC = mix(sunCol, vec3(dot(sunCol, vec3(0.3, 0.55, 0.15))), U.cloudWhite).mul(U.sunVis).mul(mix(float(1.5), float(0.8), U.night));
      Loop({ start: int(0), end: int(U.steps), type: 'int', condition: '<' }, ({ i }: { i: THREE.Node<'int'> }) => {
        // 步长按 s^0.7 增长：近处细、远处粗
        const s = float(i).add(jit).div(U.steps);
        const t = t0.add(len.mul(pow(s, 1.7)));
        const dt = len.mul(1.7).mul(pow(s, 0.7)).div(U.steps).add(1.0);
        const p = U.camPos.add(d.mul(t));
        const den = density(p, true).toVar();
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
          // 云底朝下，看到的是地面不是天：比云顶暗得多。一朵云才有底，才是立着的
          const amb0 = mix(U.ambBottom as unknown as THREE.Node<'vec3'>, U.ambTop as unknown as THREE.Node<'vec3'>, smoothstep(0.0, 0.5, hn)).mul(mix(float(0.3), float(0.62), smoothstep(0.0, 0.3, hn)));
          const amb = mix(amb0, vec3(dot(amb0, vec3(0.3, 0.55, 0.15))), 0.45);
          // 阴天时云层就是天空：亮度要和灰色的天顶、地平线一致，否则厚云会把整个世界（和环境贴图）压成一片黑
          const nightK = mix(vec3(1.0), vec3(NIGHT_TINT.r, NIGHT_TINT.g, NIGHT_TINT.b), U.night);
          const ovc = mix(U.ovHorizon as unknown as THREE.Node<'vec3'>, U.ovZenith as unknown as THREE.Node<'vec3'>, hn).mul(U.overcast.mul(1.05)).mul(nightK);
          const S = sunC.mul(tSun.mul(phase).mul(mix(float(1), powder, 0.5)).add(tMs.mul(0.22))).add(amb).add(ovc);
          const a = exp(den.mul(-SIGMA).mul(dt));
          acc.addAssign(S.mul(trans).mul(float(1).sub(a)));
          trans.mulAssign(a);
        });
        If(trans.lessThan(0.02), () => {
          Break();
        });
      });
      // 远处的云融进地平线的天色里；视线贴近地平线时淡出（大气透视）。
      // 一定要用这个方向上地平线的颜色：换成固定的灰白色，黄昏时海天线上方就是一条发白的带子
      const far = float(1).sub(exp(t0.div(-20000.0)));
      const horizon = smoothstep(-0.02, 0.1, abs(d.y));
      const keep = float(1).sub(far).mul(horizon);
      const o = float(1).sub(trans).toVar();
      acc.assign(mix(ringColor(d).mul(o), acc, keep));
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
  /** 地平线一圈的天色（从太阳方位转到背后，见 atmosphere.ts） */
  ring: THREE.Color[];
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
}

const c = (hex: number) => new THREE.Color().setHex(hex);
const _warm = new THREE.Color();
const _dusk = new THREE.Color(0x6a5a72);
const _moonHaze = new THREE.Color(0.05, 0.07, 0.12);
const _ringDir = new THREE.Vector3();

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
  private readonly model = new SkyModel();
  private readonly lutData = new Uint16Array(SKY_W * SKY_H * 4);
  private readonly lut = new THREE.DataTexture(this.lutData, SKY_W, SKY_H, THREE.RGBAFormat, THREE.HalfFloatType);
  /** 这张图的大气：气溶胶多少（1 = 很干净）、地面反照率 */
  private air = { haze: 1.6, albedo: [0.15, 0.15, 0.15] as [number, number, number] };
  /** 太阳高度带来的“白天程度”：0 = 贴着地平线，1 = 高于约 25°（清晨、黄昏时天空、阳光、环境光都更暗） */
  dayK = 1;
  /** 1 = 夜晚 */
  night = 0;
  /** 晴空的天顶/地平线/朝阳地平线颜色与阳光透射（只与太阳位置、浑浊度有关，加载时算一次） */
  private clear = { zenith: new THREE.Color(), horizon: new THREE.Color(), horizonSun: new THREE.Color(), sunTint: new THREE.Color(), sunGain: 1 };
  private readonly clearRing = Array.from({ length: RING_N }, () => new THREE.Color());
  /** 地平线一圈每个方向和太阳方向的余弦 */
  private readonly ringSun: number[] = new Array(RING_N).fill(0);
  /** 太阳的水平方向（x、z） */
  readonly sunFlat = new THREE.Vector2(0, 1);

  constructor(sunAzimuthDeg: number, sunElevationDeg: number, fogTint: number, groundTint: number, night = false, haze = 1.6) {
    this.fogTint = c(fogTint);
    this.groundTint = c(groundTint);
    // （地面反上来的光给天空带的颜色很淡，直接用地表的绿色，地平线会发绿）
    const grey = Math.min(0.3, (this.groundTint.r + this.groundTint.g + this.groundTint.b) / 3);
    this.air = { haze, albedo: [grey, grey, grey] };
    this.lut.name = 'SkyView';
    this.lut.magFilter = THREE.LinearFilter;
    this.lut.minFilter = THREE.LinearFilter;
    this.lut.generateMipmaps = false;
    this.lut.wrapS = this.lut.wrapT = THREE.ClampToEdgeWrapping;
    this.setSun(sunAzimuthDeg, sunElevationDeg);
    this.u = makeSkyUniforms(this.sunDir, this.windOffset, this.lut);
    this.u.sunFlat.value = this.sunFlat;
    this.setNight(night);
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
      ring: Array.from({ length: RING_N }, () => new THREE.Color()),
      sun: new THREE.Color(),
      sunIntensity: 3,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 0.6,
    };
  }

  /** 是否夜晚（太阳换成月亮）：setSun 之后调用 */
  setNight(on: boolean): void {
    this.night = on ? 1 : 0;
    this.u.night.value = this.night;
  }

  /** 太阳方位角 / 高度角（度）：换时段（清晨、黄昏）时调用，重新计算大气参数（sunDir 是同一个对象，着色器自动跟随） */
  setSun(azDeg: number, elDeg: number): void {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.dayK = Math.max(0, Math.min(1, (elDeg - 1.5) / 23.5));
    this.setAtmosphere();
  }

  /** 按太阳位置重算大气（查找表、地平线一圈的颜色、阳光的颜色） */
  private setAtmosphere(): void {
    const m = this.model;
    m.update(this.sunDir.y, { haze: this.air.haze, albedo: this.air.albedo, altitude: 0.4 });
    for (let i = 0; i < this.lutData.length; i++) this.lutData[i] = THREE.DataUtils.toHalfFloat(m.sky[i]);
    this.lut.needsUpdate = true;
    const fl = Math.hypot(this.sunDir.x, this.sunDir.z) || 1;
    const fx = this.sunDir.x / fl;
    const fz = this.sunDir.z / fl;
    this.sunFlat.set(fx, fz);
    const side = new THREE.Vector3(-this.sunDir.z, 0.06, this.sunDir.x).normalize();
    const sunward = new THREE.Vector3(this.sunDir.x, 0.03, this.sunDir.z).normalize();
    this.radiance(new THREE.Vector3(0, 1, 0), this.clear.zenith);
    this.radiance(side, this.clear.horizon);
    this.radiance(sunward, this.clear.horizonSun);
    // 地平线一圈（高度 0，和穹顶在地平线处算出来的一样）
    for (let i = 0; i < RING_N; i++) {
      const g = Math.PI * (i / (RING_N - 1)) ** 2;
      _ringDir.set(fx * Math.cos(g) - fz * Math.sin(g), 0, fz * Math.cos(g) + fx * Math.sin(g));
      this.radiance(_ringDir, this.clearRing[i]);
      this.ringSun[i] = Math.max(0, _ringDir.dot(this.sunDir));
    }
    // 阳光：太阳方向的大气透过率。只算三个波长的话红得太过（真实的光谱是连续的），往亮度收一点
    const t = m.sunTransmittance([0, 0, 0]);
    const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
    const k = 0.74;
    const r = l + (t[0] - l) * k;
    const g = l + (t[1] - l) * k;
    const bl = l + (t[2] - l) * k;
    const top = Math.max(r, g, bl, 1e-4);
    this.clear.sunTint.setRGB(r / top, g / top, bl / top);
    this.clear.sunGain = top;
  }

  /** 查表（和着色器的取法一样），返回线性颜色 */
  private radiance(d: THREE.Vector3, out: THREE.Color): THREE.Color {
    const fl = Math.hypot(d.x, d.z);
    const ca = fl > 1e-4 ? (d.x * this.sunFlat.x + d.z * this.sunFlat.y) / fl : 1;
    const o = this.model.radiance(Math.acos(Math.max(-1, Math.min(1, ca))), Math.asin(Math.max(-1, Math.min(1, d.y))), [0, 0, 0]);
    return out.setRGB(o[0] * SUN_E * SKY_GAIN, o[1] * SUN_E * SKY_GAIN, o[2] * SUN_E * SKY_GAIN);
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
    // （太阳低的时候霾也暗下去、带上天色，不能一直是白天的灰白色）
    const haze = c(0xc9cfd4).lerp(this.fogTint, 0.35).multiplyScalar(0.62).lerp(this.clear.horizon, 1 - this.dayK).lerp(ovHor, oc);
    C.zenith.copy(this.clear.zenith).lerp(ovZen, oc);
    C.horizon.copy(this.clear.horizon).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.fog.copy(C.horizon);
    C.fogSun.copy(this.clear.horizonSun).lerp(ovHor, oc).lerp(haze, fogK * 0.8);
    C.ground.copy(this.groundTint).multiplyScalar(0.55).lerp(C.horizon, 0.55);
    const sunVis = Math.max(0, 1 - oc * 0.92) * (1 - fogK * 0.55);
    C.sun.copy(this.clear.sunTint);
    // 太阳越低，穿过的大气越厚：直射光变弱、变红（都来自大气透过率）
    C.sunIntensity = SUN_E * this.clear.sunGain * (0.12 + 0.88 * sunVis);
    C.hemiSky.copy(C.zenith).lerp(C.horizon, 0.5);
    C.hemiGround.copy(this.groundTint).multiplyScalar(0.6);
    C.hemiIntensity = (0.5 + 0.6 * oc) * (0.45 + 0.55 * this.dayK) + flash * 2.5;
    // 地平线一圈：和穹顶的做法一样（阴天换成灰色，有霾时盖上霾，再加太阳周围的光晕）
    const hazeK = fogK * 0.85;
    const skyFog = Math.min(0.97, Math.max(0, (1500 - w.visibility) / 900));
    for (let i = 0; i < RING_N; i++) {
      const k = C.ring[i].copy(this.clearRing[i]).lerp(ovHor, oc).lerp(haze, hazeK);
      const glow = this.ringSun[i] ** 24 * 0.12 * sunVis;
      k.r += C.sun.r * glow;
      k.g += C.sun.g * glow;
      k.b += C.sun.b * glow;
    }
    if (this.night) {
      // 夜晚：所有天光压到月夜的亮度；月光本身比太阳弱得多，略偏蓝
      for (const k of [C.zenith, C.horizon, C.fog, C.fogSun, C.ground, C.hemiSky, C.hemiGround, ...C.ring]) k.multiply(NIGHT_TINT);
      C.fogSun.lerp(_moonHaze, 0.5 * sunVis);
      for (let i = 0; i < RING_N; i++) C.ring[i].lerp(_moonHaze, 0.5 * sunVis * this.ringSun[i] ** 6);
      C.sun.setRGB(0.66, 0.76, 1.0);
      C.sunIntensity = 0.62 * (0.1 + 0.9 * sunVis);
    }
    for (const k of C.ring) k.lerp(C.fog, skyFog);
    // 闪电把雨雾一起照亮：只亮天的话，夜里地平线上是一道硬边，下面一片黑
    // （夜里人眼的曝光开得大，加同样多就白成一片）
    if (flash > 0) {
      const lit = flash * (this.night ? 0.12 : 0.26);
      for (const k of [C.fog, C.fogSun, C.horizon, ...C.ring]) {
        k.r += 0.88 * lit;
        k.g += 0.96 * lit;
        k.b += 1.2 * lit;
      }
    }
    const u = this.u;
    u.zenith.value.copy(this.clear.zenith);
    u.ovZenith.value.copy(ovZen);
    u.ovHorizon.value.copy(ovHor);
    u.overcast.value = oc;
    u.haze.value.copy(haze);
    u.skyFog.value = skyFog;
    u.fogCol.value.copy(C.fog);
    u.hazeK.value = hazeK;
    u.ground.value.copy(C.ground);
    u.sunColor.value.copy(C.sun);
    // 云和天空里的光按“太阳的亮度”写的：月光要弱得多
    if (this.night) u.sunColor.value.multiplyScalar(0.13);
    u.sunVis.value = sunVis;
    u.cloudLit.value.copy(c(0xf6f7f9)).lerp(c(0x9aa0a8), oc).lerp(c(0x585e66), storm);
    u.cloudDark.value.copy(c(0xa3abb7)).lerp(c(0x6c727a), oc).lerp(c(0x30353c), storm);
    if (this.night) {
      u.cloudLit.value.multiply(NIGHT_TINT).multiplyScalar(2.4);
      u.cloudDark.value.multiply(NIGHT_TINT);
    }
    u.time.value += dt;
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
    if (steps !== this.u.steps.value) this.clouds.reset();
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

  /**
   * 水面倒影看到的天空：方向 d 上的大气颜色，再盖上 uv 处的体积云（uv：这个方向在屏幕上的位置）。
   * 不用画面里的颜色：座舱立柱、山挡住的方向一样有天，画面外的方向也一样有。
   * cloudK：体积云的权重（方向在画面外时为 0，云只算到画面边上）。
   */
  reflectedSky(d: THREE.Node<'vec3'>, uvs: Array<THREE.Node<'vec2'>>, cloudK: THREE.Node<'float'>): THREE.Node<'vec3'> {
    const U = this.u;
    const tex = this.clouds.tex;
    return Fn(() => {
      const h = d.y;
      // 水面着色器的贴图数已经到了上限（每个阶段 16 张）：这里不查天空表，用地平线一圈的颜色和天顶的颜色插出来。
      // 倒影里的天本来就被波浪抹开了，看不出区别
      const col = mix(ringColor(d), U.zenith, pow(clamp(h, 0.0, 1.0), 0.42)).toVar();
      col.assign(mix(col, mix(U.ovHorizon, U.ovZenith, pow(clamp(h, 0.0, 1.0), 0.5)), U.overcast));
      col.assign(mix(col, U.haze, U.hazeK.mul(float(1).sub(smoothstep(0.0, 0.35, h)))));
      const sd = max(dot(d, U.sunDir), 0.0);
      col.mulAssign(mix(vec3(1.0), vec3(NIGHT_TINT.r, NIGHT_TINT.g, NIGHT_TINT.b), U.night));
      col.addAssign(U.sunColor.mul(pow(sd, 24.0).mul(mix(float(0.12), float(0.05), U.night))).mul(U.sunVis));
      If(U.aurora.mul(U.night).greaterThan(0.001), () => {
        col.addAssign(auroraGlow(d, getNoiseTexture(), U.time, 6).mul(U.aurora.mul(U.night).mul(0.07)).mul(float(1).sub(U.overcast)));
      });
      // 几个采样点的平均：波浪把云的倒影上下拉开
      const acc = vec4(0).toVar();
      for (const q of uvs) acc.addAssign(tex.sample(q));
      const cl = acc.mul(1 / uvs.length);
      col.assign(mix(col, col.mul(cl.a).add(cl.rgb), U.useTex.mul(cloudK)));
      col.assign(mix(col, U.fogCol, U.skyFog));
      return col;
    })();
  }

  /** 这张图夜里的极光有多强 */
  setAurora(k: number): void {
    this.u.aurora.value = k;
  }

  /** 地面的颜色图（烘焙环境贴图时当下半球） */
  setLand(color: THREE.Texture, size: number): void {
    this.u.land.value = color;
    this.u.landSize.value = size;
  }

  /** 烘焙环境贴图时：CloudPass 的纹理是屏幕空间的，这里改用二维云层；返回的函数用来恢复 */
  beginEnvBake(eyeH = 300): () => void {
    const C = this.colors;
    this.u.eyeH.value = Math.max(40, eyeH);
    // 平地接到的光：阳光 + 天光
    const k = (C.sunIntensity * Math.max(0, this.sunDir.y)) / Math.PI;
    this.u.landLight.value.setRGB(C.sun.r * k + C.zenith.r * 0.8, C.sun.g * k + C.zenith.g * 0.8, C.sun.b * k + C.zenith.b * 0.8);
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
