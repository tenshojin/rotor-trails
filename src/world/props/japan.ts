// 日本海湾地图的建筑与地标：民居（瓦顶）、村落生成器、港口仓库、龙门吊、码头、渔船、渡轮、灯塔、
// 海上鸟居、神社、五重塔、观测站、海蚀柱、防波堤。
// 神社与五重塔参照濑户内沿岸的寺社（鞆之浦一带）：坐在花岗岩砌的基坛上，门前是碎石铺的参道，
// 两旁立着春日式石灯笼，参道入口有一座小鸟居；灯塔坐在混凝土台基上，四周围着白色栏杆。

import type { Rng } from '../../core/noise';
import type { PropDef } from '../../maps/types';
import type { PropBuilder } from '../propBuilder';
import { C, type PropCtx, type PropFn } from './common';
import { frontSteps, lotPoint, plinth, railFence, settle, siteGround, terrace, yard } from './settle';

/** 五重塔各层（与 tools/blender/jlandmarks.py 的 pagoda_levels() 同一套参数）：底高、柱高、半宽、出檐外缘、檐口高、屋面内沿高 */
const PAGODA_LEVELS = (() => {
  const W = [7.0, 6.4, 5.8, 5.2, 4.6];
  const H = [3.5, 2.6, 2.5, 2.4, 2.4];
  const OV = [2.5, 2.4, 2.3, 2.2, 2.1];
  const out: Array<{ k: number; zf: number; h: number; hw: number; X1: number; ze: number; zIn: number }> = [];
  let z = 1.35;
  for (let k = 0; k < 5; k++) {
    const hw = W[k] / 2;
    const zb = z + H[k] + 1.05;
    const X1 = hw + OV[k];
    const ze = zb - (X1 - (hw + 1.3)) * 0.42;
    const xIn = k < 4 ? W[k + 1] / 2 + 0.85 : 0;
    const zIn = ze + (X1 - xIn) * 0.42;
    out.push({ k, zf: z, h: H[k], hw, X1, ze, zIn });
    z = zIn + 0.25;
  }
  return out;
})();
const PAGODA_TOP = PAGODA_LEVELS[4].zIn;

/** 花岗岩（基坛、石灯笼；顶点色按线性值使用，取偏暗的灰） */
const GRANITE_J = 0x45433e;

/** 春日式石灯笼（约 2.1 m）：基座、竿、中台、火袋、笠、宝珠 */
function stoneLantern(B: PropBuilder, ctx: PropCtx, x: number, z: number, rot: number, yAt?: number): void {
  const y = yAt ?? ctx.terrain.heightAt(x, z);
  if (ctx.waterLevel !== null && y < ctx.waterLevel + 0.3) return;
  B.at(x, y, z, rot, 1);
  const o = { mat: 'stone' as const, solid: false, jitter: 0.05 };
  B.box(0, 0.05, 0, 0.78, 0.5, 0.78, GRANITE_J, o);
  B.cyl(0, 0.62, 0, 0.15, 0.13, 0.75, GRANITE_J, 8, o);
  B.box(0, 1.07, 0, 0.62, 0.16, 0.62, GRANITE_J, o);
  B.box(0, 1.37, 0, 0.42, 0.44, 0.42, 0x5a5650, o);
  B.box(0, 1.37, 0.215, 0.2, 0.22, 0.02, 0x1a1a18, { solid: false });
  B.hip(0, 1.6, 0, 0.95, 0.95, 0.32, 0.12, GRANITE_J, o, 0.05);
  B.sphere(0, 2.0, 0, 0.1, GRANITE_J, { mat: 'stone', solid: false, seg: 6 });
}

/** 参道：从 (局部) z0 到 z1 沿局部 +z 的碎石路，两旁每 spacing 米一对石灯笼，起点处一座小鸟居 */
function approach(B: PropBuilder, ctx: PropCtx, l: { x: number; z: number; rot: number }, z0: number, z1: number, spacing: number, torii: boolean): void {
  const a = lotPoint(l, 0, z0);
  const b = lotPoint(l, 0, z1);
  ctx.paintPath?.(1, [a, b], 1.8, 1.2, 0.9);
  ctx.paintPath?.(2, [a, b], 4, 2, 1);
  for (let zz = z0 + 3; zz < z1 - 4; zz += spacing)
    for (const side of [-1, 1]) {
      const [x, z] = lotPoint(l, side * 3.1, zz);
      stoneLantern(B, ctx, x, z, l.rot);
    }
  if (!torii) return;
  // 参道入口的小鸟居（与海上大鸟居同一个模型，缩小到约 5 m 高；柱脚埋进地面）
  const [tx, tz] = lotPoint(l, 0, z1 - 2);
  const s = 0.4;
  B.at(tx, ctx.terrain.heightAt(tx, tz) + 1.5 * s, tz, l.rot, s);
  toriiGeom(B);
}

const ROOF = [0x3b4350, 0x434b56, 0x4a3f3a, 0x2f3640];
const WALL = [0xe9e3d6, 0xdcd4c2, 0x6b5440, 0xcfc6b2, 0x8a6a4c];

/** 石垣平台比房子四周各宽出的距离（米，参考尺寸下；与 tools/blender/jhouse.py 的 PLAT_M 一致）与向下的深度 */
const PLAT_M = 1.5;
const PLAT_DEPTH = 3.2;

export interface HouseInfo {
  /** 平台的半宽 / 半深（游戏局部 x / z） */
  hw: number;
  hd: number;
  twoStory: boolean;
}

/**
 * 民居（Blender 模型，参考尺寸 8.5 × 7 m，按本栋的宽/深缩放）。房子坐在石垣平台上：
 * 平台顶面 = 放置高度，向下 3.2 m 的石砌挡土墙（坡地上下坡一侧露出来，与濑户内沿岸村落一样）。
 */
export function jhouse(B: PropBuilder, rng: Rng, big = false): HouseInfo {
  const w = rng.range(7, 10) * (big ? 1.3 : 1);
  const d = rng.range(6, 8) * (big ? 1.2 : 1);
  const h = 3;
  const wall = rng.pick(WALL);
  const roof = rng.pick(ROOF);
  const twoStory = rng.chance(big ? 0.9 : 0.45);
  // 褐色墙 → 杉板外墙款；大宅的二层款单独建模（参考 11 × 8.4 m），瓦垄与门窗不会被拉宽
  const wood = wall === 0x6b5440 || wall === 0x8a6a4c;
  const large = big && twoStory;
  const [rw, rd] = large ? [11, 8.4] : [8.5, 7];
  const pw = (w * (rw + 2 * PLAT_M)) / rw;
  const pd = (d * (rd + 2 * PLAT_M)) / rd;
  B.beginModel(`jhouse_${twoStory ? 2 : 1}${wood ? 'b' : 'a'}${large ? 'L' : ''}`, 0, 0, 0, 0, w / rw, 1, d / rd);
  B.box(0, h / 2, 0, w, h, d, wall, { jitter: 0.06 });
  B.box(0, 0.25, 0, w + 0.2, 0.5, d + 0.2, 0x6f6a62, { solid: false });
  // 石垣平台（也是碰撞体）
  B.box(0, -PLAT_DEPTH / 2, 0, pw, PLAT_DEPTH, pd, 0x8f8a80, { jitter: 0.04 });
  // 窗与门
  for (let i = -1; i <= 1; i++) B.box(i * w * 0.3, h * 0.55, d / 2 + 0.03, 1.2, 0.9, 0.06, 0x2a2f36, { solid: false, mat: 'glass' });
  B.box(w * 0.35, h * 0.4, -d / 2 - 0.03, 1.1, 2.0, 0.06, 0x4a3828, { solid: false });
  if (twoStory) {
    const w2 = w * 0.75;
    const d2 = d * 0.8;
    B.box(0, h + 1.5, 0, w2, 3, d2, wall, { jitter: 0.05 });
    B.hip(0, h, 0, w + 0.4, d + 0.4, 0.9, 0.6, roof, { solid: false }, 0.9);
    B.hip(0, h + 3, 0, w2, d2, 2.0, 0.7, roof, {}, 0.4);
  } else {
    B.hip(0, h, 0, w, d, 2.2, 0.75, roof, {}, 0.45);
  }
  B.endModel();
  B.footprint(Math.hypot(pw, pd) / 2 + 1.0);
  return { hw: pw / 2, hd: pd / 2, twoStory };
}

/** 电线杆挂线点（局部坐标，与 tools/blender/props_japan.py 的 denchu 一致）：高压 3 根、低压 2 根、通信 1 根 */
const POLE_WIRES: Array<[number, number, number, number]> = [
  // x, y, z, 弧垂比例（档距的百分比）
  [-0.65, 10.93, -0.16, 0.018],
  [0.0, 10.93, -0.16, 0.018],
  [0.65, 10.93, -0.16, 0.018],
  [-0.55, 10.13, -0.16, 0.022],
  [0.55, 10.13, -0.16, 0.022],
  [0.45, 6.4, 0.0, 0.035],
];

interface Pole {
  x: number;
  y: number;
  z: number;
  rot: number;
}

/** 两点间的一根电线：抛物线近似悬链线，分 6 段画成细杆 */
function wire(B: PropBuilder, a: [number, number, number], b: [number, number, number], sagK: number, color = 0x1b1c1e, r = 0.02): void {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const sag = L * sagK;
  const n = 6;
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    B.beam(prev, p, r, color, { solid: false, mat: 'wire', jitter: 0 });
    prev = p;
  }
}

/** 电线杆局部坐标的挂线点 → 世界坐标 */
function poleAttach(p: Pole, k: number): [number, number, number] {
  const [lx, ly, lz] = POLE_WIRES[k];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return [p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c];
}

/**
 * 村落：在半径内按地形自动放置民居（避开水面与陡坡），参照濑户内沿岸的村子：
 *   · 房子坐在石垣平台上（取平台范围内地面的最高处，下坡一侧露出石墙）；
 *   · 房子之间用最小生成树连成窄巷（地表画成碎石路），院子四周是踩实的泥地；
 *   · 沿巷子每 30 m 左右立一根电线杆，杆间拉高压、低压与通信线，再从最近的杆子拉一根进户线到各家屋檐。
 */
function village(B: PropBuilder, d: PropDef, rng: Rng, ctx: PropCtx): void {
  const [cx, , cz] = B.origin;
  const r = Number(d.p?.r ?? 120);
  const n = Number(d.p?.n ?? 14);
  const minH = Number(d.p?.minH ?? 1.5);
  const placed: Array<{ x: number; y: number; z: number; rot: number; info: HouseInfo }> = [];
  let tries = 0;
  const T = ctx.terrain;
  while (placed.length < n && tries++ < n * 25) {
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.float()) * r;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const h = T.heightAt(x, z);
    if (h < minH || (ctx.waterLevel !== null && h < ctx.waterLevel + 1.2)) continue;
    if (T.slopeAt(x, z) > 0.18) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 17)) continue;
    // 朝向大致对齐（村落街道感）
    const rot = Math.round(rng.range(0, 4)) * (Math.PI / 2) + Number(d.rotY ?? 0) + rng.range(-0.08, 0.08);
    // 平台顶面：房子本身范围（约 5 m 半径）内地面的最高处——房子不会陷进上坡一侧；
    // 平台外沿在上坡一侧被土埋住、在下坡一侧露出石墙（平地上只露出一点点）
    let top = h;
    for (let k = 0; k < 12; k++) {
      const aa = (k / 12) * Math.PI * 2;
      for (const rad of [2.5, 4.8]) top = Math.max(top, T.heightAt(x + Math.cos(aa) * rad, z + Math.sin(aa) * rad));
    }
    B.at(x, top + 0.05, z, rot, 1);
    const info = jhouse(B, rng, rng.chance(0.15));
    placed.push({ x, y: top + 0.05, z, rot, info });
  }
  if (placed.length < 2) return;
  // 院子四周踩实的泥地（不长树）
  for (const p of placed) {
    const rad = Math.hypot(p.info.hw, p.info.hd);
    ctx.paintCircle?.(1, p.x, p.z, rad + 0.5, 2.5, 0.45);
    ctx.paintCircle?.(2, p.x, p.z, rad + 2, 3, 1);
  }
  // 最小生成树（Prim）把房子连成巷子
  const inTree = new Set<number>([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < placed.length) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const i of inTree)
      for (let j = 0; j < placed.length; j++) {
        if (inTree.has(j)) continue;
        const dd = Math.hypot(placed[i].x - placed[j].x, placed[i].z - placed[j].z);
        if (dd < bd) {
          bd = dd;
          best = [i, j];
        }
      }
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  const insidePlatform = (x: number, z: number, margin: number) =>
    placed.some((p) => {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const dx = x - p.x;
      const dz = z - p.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return Math.abs(lx) < p.info.hw + margin && Math.abs(lz) < p.info.hd + margin;
    });
  const poles: Pole[] = [];
  const spans: Array<[number, number]> = [];
  const nearestPole = new Map<number, number>();
  for (const [i, j] of edges) {
    const A = placed[i];
    const Bh = placed[j];
    // 巷子：碎石 / 泥土路面，宽约 2.6 m
    ctx.paintPath?.(1, [[A.x, A.z], [Bh.x, Bh.z]], 1.3, 1.6, 0.9);
    ctx.paintPath?.(2, [[A.x, A.z], [Bh.x, Bh.z]], 2.6, 2, 1);
    // 沿巷子一侧立电线杆
    const L = Math.hypot(Bh.x - A.x, Bh.z - A.z);
    const ux = (Bh.x - A.x) / L;
    const uz = (Bh.z - A.z) / L;
    const nx = -uz;
    const nz = ux;
    const segs = Math.max(1, Math.round(L / 30));
    let prev = -1;
    for (let k = 0; k <= segs; k++) {
      const t = 0.12 + (0.76 * k) / segs;
      const x = A.x + (Bh.x - A.x) * t + nx * 2.3;
      const z = A.z + (Bh.z - A.z) * t + nz * 2.3;
      if (insidePlatform(x, z, 0.8)) continue;
      if (T.slopeAt(x, z) > 0.45) continue;
      const y = T.heightAt(x, z);
      if (ctx.waterLevel !== null && y < ctx.waterLevel + 0.3) continue;
      // 腕金（局部 X）垂直于巷子方向：局部 Z 轴沿巷子
      const rot = Math.atan2(ux, uz);
      const idx = poles.length;
      poles.push({ x, y, z, rot });
      if (prev >= 0) spans.push([prev, idx]);
      prev = idx;
    }
  }
  // 各段之间：在房子附近把不同巷子的电线杆接起来（最近的一对），形成连通的线网
  for (let i = 0; i < poles.length; i++)
    for (let j = i + 1; j < poles.length; j++) {
      const dd = Math.hypot(poles[i].x - poles[j].x, poles[i].z - poles[j].z);
      if (dd > 4 && dd < 26 && !spans.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) {
        // 只接到还没有两根以上线的杆子，避免蛛网
        const deg = (k: number) => spans.filter(([a, b]) => a === k || b === k).length;
        if (deg(i) < 2 && deg(j) < 2) spans.push([i, j]);
      }
    }
  poles.forEach((p, i) => {
    B.at(p.x, p.y, p.z, p.rot, 1);
    // 约三成带柱上变压器与防犯灯（按序号决定，不消耗随机数，其他道具的随机序列不受影响）
    B.beginModel((i * 7919) % 10 < 3 ? 'denchu_b' : 'denchu_a');
    B.cyl(0, 6, 0, 0.19, 0.12, 12, 0xa4a6a2, 8);
    B.endModel();
    B.footprint(1.5);
  });
  // 电线（世界坐标）
  B.at(0, 0, 0, 0, 1);
  for (const [a, b] of spans) {
    for (let k = 0; k < POLE_WIRES.length; k++) {
      wire(B, poleAttach(poles[a], k), poleAttach(poles[b], k), POLE_WIRES[k][3], 0x1b1c1e, k < 3 ? 0.016 : 0.022);
    }
  }
  // 进户线：从最近的杆子（低压线高度）拉到屋檐角
  placed.forEach((p, hi) => {
    let best = -1;
    let bd = Infinity;
    poles.forEach((q, qi) => {
      const dd = Math.hypot(q.x - p.x, q.z - p.z);
      if (dd < bd) {
        bd = dd;
        best = qi;
      }
    });
    if (best < 0 || bd > 45) return;
    nearestPole.set(hi, best);
    const q = poles[best];
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    // 屋檐角（局部 x = 半宽、z = 半深，取离杆子近的那个角）
    let tx = 0;
    let tz = 0;
    let td = Infinity;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = sx * (p.info.hw - 1.6);
      const lz = sz * (p.info.hd - 1.6);
      const wx = p.x + lx * c + lz * s;
      const wz = p.z - lx * s + lz * c;
      const dd = Math.hypot(wx - q.x, wz - q.z);
      if (dd < td) {
        td = dd;
        tx = wx;
        tz = wz;
      }
    }
    wire(B, poleAttach(q, 4), [tx, p.y + (p.info.twoStory ? 5.6 : 2.7), tz], 0.04, 0x1b1c1e, 0.012);
  });
}

export const japanProps: Record<string, PropFn> = {
  jhouse(B, _d, rng) {
    jhouse(B, rng);
  },
  jvillage: village,
  warehouse(B, d) {
    const w = Number(d.p?.w ?? 22);
    const l = Number(d.p?.l ?? 34);
    const h = Number(d.p?.h ?? 9);
    const col = Number(d.p?.color ?? 0x7f8b96);
    B.beginModel(String(d.p?.model ?? 'pshed_a'), 0, 0, 0, 0, w / 22, h / 9, l / 40);
    B.box(0, h / 2, 0, w, h, l, col, { mat: 'metal', jitter: 0.04 });
    B.gable(0, h, 0, l, w, 2.4, 0.4, 0x5d6670, { mat: 'metal' }, Math.PI / 2);
    B.endModel();
    B.footprint(Math.hypot(w, l) / 2 + 2);
  },
  crane(B) {
    // 港口悬臂吊：立柱 + 机房 + 桁架悬臂（碰撞体只取立柱和悬臂的外包）
    B.beginModel('jib_crane');
    B.cyl(0, 7.5, 0, 1.1, 0.9, 15, 0x2f5f8f, 12, { mat: 'metal' });
    B.box(-1.2, 15.8, 0, 8, 3, 3.4, 0xdedfdc, { mat: 'metal' });
    B.box(13.8, 21, 0, 25, 1.6, 2, 0x2f5f8f, { mat: 'metal' });
    B.endModel();
    B.anchor('blink', 26.5, 26.2, 0, 0, { color: 'red', period: 1.5 });
    B.footprint(6);
  },
  pier(B, d) {
    // 码头：沿 +X 伸出的栈桥，每段一个模型（模型缺失时退回一块长板）
    const len = Number(d.p?.len ?? 80);
    const w = Number(d.p?.w ?? 10);
    const deck = Number(d.p?.deck ?? 2.5);
    const n = Math.max(1, Math.round(len / 20));
    const sl = len / n;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * sl;
      B.beginModel('pier_seg', x, deck, 0, 0, sl / 20, 1, w / 10);
      B.box(x, deck - 0.4, 0, sl, 0.8, w, 0x8a857c, { mat: 'rough' });
      for (const sz of [-w / 2 + 0.6, w / 2 - 0.6]) B.cyl(x, deck / 2 - 3, sz, 0.35, 0.35, deck + 6, 0x5a5550, 6, { solid: false });
      B.endModel();
    }
  },
  quay(B, d) {
    // 岸壁：沿 Z 排开的一段段模型，原点在岸壁外沿
    const len = Number(d.p?.len ?? 200);
    const n = Math.round(len / 40);
    for (let i = 0; i < n; i++) {
      B.beginModel('quay_seg', 0, 0, (i - (n - 1) / 2) * 40);
      B.endModel();
    }
  },
  portYard(B, d, rng) {
    // 港区的零碎：沿岸路灯、停着的小货车、鱼箱和渔网堆；局部 +X 朝水面，范围 Z ±len/2
    const len = Number(d.p?.len ?? 200);
    for (let z = -len / 2 + 20; z < len / 2; z += 58) B.beginModel('street_lamp', -16, 0, z, Math.PI).endModel();
    const n = Number(d.p?.n ?? 16);
    const models = ['fish_boxes', 'fish_boxes', 'net_a', 'net_b', 'kei_truck'];
    for (let i = 0; i < n; i++) {
      const z = rng.range(-len / 2, len / 2);
      const x = rng.range(-30, -11);
      B.beginModel(models[i % models.length], x, 0, z, rng.range(0, 6.28));
      B.endModel();
    }
  },
  boat(B, d, rng) {
    const l = Number(d.p?.l ?? rng.range(10, 16));
    const w = l * 0.32;
    const hulls = [0xe8e8e8, 0x2f62b0, 0xb8322a, 0x3c8a4a];
    const hull = rng.pick(hulls);
    B.beginModel(`boat_${hulls.indexOf(hull)}`, 0, 0, 0, 0, l / 13, l / 13, l / 13);
    B.box(0, 0.6, 0, l, 2.2, w, hull, { jitter: 0.05 });
    B.box(-l / 2 - 1.2, 0.9, 0, 2.6, 1.6, w * 0.7, hull, { solid: false }, 0);
    B.box(l * 0.15, 2.6, 0, l * 0.3, 1.8, w * 0.75, 0xf2f2f2, {});
    B.box(l * 0.15, 3.0, 0, l * 0.3 + 0.1, 0.6, w * 0.76, 0x2a3440, { mat: 'glass', solid: false });
    B.cyl(l * 0.15, 5.0, 0, 0.1, 0.08, 3, 0xdddddd, 6, { solid: false });
    B.endModel();
    B.footprint(l / 2);
  },
  ferry(B) {
    const l = 46;
    const w = 11;
    B.beginModel('ferry_jp');
    B.box(0, 1.5, 0, l, 5, w, 0xf0f0f0, { jitter: 0.03 });
    B.box(-4, 5.5, 0, l * 0.6, 3, w - 1.5, 0xf4f4f4, {});
    B.box(2, 8.5, 0, 10, 3, w - 3, 0xf4f4f4, {});
    B.cyl(-10, 9.5, 0, 1.2, 1.4, 4, 0xc0392b, 10, {});
    B.endModel();
    B.footprint(24);
  },
  lighthouse(B, _d, _rng, ctx) {
    const h = 20;
    // 混凝土台基 + 四周的白色栏杆（朝向灯塔的门留个口）
    const [ox, , oz] = B.origin;
    const { base, depth } = settle(ctx, ox, oz, 0, 4.3, 4.3, 0.15);
    B.at(ox, base, oz, 0, 1);
    plinth(B, 4.3, 4.3, depth, 0x5a5954, 'rough', 0.5);
    const ring: Array<[number, number]> = [];
    for (let k = 0; k <= 18; k++) {
      const a = 0.4 + (k / 18) * (Math.PI * 2 - 0.8);
      ring.push([ox + Math.cos(a) * 8.5, oz + Math.sin(a) * 8.5]);
    }
    railFence(B, ctx, ring, 1.1, 2.2, 0xe8e8e4);
    yard(ctx, { x: ox, z: oz, rot: 0, hw: 4.3, hd: 4.3, base }, 4.5, 0.45);
    B.at(ox, base, oz, 0, 1);
    B.beginModel('lighthouse');
    B.cyl(0, 1, 0, 4, 4.2, 2, 0x9a958c, 14, { mat: 'rough' });
    B.cyl(0, 2 + h / 2, 0, 2.6, 1.8, h, 0xf2f2ee, 16, {});
    for (let k = 0; k < 3; k++) B.cyl(0, 5 + k * 6, 0, 2.35 - k * 0.22, 2.25 - k * 0.22, 1.0, 0xc0392b, 16, { solid: false });
    B.cyl(0, h + 2.4, 0, 2.6, 2.6, 0.4, 0x333333, 16, { solid: false });
    B.cyl(0, h + 3.8, 0, 1.4, 1.4, 2.6, 0xfff6d0, 12, { mat: 'emit', solid: false });
    B.cone(0, h + 6.0, 0, 1.8, 1.8, 0xc0392b, 12, { solid: false });
    B.endModel();
    B.colliderBox(0, h + 3.5, 0, 1.8, 2.5, 1.8);
    B.anchor('beacon', 0, h + 3.8, 0, 0, { color: 'white', period: 4 });
    B.footprint(6);
  },
  torii(B) {
    toriiGeom(B);
    B.footprint(9);
  },
  shrine(B, _d, _rng, ctx) {
    // 拜殿坐在花岗岩基坛上（模型自带 1.2 m 的台基，这里补上坡地下坡一侧露出的部分），门前（局部 +z）是参道
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    // 台地比拜殿四周宽出 3 m（前面 5 m，留出参拜的空地）；坡地上是带收分的石垣，前面一段石阶下到参道
    const { base, depth } = settle(ctx, ox, oz + 0, rot, 9, 9.5, 0.05);
    B.at(ox, base, oz, rot, 1);
    terrace(B, 9, 9.5, depth, GRANITE_J, 0.32, 'stone', 0.6, 0x6a6458);
    frontSteps(B, ctx, { x: ox, z: oz, rot }, base, 9.5, 2.8, GRANITE_J);
    yard(ctx, { x: ox, z: oz, rot, hw: 9, hd: 9.5, base }, 3, 0.5);
    approach(B, ctx, { x: ox, z: oz, rot }, 10, 52, 7.5, true);
    B.at(ox, base, oz, rot, 1);
    B.beginModel('shrine');
    // 后备几何与碰撞体：基坛、高床上的拜殿、入母屋屋顶、向拜（与 jlandmarks.py 的 shrine() 一致；正面朝局部 +z）
    B.box(0, 0.45, 0.8, 12, 0.9, 11.8, 0x8a857c, { mat: 'rough' });
    B.box(0, 3.08, 0, 9, 3.05, 6.5, 0x7a2a1a, {});
    B.hip(0, 4.0, 0, 12.2, 9.7, 3.0, 0.4, 0x3b4350, {}, 0.55);
    B.box(0, 2.2, 3.3, 2.2, 1.6, 0.2, 0xd8c070, { solid: false });
    for (const sx of [-2.1, 2.1]) B.cyl(sx, 2.2, 5.95, 0.16, 0.16, 2.6, 0xd2401e, 10, {});
    B.box(0, 3.85, 4.8, 5.0, 0.3, 3.0, 0x3b4350, { solid: false });
    B.endModel();
    B.footprint(9);
  },
  pagoda(B, _d, _rng, ctx) {
    // 五重塔（地标）：模型自带 1.6 m 的基坛，这里补上坡地下坡一侧露出的部分；四周是碎石院子与四座石灯笼
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    const { base, depth } = settle(ctx, ox, oz, rot, 8, 8, 0.05);
    for (const [lx, lz] of [
      [-7, -7],
      [7, -7],
      [-7, 7],
      [7, 7],
    ] as Array<[number, number]>) {
      // 石灯笼立在台面上
      const [x, z] = lotPoint({ x: ox, z: oz, rot }, lx, lz);
      stoneLantern(B, ctx, x, z, rot + Math.PI / 4, base);
    }
    B.at(ox, base, oz, rot, 1);
    terrace(B, 8, 8, depth, GRANITE_J, 0.32, 'stone', 0.6, 0x6a6458);
    frontSteps(B, ctx, { x: ox, z: oz, rot }, base, 8, 2.8, GRANITE_J);
    yard(ctx, { x: ox, z: oz, rot, hw: 8, hd: 8, base }, 3, 0.6);
    B.beginModel('pagoda');
    // 后备几何与碰撞体：尺寸与 tools/blender/jlandmarks.py 的 pagoda_levels() 一致（每层塔身 + 一圈出檐）
    B.box(0, 0.6, 0, 12.2, 1.2, 12.2, 0x8a857c, { mat: 'rough' });
    for (const L of PAGODA_LEVELS) {
      B.box(0, L.zf + L.h / 2, 0, L.hw * 2, L.h, L.hw * 2, 0x7a2a1a, {});
      B.hip(0, L.ze, 0, (L.X1 - 0.1) * 2, (L.X1 - 0.1) * 2, L.zIn - L.ze, 0.05, 0x323a44, { solid: false }, L.k === 4 ? 0.02 : 0.5);
      // 出檐：一块薄板形的碰撞体（直升机撞到屋檐会受损）
      B.colliderBox(0, (L.ze + L.zIn) / 2, 0, L.X1, (L.zIn - L.ze) / 2 + 0.15, L.X1);
    }
    B.cyl(0, PAGODA_TOP + 4.6, 0, 0.25, 0.12, 9, 0xb8a050, 6, { mat: 'metal', solid: false });
    B.endModel();
    B.addColliderCyl(0, PAGODA_TOP + 4.6, 0, 4.6, 0.6);
    B.footprint(9);
  },
  joyato(B, d, _rng, ctx) {
    const [sx, , sz] = B.origin;
    const a = (Number(d.p?.dir ?? 90) * Math.PI) / 180;
    const ux = Math.sin(a);
    const uz = -Math.cos(a);
    const wl = ctx.waterLevel ?? 0;
    let x = sx;
    let z = sz;
    for (let k = 0; k < 200 && ctx.terrain.heightAt(x + ux * 2, z + uz * 2) > wl + 1.2; k++) {
      x += ux * 2;
      z += uz * 2;
    }
    // 岸边砌一块石垣码头（向海一侧的石墙一直砌到水下），常夜灯立在码头靠陆一侧；局部 +z 朝海
    const rot = Math.atan2(ux, uz);
    const quay = { x: x + ux * 1.5, z: z + uz * 1.5, rot };
    const qg = siteGround(ctx, quay.x, quay.z, rot, 7, 5.5);
    const qtop = Math.max(qg.top, wl + 1.1) + 0.25;
    B.at(quay.x, qtop, quay.z, rot, 1);
    terrace(B, 7, 5.5, qtop - Math.min(qg.low, wl - 1.6), GRANITE_J, 0.12, 'stone', 0.4);
    const [lx, lz] = lotPoint(quay, 0, -2.4);
    const base = qtop;
    const depth = 0;
    B.at(lx, base, lz, rot, 1);
    B.beginModel('joyato');
    B.box(0, 0.35, 0, 4.4, 0.7, 4.4, 0x77736b, { mat: 'rough' });
    B.box(0, 1.0, 0, 3.4, 0.6, 3.4, 0x8a857c, { mat: 'rough' });
    B.box(0, 3.2, 0, 0.8, 4.2, 0.8, 0x8a857c, { mat: 'rough' });
    B.box(0, 5.6, 0, 1.6, 1.6, 1.6, 0x9a958c, { mat: 'rough' });
    B.hip(0, 6.4, 0, 3.0, 3.0, 0.8, 0.2, 0x8a857c, { mat: 'rough' }, 0.05);
    B.endModel();
    void depth;
    B.footprint(4);
    // 雁木：码头向海一侧，一级级下到水面以下的石阶（宽 9 m）
    B.at(quay.x, qtop, quay.z, rot, 1);
    for (let k = 0; k < 16; k++) {
      const zz = 5.5 + 0.3 + k * 0.55;
      const [wx, wz] = lotPoint(quay, 0, zz);
      const top = -0.28 * (k + 1);
      if (qtop + top < wl - 1.2) break;
      const bottom = Math.min(ctx.terrain.heightAt(wx, wz), wl - 1.6) - 0.3 - qtop;
      B.box(0, (top + bottom) / 2, zz, 9, top - bottom, 0.58, GRANITE_J, { mat: 'stone', jitter: 0.06 });
    }
  },
  obsStation(B) {
    // 观测站：一层的混凝土小楼（海风吹得外墙发灰），屋顶上是雷达罩、天线和设备，旁边一排太阳能板
    const WALL = 0xb9b4a9;
    const TRIM = 0x8e8d88;
    const FRAME = 0x4a4d50;
    B.box(0, 0.2, 0, 12.9, 0.4, 8.9, 0x7c7a73, { mat: 'rough' });
    B.box(0, 2.2, 0, 12, 3.8, 8, WALL, { mat: 'rough', jitter: 0.03 });
    // 女儿墙与压顶
    for (const [x, z, sx, sz] of [
      [0, 3.98, 12.2, 0.24],
      [0, -3.98, 12.2, 0.24],
      [5.98, 0, 0.24, 8.2],
      [-5.98, 0, 0.24, 8.2],
    ]) {
      B.box(x, 4.35, z, sx, 0.7, sz, WALL, { mat: 'rough', solid: false });
      B.box(x, 4.74, z, sx + 0.1, 0.08, sz + 0.1, TRIM, { solid: false });
    }
    B.box(0, 4.14, 0, 11.7, 0.1, 7.7, 0x55575a, { solid: false });
    // 前后的窗（窗框 + 玻璃 + 窗台），侧面一扇小窗
    for (const z of [4.02, -4.02]) {
      for (let i = 0; i < 4; i++) {
        const x = -4.2 + i * 2.8;
        if (z > 0 && i === 2) continue;
        B.box(x, 2.6, z, 1.7, 1.45, 0.06, FRAME, { solid: false });
        B.box(x, 2.6, z + Math.sign(z) * 0.03, 1.5, 1.25, 0.04, 0x25303a, { mat: 'glass', solid: false });
        B.box(x, 2.6, z + Math.sign(z) * 0.05, 0.05, 1.25, 0.03, FRAME, { solid: false });
        B.box(x, 1.84, z + Math.sign(z) * 0.06, 1.8, 0.07, 0.16, TRIM, { solid: false });
      }
    }
    // 门、雨棚、门前台阶
    B.box(1.4, 1.5, 4.03, 1.15, 2.2, 0.07, 0x3d4247, { solid: false });
    B.box(1.75, 1.5, 4.08, 0.08, 0.08, 0.06, 0xb8b8b4, { mat: 'metal', solid: false });
    B.box(1.4, 2.82, 4.5, 1.9, 0.1, 1.1, TRIM, { solid: false });
    B.box(1.4, 0.3, 4.6, 2.2, 0.2, 1.2, 0x7c7a73, { mat: 'rough', solid: false });
    // 空调外机、管线
    B.box(-5.4, 0.85, 4.35, 0.9, 0.7, 0.42, 0xa8a8a2, { solid: false });
    B.box(-5.4, 0.85, 4.57, 0.62, 0.5, 0.02, 0x3a3c3e, { solid: false });
    B.cyl(5.75, 2.3, 4.08, 0.05, 0.05, 3.9, 0x6f7276, 6, { mat: 'metal', solid: false });
    // 屋顶：雷达罩（圆滑的白球 + 底座），设备箱，栏杆
    B.cyl(3.5, 4.9, -1.5, 1.05, 1.15, 1.3, 0x9a9b98, 24, {});
    B.cyl(3.5, 5.6, -1.5, 1.32, 1.32, 0.12, 0x77797b, 24, { solid: false });
    B.sphere(3.5, 7.1, -1.5, 1.85, 0xe4e4e0, { seg: 30, jitter: 0.004 });
    B.box(-1.5, 4.55, 1.8, 1.8, 0.75, 1.1, 0x9b9c98, { solid: false });
    B.box(-1.5, 4.55, 2.36, 1.3, 0.5, 0.02, 0x3f4245, { solid: false });
    B.cyl(-4, 9, -2, 0.12, 0.08, 10, 0xc4c4c0, 8, { mat: 'metal', solid: true });
    B.box(-4, 13.4, -2, 0.9, 0.05, 0.05, 0xc4c4c0, { mat: 'metal', solid: false });
    B.box(-4, 12.6, -2, 0.05, 0.05, 1.3, 0xc4c4c0, { mat: 'metal', solid: false });
    B.anchor('blink', -4, 14.2, -2, 0, { color: 'red', period: 2 });
    // 太阳能板：斜架在地上
    for (let i = 0; i < 3; i++) {
      const x = -8 - i * 2.6;
      B.box(x, 1.1, 2, 2.2, 0.08, 3.4, 0x18233f, { mat: 'glass', solid: false }, 0);
      B.box(x, 0.5, 3.3, 0.08, 1, 0.08, 0x8a8c8e, { mat: 'metal', solid: false });
      B.box(x, 0.5, 0.7, 0.08, 1, 0.08, 0x8a8c8e, { mat: 'metal', solid: false });
    }
    B.footprint(10);
  },
  seaStack(B, d, rng) {
    const h = Number(d.p?.h ?? 40);
    const r = Number(d.p?.r ?? 9);
    const col = Number(d.p?.color ?? 0x6e665c);
    // 海蚀柱：下粗上细的不规则岩柱，一圈圈截面沿高度错开、时宽时窄（岩层被海浪掏蚀的样子），顶上长着松树和草
    const seg = 14;
    const rings = 10;
    const pts: Array<Array<[number, number, number]>> = [];
    const lean = rng.range(0.03, 0.09);
    const ang = rng.range(0, 6.28);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const y = -6 + (h + 6) * t;
      const ledge = 1 + 0.16 * Math.sin(j * 2.1 + ang) + (j % 3 === 0 ? -0.1 : 0.05);
      const rr = r * (1.28 - 0.62 * t) * ledge * (t > 0.92 ? 0.82 : 1);
      const ox = Math.cos(ang) * lean * y + rng.range(-0.5, 0.5);
      const oz = Math.sin(ang) * lean * y + rng.range(-0.5, 0.5);
      const ring: Array<[number, number, number]> = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const k = 1 + 0.22 * Math.sin(a * 3 + j * 0.7 + ang) + 0.1 * Math.sin(a * 7 - j);
        ring.push([ox + Math.cos(a) * rr * k, y, oz + Math.sin(a) * rr * k]);
      }
      pts.push(ring);
    }
    const tris: number[] = [];
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        const a = pts[j][i];
        const b = pts[j][(i + 1) % seg];
        const c = pts[j + 1][(i + 1) % seg];
        const e = pts[j + 1][i];
        tris.push(...a, ...e, ...c, ...a, ...c, ...b);
      }
    const top = pts[rings];
    const cx = top.reduce((s, p) => s + p[0], 0) / seg;
    const cz = top.reduce((s, p) => s + p[2], 0) / seg;
    for (let i = 0; i < seg; i++) tris.push(cx, h + 1, cz, ...top[(i + 1) % seg], ...top[i]);
    B.mesh(tris, col, 'rock', 0.1);
    B.sphere(cx, h + 0.4, cz, r * 0.62, 0x4f6a3a, { sy: 0.32, noise: 0.35, seg: 9, solid: false });
    B.addColliderCyl(0, (h - 6) / 2, 0, (h + 6) / 2, r * 0.92);
    B.footprint(r + 2);
  },
  breakwater(B, d) {
    // 防波堤：混凝土堤身，外侧堆消波块，堤头一座小灯塔
    const len = Number(d.p?.len ?? 120);
    B.box(len / 2, 0.5, 0, len, 5, 6, 0x9a958c, { mat: 'rough' });
    B.box(len / 2, 3.2, -2.1, len, 0.9, 0.9, 0x9a958c, { mat: 'rough', solid: false });
    for (let x = 20; x < len; x += 40) {
      B.beginModel('tetrapods', x, -0.5, 7.5, Math.PI);
      B.endModel();
    }
    B.beginModel(String(d.p?.light ?? 'hlight_r'), len + 2, 3, 0);
    B.cyl(len + 2, 6, 0, 1.2, 0.8, 7, 0xc0392b, 10, {});
    B.endModel();
    B.anchor('blink', len + 2, 12.4, 0, 0, { color: String(d.p?.light ?? 'hlight_r') === 'hlight_r' ? 'red' : 'green', period: 3 });
  },
};

export { C };

/** 鸟居（朱红）：当前变换下，柱脚在 y = -1.5（海上鸟居的柱子插进水里） */
function toriiGeom(B: PropBuilder): void {
  const red = 0xc8361f;
  const h = 13;
  B.beginModel('torii');
  for (const sx of [-4.2, 4.2]) B.cyl(sx, h / 2 - 1.5, 0, 0.55, 0.6, h + 3, red, 12, {});
  B.box(0, h - 2.2, 0, 11, 0.7, 0.8, red, { solid: false });
  B.box(0, h + 0.1, 0, 14.5, 0.9, 1.4, 0x222222, {});
  B.box(-7.1, h + 0.5, 0, 1.4, 0.5, 1.4, 0x222222, { solid: false }, 0);
  B.box(7.1, h + 0.5, 0, 1.4, 0.5, 1.4, 0x222222, { solid: false }, 0);
  B.box(0, h - 0.6, 0, 13.4, 0.6, 1.0, red, { solid: false });
  B.box(0, h - 1.4, 0, 1.0, 1.3, 0.3, 0x333333, { solid: false });
  B.endModel();
}
