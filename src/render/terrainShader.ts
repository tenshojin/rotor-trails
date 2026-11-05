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
  sin,
  smoothstep,
  sqrt,
  step,
  struct,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  mx_noise_float,
  mx_worley_noise_float,
} from 'three/tsl';
import type { RockFormDef } from '../world/rockForm';
import { FOG } from './atmosphere';
import { GI } from './giField';
import { terrainSun } from './sunMap';
import type { TerrainLayers } from './terrainLayers';
import { VFOG } from './volumetricFog';

type N<T extends string> = THREE.Node<T>;

/** 地面湿度 uniform（0..1） */
export const makeWetUniform = () => uniform(0);

export interface TerrainUniforms {
  noise: THREE.Texture;
  surface: THREE.Texture;
  forest: THREE.Texture;
  /** 干河道的颜色（null：沟里植被更密） */
  wash: THREE.Color | null;
  /** 地形宏观图与岩石浮雕图（见 terrainMacro.ts） */
  macro: THREE.Texture;
  relief: THREE.Texture;
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
  /** 地图边缘一圈的平均树冠覆盖度：地图外面的远景按这个接着铺 */
  forestFar: number;
  strataA: THREE.Color;
  strataB: THREE.Color;
  strataC: THREE.Color;
  strataD: THREE.Color;
  strata: number;
  /** 地表掩码 A 通道是水泥地（否则是积雪） */
  paved: boolean;
  beachTop: number;
  snowLine: number;
  rockSlope: number;
  waterLevel: number;
  /** 雨后地面变湿（0..1），每帧更新 */
  uWet: ReturnType<typeof makeWetUniform>;
  /** 地层（见 world/rockForm.ts）：有地层表时，岩石的颜色按它查 */
  rockForm: RockFormDef | null;
  strataLUT: THREE.Texture | null;
}

const LUMW = vec3(0.2126, 0.7152, 0.0722);
const c3 = (c: THREE.Color) => vec3(c.r, c.g, c.b);
/** 照片法线（XY + 粗糙度打包）：纹理数组未上下翻转，绿通道取反 */
const unpackN = (v: N<'vec4'>) => {
  const xy = v.rg.mul(2).sub(1);
  return vec3(xy.x, xy.y.negate(), sqrt(max(0, float(1).sub(dot(xy, xy)))));
};
const TerrainOut = struct({ col: 'vec3', rough: 'float', nb: 'vec3', ao: 'float' });
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
    const forestMap = texture(U.forest, muv);
    // 地图外面没有树冠图（贴图会把边上那一格一直拉出去，成了一道道放射的条纹）：
    // 按边缘的平均覆盖度铺一层，大块地疏密起伏，和地图里的林子看不出分界
    const outK = smoothstep(-0.012, 0.03, max(abs(muv.x.sub(0.5)), abs(muv.y.sub(0.5))).sub(0.5));
    const farForest = clamp(texture(noise, P.xz.mul(0.00031)).r.sub(0.5).mul(1.6 * (1 - 0.8 * U.forestFar)).add(U.forestFar), 0.0, 1.0);
    const forest = mix(forestMap.r, farForest, outK).toVar();
    // 地图外面的远景地形没有宏观图：凹凸取中性值，坡度用几何法线
    const inMap = step(abs(muv.x.sub(0.5)), 0.5).mul(step(abs(muv.y.sub(0.5)), 0.5));
    const mac0 = texture(U.macro, muv);
    const mac = mix(vec4(0.5, 0.5, 1.0, slope), mac0, inMap);
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
    // 两种地表的分界不是一条平滑的曲线：掺上小尺度的噪声，边缘才碎
    const g2 = smoothstep(0.38, 0.62, n1.add(n3.sub(0.5).mul(0.3)).add(n2.sub(0.5).mul(0.24)));
    const fo = clamp(forest.mul(1.3), 0.0, 0.85);
    // 沙滩的宽窄沿海岸线变化：有的地方是宽沙滩，有的地方树林和岩石直接到水边
    const beachVar = texture(noise, P.xz.mul(0.0034).add(0.71)).g.sub(0.5).mul(3.4);
    const sandW = max(float(1).sub(smoothstep(U.beachTop - 0.5, U.beachTop + 2.0, h.add(n2.sub(0.5).mul(2.5)).add(beachVar))), surf.r).toVar();
    const dirtW = surf.g.mul(0.9).toVar();
    const rk = triR(0.006, 0.0).mul(0.65).add(triG(0.028, 0.0).mul(0.35));
    const r2 = smoothstep(0.32, 0.68, rk).toVar();
    const rockW = smoothstep(U.rockSlope - 0.07, U.rockSlope + 0.06, mix(mac.a, slope, 0.25).add(n1.sub(0.5).mul(0.14)).add(n3.sub(0.5).mul(0.1))).toVar();
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
    // 贴图坐标加一点低频扭曲：照片材质的平铺格子不再是一条条直线（远看山壁上才不会出现方格）
    // （平地上扭曲要小，否则草地上会出现大理石一样的旋涡纹）
    const warp = vec2(texture(noise, P.xz.mul(0.0043)).r, texture(noise, P.xz.mul(0.0043).add(0.5)).r).sub(0.5).mul(mix(float(3.0), float(26.0), rockW));
    // 地层面的高度偏移：岩壁贴图的层线沿地层面走（倾斜、起伏都跟着地层表），不是一律水平
    let sw: N<'float'> = P.x.mul(0.05).add(P.z.mul(0.03));
    if (U.rockForm) {
      const R = U.rockForm;
      sw = P.x.mul(R.dip[0]).add(P.z.mul(R.dip[1]));
      for (const [kx, kz, a, ph] of R.waves) sw = sw.add(sin(P.x.mul(kx).add(P.z.mul(kz)).add(ph)).mul(a));
    }
    const swV = sw.toVar();
    // （只有岩石才沿地层面走：草坡的坡度和地层倾角差不多时，贴图会沿山坡拉成一条条）
    const Pw = P.add(vec3(warp.x, warp.y.mul(0.6).add(swV.mul(rockW)), warp.y)).toVar();

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
        const uv1 = Pw.xz.div(t);
        const uv2 = rot2(Pw.xz).div(t * 6.3).add(0.37);
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
          // 岩壁上的贴图 v 轴朝下取（贴图的第一行在顶上），岩层、断面才是正着的
          const uv = vec2(p.z, p.y.negate()).div(t);
          const gx = vec2(dPx.z, dPx.y.negate()).div(t);
          const gy = vec2(dPy.z, dPy.y.negate()).div(t);
          const n4 = texture(terN, uv).depth(int(l)).grad(gx, gy);
          C.addAssign(texture(terC, uv).depth(int(l)).grad(gx, gy).rgb.mul(tw.x));
          const u = unpackN(n4);
          tx.assign(vec3(vec2(u.x, u.y.negate()).add(n.zy), abs(u.z).mul(n.x)));
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
          const uv = vec2(p.x, p.y.negate()).div(t);
          const gx = vec2(dPx.x, dPx.y.negate()).div(t);
          const gy = vec2(dPy.x, dPy.y.negate()).div(t);
          const n4 = texture(terN, uv).depth(int(l)).grad(gx, gy);
          C.addAssign(texture(terC, uv).depth(int(l)).grad(gx, gy).rgb.mul(tw.z));
          const u = unpackN(n4);
          tz.assign(vec3(vec2(u.x, u.y.negate()).add(n.xy), abs(u.z).mul(n.z)));
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
        If(k.lessThan(0.99), () => triOnce(l, t, Pw, c1, N1, r1));
        If(k.greaterThan(0.01), () => triOnce(l, t * 5.7, Pw.add(31.7), c2, N2, rr2));
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
      if (U.rockForm && U.strataLUT) {
        // 地层：岩石的颜色按地层表查（层线和地形的台阶对得上，绕山连续），照片材质只留明暗细节
        const R = U.rockForm;
        // 层线不是尺子画的：沿层面有几米的起伏，上层风化下来的颜色也会顺着岩壁往下淌一点
        const sy = h.add(swV).add(n2.sub(0.5).mul(7.0)).add(n3.sub(0.5).mul(5.0)).add(n1.sub(0.5).mul(6.0));
        const lay = texture(U.strataLUT, vec2(sy.sub(R.y0).div(R.y1 - R.y0), 0.5));
        const stain = texture(U.strataLUT, vec2(sy.add(9.0).sub(R.y0).div(R.y1 - R.y0), 0.5));
        const lum = dot(col, LUMW).div(Math.max(0.02, 0.2126 * U.rock.r + 0.7152 * U.rock.g + 0.0722 * U.rock.b));
        const rc = mix(lay.rgb, stain.rgb, smoothstep(0.45, 0.8, n3).mul(0.5)).mul(clamp(lum, 0.68, 1.45));
        // 只有真正的崖壁才露出层线：缓坡上满山一圈圈的条纹会像等高线
        // （地图外的远景网格很粗，层线在上面像等高线，减弱一些）
        col.assign(mix(col, rc, rockW.mul(smoothstep(0.26, 0.5, mac.a)).mul(mix(float(0.4), float(1), inMap)).mul(R.tint)));
        if (R.debris) {
          // 岩架上堆的是上面崩下来的碎石，和岩壁同一个颜色；只有平的谷底、台地才是沙土
          const deb = float(1).sub(rockW).mul(smoothstep(0.035, 0.11, mac.a)).mul(R.debris);
          col.assign(mix(col, stain.rgb.mul(clamp(lum, 0.7, 1.05)), deb));
        }
      } else if (U.strata > 0) {
        const sc = strataColor(h.add(n1.sub(0.5).mul(18.0)));
        col.assign(mix(col, col.mul(sc).div(max(0.05, dot(sc, LUMW))).mul(0.42), rockW.mul(U.strata * 0.32)));
      }
      // 远处减弱法线细节（每个像素覆盖的地面变大，细节只会变成噪点）
      nb.assign(normalize(n.add(off.div(ws).mul(float(1).sub(far.mul(0.65))))));
      rough.assign(rg.div(ws));
      col.mulAssign(n2.mul(0.16).add(0.92));
      // 积雪：按带细节的法线判断“朝上的程度”——雪积在岩石的平台、凹处，边缘跟着岩石纹理走
      // 远景的网格粗，法线很平滑，积雪和岩石的分界是一团团的：掺上岩面的起伏，边缘碎成一条条
      const flatK = nb.y.add(n3.sub(0.5).mul(0.14)).add(texture(U.relief, P.xz.div(420.0)).b.sub(0.46).mul(mix(float(0.62), float(0.1), inMap)));
      // 雪线以上很多的地方（远处的高峰）连陡坡也挂满雪，只有最陡的岩壁露出来
      const highSnow = smoothstep(U.snowLine + 500.0, U.snowLine + 1100.0, h.add(n1.sub(0.5).mul(240.0))).mul(smoothstep(0.08, 0.3, flatK));
      const sW = max(max(snowAlt.mul(smoothstep(0.52, 0.74, flatK)), highSnow), U.paved ? float(0) : surf.a.mul(smoothstep(0.34, 0.58, flatK))).toVar();
      If(sW.greaterThan(0.01), () => {
        const sc = vec3(0).toVar();
        const so = vec3(0).toVar();
        const sr = float(0).toVar();
        If(triK.lessThan(0.99), () => sampleFlat(7, float(1).sub(triK), sc, so, sr));
        If(triK.greaterThan(0.01), () => sampleTri(7, triK, sc, so, sr));
        // 航拍雪原偏灰，提亮成新雪。远处看雪是一整片平滑的白：照片的纹理按距离淡掉，否则平铺的重复一眼就能看出来
        const snowFar = smoothstep(70.0, 520.0, length(P.sub(cameraPosition)));
        col.assign(mix(col, mix(sc, vec3(0.8, 0.83, 0.88), mix(float(0.35), float(0.9), snowFar)), sW));
        nb.assign(normalize(mix(nb, normalize(n.add(so.mul(mix(float(0.6), float(0.05), snowFar)))), sW)));
        rough.assign(mix(rough, sr.mul(0.8), sW));
      });
      snowW.assign(sW);
    } else {
      // 程序化配色 + 噪声凹凸
      const sw = max(snowAlt.mul(float(1).sub(smoothstep(0.42, 0.62, slope))), U.paved ? float(0) : surf.a.mul(float(1).sub(smoothstep(0.55, 0.8, slope))));
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
    if (U.paved) {
      // 港区水泥地：一块块浇筑的板（缝）、油污和轮胎碾过的深浅、退色的车道线
      const pk = surf.a.toVar();
      If(pk.greaterThan(0.01), () => {
        const stain = n3.mul(0.55).add(texture(noise, P.xz.mul(0.013).add(0.3)).r.mul(0.45));
        // 一块块分别浇筑的板：每块的颜色、新旧都不一样
        const slab = P.xz.div(vec2(7.5, 10.0)).toVar();
        const cell = slab.floor();
        const age = texture(noise, cell.mul(0.0371).add(0.13)).a.mul(0.6).add(texture(noise, cell.mul(0.0173).add(0.57)).r.mul(0.4));
        const conc = mix(vec3(0.255, 0.25, 0.235), vec3(0.385, 0.38, 0.36), stain).mul(age.mul(0.42).add(0.8)).mul(n2.mul(0.16).add(0.92));
        const jx = abs(fract(slab.x).sub(0.5));
        const jz = abs(fract(slab.y).sub(0.5));
        const joint = smoothstep(0.4945, 0.4985, max(jx, jz));
        // 车辙：车总走那几条线，轮胎把地面磨黑；还有一滴滴的油污
        const rut = smoothstep(0.52, 0.8, texture(noise, vec2(P.x.mul(0.058), P.z.mul(0.0034)).add(0.21)).r);
        const oil = smoothstep(0.66, 0.84, texture(noise, P.xz.mul(0.031).add(0.41)).g);
        const wear = float(1).sub(rut.mul(0.3)).sub(oil.mul(0.24));
        col.assign(mix(col, conc.mul(wear).mul(float(1).sub(joint.mul(0.5))), pk));
        rough.assign(mix(rough, mix(float(0.84), float(0.5), oil), pk));
        nb.assign(normalize(mix(nb, n, pk)));
      });
    }
    // 宏观地貌：岩壁加上三平面投影的脊状浮雕（两个尺度），平缓的地面只加一点起伏；明暗再跟着真实的沟谷与山脊走
    const cavS = mac.r.mul(2.0).sub(1.0);
    const cavL = mac.g.mul(2.0).sub(1.0);
    const rockK = rockW.mul(float(1).sub(snowW));
    // 竖直的两个投影：v 是地层坐标（高度加上地层面的偏移），岩层、断面沿地层面走
    const Py = P.y.add(swV).toVar();
    const relief = (s: number, o: number) => {
      const fx = texture(U.relief, vec2(P.z, Py).div(s).add(o));
      const fy = texture(U.relief, P.xz.div(s).add(o));
      const fz = texture(U.relief, vec2(P.x, Py).div(s).add(o));
      const hgt = fx.b.mul(tw.x).add(fy.b.mul(tw.y)).add(fz.b.mul(tw.z));
      const ux = fx.rg.mul(2.0).sub(1.0);
      const uy = fy.rg.mul(2.0).sub(1.0);
      const uz = fz.rg.mul(2.0).sub(1.0);
      const wn = vec3(0.0, ux.y, ux.x).mul(tw.x).add(vec3(uy.x, 0.0, uy.y).mul(tw.y)).add(vec3(uz.x, uz.y, 0.0).mul(tw.z));
      return vec4(wn, hgt);
    };
    const cavOf = (s: number, o: number) => texture(U.relief, vec2(P.z, Py).div(s).add(o)).a.mul(tw.x).add(texture(U.relief, P.xz.div(s).add(o)).a.mul(tw.y)).add(texture(U.relief, vec2(P.x, Py).div(s).add(o)).a.mul(tw.z));
    const rA = relief(230.0, 0.0);
    const rB = relief(71.0, 0.41);
    // 最细的一层（19 米平铺）：岩面上的裂隙和小棱角，只在中近距离看得出
    const rC = relief(19.0, 0.73);
    const footK = float(1).sub(smoothstep(0.6, 3.6, length(dPx).add(length(dPy))));
    const footC = float(1).sub(smoothstep(0.16, 1.05, length(dPx).add(length(dPy))));
    const reliefN = rA.xyz.mul(1.0).add(rB.xyz.mul(footK.mul(0.9))).add(rC.xyz.mul(footC.mul(0.8)));
    nb.assign(normalize(nb.add(reliefN.mul(mix(mix(float(0.16), float(0.34), snowW), float(1.0), rockK)))));
    const rH = rA.w.mul(0.6).add(rB.w.mul(0.4)).add(rC.w.sub(0.42).mul(footC.mul(0.5)));
    // 凸处（山脊、岩棱）亮，凹处（沟、裂缝）暗；积雪处减弱
    const shade = float(1).sub(cavS.mul(0.26)).sub(cavL.mul(0.2)).add(rH.sub(0.46).mul(mix(float(0.1), float(0.7), rockK)));
    col.mulAssign(clamp(shade, 0.66, 1.4).mul(float(1).sub(snowW.mul(0.5))).add(snowW.mul(0.5)));
    // 裂缝和岩层下面的凹处：太阳照不进去，是岩壁上最黑的地方
    const cav = cavOf(71.0, 0.41).mul(footK.mul(0.75)).add(cavOf(19.0, 0.73).mul(footC.mul(0.65))).add(cavOf(230.0, 0.0).mul(0.42));
    col.mulAssign(float(1).sub(clamp(cav, 0.0, 1.0).mul(rockK).mul(0.34)));
    // 水痕：雨水顺着岩壁往下淌，留下一道道深色的竖纹（矿物、地衣），这是崖壁远看最抢眼的纹理
    const seep = texture(noise, vec2(P.x.add(P.z).mul(0.0047), P.y.mul(0.00035))).r.mul(0.62).add(texture(noise, vec2(P.x.sub(P.z).mul(0.019), P.y.mul(0.0011).add(0.3))).g.mul(0.38));
    col.mulAssign(float(1).sub(smoothstep(0.5, 0.74, seep).mul(rockK).mul(smoothstep(0.3, 0.55, slope)).mul(0.3)));
    // 几百米尺度的深浅与冷暖：同一种地表在大范围里也不是一个颜色（土壤、湿度、植被密度都在变）
    const big = texture(noise, P.xz.mul(0.00031).add(0.2)).r;
    const big2 = texture(noise, P.xz.mul(0.00083).add(0.6)).r;
    const patchK = float(1).sub(rockW.mul(0.6)).mul(float(1).sub(snowW));
    col.mulAssign(mix(vec3(1.0), mix(vec3(0.8, 0.84, 0.84), vec3(1.16, 1.12, 1.02), big.mul(0.6).add(big2.mul(0.4))), patchK));
    // 水系：雨水汇到的沟。荒漠里是一条条浅色的干河道，别处是沿沟更密更绿的植被
    // 地图外面的远景没有水系图：取噪声的等值线，弯弯曲曲的像一条条沟
    const farFl = float(1).sub(smoothstep(0.0, 0.022, abs(texture(noise, P.xz.mul(0.00041)).r.add(n2.sub(0.5).mul(0.06)).sub(0.5)))).mul(smoothstep(0.42, 0.62, texture(noise, P.xz.mul(0.00019).add(0.3)).g)).mul(0.34);
    const fl = mix(farFl, forestMap.g, inMap);
    const washK = smoothstep(0.1, 0.5, fl.add(n3.sub(0.5).mul(0.2))).mul(float(1).sub(rockW)).mul(float(1).sub(snowW)).mul(float(1).sub(surf.a)).toVar();
    if (U.wash) {
      col.assign(mix(col, c3(U.wash).mul(n2.mul(0.3).add(0.85)), washK.mul(0.62)));
      // 远景的荒漠上看不见一丛丛灌木了，用深色的小斑点代替
      col.mulAssign(float(1).sub(smoothstep(0.62, 0.82, texture(noise, P.xz.mul(0.0119)).a).mul(float(1).sub(inMap)).mul(0.3)));
    }
    else col.mulAssign(mix(vec3(1.0), vec3(0.66, 0.8, 0.58), washK.mul(float(1).sub(forest)).mul(0.85)));
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
      const canopy = mix(vec3(0.052, 0.104, 0.046), vec3(0.1, 0.16, 0.052), hue).mul(dome.mul(0.75).add(0.35)).mul(fine.mul(0.3).add(0.85));
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
    // 水边一条被浪打湿的深色带（沙滩、礁石、岩壁脚下都有）
    const tide = float(1).sub(smoothstep(U.waterLevel + 0.25, U.waterLevel + 1.1, h.add(n3.sub(0.5).mul(0.9))));
    col.mulAssign(mix(float(1), float(0.62), tide.mul(float(1).sub(under))));
    rough.assign(mix(rough, 0.42, tide));
    const wet = U.uWet.mul(float(1).sub(snowW));
    col.mulAssign(mix(1.0, 0.68, wet));
    rough.assign(mix(rough, 0.55, wet.mul(0.7)));
    return TerrainOut(col, rough, nb, mix(float(0.42), float(1), mac.b));
  });
  const SKY_VIS = Fn(() => texture(U.macro, positionWorld.xz.div(U.mapSize).add(0.5)).b);
  // 颜色、粗糙度、法线引用同一个计算结果（着色器里只算一次）
  const res = result();
  // 颜色不放在 colorNode 上：three.js 为了支持带透明度的阴影，会把 colorNode 的 alpha 带进阴影通道的着色器，
  // 这么大的地形着色器要多编译一份（一百多 KB，首次进入要多等好几秒）。这里只在建主着色器的那一刻才交出去。
  const M = mat as unknown as { terrainColor: N<'vec4'>; colorNode: N<'vec4'> | null; setupDiffuseColor(b: THREE.NodeBuilder): void };
  M.terrainColor = vec4(res.get('col') as N<'vec3'>, 1.0);
  const setupDiffuse = M.setupDiffuseColor;
  M.setupDiffuseColor = function (b) {
    this.colorNode = this.terrainColor;
    setupDiffuse.call(this, b);
    this.colorNode = null;
  };
  mat.roughnessNode = res.get('rough') as N<'float'>;
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(res.get('nb') as N<'vec3'>, 0.0)).xyz);
  mat.aoNode = res.get('ao') as N<'float'>;
  // 反光：山谷里背阴的岩壁被对面晒着太阳的岩壁照亮——暖色的光在阴影里来回反射，
  // 这是峡谷清晨、黄昏最好看的地方，也是阴影里不至于一片死黑的原因
  const shadeK = float(1).sub(terrainSun(positionWorld));
  // 背对太阳的坡（自己的影子里）和被斜阳擦过的平地也一样：只有蓝天照着会发青，实际上还接着地面反上来、
  // 太阳那一侧的天空洒下来的暖光
  const backK = clamp(float(0.32).sub(dot(normalize(normalWorld), FOG.sunDir)), 0.0, 1.0);
  // （开着光线追踪时大部分换成算出来的真实反弹光，见 giField.ts）
  mat.emissiveNode = (res.get('col') as N<'vec3'>).mul(VFOG.sun).mul(shadeK.mul(float(1.15).sub(SKY_VIS())).mul(0.1).add(backK.mul(0.085))).mul(float(1).sub(GI.on.mul(0.75)));
  return mat;
}
