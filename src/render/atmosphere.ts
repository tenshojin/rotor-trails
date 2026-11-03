// 大气雾：替换 three.js 的雾着色片段——
//   · 雾的颜色随视线方向变化：朝太阳一侧取天空在地平线处更亮更暖的颜色（与天空穹顶一致）；
//   · 雾的浓度随高度衰减（山谷朦胧、高处清晰），按视线两端的平均高度近似；
//   · 进入云层时另加一份不随高度衰减的均匀浓雾。
// 额外的雾参数通过共享 uniform 注入（SunShadows.setupMaterial 的着色器钩子里调用 injectFog）。
// 没有注入的材质（精灵等）这些参数为 0，表现为普通的指数平方雾。

import * as THREE from 'three';

export const FOG = {
  fogSunColor: { value: new THREE.Color(1, 1, 1) },
  fogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** 高度衰减系数（1/米），0 = 不衰减 */
  fogHeightK: { value: 0 },
  /** 雾最浓的基准高度（米，世界坐标） */
  fogBaseY: { value: 0 },
  /** 云层里的额外均匀雾密度 */
  fogCloud: { value: 0 },
};

let installed = false;

export function installFogChunks(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWPos;
#endif`;
  // 世界坐标由视空间位置反推（精灵、点等没有 transformed 变量，也能用）
  C.fog_vertex = /* glsl */ `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWPos;
  uniform vec3 fogSunColor;
  uniform vec3 fogSunDir;
  uniform float fogHeightK;
  uniform float fogBaseY;
  uniform float fogCloud;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `#ifdef USE_FOG
  vec3 fogV = vFogWPos - cameraPosition;
  float fogDist = length(fogV);
  vec3 fogDir = fogV / max(fogDist, 1e-3);
  #ifdef FOG_EXP2
    float fogH = 0.5 * (cameraPosition.y + vFogWPos.y) - fogBaseY;
    float fogHk = fogHeightK > 0.0 ? clamp(exp(-max(fogH, 0.0) * fogHeightK), 0.16, 1.0) : 1.0;
    float fogD = fogDensity * fogHk;
    float fogFactor = 1.0 - exp(-(fogD * fogD + fogCloud * fogCloud) * fogDist * fogDist);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float fogSunK = pow(max(dot(fogDir, fogSunDir), 0.0), 6.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, fogSunColor, fogSunK), fogFactor);
#endif`;
}

/** 在材质的 onBeforeCompile 里调用：注入共享的雾参数 */
export function injectFog(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, FOG);
}
