// 地形着色器：按坡度/高度/掩码混合 8 层地表（草地、草地 2、林地、沙/河岸、泥土、岩石、岩石 2、积雪）。
// 有照片材质（TERRAIN_PHOTO）时：平地用俯视投影（近处 + 旋转后的大尺度两次采样，打破重复），
// 峭壁用三平面投影（whiteout 法线混合）；照片保留明暗细节，色相向地图原有配色靠拢。
// 没有照片材质时退回程序化配色（与旧版一致）。

import type * as THREE from 'three';

export type TerrainUniforms = Record<string, THREE.IUniform>;

const VERT_COMMON = /* glsl */ `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;`;

const VERT_WORLDPOS = /* glsl */ `#include <worldpos_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);`;

const FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uNoise;
uniform sampler2D uSurface;
uniform sampler2D uForest;
uniform float uMapSize;
uniform vec3 uSand, uGrass, uGrass2, uDirt, uRock, uRock2, uSnow, uForestFloor;
uniform vec3 uStrataA, uStrataB, uStrataC, uStrataD;
uniform float uStrata, uBeachTop, uSnowLine, uRockSlope, uWet, uWaterLevel;
float tRough = 0.95;
float tBump = 0.0;
vec3 gTN = vec3(0.0, 1.0, 0.0);
const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
#ifdef TERRAIN_PHOTO
uniform highp sampler2DArray uTerC;
uniform highp sampler2DArray uTerN;
uniform float uTile[8];
uniform float uMeanL[8];
uniform vec3 uBiomeC[8];
uniform float uTintK[8];
vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
vec3 unpackN(vec4 v) {
  vec3 n;
  n.xy = v.rg * 2.0 - 1.0;
  n.y = -n.y; // 纹理数组未做上下翻转（图像第一行在 v=0），OpenGL 法线的绿通道要取反
  n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
  return n;
}
// 照片保留明暗细节，色相向地图配色靠拢
vec3 tintL(int L, vec3 c) {
  vec3 target = uBiomeC[L] * (dot(c, LUMW) / uMeanL[L]);
  return mix(c, target, uTintK[L]);
}
// 俯视投影：近处一个尺度 + 远处旋转后的大尺度
void sampleFlat(int L, float w, vec2 xz, float far, inout vec3 col, inout vec3 off, inout float rgh) {
  float t = uTile[L];
  vec2 uv1 = xz / t;
  vec2 uv2 = rot2(xz, 0.83) / (t * 6.3) + 0.37;
  float k = 0.22 + 0.62 * far;
  vec4 c = mix(texture(uTerC, vec3(uv1, float(L))), texture(uTerC, vec3(uv2, float(L))), k);
  vec4 nn = mix(texture(uTerN, vec3(uv1, float(L))), texture(uTerN, vec3(uv2, float(L))), k);
  vec3 tn = unpackN(nn);
  col += tintL(L, c.rgb) * w;
  off += vec3(tn.x, 0.0, tn.y) * w;
  rgh += nn.b * w;
}
// 三平面投影的一个尺度：只采样权重明显的投影方向（多数像素只有一两个方向起作用）
void triOnce(int L, float t, vec3 p, vec3 ng, vec3 bw, out vec3 c, out vec3 N, out float r) {
  c = vec3(0.0);
  vec3 tx = vec3(0.0), ty = vec3(0.0), tz = vec3(0.0);
  r = 0.0;
  if (bw.x > 0.03) {
    vec3 l = vec3(p.zy / t, float(L));
    vec4 n4 = texture(uTerN, l);
    c += texture(uTerC, l).rgb * bw.x;
    tx = unpackN(n4);
    tx = vec3(tx.xy + ng.zy, abs(tx.z) * ng.x);
    r += n4.b * bw.x;
  }
  if (bw.y > 0.03) {
    vec3 l = vec3(p.xz / t, float(L));
    vec4 n4 = texture(uTerN, l);
    c += texture(uTerC, l).rgb * bw.y;
    ty = unpackN(n4);
    ty = vec3(ty.xy + ng.xz, abs(ty.z) * ng.y);
    r += n4.b * bw.y;
  }
  if (bw.z > 0.03) {
    vec3 l = vec3(p.xy / t, float(L));
    vec4 n4 = texture(uTerN, l);
    c += texture(uTerC, l).rgb * bw.z;
    tz = unpackN(n4);
    tz = vec3(tz.xy + ng.xy, abs(tz.z) * ng.z);
    r += n4.b * bw.z;
  }
  float s = (bw.x > 0.03 ? bw.x : 0.0) + (bw.y > 0.03 ? bw.y : 0.0) + (bw.z > 0.03 ? bw.z : 0.0);
  c /= max(s, 1e-3);
  r /= max(s, 1e-3);
  N = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz.xyz * bw.z + ng * 1e-3);
}
// 三平面投影（陡坡/峭壁）：近处尺度 + 远处 5.7 倍大尺度，按距离混合（尺度固定，移动时纹理不会“游动”）
void sampleTri(int L, float w, vec3 p, vec3 ng, vec3 bw, float far, inout vec3 col, inout vec3 off, inout float rgh) {
  float t = uTile[L];
  float k = 0.2 + 0.65 * far;
  vec3 c1 = vec3(0.0), N1 = ng, c2 = vec3(0.0), N2 = ng;
  float r1 = 0.0, r2 = 0.0;
  if (k < 0.99) triOnce(L, t, p, ng, bw, c1, N1, r1);
  if (k > 0.01) triOnce(L, t * 5.7, p + 31.7, ng, bw, c2, N2, r2);
  vec3 c = mix(c1, c2, k);
  vec3 N = normalize(mix(N1, N2, k));
  col += tintL(L, c) * w;
  off += (N - ng) * w;
  rgh += mix(r1, r2, k) * w;
}
#endif
// 三平面投影权重（陡坡/峭壁上不会出现纹理拉伸成竖条的“雪花”）
vec3 triW() {
  vec3 a = pow(abs(normalize(vWNrm)), vec3(4.0));
  return a / (a.x + a.y + a.z);
}
float triG(vec3 w, float s, float o) {
  return texture2D(uNoise, vWPos.zy * s + o).g * w.x + texture2D(uNoise, vWPos.xz * s + o).g * w.y + texture2D(uNoise, vWPos.xy * s + o).g * w.z;
}
float triR(vec3 w, float s, float o) {
  return texture2D(uNoise, vWPos.zy * s + o).r * w.x + texture2D(uNoise, vWPos.xz * s + o).r * w.y + texture2D(uNoise, vWPos.xy * s + o).r * w.z;
}
vec3 strataColor(float y) {
  float t = fract(y / 46.0);
  float b = fract(y / 11.0);
  vec3 c = mix(uStrataA, uStrataB, smoothstep(0.15, 0.35, t));
  c = mix(c, uStrataC, smoothstep(0.45, 0.6, t));
  c = mix(c, uStrataD, smoothstep(0.75, 0.9, t));
  return c * (0.88 + 0.24 * b);
}
vec3 terrainAlbedo() {
  vec3 n = normalize(vWNrm);
  float slope = 1.0 - n.y;
  float h = vWPos.y;
  vec2 muv = vWPos.xz / uMapSize + 0.5;
  vec4 surf = texture2D(uSurface, muv);
  float forest = texture2D(uForest, muv).r;
  float n1 = texture2D(uNoise, vWPos.xz * 0.0021).r;
  vec3 tw = triW();
  float n2 = triG(tw, 0.019, 0.0);
  float n3 = triG(tw, 0.045, 0.37);
  // 各层权重：草地 → 林地 → 沙 → 泥土 → 岩石 → 积雪，逐层覆盖
  float g2 = smoothstep(0.35, 0.65, n1);
  float fo = clamp(forest * 1.3, 0.0, 0.85);
  float sandW = 1.0 - smoothstep(uBeachTop - 0.5, uBeachTop + 2.0, h + (n2 - 0.5) * 2.5);
  sandW = max(sandW, surf.r);
  float dirtW = surf.g * 0.9;
  float rk = triR(tw, 0.006, 0.0) * 0.65 + triG(tw, 0.028, 0.0) * 0.35;
  float r2 = smoothstep(0.32, 0.68, rk);
  float rockW = smoothstep(uRockSlope - 0.07, uRockSlope + 0.06, slope + (n1 - 0.5) * 0.14);
  float snowW = smoothstep(uSnowLine - 50.0, uSnowLine + 30.0, h + (n1 - 0.5) * 90.0) * (1.0 - smoothstep(0.42, 0.62, slope));
  snowW = max(snowW, surf.a * (1.0 - smoothstep(0.55, 0.8, slope)));
  vec3 c;
#ifdef TERRAIN_PHOTO
  float W[8];
  W[0] = (1.0 - g2) * (1.0 - fo);
  W[1] = g2 * (1.0 - fo);
  W[2] = fo;
  for (int i = 0; i < 3; i++) W[i] *= 1.0 - sandW;
  W[3] = sandW;
  for (int i = 0; i < 4; i++) W[i] *= 1.0 - dirtW;
  W[4] = dirtW;
  for (int i = 0; i < 5; i++) W[i] *= 1.0 - rockW;
  W[5] = rockW * (1.0 - r2);
  W[6] = rockW * r2;
  float dist = length(vWPos - cameraPosition);
  float far = smoothstep(40.0, 420.0, dist);
  vec3 col = vec3(0.0);
  vec3 off = vec3(0.0);
  float rg = 0.0;
  float ws = 0.0;
  // 坡度较大时逐渐改用三平面投影（俯视投影在陡坡上会被拉成竖条），过渡带两种都采样后混合
  float triK = smoothstep(0.2, 0.36, slope);
  // 先混合积雪以外的 7 层
  for (int L = 0; L < 7; L++) {
    float w = W[L];
    if (w < 0.015) continue;
    ws += w;
    if (L == 5 || L == 6) {
      sampleTri(L, w, vWPos, n, tw, far, col, off, rg);
    } else {
      if (triK < 0.99) sampleFlat(L, w * (1.0 - triK), vWPos.xz, far, col, off, rg);
      if (triK > 0.01) sampleTri(L, w * triK, vWPos, n, tw, far, col, off, rg);
    }
  }
  ws = max(ws, 1e-3);
  c = col / ws;
  if (uStrata > 0.0) {
    vec3 sc = strataColor(h + (n1 - 0.5) * 18.0);
    c = mix(c, c * sc / max(0.05, dot(sc, LUMW)) * 0.42, uStrata * rockW * 0.32);
  }
  // 远处减弱法线细节（每个像素覆盖的地面变大，细节只会变成噪点）
  vec3 nb = normalize(n + (off / ws) * (1.0 - 0.65 * far));
  tRough = rg / ws;
  c *= 0.92 + 0.16 * n2;
  // 积雪：按带细节的法线判断“朝上的程度”——雪积在岩石的平台、凹处，边缘跟着岩石纹理走
  float snowAlt = smoothstep(uSnowLine - 50.0, uSnowLine + 30.0, h + (n1 - 0.5) * 90.0);
  float flatK = nb.y + (n3 - 0.5) * 0.14;
  float sW = snowAlt * smoothstep(0.52, 0.74, flatK);
  sW = max(sW, surf.a * smoothstep(0.34, 0.58, flatK));
  if (sW > 0.01) {
    vec3 sc = vec3(0.0);
    vec3 so = vec3(0.0);
    float sr = 0.0;
    if (triK < 0.99) sampleFlat(7, 1.0 - triK, vWPos.xz, far, sc, so, sr);
    if (triK > 0.01) sampleTri(7, triK, vWPos, n, tw, far, sc, so, sr);
    sc = mix(sc, vec3(0.92, 0.94, 0.97), 0.35); // 航拍雪原偏灰，提亮成新雪
    c = mix(c, sc, sW);
    nb = normalize(mix(nb, normalize(n + so * 0.6), sW));
    tRough = mix(tRough, sr * 0.8, sW);
  }
  snowW = sW;
  gTN = nb;
#else
  c = mix(uGrass, uGrass2, g2);
  c = mix(c, uForestFloor, fo);
  c = mix(c, uSand, sandW);
  c = mix(c, uDirt, dirtW);
  vec3 rock = mix(uRock, uRock2, r2);
  if (uStrata > 0.0) rock = mix(rock, strataColor(h + (n1 - 0.5) * 18.0), uStrata * (0.6 + 0.4 * tw.x + 0.4 * tw.z));
  c = mix(c, rock, rockW);
  c = mix(c, uSnow, snowW);
  c *= 0.86 + 0.28 * n2;
  c *= 0.93 + 0.14 * n3;
  tRough = mix(0.96, 0.88, rockW);
  tRough = mix(tRough, 0.7, snowW);
  tBump = mix(0.25, 1.0, rockW) * (1.0 - snowW * 0.6);
#endif
  // 水下：变暗偏蓝绿
  float under = smoothstep(uWaterLevel + 0.3, uWaterLevel - 2.0, h);
  c = mix(c, c * vec3(0.55, 0.7, 0.72), under);
  float wet = uWet * (1.0 - snowW);
  c *= mix(1.0, 0.68, wet);
  tRough = mix(tRough, 0.55, wet * 0.7);
  return c;
}`;

const FRAG_NORMAL = /* glsl */ `#include <normal_fragment_maps>
#ifdef TERRAIN_PHOTO
normal = normalize((viewMatrix * vec4(gTN, 0.0)).xyz);
#else
{
  vec3 tw2 = triW();
  float hb = triG(tw2, 0.035, 0.0) * 0.65 + triG(tw2, 0.1, 0.5) * 0.35;
  // 远处（每像素对应的世界尺寸变大）逐渐减弱凹凸细节，避免闪烁颗粒
  tBump *= 1.0 - 0.75 * smoothstep(0.12, 0.7, length(fwidth(vWPos)));
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(hb);
  float dhy = dFdy(hb);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * 1.2 * tBump);
}
#endif`;

/** 给 MeshStandardMaterial 注入地形着色。uniforms 里有 uTerC（照片材质）时启用 TERRAIN_PHOTO。 */
export function patchTerrainMaterial(mat: THREE.MeshStandardMaterial, uniforms: TerrainUniforms): void {
  const photo = !!uniforms.uTerC;
  if (photo) mat.defines = { ...(mat.defines ?? {}), TERRAIN_PHOTO: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', VERT_COMMON).replace('#include <worldpos_vertex>', VERT_WORLDPOS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_COMMON)
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= terrainAlbedo();')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tRough;')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL);
  };
  mat.customProgramCacheKey = () => (photo ? 'terrain-v4-photo' : 'terrain-v4');
}
