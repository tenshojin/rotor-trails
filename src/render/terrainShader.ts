// 地形着色（WebGPU 节点版）：按坡度/高度/掩码混合 8 层地表（草地、草地 2、林地、沙/河岸、泥土、岩石、岩石 2、积雪）。
// 有照片材质时：平地用俯视投影（近处 + 旋转后的大尺度两次采样，打破重复），
// 峭壁用三平面投影（whiteout 法线混合）；照片保留明暗细节，色相向地图原有配色靠拢。
// 没有照片材质时退回程序化配色 + 噪声凹凸。
//
// 每层只在权重明显时才采样（逐像素分支）；分支里的采样用显式梯度（在分支外求世界坐标的屏幕导数），
// 这样 WGSL 的“统一控制流”规则下也能正确选 mip 级别。颜色、粗糙度、法线共用同一次计算。

import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  Fn,
  fract,
  fwidth,
  If,
  int,
  length,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  struct,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  mx_noise_float,
  mx_worley_noise_float,
} from 'three/tsl';
import type { TerrainLayers } from './terrainLayers';

type N<T extends string> = THREE.Node<T>;

/** 地面湿度 uniform（0..1） */
export const makeWetUniform = () => uniform(0);

export interface TerrainUniforms {
  noise: THREE.Texture;
  surface: THREE.Texture;
  forest: THREE.Texture;
  layers: TerrainLayers | null;
  mapSize: number;
  sand: THREE.Color;
  grass: THREE.Color;
  grass2: THREE.Color;
  dirt: THREE.Color;
  rock: THREE.Color;
  rock2: THREE.Color;
  snow: THREE.Color;
  forestFloor: THREE.Color;
  strataA: THREE.Color;
  strataB: THREE.Color;
  strataC: THREE.Color;
  strataD: THREE.Color;
  strata: number;
  beachTop: number;
  snowLine: number;
  rockSlope: number;
  waterLevel: number;
  /** 雨后地面变湿（0..1），每帧更新 */
  uWet: ReturnType<typeof makeWetUniform>;
}

const LUMW = vec3(0.2126, 0.7152, 0.0722);
const c3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);
/** 照片法线（XY + 粗糙度打包）：纹理数组未上下翻转，绿通道取反 */
const unpackN = (v: N<'vec4'>) => {
  const xy = v.rg.mul(2).sub(1);
  return vec3(xy.x, xy.y.negate(), sqrt(max(0, float(1).sub(dot(xy, xy)))));
};
const TerrainOut = struct({ col: 'vec3', rough: 'float', nb: 'vec3' });
const ROT = 0.83;
const rot2 = (p: N<'vec2'>) => vec2(p.x.mul(Math.cos(ROT)).sub(p.y.mul(Math.sin(ROT))), p.x.mul(Math.sin(ROT)).add(p.y.mul(Math.cos(ROT))));

export function makeTerrainMaterial(U: TerrainUniforms): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const L = U.layers;
  const noise = U.noise;

  const result = Fn(() => {
    const P = positionWorld;
    // 屏幕导数在分支外求（统一控制流），分支里的采样用显式梯度
    const dPx = dFdx(P).toVar();
    const dPy = dFdy(P).toVar();
    const n = normalize(normalWorld).toVar();
    const slope = float(1).sub(n.y);
    const h = P.y;
    const muv = P.xz.div(U.mapSize).add(0.5);
    const surf = texture(U.surface, muv);
    const forest = texture(U.forest, muv).r;
    const n1 = texture(noise, P.xz.mul(0.0021)).r;
    // 三平面权重（陡坡上纹理不会被拉成竖条）
    const aw = pow(abs(n), vec3(4.0));
    const tw = aw.div(aw.x.add(aw.y).add(aw.z)).toVar();
    const triG = (s: number, o: number) =>
      texture(noise, P.zy.mul(s).add(o)).g.mul(tw.x).add(texture(noise, P.xz.mul(s).add(o)).g.mul(tw.y)).add(texture(noise, P.xy.mul(s).add(o)).g.mul(tw.z));
    const triR = (s: number, o: number) =>
      texture(noise, P.zy.mul(s).add(o)).r.mul(tw.x).add(texture(noise, P.xz.mul(s).add(o)).r.mul(tw.y)).add(texture(noise, P.xy.mul(s).add(o)).r.mul(tw.z));
    const n2 = triG(0.019, 0.0).toVar();
    const n3 = triG(0.045, 0.37).toVar();
    // 各层权重：草地 → 林地 → 沙 → 泥土 → 岩石 → 积雪，逐层覆盖
    const g2 = smoothstep(0.35, 0.65, n1);
    const fo = clamp(forest.mul(1.3), 0.0, 0.85);
    const sandW = max(float(1).sub(smoothstep(U.beachTop - 0.5, U.beachTop + 2.0, h.add(n2.sub(0.5).mul(2.5)))), surf.r).toVar();
    const dirtW = surf.g.mul(0.9).toVar();
    const rk = triR(0.006, 0.0).mul(0.65).add(triG(0.028, 0.0).mul(0.35));
    const r2 = smoothstep(0.32, 0.68, rk).toVar();
    const rockW = smoothstep(U.rockSlope - 0.07, U.rockSlope + 0.06, slope.add(n1.sub(0.5).mul(0.14))).toVar();
    const snowAlt = smoothstep(U.snowLine - 50.0, U.snowLine + 30.0, h.add(n1.sub(0.5).mul(90.0)));
    const strataColor = (y: N<'float'>) => {
      const t = fract(y.div(46.0));
      const b = fract(y.div(11.0));
      const c = mix(c3(U.strataA), c3(U.strataB), smoothstep(0.15, 0.35, t));
      const c2 = mix(c, c3(U.strataC), smoothstep(0.45, 0.6, t));
      return mix(c2, c3(U.strataD), smoothstep(0.75, 0.9, t)).mul(b.mul(0.24).add(0.88));
    };
    const col = vec3(0).toVar();
    const nb = vec3(n).toVar();
    const rough = float(0.95).toVar();
    const snowW = float(0).toVar();

    if (L) {
      const terC = L.color;
      const terN = L.normal;
      const far = smoothstep(40.0, 420.0, length(P.sub(cameraPosition))).toVar();
      const triK = smoothstep(0.2, 0.36, slope).toVar();
      const acc = vec3(0).toVar();
      const off = vec3(0).toVar();
      const rg = float(0).toVar();
      const ws = float(0).toVar();
      const tintL = (l: number, c: N<'vec3'>) => mix(c, c3(L.biome[l]).mul(dot(c, LUMW).div(L.meanLum[l])), L.tintK[l]);
      // 俯视投影：近处一个尺度 + 远处旋转后的大尺度
      const sampleFlat = (l: number, w: N<'float'>, A: N<'vec3'>, O: N<'vec3'>, Rr: N<'float'>) => {
        const t = L.tiles[l];
        const uv1 = P.xz.div(t);
        const uv2 = rot2(P.xz).div(t * 6.3).add(0.37);
        const gx1 = dPx.xz.div(t);
        const gy1 = dPy.xz.div(t);
        const gx2 = rot2(dPx.xz).div(t * 6.3);
        const gy2 = rot2(dPy.xz).div(t * 6.3);
        const k = far.mul(0.62).add(0.22);
        const c = mix(texture(terC, uv1).depth(int(l)).grad(gx1, gy1), texture(terC, uv2).depth(int(l)).grad(gx2, gy2), k);
        const nn = mix(texture(terN, uv1).depth(int(l)).grad(gx1, gy1), texture(terN, uv2).depth(int(l)).grad(gx2, gy2), k);
        const tn = unpackN(nn);
        A.addAssign(tintL(l, c.rgb).mul(w));
        O.addAssign(vec3(tn.x, 0.0, tn.y).mul(w));
        Rr.addAssign(nn.b.mul(w));
      };
      // 三平面投影的一个尺度：只采样权重明显的投影方向
      const triOnce = (l: number, t: number, p: N<'vec3'>, C: N<'vec3'>, Nn: N<'vec3'>, Rr: N<'float'>) => {
        const tx = vec3(0).toVar();
        const ty = vec3(0).toVar();
        const tz = vec3(0).toVar();
        const s = float(0).toVar();
        If(tw.x.greaterThan(0.03), () => {
          const uv = p.zy.div(t);
          const n4 = texture(terN, uv).depth(int(l)).grad(dPx.zy.div(t), dPy.zy.div(t));
          C.addAssign(texture(terC, uv).depth(int(l)).grad(dPx.zy.div(t), dPy.zy.div(t)).rgb.mul(tw.x));
          const u = unpackN(n4);
          tx.assign(vec3(u.xy.add(n.zy), abs(u.z).mul(n.x)));
          Rr.addAssign(n4.b.mul(tw.x));
          s.addAssign(tw.x);
        });
        If(tw.y.greaterThan(0.03), () => {
          const uv = p.xz.div(t);
          const n4 = texture(terN, uv).depth(int(l)).grad(dPx.xz.div(t), dPy.xz.div(t));
          C.addAssign(texture(terC, uv).depth(int(l)).grad(dPx.xz.div(t), dPy.xz.div(t)).rgb.mul(tw.y));
          const u = unpackN(n4);
          ty.assign(vec3(u.xy.add(n.xz), abs(u.z).mul(n.y)));
          Rr.addAssign(n4.b.mul(tw.y));
          s.addAssign(tw.y);
        });
        If(tw.z.greaterThan(0.03), () => {
          const uv = p.xy.div(t);
          const n4 = texture(terN, uv).depth(int(l)).grad(dPx.xy.div(t), dPy.xy.div(t));
          C.addAssign(texture(terC, uv).depth(int(l)).grad(dPx.xy.div(t), dPy.xy.div(t)).rgb.mul(tw.z));
          const u = unpackN(n4);
          tz.assign(vec3(u.xy.add(n.xy), abs(u.z).mul(n.z)));
          Rr.addAssign(n4.b.mul(tw.z));
          s.addAssign(tw.z);
        });
        C.divAssign(max(s, 1e-3));
        Rr.divAssign(max(s, 1e-3));
        Nn.assign(normalize(tx.zyx.mul(tw.x).add(ty.xzy.mul(tw.y)).add(tz.mul(tw.z)).add(n.mul(1e-3))));
      };
      // 三平面投影（陡坡/峭壁）：近处尺度 + 远处 5.7 倍大尺度，按距离混合
      const sampleTri = (l: number, w: N<'float'>, A: N<'vec3'>, O: N<'vec3'>, Rr: N<'float'>) => {
        const t = L.tiles[l];
        const k = far.mul(0.65).add(0.2).toVar();
        const c1 = vec3(0).toVar();
        const N1 = vec3(n).toVar();
        const r1 = float(0).toVar();
        const c2 = vec3(0).toVar();
        const N2 = vec3(n).toVar();
        const rr2 = float(0).toVar();
        If(k.lessThan(0.99), () => triOnce(l, t, P, c1, N1, r1));
        If(k.greaterThan(0.01), () => triOnce(l, t * 5.7, P.add(31.7), c2, N2, rr2));
        A.addAssign(tintL(l, mix(c1, c2, k)).mul(w));
        O.addAssign(normalize(mix(N1, N2, k)).sub(n).mul(w));
        Rr.addAssign(mix(r1, rr2, k).mul(w));
      };
      const W: N<'float'>[] = [];
      W[0] = float(1).sub(g2).mul(float(1).sub(fo));
      W[1] = g2.mul(float(1).sub(fo));
      W[2] = fo;
      for (let i = 0; i < 3; i++) W[i] = W[i].mul(float(1).sub(sandW));
      W[3] = sandW;
      for (let i = 0; i < 4; i++) W[i] = W[i].mul(float(1).sub(dirtW));
      W[4] = dirtW;
      for (let i = 0; i < 5; i++) W[i] = W[i].mul(float(1).sub(rockW));
      W[5] = rockW.mul(float(1).sub(r2));
      W[6] = rockW.mul(r2);
      // 先混合积雪以外的 7 层（坡度较大时逐渐改用三平面投影，过渡带两种都采样后混合）
      for (let l = 0; l < 7; l++) {
        const w = W[l].toVar();
        If(w.greaterThan(0.015), () => {
          ws.addAssign(w);
          if (l === 5 || l === 6) {
            sampleTri(l, w, acc, off, rg);
          } else {
            If(triK.lessThan(0.99), () => sampleFlat(l, w.mul(float(1).sub(triK)), acc, off, rg));
            If(triK.greaterThan(0.01), () => sampleTri(l, w.mul(triK), acc, off, rg));
          }
        });
      }
      ws.assign(max(ws, 1e-3));
      col.assign(acc.div(ws));
      if (U.strata > 0) {
        const sc = strataColor(h.add(n1.sub(0.5).mul(18.0)));
        col.assign(mix(col, col.mul(sc).div(max(0.05, dot(sc, LUMW))).mul(0.42), rockW.mul(U.strata * 0.32)));
      }
      // 远处减弱法线细节（每个像素覆盖的地面变大，细节只会变成噪点）
      nb.assign(normalize(n.add(off.div(ws).mul(float(1).sub(far.mul(0.65))))));
      rough.assign(rg.div(ws));
      col.mulAssign(n2.mul(0.16).add(0.92));
      // 积雪：按带细节的法线判断“朝上的程度”——雪积在岩石的平台、凹处，边缘跟着岩石纹理走
      const flatK = nb.y.add(n3.sub(0.5).mul(0.14));
      const sW = max(snowAlt.mul(smoothstep(0.52, 0.74, flatK)), surf.a.mul(smoothstep(0.34, 0.58, flatK))).toVar();
      If(sW.greaterThan(0.01), () => {
        const sc = vec3(0).toVar();
        const so = vec3(0).toVar();
        const sr = float(0).toVar();
        If(triK.lessThan(0.99), () => sampleFlat(7, float(1).sub(triK), sc, so, sr));
        If(triK.greaterThan(0.01), () => sampleTri(7, triK, sc, so, sr));
        // 航拍雪原偏灰，提亮成新雪
        col.assign(mix(col, mix(sc, vec3(0.92, 0.94, 0.97), 0.35), sW));
        nb.assign(normalize(mix(nb, normalize(n.add(so.mul(0.6))), sW)));
        rough.assign(mix(rough, sr.mul(0.8), sW));
      });
      snowW.assign(sW);
    } else {
      // 程序化配色 + 噪声凹凸
      const sw = max(snowAlt.mul(float(1).sub(smoothstep(0.42, 0.62, slope))), surf.a.mul(float(1).sub(smoothstep(0.55, 0.8, slope))));
      const c = mix(c3(U.grass), c3(U.grass2), g2).toVar();
      c.assign(mix(c, c3(U.forestFloor), fo));
      c.assign(mix(c, c3(U.sand), sandW));
      c.assign(mix(c, c3(U.dirt), dirtW));
      const rockC = mix(c3(U.rock), c3(U.rock2), r2).toVar();
      if (U.strata > 0) rockC.assign(mix(rockC, strataColor(h.add(n1.sub(0.5).mul(18.0))), tw.x.mul(0.4).add(tw.z.mul(0.4)).add(0.6).mul(U.strata)));
      c.assign(mix(c, rockC, rockW));
      c.assign(mix(c, c3(U.snow), sw));
      c.mulAssign(n2.mul(0.28).add(0.86));
      c.mulAssign(n3.mul(0.14).add(0.93));
      col.assign(c);
      rough.assign(mix(mix(0.96, 0.88, rockW), 0.7, sw));
      snowW.assign(sw);
      // 凹凸：噪声高度的屏幕导数扰动法线；远处（每像素对应的世界尺寸变大）逐渐减弱，避免闪烁颗粒
      const bump = mix(0.25, 1.0, rockW).mul(float(1).sub(sw.mul(0.6))).mul(float(1).sub(smoothstep(0.12, 0.7, length(fwidth(P))).mul(0.75)));
      const hb = triG(0.035, 0.0).mul(0.65).add(triG(0.1, 0.5).mul(0.35));
      const dhx = dFdx(hb);
      const dhy = dFdy(hb);
      const r1 = dPy.cross(n);
      const rr2 = n.cross(dPx);
      const det = dot(dPx, r1);
      const grad = r1.mul(dhx).add(rr2.mul(dhy)).mul(det.sign());
      nb.assign(normalize(n.mul(abs(det)).sub(grad.mul(bump.mul(1.2)))));
    }
    // 整体降低一点饱和度：照片材质向地图配色靠拢后草地偏艳，在中性色调映射下会显得发荧光
    col.assign(mix(col, vec3(dot(col, LUMW)), 0.18));
    // 森林区远处的“树冠层”：从空中看真实的森林是连成一片的树冠，而不是一棵棵树之间露出草地。
    // 用 Worley 噪声画出一团团树冠（中心亮、缝隙暗）与按位置变化的松林 / 阔叶林色调，并随树冠起伏扰动法线；
    // 离镜头近（< 90 m）时淡出，只看真实的树。
    const camDist = length(P.sub(cameraPosition));
    const canopyK = smoothstep(0.25, 0.75, forest).mul(smoothstep(90.0, 300.0, camDist)).mul(float(1).sub(snowW)).toVar();
    If(canopyK.greaterThan(0.01), () => {
      const cp = P.xz.div(5.2);
      const f1 = mx_worley_noise_float(cp);
      const dome = clamp(float(1).sub(f1.mul(f1).mul(1.7)), 0.0, 1.0);
      const hue = mx_noise_float(P.xz.mul(0.012)).mul(0.5).add(0.5);
      const fine = mx_noise_float(P.xz.mul(0.35)).mul(0.5).add(0.5);
      const canopy = mix(vec3(0.045, 0.085, 0.04), vec3(0.085, 0.13, 0.045), hue).mul(dome.mul(0.75).add(0.35)).mul(fine.mul(0.3).add(0.85));
      col.assign(mix(col, canopy, canopyK));
      // 树冠起伏的法线（用 Worley 距离在 x / z 方向的差分）
      const e = 0.6;
      const fx = mx_worley_noise_float(cp.add(vec2(e / 5.2, 0)));
      const fz = mx_worley_noise_float(cp.add(vec2(0, e / 5.2)));
      const bump = vec3(fx.sub(f1).mul(-2.2), 1.0, fz.sub(f1).mul(-2.2));
      nb.assign(normalize(mix(nb, normalize(bump.mul(vec3(1, 1, 1))), canopyK.mul(0.6))));
      rough.assign(mix(rough, 0.85, canopyK));
    });
    // 水下：变暗偏蓝绿；雨后变湿：变暗、更光滑
    const under = float(1).sub(smoothstep(U.waterLevel - 2.0, U.waterLevel + 0.3, h));
    col.assign(mix(col, col.mul(vec3(0.55, 0.7, 0.72)), under));
    const wet = U.uWet.mul(float(1).sub(snowW));
    col.mulAssign(mix(1.0, 0.68, wet));
    rough.assign(mix(rough, 0.55, wet.mul(0.7)));
    return TerrainOut(col, rough, nb);
  });
  // 颜色、粗糙度、法线引用同一个计算结果（着色器里只算一次）
  const res = result();
  mat.colorNode = vec4(res.get('col') as N<'vec3'>, 1.0);
  mat.roughnessNode = res.get('rough') as N<'float'>;
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(res.get('nb') as N<'vec3'>, 0.0)).xyz);
  return mat;
}
