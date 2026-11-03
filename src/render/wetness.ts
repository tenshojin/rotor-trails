// 雨天的湿润表面（建筑模型与程序道具共用；地形在 terrainShader.ts 里有自己的一套）：
// 被雨淋湿的表面颜色变深、变光滑（更多地反射天空——开光线追踪时还有屏幕空间反射），
// 朝上的面（屋顶、地面、台阶）湿得最透，竖直的墙面只湿一部分。WET 由 WorldView 每帧按天气的 wetness 设置。

import * as THREE from 'three/webgpu';
import { float, mix, normalWorld, smoothstep, uniform } from 'three/tsl';

/** 湿润程度 0..1（天气的 wetness） */
export const WET = uniform(0);

/** 该处被淋湿的程度：朝上的面 1，竖直墙面约 0.35，朝下的面（檐下）几乎不湿 */
export function wetAmount(): THREE.Node<'float'> {
  return WET.mul(smoothstep(-0.6, 0.75, normalWorld.y).mul(0.65).add(smoothstep(-0.2, 0.2, normalWorld.y).mul(0.35)));
}

/** 湿了的颜色：变深（水膜让漫反射减少） */
export function wetColor(c: THREE.Node<'vec4'>): THREE.Node<'vec4'> {
  return c.mul(mix(float(1), float(0.7), wetAmount()));
}

/** 湿了的粗糙度：趋向 0.12（水膜很光滑） */
export function wetRough(r: THREE.Node<'float'>): THREE.Node<'float'> {
  return mix(r, float(0.12), wetAmount().mul(0.85));
}
