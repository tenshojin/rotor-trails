// 水面倒影：沿反射方向在屏幕上步进，碰到画面里的山、树、房子就取那里的颜色（水面本身是平的，这样做又便宜又准）；
// 光线飞出画面（低头看水、山在画面外）时接着在地形高度图里走（倒影场，见 reflectMap.ts），山还是映得出来；
// 什么都没碰到就是天空：按方向算大气颜色，再盖上云层贴图里的云（云也映进水里）。海面、峡湾、河面共用。

import * as THREE from 'three/webgpu';
import {
  Break,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  Fn,
  If,
  interleavedGradientNoise,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionWorld,
  pow,
  reflect,
  screenCoordinate,
  screenUV,
  select,
  smoothstep,
  step,
  struct,
  texture,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
} from 'three/tsl';
import { FOG } from './atmosphere';
import type { ReflectField } from './reflectMap';
import { COVER, SNOW_RGB } from './wetness';
import type { SkyDome } from './sky';
import { terrainSun } from './sunMap';
import { VFOG } from './volumetricFog';

type N<T extends string> = THREE.Node<T>;

const MirrorOut = struct({ rgb: 'vec3', total: 'float', hit: 'float' });

/** 步数、第一步长度（米）、每步放大的倍数、最后的二分次数 */
const STEPS = 17;
const T0 = 4;
const GROW = 1.5;
const REFINE = 3;
/** 倒影场：高度图里走的步数和最后的二分次数 */
const FIELD_STEPS = 24;
const FIELD_REFINE = 3;

const depthShared = new Map<boolean, THREE.TextureNode>();

/**
 * 取画面颜色（海面、河面的倒影和折射，风挡内侧的倒影）：都从这一个节点 sample() 出来，一次渲染只拷一次画面。
 * three.js 的 viewportSharedTexture 虽然共用一张贴图，却是每个节点各拷一遍（按节点本身去重）：以前水面 5 个倒影采样
 * 加 1 个折射、风挡 1 个，实测每帧把画面颜色拷 7 遍（日本海面、亚马孙河面都是），每拷一遍渲染通道都要断开再接上。
 * 这里按 sample() 的源头去重。拷的时机是第一个用到它的东西画之前：水面、河面都排在不透明物体之后，
 * 风挡是透明物体、画得更晚，它取的遮光罩早就在画面里了，所以大家拿到的颜色和以前各拷各的一样。
 */
class FrameCopy extends THREE.ViewportSharedTextureNode {
  override updateReference(): unknown {
    return this.referenceNode ?? this;
  }
}

let frameShared: FrameCopy | null = null;

/** 画面颜色的拷贝（用 .sample(uv) 取） */
export function frameCopy(): THREE.TextureNode {
  return (frameShared ??= new FrameCopy());
}

/** 场景深度：水面、河流、烟幕共用一份拷贝（每多一份，渲染通道就要多中断一次；深度格式要和渲染通道一致） */
export function sceneDepthNode(reversedDepth: boolean): THREE.TextureNode {
  const cached = depthShared.get(reversedDepth);
  if (cached) return cached;
  const depthCopy = new THREE.DepthTexture(1, 1);
  if (reversedDepth) depthCopy.type = THREE.FloatType;
  const node = (viewportDepthTexture as unknown as (u: N<'vec2'>, l: null, d: THREE.DepthTexture) => THREE.TextureNode)(screenUV, null, depthCopy);
  depthShared.set(reversedDepth, node);
  return node;
}

/** 从 P0 沿 Rd 在地形高度图里走，返回 vec4(那里的颜色, 碰到了吗) */
function fieldMarch(P0: N<'vec3'>, Rd: N<'vec3'>, f: ReflectField, frame: N<'float'>, washout?: N<'float'>): N<'vec4'> {
  const hTex = texture(f.height);
  const cTex = texture(f.color);
  const fTex = texture(f.far);
  const S = f.size;
  const FS = f.farSize;
  const inMap = (q: N<'vec2'>): N<'float'> => step(max(q.x.abs(), q.y.abs()), float(S / 2));
  const hAt = (q: N<'vec2'>): N<'float'> => {
    const outer = mix(float(-1e4), fTex.sample(q.div(FS).add(0.5)).level(float(0)).a, step(max(q.x.abs(), q.y.abs()), float(FS / 2)));
    return mix(outer, hTex.sample(q.div(S).add(0.5)).level(float(0)).r, inMap(q));
  };
  return Fn(() => {
    const out = vec4(0).toVar();
    // 光线升到最高的山顶之前才可能碰到东西：高仰角的光线走得短、步子小，贴水面的光线步子大
    const tMax = min(float(Math.max(f.top, f.farTop)).sub(P0.y).div(Rd.y), float(S * 2.4)).toVar();
    // 步子越走越大：近处的山脊不能跨过去，远处的山够大
    const inc = float(1 / FIELD_STEPS);
    // （抖动每帧不同，时间抗锯齿才抹得平，否则倒影里是一片固定的网点）
    const u = inc.mul(interleavedGradientNoise(screenCoordinate.xy.add(frame)).mul(0.7).add(0.3)).toVar();
    const t0 = float(0).toVar();
    const t1 = tMax.mul(pow(u, 1.6)).toVar();
    const hit = float(0).toVar();
    Loop(FIELD_STEPS, () => {
      const p = P0.add(Rd.mul(t1)).toVar();
      If(p.y.lessThan(hAt(p.xz)), () => {
        hit.assign(1);
        Break();
      });
      t0.assign(t1);
      u.addAssign(inc);
      t1.assign(tMax.mul(pow(u, 1.6)));
    });
    If(hit.greaterThan(0.5), () => {
      Loop(FIELD_REFINE, () => {
        const mid = t0.add(t1).mul(0.5).toVar();
        const p = P0.add(Rd.mul(mid)).toVar();
        const under = p.y.lessThan(hAt(p.xz));
        t1.assign(select(under, mid, t1));
        t0.assign(select(under, t0, mid));
      });
      const p = P0.add(Rd.mul(t1)).toVar();
      const inside = inMap(p.xz).toVar();
      const e = mix(float(64), float(8), inside).toVar();
      const hx = hAt(p.xz.add(vec2(e, 0))).sub(hAt(p.xz.sub(vec2(e, 0))));
      const hz = hAt(p.xz.add(vec2(0, e))).sub(hAt(p.xz.sub(vec2(0, e))));
      const nrm = normalize(vec3(hx.negate(), e.mul(2), hz.negate()));
      const alb = mix(vec4(fTex.sample(p.xz.div(FS).add(0.5)).level(float(0)).rgb, 0.6), cTex.sample(p.xz.div(S).add(0.5)).level(float(0)), inside);
      // 打光：太阳（山影里没有）+ 天光（山谷深处看得见的天少）
      const sun = VFOG.sun.mul(max(dot(nrm, FOG.sunDir), 0.0).mul(terrainSun(p)).mul(1 / Math.PI));
      const sky = FOG.color.mul(alb.a.mul(0.75).add(0.1));
      // （下了雪倒影里的山也是白的）
      const lit = mix(alb.rgb, SNOW_RGB, COVER.mul(smoothstep(0.55, 0.85, nrm.y))).mul(sun.add(sky));
      const dist = length(P0.sub(cameraPosition)).add(t1);
      const fogK = float(1).sub(exp(FOG.density.mul(FOG.density).add(FOG.cloud.mul(FOG.cloud)).mul(dist).mul(dist).negate()));
      // 被风吹皱的水面（和屏幕里那一段同一个道理）：往上抬一点的光线走到同样远还在山里 = 高崖，倒影照旧；
      // 已经越过山顶 = 低矮的岛，淡成天色（权重放在 a 里，空出来的给天空）
      let a: N<'float'> = float(1);
      if (washout) {
        const q = P0.add(normalize(Rd.add(vec3(0.0, washout.mul(0.25), 0.0))).mul(t1)).toVar();
        a = float(1).sub(washout.mul(step(hAt(q.xz), q.y)));
      }
      out.assign(vec4(mix(lit, FOG.color, fogK), a));
    });
    return out;
  })();
}

/**
 * 返回结构体：rgb = 倒影颜色，total = 倒影权重（白沫上是 0，由材质自己的环境反射负责），hit = 其中碰到山、树、房子的部分。
 * nW：世界空间的波浪法线（这里会压平一些，否则远处的倒影会碎成一片噪点）
 * washout：水面被风吹皱的程度（0 = 平静的水面，不传就当平静）：碰到的东西上面是天，倒影就按这个程度淡成天色；上面还是山就照旧
 */
export function screenMirror(nW: N<'vec3'>, foam: N<'float'>, depthNode: THREE.TextureNode, on: N<'float'>, field: ReflectField | null, spread: N<'float'>, sky: SkyDome, washout?: N<'float'>): ReturnType<typeof MirrorOut> {
  return Fn(() => {
    const P0 = positionWorld;
    const V = normalize(P0.sub(cameraPosition));
    const nR = normalize(mix(nW, vec3(0.0, 1.0, 0.0), 0.6));
    const r0 = reflect(V, nR);
    const Rd = vec3(r0.x, max(r0.y, 0.015), r0.z).toVar();
    const viewZ = (uvq: N<'vec2'>) => perspectiveDepthToViewZ(depthNode.sample(uvq).r, cameraNear, cameraFar).negate();
    const proj = (tt: N<'float'>) => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P0.add(Rd.mul(tt)), 1.0)));
    const toUV = (c: N<'vec4'>) => vec2(c.x.div(c.w).mul(0.5).add(0.5), float(0.5).sub(c.y.div(c.w).mul(0.5)));
    const t0 = float(0).toVar();
    const t1 = float(T0).toVar();
    const hit = float(0).toVar();
    const huv = vec2(0.5).toVar();
    const szPrev = float(-1).toVar();
    // 画面里这一点的东西在水面以下吗（透过水看到的水底、浅滩）：它和光线上那一点在同一条视线上，
    // 高度按深度比例算。光线一直在水面上走，碰不到水下的东西——以前这样“撞上”的岸边浅滩，
    // 在倒影里是一道沿着岛的轮廓、带噪点的暗线
    const dry = (tt: N<'float'>, c: N<'vec4'>, sz: N<'float'>): N<'float'> =>
      step(P0.y.sub(0.5), cameraPosition.y.add(P0.y.add(Rd.y.mul(tt)).sub(cameraPosition.y).mul(sz.div(c.w.max(0.001)))));
    Loop(STEPS, () => {
      const c = proj(t1).toVar();
      const uvq = toUV(c).toVar();
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.0, 1.0)).toVar();
      const sz = viewZ(uvc).toVar();
      const onScreen = step(0.0, uvq.x).mul(step(uvq.x, 1.0)).mul(step(uvq.y, 1.0)).mul(step(0.0, uvq.y));
      // 光线走到了画面里那个东西的后面（而且没有穿过去太多）= 碰到了。离镜头 3 m 以内是座舱，不算。
      // 容差取这一步的长度，再小光线一步就跨过去了。
      // 这一步落点的画面一下子比上一步近了很多 = 跨过了前景的轮廓，光线其实是从悬崖“后面”飞进山谷的，不是撞上它：
      // 不排除的话，水面上会多出一条从悬崖脚下画出来的直线（薄的树冠漏过去也不要紧，下面的倒影场接得住）
      const solid = step(szPrev.sub(sz), t1.mul(0.7).add(30.0));
      const behind = step(sz, c.w).mul(step(c.w.sub(sz), t1.mul(0.34).add(24.0))).mul(step(3.0, sz)).mul(onScreen).mul(solid).mul(dry(t1, c, sz));
      szPrev.assign(sz);
      const fresh = behind.mul(float(1).sub(hit));
      huv.assign(mix(huv, uvc, fresh));
      hit.assign(max(hit, behind));
      // 还没碰到就继续往前走；碰到之后 t0、t1 留在最后这一段里，下面用二分法把位置找准
      t0.assign(select(hit.greaterThan(0.5), t0, t1));
      t1.assign(select(hit.greaterThan(0.5), t1, t1.mul(GROW)));
    });
    Loop(REFINE, () => {
      const mid = t0.add(t1).mul(0.5).toVar();
      const c = proj(mid).toVar();
      const uvq = toUV(c).toVar();
      const uvc = vec2(clamp(uvq.x, 0.0, 1.0), clamp(uvq.y, 0.0, 1.0)).toVar();
      const sz = viewZ(uvc).toVar();
      const behind = step(sz, c.w).mul(step(3.0, sz)).mul(dry(mid, c, sz));
      huv.assign(mix(huv, uvc, behind.mul(hit)));
      t1.assign(select(behind.greaterThan(0.5), mid, t1));
      t0.assign(select(behind.greaterThan(0.5), t0, mid));
    });
    // 贴着画面边缘的倒影淡出，换成倒影场，否则画面外的东西突然断掉
    const e = min(min(huv.x, float(1).sub(huv.x)), min(huv.y, float(1).sub(huv.y)));
    const live = float(1).sub(foam).mul(on).toVar();
    const k = hit.mul(smoothstep(0.0, 0.08, e)).mul(live).toVar();
    const far = vec4(0).toVar();
    if (field) {
      If(k.lessThan(0.995).and(live.greaterThan(0.01)), () => {
        far.assign(fieldMarch(P0, Rd, field, (sky.u.frame as unknown as N<'float'>).mul(5.588238), washout));
      });
    }
    const wFar = far.a.mul(live).mul(float(1).sub(k));
    // spread：波浪把倒影上下拉开多少（屏幕比例）。靠固定的多点采样模糊，逐帧抖动只留一点点：
    // 全靠抖动的话，悬停时时间抗锯齿能抹平，高速飞行时抹不平，远处的海面是一层飞快乱窜的颗粒
    const fr = (sky.u.frame as unknown as N<'float'>).mul(5.588238);
    const jit = interleavedGradientNoise(screenCoordinate.xy.add(fr)).sub(0.5).mul(0.2);
    const jx = interleavedGradientNoise(screenCoordinate.yx.add(fr.mul(1.7)).add(23.0)).sub(0.5).mul(0.3);
    const sp = spread.toVar();
    const offs = [-0.8, -0.4, 0, 0.4, 0.8];
    const tap = (uvq: N<'vec2'>, o: number) => vec2(uvq.x, clamp(uvq.y.add(jit.add(o).mul(sp)), 0.002, 0.998));
    const frame = frameCopy();
    const seen = offs.map((o) => frame.sample(tap(huv, o)).rgb).reduce((a, b) => a.add(b)).mul(1 / offs.length);
    // 云的倒影：左右也要散开一点，否则竖着抹开的云是一块块直边的方块
    const cloudTap = (uvq: N<'vec2'>, ox: number, oy: number) => vec2(clamp(uvq.x.add(jx.add(ox).mul(sp).mul(1.3)), 0.0, 1.0), clamp(uvq.y.add(jit.add(oy).mul(sp).mul(2.0)), 0.002, 0.998));
    // 天空：光线走到无穷远落在画面的哪里（云只有画面里才有）
    const cS = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(Rd, 0.0))).toVar();
    const uvS = toUV(cS).toVar();
    const eS = min(min(uvS.x, float(1).sub(uvS.x)), min(uvS.y, float(1).sub(uvS.y)));
    const uvC = vec2(clamp(uvS.x, 0.0, 1.0), clamp(uvS.y, 0.0, 1.0)).toVar();
    const skyRgb = sky.reflectedSky(Rd, [[-0.7, -0.66], [0.7, -0.33], [0, 0], [-0.7, 0.33], [0.7, 0.66]].map(([ox, oy]) => cloudTap(uvC, ox, oy)), step(0.01, cS.w).mul(smoothstep(0.0, 0.12, eS)));
    // 被风吹皱的水面：小波面朝向各不相同，倒影上下散开十几度，碰到的东西上面是什么也映了进来。
    // 低矮的岛上面是天：倒影淡下去，换成天光；高的崖壁上面还是崖壁：倒影照样是暗的（一律换成天光的话，峡湾里的水会发白）。
    // 往上隔开两点看深度：天空不写深度，落在天上（深度在最远处）才算“上面空着”；被座舱挡住看不见的当作还有东西，倒影照旧。
    // 空出来的权重给下面算好的天空颜色（带云），不用再从画面里取颜色
    let kHit: N<'float'> = k;
    if (washout) {
      const up = washout.mul(0.22).toVar();
      const skyAt = (f: number): N<'float'> => step(cameraFar.mul(0.9), viewZ(vec2(huv.x, clamp(huv.y.sub(up.mul(jit.add(f))), 0.002, 0.998))));
      const open = skyAt(0.45).add(skyAt(1.0)).mul(0.5);
      kHit = k.mul(float(1).sub(washout.mul(open))).toVar();
    }
    const wHit = kHit.add(wFar).toVar();
    const wSky = max(float(1).sub(wHit), 0.0).mul(live);
    const total = wHit.add(wSky).toVar();
    return MirrorOut(seen.mul(kHit).add(far.rgb.mul(wFar)).add(skyRgb.mul(wSky)).div(max(total, 0.001)), total, wHit);
  })();
}
