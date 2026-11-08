// 尼泊尔高山地图的道具：石屋与村落、佛塔（白塔）、经幡、寺院、高山营地帐篷、玛尼石堆、气象站。
//
// 与地形的衔接参照昆布地区的夏尔巴村落（昆琼、庞坡切、南池）：石屋坐在干砌片石的房基上（坡地上露出一截），
// 房子周围是用干砌石墙围起来的小块土豆田（翻过的褐色土地），石板小路串起各家，屋顶之间拉着经幡。

import type { Rng } from '../../core/noise';
import type { PropBuilder } from '../propBuilder';
import type { PropCtx, PropFn } from './common';
import { dryWall, hash01, lotPoint, overlaps, pathNet, plinth, rectLoop, settle, yard, type Lot } from './settle';

const STONE = [0x8a8278, 0x7a7268, 0x9a9286, 0xa89e90];
/** 干砌片石（房基、田埂） */
const DRYSTONE = 0x45403a;

interface StoneDims {
  w: number;
  l: number;
  h: number;
  stone: number;
}

/** 石屋尺寸与石色（随机数的取用顺序与原来相同） */
function stoneDims(rng: Rng): StoneDims {
  const w = rng.range(6, 9);
  const l = rng.range(7, 10);
  const h = rng.range(3.5, 5.5);
  return { w, l, h, stone: rng.pick(STONE) };
}

function stoneHouse(B: PropBuilder, D: StoneDims): void {
  const { w, l, h, stone } = D;
  // Blender 模型（夏尔巴石屋，参考尺寸 7.5 × 8.5 m、墙高 4.5 m；四种石色对应四种墙面/屋顶配色）
  B.beginModel(`stone_house_${'abcd'[STONE.indexOf(stone)]}`, 0, 0, 0, 0, w / 7.5, h / 4.5, l / 8.5);
  B.box(0, h / 2, 0, w, h, l, stone, { mat: 'rough', jitter: 0.08 });
  B.box(0, h + 0.25, 0, w + 0.6, 0.5, l + 0.6, 0x5a4a3a, { solid: false });
  B.box(0, h * 0.85, l / 2 + 0.03, w * 0.9, 0.5, 0.06, 0x8a2a1a, { solid: false });
  for (let i = -1; i <= 1; i += 2) B.box(i * w * 0.25, h * 0.55, l / 2 + 0.04, 0.9, 1.1, 0.06, 0x1a1a1a, { solid: false });
  B.endModel();
  B.footprint(Math.hypot(w, l) / 2 + 1.5);
}

function prayerLine(B: PropBuilder, a: [number, number, number], b: [number, number, number]): void {
  // 经幡：两点之间下垂的绳子上挂着彩色小旗（随风飘动）
  const cols = ['blue', 'white', 'red', 'green', 'yellow'];
  // 小旗之间约 0.9 m（真实的经幡排得很密）
  const n = Math.max(6, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.9));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 1.6;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t - sag;
    const z = a[2] + (b[2] - a[2]) * t;
    B.anchor('prayer', x, y, z, Math.atan2(-(b[2] - a[2]), b[0] - a[0]), { color: cols[i % 5] });
  }
  B.beam(a, b, 0.03, 0x444444, { solid: false });
}

export const himalayaProps: Record<string, PropFn> = {
  stoneHouse(B, _d, rng, ctx) {
    const [x, , z] = B.origin;
    const D = stoneDims(rng);
    const { base, depth } = settle(ctx, x, z, B.rotation, D.w / 2, D.l / 2, 0.3);
    B.at(x, base, z, B.rotation, 1);
    stoneHouse(B, D);
    plinth(B, D.w / 2, D.l / 2, depth, DRYSTONE, 'stone', 0.12);
  },
  hvillage(B, d, rng, ctx: PropCtx) {
    const [cx, , cz] = B.origin;
    const r = Number(d.p?.r ?? 80);
    const n = Number(d.p?.n ?? 10);
    const lots: Array<Lot & { h: number }> = [];
    for (let tries = 0; lots.length < n && tries < n * 25; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.float()) * r;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (ctx.terrain.slopeAt(x, z) > 0.22) continue;
      if (lots.some((l) => Math.hypot(l.x - x, l.z - z) < 14)) continue;
      const rot = rng.range(0, Math.PI);
      const D = stoneDims(rng);
      // 房子坐在占地范围内的最高处，干砌片石的房基一直砌到下坡一侧的地面以下
      const { base, depth } = settle(ctx, x, z, rot, D.w / 2, D.l / 2, 0.3);
      B.at(x, base, z, rot, 1);
      stoneHouse(B, D);
      plinth(B, D.w / 2, D.l / 2, depth, DRYSTONE, 'stone', 0.12);
      lots.push({ x, z, rot, hw: D.w / 2, hd: D.l / 2, base, h: D.h });
    }
    if (!lots.length) return;
    for (const l of lots) yard(ctx, l, 2, 0.5);
    // 石板小路串起各家
    const edges = pathNet(
      ctx,
      lots.map((l) => [l.x, l.z]),
      1.1,
      0.8,
      1,
    );
    // 土豆田：房子旁边一两块干砌石墙围起来的长方形田地（翻过的褐色土）
    const fields: Array<{ x: number; z: number; hw: number; hd: number }> = [];
    for (const l of lots)
      for (const side of [1, -1]) {
        if (hash01(l.x, l.z, side > 0 ? 31 : 32) > 0.65) continue;
        const fhw = 6 + hash01(l.x, l.z, 33) * 4;
        const fhd = 5 + hash01(l.x, l.z, 34) * 3;
        const [fx, fz] = lotPoint(l, side * (l.hw + 2.5 + fhw), (hash01(l.x, l.z, 35) - 0.5) * 6);
        if (ctx.terrain.slopeAt(fx, fz) > 0.3) continue;
        if (overlaps(lots.filter((o) => o !== l), fx, fz, Math.hypot(fhw, fhd), 2)) continue;
        if (fields.some((f) => Math.hypot(f.x - fx, f.z - fz) < Math.hypot(f.hw, f.hd) + Math.hypot(fhw, fhd))) continue;
        fields.push({ x: fx, z: fz, hw: fhw, hd: fhd });
        const plot = { x: fx, z: fz, rot: l.rot };
        ctx.paintRect?.(1, fx, fz, l.rot, fhw - 0.6, fhd - 0.6, 1.2, 0.6);
        ctx.paintRect?.(2, fx, fz, l.rot, fhw + 1, fhd + 1, 2, 1);
        // 靠房子一侧的角上留一个口子
        const loop = rectLoop(plot, fhw, fhd).map(([x, z], k) => [x + (hash01(fx, fz, 40 + (k % 4)) - 0.5) * 2.8, z + (hash01(fx, fz, 44 + (k % 4)) - 0.5) * 2.8] as [number, number]);
        dryWall(B, ctx, loop, 1.0, 0.7, DRYSTONE, [lotPoint(plot, -side * fhw, -fhd + 1.5)]);
      }
    // 屋顶之间拉经幡（约四成的小路两端）
    for (const [i, j] of edges) {
      const A = lots[i];
      const Bh = lots[j];
      if (hash01(A.x + Bh.x, A.z + Bh.z, 36) > 0.4) continue;
      if (Math.hypot(A.x - Bh.x, A.z - Bh.z) > 45) continue;
      B.at(0, 0, 0, 0, 1);
      prayerLine(B, [A.x, A.base + A.h + 1.4, A.z], [Bh.x, Bh.base + Bh.h + 1.4, Bh.z]);
    }
  },
  chorten(B) {
    // 白塔（佛塔）：Blender 模型参照昆布地区的白塔；经幡仍是程序生成
    B.beginModel('chorten');
    B.box(0, 1.5, 0, 9, 3, 9, 0xe8e4dc, { mat: 'rough' });
    B.box(0, 4, 0, 7, 2, 7, 0xe8e4dc, { mat: 'rough' });
    B.sphere(0, 7.5, 0, 3.6, 0xf2f0ea, { sy: 0.85, seg: 12 });
    B.box(0, 10.6, 0, 2.2, 1.4, 2.2, 0xe8e4dc, {});
    B.cone(0, 14, 0, 1.2, 5.5, 0xc8a050, 10, { mat: 'metal' });
    B.box(0, 10.6, 1.15, 1.2, 0.8, 0.05, 0x2a4a8a, { solid: false });
    B.endModel();
    prayerLine(B, [0, 16, 0], [18, 2, 6]);
    prayerLine(B, [0, 16, 0], [-17, 2, -8]);
    B.footprint(8);
  },
  prayerFlags(B, d) {
    const x2 = Number(d.p?.x2 ?? 30);
    const z2 = Number(d.p?.z2 ?? 0);
    const h = Number(d.p?.h ?? 5);
    B.cyl(0, h / 2, 0, 0.08, 0.06, h, 0x6a5a4a, 6, {});
    B.cyl(x2, h / 2, z2, 0.08, 0.06, h, 0x6a5a4a, 6, {});
    prayerLine(B, [0, h, 0], [x2, h, z2]);
  },
  monastery(B, _d, rng, ctx) {
    // 寺院：白墙、红色檐带、金顶（Blender 模型参照丹波切寺）；坐在石砌台基上，门前是石板铺的院子
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    // 占地含西侧的附属石屋（局部 x = -20 .. 13）
    const { base, depth } = settle(ctx, ox - Math.cos(rot) * 3.5, oz + Math.sin(rot) * 3.5, rot, 16.5, 9.5, 0.5);
    B.at(ox, base, oz, rot, 1);
    B.beginModel('monastery');
    B.box(0, 4, 0, 22, 8, 16, 0xe8e4dc, { mat: 'rough' });
    B.box(0, 8.4, 0, 22.4, 0.8, 16.4, 0x8a2a1a, { solid: false });
    B.box(0, 10, 0, 12, 4, 9, 0xe8e4dc, { mat: 'rough' });
    B.hip(0, 12, 0, 13, 10, 3, 0.8, 0xc8a050, { mat: 'metal' }, 0.3);
    B.cone(0, 16, 0, 0.8, 2.5, 0xd8b060, 8, { mat: 'metal', solid: false });
    for (let i = -2; i <= 2; i++) B.box(i * 4, 3.5, 8.04, 1.2, 1.8, 0.06, 0x1a1a1a, { solid: false });
    B.box(-16, 3, 4, 8, 6, 10, rng.pick(STONE), { mat: 'rough' });
    B.endModel();
    plinth(B, 12, 8.5, depth, DRYSTONE, 'stone', 0.6);
    B.box(-16, -(depth + 0.5) / 2 + 0.02, 4, 8.4, depth + 0.5, 10.4, DRYSTONE, { mat: 'stone', jitter: 0.04 });
    yard(ctx, { x: ox, z: oz, rot, hw: 12, hd: 8.5, base }, 6, 0.55);
    prayerLine(B, [11, 9, -8], [30, 2, -20]);
    prayerLine(B, [-11, 9, 8], [-26, 1, 22]);
    B.footprint(18);
  },
  tentCamp(B, d, rng, ctx: PropCtx) {
    const n = Number(d.p?.n ?? 6);
    // 高山帐篷：外帐颜色鲜艳，但在太阳底下晒旧了，不是糖果色
    const cols = [0xb9622f, 0xc9a43e, 0x3f6688, 0xa64a3a];
    const [cx, , cz] = B.origin;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 14 + rng.range(0, 6);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      // 帐篷跟随地面（取四角最低点，避免悬空）
      const foot = Math.min(ctx.terrain.heightAt(x + 1.5, z), ctx.terrain.heightAt(x - 1.5, z), ctx.terrain.heightAt(x, z + 1.5), ctx.terrain.heightAt(x, z - 1.5));
      B.at(x, foot, z, a, 1);
      const c = rng.pick(cols);
      B.sphere(0, 0.05, 0, 1.75, c, { sy: 0.68, seg: 14, mat: 'cloth', solid: false });
      // 门厅和交叉的帐杆
      B.sphere(1.45, 0.02, 0, 1.0, c, { sy: 0.6, seg: 10, mat: 'cloth', solid: false });
      for (const q of [0.78, -0.78]) {
        for (let k = 0; k < 8; k++) {
          const t0 = (k / 8) * Math.PI;
          const t1 = ((k + 1) / 8) * Math.PI;
          const p = (t: number): [number, number, number] => [Math.cos(t) * 1.78 * Math.cos(q), Math.sin(t) * 1.24, Math.cos(t) * 1.78 * Math.sin(q)];
          B.beam(p(t0), p(t1), 0.028, 0x24262a, { solid: false, mat: 'metal' });
        }
      }
      // 防风绳
      for (const [gx, gz] of [[3.1, 1.3], [3.1, -1.3], [-2.9, 1.5], [-2.9, -1.5]]) B.beam([gx * 0.5, 1.0, gz * 0.5], [gx, 0.02, gz], 0.012, 0xc8c4b8, { solid: false, mat: 'metal' });
    }
    B.footprint(20);
  },
  colHut(B) {
    // 山口科考站：两节保温舱、气象桅杆（风杯 + 风向袋）、太阳能板与通信天线
    B.box(-4, 1.45, 0, 6.1, 2.9, 2.6, 0xe86a1a, { mat: 'metal' });
    B.box(2.4, 1.45, 0, 6.1, 2.9, 2.6, 0xe8e4dc, { mat: 'metal' });
    B.box(-0.8, 3.0, 0, 12.8, 0.2, 2.9, 0x6a6e72, { mat: 'metal', solid: false });
    for (let i = 0; i < 3; i++) B.box(-5.5 + i * 3.6, 1.7, 1.33, 1.3, 0.9, 0.06, 0x1a2a4a, { mat: 'glass', solid: false });
    B.box(1.6, 1.1, 1.33, 1.0, 2.0, 0.06, 0x3a3e44, { mat: 'metal', solid: false });
    // 太阳能板
    for (let i = 0; i < 3; i++) B.box(-5 + i * 2.4, 1.2, -3.6, 2.2, 0.08, 1.4, 0x1e2c4c, { mat: 'glass', solid: false });
    B.box(-2.6, 0.55, -3.6, 7.6, 1.1, 0.12, 0x8a8e92, { mat: 'metal', solid: false });
    // 气象桅杆
    B.cyl(7.5, 4, -1.5, 0.09, 0.07, 8, 0xe0e0e0, 6, { mat: 'metal' });
    B.box(7.5, 8.05, -1.5, 1.2, 0.06, 0.06, 0xd0d0d0, { mat: 'metal', solid: false });
    B.sphere(8.1, 8.05, -1.5, 0.16, 0xe8e8e8, { seg: 6, solid: false });
    B.sphere(6.9, 8.05, -1.5, 0.16, 0xe8e8e8, { seg: 6, solid: false });
    B.anchor('windsock', 7.5, 6.2, -1.5);
    // 通信天线
    B.cyl(-8.5, 5, 0.5, 0.1, 0.07, 10, 0xd0d0d0, 6, { mat: 'metal' });
    B.anchor('blink', -8.5, 10.2, 0.5, 0, { color: 'red', period: 2 });
    B.anchor('flag', -1, 5.4, -1.2, 0, { color: 'np' });
    B.cyl(-1, 4.2, -1.2, 0.05, 0.04, 2.4, 0xdddddd, 6, { solid: false });
    B.footprint(10);
  },
  maniWall(B, d) {
    const len = Number(d.p?.len ?? 24);
    B.beginModel('mani_wall', 0, 0, 0, 0, len / 24, 1, 1);
    B.box(0, 0.8, 0, len, 1.6, 2, 0x7a7268, { mat: 'rough' });
    for (let x = -len / 2 + 1; x < len / 2; x += 2) B.box(x, 1.7, 0, 1.6, 0.3, 1.8, 0x8a8278, { mat: 'rough', solid: false });
    B.endModel();
    B.footprint(len / 2 + 1);
  },
};
