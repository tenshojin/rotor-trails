// 光线追踪的全局光照。浏览器没有硬件光追，但这个世界的主体是一张高度图，光线在高度图里走是真的光线追踪：
// 看得到画面外的山，没有屏幕空间那种“转个头光就变了”的问题。
//
// 换地图、换时段时，在显卡上给地图上每一格放一个探针，朝四面八方各发一百多条光线：
//   · 碰到地面：按那里的颜色、朝向、有没有被山挡住算出它反上来的光（太阳 + 天光 + 上一轮算好的反弹光，走三轮就是三次反弹）；
//   · 碰到水面：反射的天光，加一点太阳的碎金（岩壁上水光的来源）；
//   · 什么都没碰到：天空。天光画面里已经有了（环境贴图），这里不重复算。
// 结果按方向存下来（一阶球谐：平均亮度 + 从哪边来），每个像素按自己的朝向取，朝向不同，受光就不同：
// 背阴的岩壁被对面晒着太阳的岩壁映成暖色，机腹和屋檐下接着草地反上来的绿光，雪坡把四周照亮。
// 太阳在一局里不动，所以只算一次，飞行时每个像素只多三次纹理读取，也就没有噪点和闪烁。

import * as THREE from 'three/webgpu';
import { abs, Break, cos, dot, exp, float, Fn, If, int, length, Loop, luminance, max, mix, normalize, outputStruct, pow, property, reflect, screenUV, select, sin, smoothstep, sqrt, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { FOG } from './atmosphere';
import type { ReflectField } from './reflectMap';
import { terrainSun } from './sunMap';
import { VFOG } from './volumetricFog';

type N<T extends string> = THREE.Node<T>;

/** 每边的探针数（4 km 的地图一格 8 米） */
const SIZE = 512;
/** 每个探针的光线数（斐波那契球面，所有探针共用一组方向：相邻探针的误差相同，不会有噪点） */
const RAYS = 128;
/** 光线步数、第一步长度（米）、每步放大的倍数 */
const STEPS = 26;
const T0 = 6;
const GROW = 1.22;
const REFINE = 3;
/** 探针离地高度（米） */
const LIFT = 3;
/** 反弹轮数：第一轮只有直接光，之后每轮多一次反弹 */
const PASSES = 3;
/** 分块画，一次提交的工作量小一些，慢显卡不会触发驱动的超时 */
const TILES = 4;

function target(name: string): THREE.RenderTarget {
  const rt = new THREE.RenderTarget(SIZE, SIZE, { depthBuffer: false, count: 3, type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  rt.textures.forEach((t, i) => (t.name = `${name}${'RGB'[i]}`));
  rt.scissorTest = true;
  return rt;
}

const ping = target('GiA');
const pong = target('GiB');

const blankHeight = new THREE.DataTexture(new Uint16Array(4), 2, 2, THREE.RedFormat, THREE.HalfFloatType);
blankHeight.magFilter = blankHeight.minFilter = THREE.LinearFilter;
blankHeight.needsUpdate = true;
const blankColor = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat);
blankColor.magFilter = blankColor.minFilter = THREE.LinearFilter;
blankColor.needsUpdate = true;

const heightTex = texture(blankHeight);
const colorTex = texture(blankColor);
const mapSize = uniform(4096);
const top = uniform(1000);
const waterY = uniform(-1e4);
const bounce = uniform(0);

/** 运行时：on = 这张图算好了（地形着色器里那段假的反光就关掉），gain = 按天气调的强度 */
export const GI = {
  on: uniform(0),
  gain: uniform(1),
};

/** 比实际算出来的亮一些：探针图的地表颜色偏暗（地图是平均过的），而且地上的石头、建筑、树干都没进高度图 */
const BOOST = 2.2;
/** 反弹光的饱和度：地表颜色是整片平均的，全饱和的话白墙一靠近草地就发绿 */
const CHROMA = 0.65;

const heightAt = (q: N<'vec2'>): N<'float'> => max(heightTex.sample(q.div(mapSize).add(0.5)).level(float(0)).r, waterY);

/** 探针图 → 朝向 n 的表面接收到的反弹光（已除以 π，乘上反照率就是出射亮度） */
function lookup(src: THREE.RenderTarget, uvq: N<'vec2'>, n: N<'vec3'>): N<'vec3'> {
  const w = vec4(1, n.mul(2));
  const [r, g, b] = src.textures.map((t) => texture(t).sample(uvq).level(float(0)));
  return max(vec3(dot(r, w), dot(g, w), dot(b, w)), vec3(0));
}

/** 沿 d 走，碰到地面（或水面）时 hit = 1，t0..t1 把碰撞点夹在中间 */
function march(P0: N<'vec3'>, d: N<'vec3'>, t0: N<'float'>, t1: N<'float'>, hit: N<'float'>): void {
  Loop(STEPS, () => {
    const p = P0.add(d.mul(t1)).toVar();
    // 飞出地图、升到最高的山顶之上：什么也碰不到了
    If(p.y.greaterThan(top).or(max(abs(p.x), abs(p.z)).greaterThan(mapSize.mul(0.5))), () => {
      Break();
    });
    If(p.y.lessThan(heightAt(p.xz)), () => {
      hit.assign(1);
      Break();
    });
    t0.assign(t1);
    t1.assign(t1.mul(GROW).add(2.0));
  });
}

/** 碰撞点沿 d 方向反过来的亮度：prev 是上一轮的探针图，k 是它的权重 */
function shade(P0: N<'vec3'>, d: N<'vec3'>, t0: N<'float'>, t1: N<'float'>, prev: THREE.RenderTarget, k: N<'float'>): N<'vec3'> {
  Loop(REFINE, () => {
    const mid = t0.add(t1).mul(0.5).toVar();
    const q = P0.add(d.mul(mid)).toVar();
    const under = q.y.lessThan(heightAt(q.xz));
    t1.assign(select(under, mid, t1));
    t0.assign(select(under, t0, mid));
  });
  const p = P0.add(d.mul(t1)).toVar();
  const uvq = p.xz.div(mapSize).add(0.5).toVar();
  const e = 8.0;
  const hx = heightAt(p.xz.add(vec2(e, 0))).sub(heightAt(p.xz.sub(vec2(e, 0))));
  const hz = heightAt(p.xz.add(vec2(0, e))).sub(heightAt(p.xz.sub(vec2(0, e))));
  const n = normalize(vec3(hx.negate(), 2 * e, hz.negate())).toVar();
  const alb = colorTex.sample(uvq).level(float(0)).toVar();
  const sun = VFOG.sun.mul(max(dot(n, FOG.sunDir), 0.0).mul(terrainSun(p)).mul(1 / Math.PI));
  const sky = FOG.color.mul(alb.a.mul(0.75).add(0.1));
  const ground = alb.rgb.mul(sun.add(sky).add(lookup(prev, uvq, n).mul(k))).toVar();
  // 水面：菲涅尔反射的天光 + 太阳的碎金（波浪把太阳的倒影撒开成一大片，岩壁上那层水光就是它）
  const fres = float(0.02).add(pow(float(1).sub(abs(d.y)), 5.0).mul(0.98)).toVar();
  const refl = vec3(d.x, d.y.negate(), d.z);
  const glitter = pow(max(dot(refl, FOG.sunDir), 0.0), 24.0).mul(terrainSun(p));
  const water = FOG.color.mul(fres.add(0.04)).add(VFOG.sun.mul(glitter.mul(fres.mul(0.5).add(0.012))));
  return mix(ground, water, step(p.y, waterY.add(0.05)));
}

function tracer(prev: THREE.RenderTarget): THREE.NodeMaterial {
  const outR = property('vec4');
  const outG = property('vec4');
  const outB = property('vec4');
  const result = outputStruct(outR, outG, outB);
  const main = Fn(() => {
    const xz = screenUV.sub(0.5).mul(mapSize).toVar();
    const P0 = vec3(xz.x, heightAt(xz).add(LIFT), xz.y).toVar();
    const accR = vec4(0).toVar();
    const accG = vec4(0).toVar();
    const accB = vec4(0).toVar();
    Loop({ start: int(0), end: int(RAYS), type: 'int', condition: '<' }, ({ i }: { i: N<'int'> }) => {
      const fi = float(i);
      const dy = float(1).sub(fi.add(0.5).mul(2 / RAYS)).toVar();
      const ring = sqrt(max(float(1).sub(dy.mul(dy)), 0.0)).toVar();
      const phi = fi.mul(2.399963).toVar();
      const d = vec3(ring.mul(cos(phi)), dy, ring.mul(sin(phi))).toVar();
      const t0 = float(0).toVar();
      const t1 = float(T0).toVar();
      const hit = float(0).toVar();
      march(P0, d, t0, t1, hit);
      If(hit.greaterThan(0.5), () => {
        const L = shade(P0, d, t0, t1, prev, bounce).toVar();
        accR.addAssign(vec4(L.r, d.mul(L.r)));
        accG.addAssign(vec4(L.g, d.mul(L.g)));
        accB.addAssign(vec4(L.b, d.mul(L.b)));
      });
    });
    outR.assign(accR.mul(1 / RAYS));
    outG.assign(accG.mul(1 / RAYS));
    outB.assign(accB.mul(1 / RAYS));
    return vec4(0);
  });
  const mat = new THREE.NodeMaterial();
  mat.name = 'GiTrace';
  mat.colorNode = main();
  mat.outputNode = result;
  return mat;
}

/** 探针图在内存里的一份，给舱内补光用（舱内不走后期的反弹光：座舱模型的光是烘焙好的） */
let probes: Uint16Array[] | null = null;
let bakeId = 0;

async function readProbes(renderer: THREE.WebGPURenderer, id: number): Promise<void> {
  type Reader = { readRenderTargetPixelsAsync(rt: THREE.RenderTarget, x: number, y: number, w: number, h: number, index: number): Promise<ArrayBufferView> };
  const reader = renderer as unknown as Reader;
  try {
    const data = await Promise.all([0, 1, 2].map((i) => reader.readRenderTargetPixelsAsync(ping, 0, 0, SIZE, SIZE, i)));
    if (id === bakeId) probes = data.map((d) => new Uint16Array(d.buffer, d.byteOffset, d.byteLength / 2));
  } catch (error) {
    console.warn('读取探针图失败，舱内不跟随地面反光：', error);
  }
}

/** 这个位置下方的地面反上来多少光（朝下的表面接到的亮度）；探针图还没算好时返回 false */
export function giGroundLight(x: number, z: number, size: number, out: THREE.Color): boolean {
  const data = probes;
  if (!data) return false;
  const ix = Math.min(SIZE - 1, Math.max(0, Math.floor((x / size + 0.5) * SIZE)));
  const iz = Math.min(SIZE - 1, Math.max(0, Math.floor((z / size + 0.5) * SIZE)));
  const at = (c: number): number => {
    const stride = data[c].length / SIZE;
    const o = iz * stride + ix * 4;
    return Math.max(0, THREE.DataUtils.fromHalfFloat(data[c][o]) - 2 * THREE.DataUtils.fromHalfFloat(data[c][o + 2]));
  };
  out.setRGB(at(0), at(1), at(2));
  return true;
}

let quad: THREE.QuadMesh | null = null;
let readPing: THREE.NodeMaterial | null = null;
let readPong: THREE.NodeMaterial | null = null;

/** 换地图时调用 */
export function setGiMap(field: ReflectField, water: number | null): void {
  heightTex.value = field.height;
  colorTex.value = field.color;
  mapSize.value = field.size;
  top.value = field.top;
  waterY.value = water ?? -1e4;
  GI.on.value = 0;
}

export function clearGiMap(): void {
  heightTex.value = blankHeight;
  colorTex.value = blankColor;
  GI.on.value = 0;
  probes = null;
  bakeId++;
}

/** 跑一遍所有光线（要在太阳、天空的 uniform 更新之后调用） */
export function bakeGi(renderer: THREE.WebGPURenderer): void {
  quad ??= new THREE.QuadMesh(new THREE.NodeMaterial());
  readPing ??= tracer(ping);
  readPong ??= tracer(pong);
  const rt = renderer.getRenderTarget();
  const mrt = renderer.getMRT();
  const autoClear = renderer.autoClear;
  renderer.setMRT(null);
  // 每一块都是一次渲染，自动清屏会把前面画好的块清掉（清屏不受裁剪框限制）
  renderer.autoClear = false;
  const span = SIZE / TILES;
  // 结果要落在 ping 上（画面读的是它）：第一轮写 ping，之后来回倒，轮数是单数
  for (let pass = 0; pass < PASSES; pass++) {
    const dst = pass % 2 === 0 ? ping : pong;
    quad.material = pass % 2 === 0 ? readPong : readPing;
    bounce.value = pass === 0 ? 0 : 1;
    renderer.setRenderTarget(dst);
    for (let y = 0; y < TILES; y++)
      for (let x = 0; x < TILES; x++) {
        dst.scissor.set(x * span, y * span, span, span);
        quad.render(renderer);
      }
  }
  renderer.setRenderTarget(rt);
  renderer.setMRT(mrt);
  renderer.autoClear = autoClear;
  GI.on.value = 1;
  probes = null;
  void readProbes(renderer, ++bakeId);
}

/** 画面里某一点（世界坐标 p、世界法线 n）接到的反弹光 */
export function giBounce(p: N<'vec3'>, n: N<'vec3'>): N<'vec3'> {
  const uvq = p.xz.div(mapSize).add(0.5).toVar();
  // 地图边上淡出：外面是不参与计算的远景
  const edge = float(1).sub(smoothstep(0.47, 0.5, max(abs(uvq.x.sub(0.5)), abs(uvq.y.sub(0.5)))));
  const e = lookup(ping, uvq, n).toVar();
  return mix(vec3(luminance(e)), e, CHROMA).mul(edge.mul(GI.gain).mul(GI.on).mul(BOOST));
}

/**
 * 金属、玻璃上的反射：同一套光线，从这个像素沿镜面方向走，碰到的地形、水面都看得到（画面外的也一样，边缘没有屏幕空间反射那种锯齿）。
 * 返回 vec4(那里的亮度, 碰到了吗)；碰不到的光线就是天空，环境贴图已经反射过了。
 */
export const giReflect = Fn(([pIn, nIn, eyeIn]: [N<'vec3'>, N<'vec3'>, N<'vec3'>]) => {
  const n = vec3(nIn);
  const eye = vec3(eyeIn);
  const out = vec4(0).toVar();
  const d = reflect(normalize(vec3(pIn).sub(eye)), n).toVar();
  const P0 = vec3(pIn).add(n.mul(0.6)).toVar();
  const t0 = float(0).toVar();
  const t1 = float(T0).toVar();
  const hit = float(0).toVar();
  march(P0, d, t0, t1, hit);
  If(hit.greaterThan(0.5), () => {
    const L = shade(P0, d, t0, t1, ping, float(BOOST)).toVar();
    const dist = length(P0.sub(eye)).add(t1);
    const fogK = float(1).sub(exp(FOG.density.mul(FOG.density).add(FOG.cloud.mul(FOG.cloud)).mul(dist).mul(dist).negate()));
    out.assign(vec4(mix(L, FOG.color, fogK), 1.0));
  });
  return out;
});

export function disposeGi(): void {
  readPing?.dispose();
  readPong?.dispose();
  readPing = readPong = null;
  ping.dispose();
  pong.dispose();
}
