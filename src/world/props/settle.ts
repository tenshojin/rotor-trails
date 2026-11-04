// 建筑与地形的衔接（各地图共用）：落地高度与基座、院子与小路网、田埂石墙、栅栏。
//
// 地形高度在布置道具之前就定了（碰撞、导航与航线检查都用它），所以这里不改地形：
//   · 房子坐在占地范围内地面的最高处，不会陷进上坡一侧；下坡一侧露出石砌 / 混凝土基座，基座底部埋进土里；
//   · 地表掩码里画出踩实的院子、连接各户的小路（只改地面着色、不长树）；
//   · 石墙、栅栏沿地面逐段落地，默认不参与碰撞（只有一米来高，降落时不该被它们绊住）。
// 需要“随机”决定的细节（哪几户有旗杆、栅栏）用坐标哈希，不消耗随机数——其他道具的随机序列保持不变。
// 注意：程序几何体的顶点色按线性值使用，同一个十六进制颜色显示出来比 sRGB 取色器里看到的亮——石头要取得偏暗。

import type { V3 } from '../../maps/types';
import type { MatKey, PropBuilder } from '../propBuilder';
import type { PropCtx } from './common';

/** 一栋建筑的落地信息（世界坐标）：中心、朝向、半宽 / 半深、底面高度 */
export interface Lot {
  x: number;
  z: number;
  rot: number;
  hw: number;
  hd: number;
  /** 房子底面（墙脚）高度 */
  base: number;
}

/** 坐标哈希 → 0..1（同一位置、同一个 k 结果固定） */
export function hash01(x: number, z: number, k = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** 局部 → 世界（与 PropBuilder 的旋转约定一致） */
export function lotPoint(l: { x: number; z: number; rot: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(l.rot);
  const s = Math.sin(l.rot);
  return [l.x + lx * c + lz * s, l.z - lx * s + lz * c];
}

/** 占地矩形（含 margin）里地面的最高 / 最低处（水面按水面高度算） */
export function siteGround(ctx: PropCtx, x: number, z: number, rot: number, hw: number, hd: number, margin = 0.4): { top: number; low: number } {
  let top = -Infinity;
  let low = Infinity;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const [wx, wz] = lotPoint({ x, z, rot }, (i / 2) * (hw + margin), (j / 2) * (hd + margin));
      const h = ctx.ground(wx, wz);
      top = Math.max(top, h);
      low = Math.min(low, h);
    }
  return { top, low };
}

/**
 * 落地：返回房子底面高度（最高处 + lift），并在当前变换下（调用前先 B.at 到房子）画基座——
 * 从地面最低处再往下埋 bury，砌到墙脚，四周比墙面各宽 lip。平地上只露出 lift 那么高的一圈。
 */
export function settle(ctx: PropCtx, x: number, z: number, rot: number, hw: number, hd: number, lift: number): { base: number; depth: number } {
  const g = siteGround(ctx, x, z, rot, hw, hd);
  let base = g.top + lift;
  // 坡很陡时下坡一侧的基座会露得很高：最多让上坡一侧往土里切进 0.8 m（真实的坡地房子也是半嵌进山坡）
  const exposed = base - g.low;
  if (exposed > 1.8) base -= Math.min(0.8, exposed - 1.8);
  return { base, depth: base - g.low };
}

export function plinth(B: PropBuilder, hw: number, hd: number, depth: number, color: number, mat: MatKey = 'stone', lip = 0.2, bury = 0.5): void {
  const h = depth + bury;
  B.box(0, -h / 2 + 0.02, 0, (hw + lip) * 2, h, (hd + lip) * 2, color, { mat, jitter: 0.04 });
}

/**
 * 带收分的石砌台基（日本的石垣、寺社基坛）：上小下大的四棱台，四面向内倾斜（batter = 每米高度向外放出的距离），
 * 顶面就是台地的地面。局部坐标，台面在 y = 0；碰撞体用外接长方体。
 */
export function terrace(B: PropBuilder, hw: number, hd: number, depth: number, color: number, batter = 0.3, mat: MatKey = 'stone', bury = 0.6, top?: number): void {
  const H = depth + bury;
  const y0 = 0.02;
  // 四面石墙：一层层错缝的石块（每块明暗略有不同、略微凸出），远处看也像石垣而不是一整块灰板
  const course = 0.55;
  const rows = Math.max(1, Math.round(H / course));
  const faces: Array<[number, number, number, number]> = [
    [0, 1, hw, hd],
    [0, -1, hw, hd],
    [1, 0, hd, hw],
    [-1, 0, hd, hw],
  ];
  for (const [nx, nz, half, off] of faces) {
    // 墙面局部：沿墙方向 t（-1..1 × 半长），从上往下第 r 层；墙脚向外放出 batter × 深度
    const sx = -nz;
    const sz = nx;
    for (let r = 0; r < rows; r++) {
      const ya = y0 - (H * r) / rows;
      const yb = y0 - (H * (r + 1)) / rows;
      const oa = off + batter * (y0 - ya);
      const ob = off + batter * (y0 - yb);
      const ha = half + batter * (y0 - ya);
      const hb = half + batter * (y0 - yb);
      const L = hb * 2;
      const n = Math.max(1, Math.round(L / (0.8 + 0.5 * hash01(nx * 3 + r, nz * 7 + r, 5))));
      const stagger = r % 2 ? 0.5 : 0;
      for (let k = -1; k < n; k++) {
        const t0 = Math.max(-1, -1 + ((k + stagger) * 2) / n);
        const t1 = Math.min(1, -1 + ((k + 1 + stagger) * 2) / n);
        if (t1 - t0 < 1e-3) continue;
        const bulge = 0.03 + 0.04 * hash01(nx * 11 + k, nz * 13 + r, 6);
        const P = (t: number, y: number, o: number, h: number): number[] => [sx * t * h + nx * (o + bulge), y, sz * t * h + nz * (o + bulge)];
        const A = P(t0, yb, ob, hb);
        const Bq = P(t1, yb, ob, hb);
        const Cq = P(t1, ya, oa, ha);
        const Dq = P(t0, ya, oa, ha);
        // 逆时针（从墙外看）：法线朝外
        const tris = nx + nz > 0 ? [...A, ...Bq, ...Cq, ...A, ...Cq, ...Dq] : [...Bq, ...A, ...Dq, ...Bq, ...Dq, ...Cq];
        B.mesh(tris, shadeHex(color, 0.82 + 0.36 * hash01(nx * 17 + k * 3.1, nz * 19 + r * 1.7, 7)), mat, 0);
      }
    }
  }
  // 台面（碎石 / 土）
  B.mesh([-hw, y0, hd, hw, y0, hd, hw, y0, -hd, -hw, y0, hd, hw, y0, -hd, -hw, y0, -hd], top ?? shadeHex(color, 1.15), mat, 0);
  B.colliderBox(0, -H / 2, 0, hw + (batter * H) / 2, H / 2, hd + (batter * H) / 2);
}

function shadeHex(hex: number, k: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
}

/**
 * 台地前方（局部 +z）下到地面的石阶：从台面边缘 zEdge 开始，每级高 0.2 m、深 0.38 m，直到碰到地面。
 * 当前变换下台面在 y = 0；每级石块向下一直埋进地面。
 */
export function frontSteps(B: PropBuilder, ctx: PropCtx, l: { x: number; z: number; rot: number }, base: number, zEdge: number, width: number, color: number): void {
  for (let k = 0; k < 60; k++) {
    const top = -(k + 1) * 0.2;
    const zc = zEdge + k * 0.38 + 0.19;
    const [wx, wz] = lotPoint(l, 0, zc);
    const g = Math.max(ctx.terrain.heightAt(wx, wz), lotGround(ctx, l, width / 2, zc));
    if (base + top <= g + 0.05) break;
    const bottom = g - 0.3 - base;
    B.box(0, (top + bottom) / 2, zc, width, top - bottom, 0.4, color, { mat: 'stone', jitter: 0.05 });
  }
}

/** 局部 (±hx, zc) 两端地面的最高处 */
function lotGround(ctx: PropCtx, l: { x: number; z: number; rot: number }, hx: number, zc: number): number {
  const [ax, az] = lotPoint(l, -hx, zc);
  const [bx, bz] = lotPoint(l, hx, zc);
  return Math.max(ctx.terrain.heightAt(ax, az), ctx.terrain.heightAt(bx, bz));
}

/** 院子：踩实的泥地 / 碎石（通道 1）与更大一圈不长树（通道 2） */
export function yard(ctx: PropCtx, l: Lot, pad: number, strength: number): void {
  ctx.paintRect?.(1, l.x, l.z, l.rot, l.hw + pad, l.hd + pad, 2.5, strength);
  ctx.paintRect?.(2, l.x, l.z, l.rot, l.hw + pad + 2, l.hd + pad + 2, 3, 1);
}

/**
 * 小路网：最小生成树（Prim）把各点连起来，再补 extra 条最短的非树边（真实村落的小路会成环）。
 * 每条边在地表掩码上画路面（通道 1，半宽 halfW）与不长树。返回边（点的序号对）。
 */
export function pathNet(ctx: PropCtx, pts: Array<[number, number]>, halfW: number, strength: number, extra = 0): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  if (pts.length < 2) return edges;
  const d = (i: number, j: number) => Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
  const inTree = new Set<number>([0]);
  while (inTree.size < pts.length) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const i of inTree)
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue;
        const dd = d(i, j);
        if (dd < bd) {
          bd = dd;
          best = [i, j];
        }
      }
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  if (extra > 0) {
    const cand: Array<[number, number, number]> = [];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) if (!edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) cand.push([i, j, d(i, j)]);
    cand.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of cand.slice(0, extra)) edges.push([i, j]);
  }
  for (const [i, j] of edges) {
    // 路略微弯一点（中点侧移），不是笔直的尺子线
    const mx = (pts[i][0] + pts[j][0]) / 2;
    const mz = (pts[i][1] + pts[j][1]) / 2;
    const L = d(i, j);
    const off = (hash01(mx, mz, 3) - 0.5) * Math.min(6, L * 0.15);
    const nx = -(pts[j][1] - pts[i][1]) / L;
    const nz = (pts[j][0] - pts[i][0]) / L;
    const line: Array<[number, number]> = [pts[i], [mx + nx * off, mz + nz * off], pts[j]];
    ctx.paintPath?.(1, line, halfW, halfW * 1.2 + 0.6, strength);
    ctx.paintPath?.(2, line, halfW + 1.5, 2, 1);
  }
  return edges;
}

/** 是否落在已有建筑的占地圆里（半径减去 tolerance，贴着房子的院墙、田埂不受影响） */
function insideFootprint(B: PropBuilder, x: number, z: number, tolerance: number): boolean {
  return B.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r - tolerance);
}

/** 颜色按比例变亮 / 变暗（十六进制） */
function shade(hex: number, k: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
}

/**
 * 矮石墙（田埂、院墙、教堂墓园墙）：世界坐标折线，每 ~2 m 一段；每段是贴着地面倾斜的棱柱（两端各按所在处地面落地，
 * 底部埋进土里，顶面略窄、高度沿墙缓慢起伏，相邻两段在接头处等高），坡地上不会变成一级级的台阶。
 * 水里、太陡的地方、已有建筑的占地里跳过；gaps：在这些世界坐标附近留出缺口（门洞、路口）。
 */
export function dryWall(B: PropBuilder, ctx: PropCtx, pts: Array<[number, number]>, h: number, thick: number, color: number, gaps: Array<[number, number]> = [], mat: MatKey = 'stone'): void {
  B.at(0, 0, 0, 0, 1);
  const T = ctx.terrain;
  const topAt = (x: number, z: number) => h * (0.82 + 0.36 * hash01(Math.round(x * 4) / 4, Math.round(z * 4) / 4, 1));
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = pts[s];
    const [bx, bz] = pts[s + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const nx = -uz;
    const nz = ux;
    const n = Math.max(1, Math.round(L / 2.1));
    for (let k = 0; k < n; k++) {
      const x0 = ax + (bx - ax) * (k / n);
      const z0 = az + (bz - az) * (k / n);
      const x1 = ax + (bx - ax) * ((k + 1) / n);
      const z1 = az + (bz - az) * ((k + 1) / n);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if (gaps.some(([gx, gz]) => Math.hypot(gx - mx, gz - mz) < 2.2)) continue;
      if (insideFootprint(B, mx, mz, 1.5)) continue;
      const g0 = T.heightAt(x0, z0);
      const g1 = T.heightAt(x1, z1);
      if (ctx.waterLevel !== null && Math.min(g0, g1) < ctx.waterLevel + 0.2) continue;
      // 陡坡上没有人砌田埂（坡度值 = 1 - 法线的 y 分量，0.12 约为 28°）
      if (T.slopeAt(mx, mz) > 0.12) continue;
      const t = (thick / 2) * (0.92 + 0.16 * hash01(mx, mz, 2));
      const tt = t * 0.72;
      const y0b = g0 - 0.35;
      const y1b = g1 - 0.35;
      const y0t = g0 + topAt(x0, z0);
      const y1t = g1 + topAt(x1, z1);
      const P = (x: number, y: number, z: number, side: number, w: number): number[] => [x + nx * w * side, y, z + nz * w * side];
      const a0L = P(x0, y0b, z0, 1, t);
      const a0R = P(x0, y0b, z0, -1, t);
      const a1L = P(x1, y1b, z1, 1, t);
      const a1R = P(x1, y1b, z1, -1, t);
      const a0Lt = P(x0, y0t, z0, 1, tt);
      const a0Rt = P(x0, y0t, z0, -1, tt);
      const a1Lt = P(x1, y1t, z1, 1, tt);
      const a1Rt = P(x1, y1t, z1, -1, tt);
      const tris: number[] = [];
      const quad = (A: number[], C: number[], D: number[], E: number[]) => tris.push(...A, ...C, ...D, ...A, ...D, ...E);
      quad(a0L, a1L, a1Lt, a0Lt); // 左侧面
      quad(a1R, a0R, a0Rt, a1Rt); // 右侧面
      quad(a0Lt, a1Lt, a1Rt, a0Rt); // 顶面
      quad(a0R, a0L, a0Lt, a0Rt); // 起点端面
      quad(a1L, a1R, a1Rt, a1Lt); // 终点端面
      B.mesh(tris, shade(color, 0.88 + 0.24 * hash01(mx, mz, 4)), mat, 0);
    }
  }
}

/** 立柱横杆栅栏（牧场、菜园）：世界坐标折线，立柱间距 spacing，两道横杆跟随地面 */
export function railFence(B: PropBuilder, ctx: PropCtx, pts: Array<[number, number]>, h: number, spacing: number, color: number, gaps: Array<[number, number]> = []): void {
  B.at(0, 0, 0, 0, 1);
  const posts: Array<V3 | null> = [];
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = pts[s];
    const [bx, bz] = pts[s + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / spacing));
    for (let k = s === 0 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const y = ctx.terrain.heightAt(x, z);
      const skip = gaps.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < spacing * 0.9) || (ctx.waterLevel !== null && y < ctx.waterLevel + 0.1) || insideFootprint(B, x, z, 1.0);
      posts.push(skip ? null : [x, y, z]);
    }
  }
  posts.forEach((p, i) => {
    if (!p) return;
    B.box(p[0], p[1] + h / 2 - 0.15, p[2], 0.11, h + 0.3, 0.11, color, { solid: false, jitter: 0.1 });
    const q = posts[i + 1];
    if (!q) return;
    for (const f of [0.45, 0.88]) B.beam([p[0], p[1] + h * f, p[2]], [q[0], q[1] + h * f, q[2]], 0.07, color, { solid: false });
  });
}

/** 矩形的四个角（世界坐标，首尾相接），用于院墙、田埂 */
export function rectLoop(l: { x: number; z: number; rot: number }, hw: number, hd: number): Array<[number, number]> {
  return [lotPoint(l, -hw, -hd), lotPoint(l, hw, -hd), lotPoint(l, hw, hd), lotPoint(l, -hw, hd), lotPoint(l, -hw, -hd)];
}

/** 新的占地是否与已有建筑（含间距 gap）重叠（按外接圆粗判） */
export function overlaps(lots: Array<{ x: number; z: number; hw: number; hd: number }>, x: number, z: number, r: number, gap: number): boolean {
  return lots.some((l) => Math.hypot(l.x - x, l.z - z) < Math.hypot(l.hw, l.hd) + r + gap);
}
