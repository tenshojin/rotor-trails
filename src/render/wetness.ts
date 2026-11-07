// 雨天的湿润表面（建筑模型与程序道具共用；地形在 terrainShader.ts 里有自己的一套）：
// 被雨淋湿的表面颜色变深、变光滑（更多地反射天空——开光线追踪时还有屏幕空间反射），
// 朝上的面（屋顶、地面、台阶）湿得最透，竖直的墙面只湿一部分。WET 由 WorldView 每帧按天气的 wetness 设置。

import * as THREE from 'three/webgpu';
import { float, floor, hash, mix, normalWorld, positionWorld, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';

/** 湿润程度 0..1（天气的 wetness） */
export const WET = uniform(0);

/** 地上积了多少雪 0..1：下雪的时候慢慢涨，停了慢慢化（WorldView 每帧设）。地形、树、草、房子共用 */
export const COVER = uniform(0);

/** 积雪的颜色（线性） */
export const SNOW_RGB = vec3(0.86, 0.88, 0.92);

/** 窗灯亮度 0..1：黄昏全开，清晨和阴雨天亮一部分，白天关 */
export const WINDOW_LIGHT = uniform(0);

/**
 * 窗灯：一块块地亮（按世界坐标约 2.6 米一格抽签，大约一半的窗户亮着），暖色。
 * k：这里是不是窗玻璃（0..1）
 */
export function windowGlow(k: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const c = floor(positionWorld.div(2.6));
  const lit = step(0.46, hash(c.x.mul(17.0).add(c.y.mul(5.0)).add(c.z.mul(31.0))));
  const warm = hash(c.x.mul(3.0).add(c.z.mul(11.0)).add(c.y.mul(7.0))).mul(0.5).add(0.75);
  return vec3(1.0, 0.68, 0.36).mul(k.mul(lit).mul(warm).mul(WINDOW_LIGHT).mul(3.4));
}

/** 该处被淋湿的程度：朝上的面 1，竖直墙面约 0.35，朝下的面（檐下）几乎不湿 */
export function wetAmount(): THREE.Node<'float'> {
  return WET.mul(smoothstep(-0.6, 0.75, normalWorld.y).mul(0.65).add(smoothstep(-0.2, 0.2, normalWorld.y).mul(0.35)));
}

/** 积雪的量：朝上的面全白，陡的屋顶挂不住，墙上没有 */
export function coverAmount(): THREE.Node<'float'> {
  return COVER.mul(smoothstep(0.42, 0.78, normalWorld.y));
}

/** 湿了的颜色：变深（水膜让漫反射减少）；积了雪就是白的 */
export function wetColor(c: THREE.Node<'vec4'>): THREE.Node<'vec4'> {
  const wet = c.mul(mix(float(1), float(0.7), wetAmount()));
  return vec4(mix(wet.rgb, SNOW_RGB, coverAmount()), wet.a);
}

/** 湿了的粗糙度：趋向 0.12（水膜很光滑） */
export function wetRough(r: THREE.Node<'float'>): THREE.Node<'float'> {
  return mix(mix(r, float(0.12), wetAmount().mul(0.85)), float(0.78), coverAmount());
}
