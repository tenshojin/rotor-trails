// 大气雾（WebGPU 节点版，挂在 scene.fogNode 上，所有受雾影响的材质自动使用）：
//   · 雾的颜色随视线方向变化：朝太阳一侧取天空在地平线处更亮更暖的颜色（与天空穹顶一致）；
//   · 雾的浓度随高度衰减（山谷朦胧、高处清晰），按视线两端的平均高度近似；
//   · 进入云层时另加一份不随高度衰减的均匀浓雾。
// 参数是共享的 uniform 节点，由 WorldView 每帧更新。

import * as THREE from 'three/webgpu';
import { cameraPosition, clamp, dot, exp, float, fog, Fn, length, max, mix, positionWorld, pow, select, uniform, vec4 } from 'three/tsl';

/** 旋翼下洗：x、z（桨毂的位置）、贴地的强度、树梢的强度（0..1）。草和树的顶点着色器用它（见 render/downwash.ts） */
export const WASH = uniform(new THREE.Vector4(0, 0, 0, 0));

export const FOG = {
  color: uniform(new THREE.Color(0xb0c0d0)),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  sunDir: uniform(new THREE.Vector3(0, 1, 0)),
  /** 指数平方雾密度（1/米） */
  density: uniform(0.0002),
  /** 高度衰减系数（1/米），0 = 不衰减 */
  heightK: uniform(0),
  /** 雾最浓的基准高度（米，世界坐标） */
  baseY: uniform(0),
  /** 云层里的额外均匀雾密度 */
  cloud: uniform(0),
};

/** 雾的颜色与浓度（vec4：rgb = 颜色，a = 雾的比例），天空与水面等自定义材质也可以直接用。 */
export const fogColorFactor = Fn(() => {
  const v = positionWorld.sub(cameraPosition);
  const dist = length(v);
  const dir = v.div(max(dist, 1e-3));
  const h = cameraPosition.y.add(positionWorld.y).mul(0.5).sub(FOG.baseY);
  const hk = select(FOG.heightK.greaterThan(0), clamp(exp(max(h, 0).negate().mul(FOG.heightK)), 0.16, 1.0), float(1));
  const d = FOG.density.mul(hk);
  const factor = float(1).sub(exp(d.mul(d).add(FOG.cloud.mul(FOG.cloud)).negate().mul(dist).mul(dist)));
  const sunK = pow(max(dot(dir, FOG.sunDir), 0), 6);
  return vec4(mix(FOG.color, FOG.sunColor, sunK), factor);
});

/** 场景雾节点：scene.fogNode = sceneFog() */
export function sceneFog(): THREE.Node {
  const cf = fogColorFactor();
  return fog(cf.rgb, cf.a);
}
