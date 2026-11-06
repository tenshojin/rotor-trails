// 大气雾（WebGPU 节点版，挂在 scene.fogNode 上，所有受雾影响的材质自动使用）：
//   · 雾的颜色就是视线那个方向上地平线的天色（一圈 7 个颜色，由 SkyDome 算好）：
//     远景融进去的正是背后的天，海天之间、山和天之间不会多出一条颜色不同的带子；
//   · 雾的浓度随高度衰减（山谷朦胧、高处清晰），按视线两端的平均高度近似；
//   · 进入云层时另加一份不随高度衰减的均匀浓雾。
// 参数是共享的 uniform 节点，由 WorldView 每帧更新。

import * as THREE from 'three/webgpu';
import { acos, cameraPosition, clamp, dot, exp, float, fog, Fn, length, max, mix, positionWorld, select, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { getNoiseTexture } from './textures';

/** 旋翼下洗：x、z（气柱落到地面的位置）、离地够不够近（0..1）、气流的强度（0..1）。草和树的顶点着色器用它（见 render/downwash.ts） */
export const WASH = uniform(new THREE.Vector4(0, 0, 0, 0));
/** 桨盘的高度：气柱从这里往下冲 */
export const WASH_Y = uniform(0);

/**
 * 风场：树、灌木、草、远处的草地和林冠都看这一份。shift 是风吹过的距离（米），一团团的阵风跟着它走，
 * 所以看得见风从草地这头扫到那头、树一片一片地弯下去。
 */
export const WIND = {
  shift: uniform(new THREE.Vector2()),
  /** 风向（单位向量 x、z） */
  dir: uniform(new THREE.Vector2(1, 0)),
  /** 摆动的幅度：没风的时候也有一点，植物不会是死的 */
  k: uniform(0.16),
};

/** 这一点现在的阵风强度（0..1） */
export function gustAt(p: THREE.Node<'vec2'>): THREE.Node<'float'> {
  const noise = getNoiseTexture();
  const q = p.sub(WIND.shift as unknown as THREE.Node<'vec2'>);
  const a = texture(noise, q.div(1400.0)).level(float(0)).r;
  const b = texture(noise, q.div(430.0).add(0.37)).level(float(0)).r;
  return smoothstep(0.34, 0.66, a.mul(0.55).add(b.mul(0.45)));
}

/** 地平线一圈取几个颜色：第 i 个离太阳方位 180° × (i / (RING_N - 1))²（太阳附近变化快，取得密） */
export const RING_N = 7;

export const FOG = {
  color: uniform(new THREE.Color(0xb0c0d0)),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  /** 太阳的水平方向（单位向量 x、z） */
  sunFlat: uniform(new THREE.Vector2(0, 1)),
  /** 地平线一圈的天色（从太阳方位转到背后） */
  ring: Array.from({ length: RING_N }, () => uniform(new THREE.Color(0xb0c0d0))),
  /** 指数平方雾密度（1/米） */
  density: uniform(0.0002),
  /** 高度衰减系数（1/米），0 = 不衰减 */
  heightK: uniform(0),
  /** 雾最浓的基准高度（米，世界坐标） */
  baseY: uniform(0),
  /** 云层里的额外均匀雾密度 */
  cloud: uniform(0),
  /** 水面碎光的强度（月光比阳光弱，但碎光不能跟着曝光一起放大） */
  glint: uniform(1),
  /** 薄雾的色偏：离得不太远时散射进来的主要是空气分子散射的蓝光，所以远山是蓝的；再远才是地平线的颜色 */
  thin: uniform(new THREE.Color(1, 1, 1)),
};

/** 这个方向上地平线的天色（dir 不必是单位向量）。 */
export function ringColor(dir: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
  const f = vec2(dir.x, dir.z);
  const c = clamp(dot(f.div(max(length(f), 1e-4)), FOG.sunFlat), -1, 1);
  const u = sqrt(acos(c).div(Math.PI)).mul(RING_N - 1);
  let col = FOG.ring[0] as unknown as THREE.Node<'vec3'>;
  for (let i = 1; i < RING_N; i++) col = mix(col, FOG.ring[i] as unknown as THREE.Node<'vec3'>, clamp(u.sub(i - 1), 0, 1));
  return col;
}

/** 雾的颜色与浓度（vec4：rgb = 颜色，a = 雾的比例），天空与水面等自定义材质也可以直接用。 */
export const fogColorFactor = Fn(() => {
  const v = positionWorld.sub(cameraPosition);
  const dist = length(v);
  const dir = v.div(max(dist, 1e-3));
  const h = cameraPosition.y.add(positionWorld.y).mul(0.5).sub(FOG.baseY);
  const hk = select(FOG.heightK.greaterThan(0), clamp(exp(max(h, 0).negate().mul(FOG.heightK)), 0.16, 1.0), float(1));
  const d = FOG.density.mul(hk);
  const factor = float(1).sub(exp(d.mul(d).add(FOG.cloud.mul(FOG.cloud)).negate().mul(dist).mul(dist)));
  return vec4(ringColor(dir).mul(mix(FOG.thin as unknown as THREE.Node<'vec3'>, vec3(1), sqrt(factor))), factor);
});

/** 场景雾节点：scene.fogNode = sceneFog() */
export function sceneFog(): THREE.Node {
  const cf = fogColorFactor();
  return fog(cf.rgb, cf.a);
}
