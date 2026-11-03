// 日本海湾地图的建筑与地标：民居（瓦顶）、村落生成器、港口仓库、龙门吊、码头、渔船、渡轮、灯塔、
// 海上鸟居、神社、五重塔、观测站、海蚀柱、防波堤。

import type { Rng } from '../../core/noise';
import type { PropDef } from '../../maps/types';
import type { PropBuilder } from '../propBuilder';
import { C, type PropCtx, type PropFn } from './common';

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
    B.box(0, h / 2, 0, w, h, l, col, { mat: 'metal', jitter: 0.04 });
    B.gable(0, h, 0, l, w, 2.4, 0.4, 0x5d6670, { mat: 'metal' }, Math.PI / 2);
    for (let i = -1; i <= 1; i++) B.box(w / 2 + 0.05, h * 0.4, i * l * 0.3, 0.1, h * 0.7, 6, 0x4a525a, { mat: 'metal', solid: false });
    B.footprint(Math.hypot(w, l) / 2 + 2);
  },
  crane(B, d) {
    // 港口龙门吊：两组门腿 + 横梁 + 伸向海面的悬臂
    const h = Number(d.p?.h ?? 32);
    const span = 18;
    const red = 0xc0392b;
    const white = 0xe8e8e8;
    for (const sz of [-6, 6]) {
      for (const sx of [-span / 2, span / 2]) B.box(sx, h / 2, sz, 1.4, h, 1.4, sz < 0 ? red : white, { mat: 'metal' });
      B.box(0, h * 0.35, sz, span, 1.0, 1.0, red, { mat: 'metal', solid: false });
    }
    B.box(0, h + 1, 0, span + 4, 2, 14, red, { mat: 'metal' });
    B.box(span / 2 + 22, h + 1.2, 0, 44, 1.6, 3, white, { mat: 'metal' });
    B.box(-span / 2 - 8, h + 1.2, 0, 16, 1.6, 3, white, { mat: 'metal' });
    B.box(-span / 2 - 14, h - 1.5, 0, 4, 5, 4, 0x555555, { mat: 'metal' });
    B.box(span / 2 + 10, h - 2.5, 0, 3, 3, 3, 0x333333, { mat: 'metal', solid: false });
    B.beam([span / 2 + 10, h, 0], [span / 2 + 10, h - 12, 0], 0.08, 0x222222, { solid: false });
    B.anchor('blink', span / 2 + 44, h + 2.5, 0, 0, { color: 'red', period: 1.5 });
    B.footprint(26);
  },
  pier(B, d) {
    // 码头：沿 +X 伸出的栈桥
    const len = Number(d.p?.len ?? 80);
    const w = Number(d.p?.w ?? 10);
    const deck = Number(d.p?.deck ?? 2.5);
    B.box(len / 2, deck - 0.4, 0, len, 0.8, w, 0x8a857c, { mat: 'rough' });
    for (let x = 6; x < len; x += 10) for (const sz of [-w / 2 + 0.6, w / 2 - 0.6]) B.cyl(x, deck / 2 - 3, sz, 0.35, 0.35, deck + 6, 0x5a5550, 6, { solid: false });
    for (let x = 4; x < len; x += 12) B.cyl(x, deck + 0.4, w / 2 - 0.4, 0.25, 0.25, 0.8, 0x333333, 6, { solid: false });
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
    B.box(0, 1.5, 0, l, 5, w, 0xf0f0f0, { jitter: 0.03 });
    B.box(0, -0.6, 0, l - 1, 1.2, w - 0.6, 0x2a4a8a, { solid: false });
    B.box(-4, 5.5, 0, l * 0.6, 3, w - 1.5, 0xf4f4f4, {});
    B.box(-4, 5.9, 0, l * 0.6 + 0.1, 1, w - 1.4, 0x22303c, { mat: 'glass', solid: false });
    B.box(2, 8.5, 0, 10, 3, w - 3, 0xf4f4f4, {});
    B.cyl(-10, 9.5, 0, 1.2, 1.4, 4, 0xc0392b, 10, {});
    B.footprint(24);
  },
  lighthouse(B) {
    const h = 20;
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
    // 海上鸟居（朱红）
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
    B.footprint(9);
  },
  shrine(B) {
    B.beginModel('shrine');
    B.box(0, 0.6, 0, 12, 1.2, 9, 0x8a857c, { mat: 'rough' });
    B.box(0, 2.8, 0, 9, 3.2, 6.5, 0x7a2a1a, {});
    B.gable(0, 4.4, 0, 9, 6.5, 3.2, 1.4, 0x3b4350, {}, 0);
    B.box(0, 2.2, 4.4, 2.2, 1.6, 0.2, 0xd8c070, { solid: false });
    B.endModel();
    B.footprint(9);
  },
  pagoda(B) {
    // 五重塔（地标）
    B.beginModel('pagoda');
    B.box(0, 0.8, 0, 13, 1.6, 13, 0x8a857c, { mat: 'rough' });
    let y = 1.6;
    for (let k = 0; k < 5; k++) {
      const w = 8.6 - k * 0.9;
      const fh = k === 0 ? 4.2 : 3.2;
      B.box(0, y + fh / 2, 0, w, fh, w, 0x7a2a1a, {});
      B.hip(0, y + fh, 0, w + 3.2, w + 3.2, 1.3, 0.6, 0x323a44, { solid: false }, 0.05);
      y += fh + 1.3;
    }
    B.cyl(0, y + 4, 0, 0.25, 0.15, 8, 0xb8a050, 6, { mat: 'metal', solid: false });
    B.endModel();
    B.colliderBox(0, y / 2, 0, 5, y / 2, 5);
    B.footprint(9);
  },
  obsStation(B) {
    // 观测站：混凝土建筑 + 雷达罩 + 天线 + 太阳能板
    B.box(0, 2, 0, 12, 4, 8, 0xdad6cc, {});
    B.box(0, 4.15, 0, 12.4, 0.3, 8.4, 0x6a6e74, { solid: false });
    B.box(0, 2.2, 4.05, 9, 1.2, 0.1, 0x2a3440, { mat: 'glass', solid: false });
    B.cyl(3.5, 5.2, -1.5, 0.8, 0.8, 2, 0xdadada, 10, {});
    B.sphere(3.5, 7.2, -1.5, 1.8, 0xf2f2f2, { seg: 10 });
    B.cyl(-4, 9, -2, 0.12, 0.08, 10, 0xd0d0d0, 6, { mat: 'metal', solid: true });
    B.anchor('blink', -4, 14.2, -2, 0, { color: 'red', period: 2 });
    for (let i = 0; i < 3; i++) B.box(-8 - i * 2.6, 1.1, 2, 2.2, 0.08, 3.4, 0x1a2a4a, { mat: 'glass', solid: false }, 0);
    B.footprint(10);
  },
  seaStack(B, d, rng) {
    const h = Number(d.p?.h ?? 40);
    const r = Number(d.p?.r ?? 9);
    const col = Number(d.p?.color ?? 0x6e665c);
    // 由几段竖向拉长、彼此重叠的岩块组成的海蚀柱
    const parts = Math.max(2, Math.ceil((h + 6) / (r * 1.4)));
    let rr = r;
    for (let i = 0; i < parts; i++) {
      const y = -6 + ((h + 6) * (i + 0.5)) / parts;
      B.sphere(rng.range(-0.8, 0.8), y, rng.range(-0.8, 0.8), rr, col, { mat: 'rock', sy: ((h + 6) / parts / rr) * 0.75, noise: 0.28, seg: 11, solid: false });
      rr *= rng.range(0.9, 0.98);
    }
    B.sphere(0, h - rr * 0.1, 0, rr * 0.95, 0x4f6a3a, { sy: 0.35, noise: 0.35, seg: 9, solid: false });
    B.addColliderCyl(0, (h - 6) / 2, 0, (h + 6) / 2, r * 0.92);
    B.footprint(r + 2);
  },
  breakwater(B, d) {
    const len = Number(d.p?.len ?? 120);
    B.box(len / 2, 0.5, 0, len, 5, 6, 0x9a958c, { mat: 'rough' });
    for (let x = 4; x < len; x += 5) B.sphere(x, 1.5, 3.5, 1.6, 0xb8b4aa, { mat: 'rock', noise: 0.2, seg: 6, solid: false });
    B.box(len + 2, 3, 0, 3, 6, 3, 0xc0392b, {});
    B.anchor('blink', len + 2, 6.5, 0, 0, { color: 'red', period: 3 });
  },
};

export { C };
