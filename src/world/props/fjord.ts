// 挪威峡湾地图的道具：彩色木屋与村落生成器、木板教堂（地标）、船屋、鲑鱼养殖网箱、瀑布、草皮屋顶农舍。
//
// 与地形的衔接参照西挪威的峡湾村落（翁德达尔、巴勒斯特兰、盖朗厄尔）：
// 木屋坐在灰色的石砌 / 混凝土地基上（坡地上下坡一侧露出半层），房前屋后是碎石院子与碎石路，
// 许多人家院子里立着白色旗杆挂国旗，菜园围着白色栅栏，田地边是干砌石墙（steingard）；
// 草皮屋顶农舍旁有架在石墩上的储物仓（stabbur）；木板教堂四周是石墙围起的墓园。

import type { Rng } from '../../core/noise';
import type { PropBuilder } from '../propBuilder';
import type { PropCtx, PropFn } from './common';
import { dryWall, hash01, lotPoint, overlaps, pathNet, plinth, railFence, rectLoop, settle, siteGround, yard, type Lot } from './settle';

const WALLS = [0x9a2a1e, 0x8c2a20, 0xe8e4dc, 0xd8b040, 0xc88a3a, 0x5a7a8a, 0xe8e4dc];
const ROOFS = [0x2a2a2e, 0x3a3a3e, 0x5a6a3a, 0x4a3a30];
const TURF = 0x5a6a3a;
/** 地基：灰色花岗岩 / 刷灰的混凝土 */
const GRANITE = 0x3c3a36;
/** 田间干砌石墙（长了地衣，偏暗） */
const FIELD_STONE = 0x2e2c27;
/** 墙色 → Blender 模型的配色（见 tools/blender/props_fjord.py） */
const WALL_MODEL: Record<number, string> = { 0x9a2a1e: 'red', 0x8c2a20: 'red', 0xe8e4dc: 'white', 0xd8b040: 'yellow', 0xc88a3a: 'yellow', 0x5a7a8a: 'blue' };

interface HouseDims {
  w: number;
  l: number;
  h: number;
  wall: number;
  roof: number;
}

/** 木屋尺寸与配色（随机数的取用顺序与原来相同：宽、长、高、墙色、屋顶） */
function nhouseDims(rng: Rng, turf = false): HouseDims {
  const w = rng.range(6, 9);
  const l = rng.range(8, 12);
  const h = rng.range(4, 6);
  const wall = rng.pick(WALLS);
  const pick = rng.pick(ROOFS);
  return { w, l, h, wall, roof: turf ? TURF : pick };
}

/** 木屋几何（当前变换下，墙脚 y = 0） */
function nhouseGeom(B: PropBuilder, D: HouseDims): void {
  const { w, l, h, wall, roof } = D;
  // Blender 模型（参考尺寸 宽 7.5 × 长 10 m、墙高 5 m，按本栋缩放）
  B.beginModel(`nhouse_${WALL_MODEL[wall]}_${roof === TURF ? 'turf' : 'tile'}`, 0, 0, 0, 0, w / 7.5, h / 5, l / 10);
  B.box(0, h / 2, 0, w, h, l, wall, { jitter: 0.05 });
  for (let i = -1; i <= 1; i++) B.box(w / 2 + 0.03, h * 0.55, i * l * 0.28, 0.06, 1.2, 1.0, 0xf2f2f2, { solid: false });
  B.box(0, h * 0.35, l / 2 + 0.03, 1.1, 2.1, 0.06, 0xf2f2f2, { solid: false });
  B.gable(0, h, 0, l, w, w * 0.45, 0.45, roof, {}, Math.PI / 2);
  B.box(0, h + w * 0.45 + 0.4, l * 0.3, 0.6, 1.2, 0.6, 0x6a6a6a, { solid: false });
  B.endModel();
  B.footprint(Math.hypot(w, l) / 2 + 1.5);
}

/** 放一栋木屋：坐在占地范围内地面的最高处 + 0.45 m，石砌地基一直砌到最低处以下（坡地上露出半层） */
function placeHouse(B: PropBuilder, ctx: PropCtx, x: number, z: number, rot: number, D: HouseDims, s = 1): Lot {
  const { base, depth } = settle(ctx, x, z, rot, (D.w / 2) * s, (D.l / 2) * s, 0.45);
  B.at(x, base, z, rot, s);
  nhouseGeom(B, D);
  plinth(B, D.w / 2, D.l / 2, depth / s, GRANITE, 'stone', 0.15);
  return { x, z, rot, hw: (D.w / 2) * s, hd: (D.l / 2) * s, base };
}

/** 旗杆 + 挪威国旗（院子一角） */
function flagpole(B: PropBuilder, ctx: PropCtx, x: number, z: number): void {
  const y = ctx.terrain.heightAt(x, z);
  if (ctx.waterLevel !== null && y < ctx.waterLevel + 0.5) return;
  B.at(x, y, z, 0, 1);
  B.cyl(0, 4.5, 0, 0.09, 0.055, 9, 0xf2f2f0, 6, { mat: 'metal', solid: false });
  B.sphere(0, 9.05, 0, 0.12, 0xe8c040, { seg: 6, solid: false });
  B.anchor('flag', 0, 8.75, 0, 0, { color: 'no' });
}

/** 储物仓（stabbur）：架在石墩上的小木仓，二层略向外挑，草皮屋顶 */
function stabbur(B: PropBuilder, ctx: PropCtx, x: number, z: number, rot: number): Lot {
  const hw = 2.3;
  const hd = 2.9;
  const g = siteGround(ctx, x, z, rot, hw, hd);
  const base = g.top + 0.95;
  B.at(x, base, z, rot, 1);
  for (const px of [-1.9, 1.9])
    for (const pz of [-2.4, 0, 2.4]) {
      const [wx, wz] = lotPoint({ x, z, rot }, px, pz);
      const hh = base - ctx.terrain.heightAt(wx, wz) + 0.3;
      B.box(px, -hh / 2, pz, 0.5, hh, 0.5, GRANITE, { mat: 'stone', jitter: 0.05 });
    }
  B.box(0, 0.12, 0, 4.8, 0.24, 6.0, 0x2a1c10, {});
  B.box(0, 1.35, 0, 4.4, 2.2, 5.6, 0x3a2818, { jitter: 0.05 });
  B.box(0, 2.95, 0, 5.0, 1.0, 6.2, 0x30200f, { jitter: 0.05 });
  B.gable(0, 3.45, 0, 6.8, 5.6, 2.1, 0.35, TURF, {}, Math.PI / 2);
  B.box(0, 1.15, 2.83, 0.9, 1.8, 0.06, 0x2e2016, { solid: false });
  B.footprint(4.5);
  return { x, z, rot, hw, hd, base };
}

/** 村落周边：碎石院子与小路、旗杆、菜园栅栏、田边石墙 */
function villageExtras(B: PropBuilder, ctx: PropCtx, lots: Lot[], cx: number, cz: number, r: number): void {
  if (!lots.length) return;
  for (const l of lots) yard(ctx, l, 2.5, 0.42);
  pathNet(
    ctx,
    lots.map((l) => [l.x, l.z]),
    1.5,
    0.85,
    Math.floor(lots.length / 5),
  );
  for (const l of lots) {
    // 约四成人家院子里有旗杆
    if (hash01(l.x, l.z, 7) < 0.4) {
      const [fx, fz] = lotPoint(l, l.hw + 3.2, -l.hd + 1.5);
      flagpole(B, ctx, fx, fz);
    }
    // 约三成人家房后有白色栅栏围起的菜园
    if (hash01(l.x, l.z, 8) < 0.3) {
      const back = [lotPoint(l, -l.hw - 2.5, l.hd + 1.5), lotPoint(l, -l.hw - 2.5, l.hd + 9), lotPoint(l, l.hw + 2.5, l.hd + 9), lotPoint(l, l.hw + 2.5, l.hd + 1.5)];
      if (!back.some(([x, z]) => overlaps(lots.filter((o) => o !== l), x, z, 0, 1.5))) railFence(B, ctx, back, 1.05, 2.2, 0xeeeeea);
    }
  }
  // 村边田地的干砌石墙：三段圆弧，碰到房子就往外挪
  for (let k = 0; k < 3; k++) {
    const a0 = hash01(cx, cz, 20 + k) * Math.PI * 2;
    for (let tryR = 1.15; tryR < 1.6; tryR += 0.15) {
      const arc: Array<[number, number]> = [];
      for (let s = 0; s <= 12; s++) {
        const a = a0 + (s / 12) * 0.85;
        const rr = r * (tryR + 0.06 * Math.sin(s * 1.3 + k));
        arc.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
      }
      if (arc.some(([x, z]) => overlaps(lots, x, z, 0, 4))) continue;
      dryWall(B, ctx, arc, 0.95, 0.85, FIELD_STONE);
      break;
    }
  }
}

function nvillage(B: PropBuilder, d: { p?: Record<string, number | string>; rotY?: number }, rng: Rng, ctx: PropCtx): void {
  const [cx, , cz] = B.origin;
  const r = Number(d.p?.r ?? 100);
  const n = Number(d.p?.n ?? 12);
  const lots: Lot[] = [];
  let tries = 0;
  while (lots.length < n && tries++ < n * 30) {
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.float()) * r;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const h = ctx.terrain.heightAt(x, z);
    if (ctx.waterLevel !== null && h < ctx.waterLevel + 1.5) continue;
    if (ctx.terrain.slopeAt(x, z) > 0.2) continue;
    if (lots.some((l) => Math.hypot(l.x - x, l.z - z) < 16)) continue;
    const rot = rng.range(0, Math.PI) + Number(d.rotY ?? 0);
    lots.push(placeHouse(B, ctx, x, z, rot, nhouseDims(rng)));
  }
  villageExtras(B, ctx, lots, cx, cz, r);
}

export const fjordProps: Record<string, PropFn> = {
  nhouse(B, _d, rng, ctx) {
    const [x, , z] = B.origin;
    const l = placeHouse(B, ctx, x, z, B.rotation, nhouseDims(rng));
    yard(ctx, l, 2.5, 0.42);
    flagpole(B, ctx, ...lotPoint(l, l.hw + 3.2, -l.hd + 1.5));
  },
  nvillage,
  staveChurch(B, _d, _rng, ctx) {
    // 木板教堂：多层陡峭坡顶，深色木材（Blender 模型参照博尔贡木板教堂；西门朝本地 +z）
    const dark = 0x3a2a1e;
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    const { base, depth } = settle(ctx, ox, oz, rot, 5.5, 7.6, 0.4);
    B.at(ox, base, oz, rot, 1);
    B.beginModel('stave_church', 0, 0, 0, Math.PI);
    B.box(0, 3, 0, 10, 6, 14, dark, {});
    B.gable(0, 6, 0, 14, 10, 5, 0.6, 0x2a2018, {}, Math.PI / 2);
    B.box(0, 9, 0, 7, 5, 8, dark, {});
    B.gable(0, 11.5, 0, 8, 7, 4, 0.5, 0x2a2018, {}, Math.PI / 2);
    B.box(0, 14.5, 0, 4, 3, 4, dark, {});
    B.hip(0, 16, 0, 4, 4, 6, 0.3, 0x2a2018, {}, 0.05);
    B.cone(0, 23, 0, 0.8, 4, 0x2a2018, 6, { solid: false });
    B.box(0, 1.8, 7.3, 2, 3.6, 0.6, 0x4a3a2a, {});
    B.endModel();
    plinth(B, 5.2, 7.2, depth, GRANITE, 'stone', 0.25);
    B.footprint(11);
    // 墓园：干砌石墙围起，西门（+z）一侧留门口，碎石路通向门口；墓碑排成几行
    const church = { x: ox, z: oz, rot };
    const gate = lotPoint(church, 0, 19);
    dryWall(B, ctx, rectLoop(church, 15, 19), 1.05, 0.9, FIELD_STONE, [gate]);
    ctx.paintPath?.(1, [lotPoint(church, 0, 8.5), gate, lotPoint(church, 0, 40)], 1.3, 1.5, 0.85);
    ctx.paintPath?.(2, [lotPoint(church, 0, 8.5), lotPoint(church, 0, 40)], 3, 2, 1);
    ctx.paintRect?.(2, ox, oz, rot, 17, 21, 3, 1);
    B.at(0, 0, 0, 0, 1);
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 7; k++) {
        const lx = (k - 3) * 2.6 + (row % 2) * 0.8;
        const lz = -16 + row * 3.2;
        if (Math.abs(lx) < 2) continue;
        const [gx, gz] = lotPoint(church, lx, lz);
        const gy = ctx.terrain.heightAt(gx, gz);
        B.box(gx, gy + 0.35, gz, 0.55, 0.9, 0.14, 0x4a4a46, { mat: 'stone', solid: false, jitter: 0.12 }, rot);
      }
  },
  boathouse(B, _d, rng, ctx) {
    const c = rng.pick([0x9a2a1e, 0x8c2a20, 0xb8a888]);
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    // 船屋（naust）建在岸边的石砌墙基上，朝水的一面敞开
    const { base, depth } = settle(ctx, ox, oz, rot, 3, 5, 0.25);
    B.at(ox, base, oz, rot, 1);
    B.beginModel(c === 0xb8a888 ? 'boathouse_grey' : 'boathouse_red');
    B.box(0, 2.5, 0, 6, 5, 10, c, {});
    B.gable(0, 5, 0, 10, 6, 2.6, 0.4, 0x2a2a2e, {}, Math.PI / 2);
    B.box(0, -1, 0, 6.2, 2.4, 10.2, 0x5a4a3a, { solid: false });
    B.endModel();
    plinth(B, 3, 5, depth, GRANITE, 'stone', 0.2, 1.2);
    B.footprint(6);
  },
  fishFarm(B, d) {
    // 鲑鱼养殖网箱：水面上一圈圈浮环
    const n = Number(d.p?.n ?? 4);
    const r = Number(d.p?.r ?? 14);
    for (let i = 0; i < n; i++) {
      const cx = (i % 2) * (r * 2.4) - r * 1.2;
      const cz = Math.floor(i / 2) * (r * 2.4) - r * 1.2;
      const seg = 18;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2;
        const a1 = ((k + 1) / seg) * Math.PI * 2;
        B.beam([cx + Math.cos(a0) * r, 0.25, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, 0.25, cz + Math.sin(a1) * r], 0.45, 0x2a2a2a, { solid: false });
      }
      B.cyl(cx, 3, cz, 0.08, 0.06, 6, 0x888888, 6, { solid: false });
      B.box(cx, 0.4, cz, 1.6, 0.4, 1.6, 0xe8a020, { solid: false });
    }
    B.box(-r * 3.4, 1.2, 0, 8, 2.4, 5, 0xd8d8d0, { mat: 'metal' });
    B.footprint(r * 3);
  },
  waterfall(B, d) {
    // 瀑布：贴着山壁流下的水带与底部水雾，在 PropsView.buildWaterfall 里按地形生成
    B.anchor('waterfall', 0, 0, 0, 0, { h: Number(d.p?.h ?? 120), w: Number(d.p?.w ?? 8) });
  },
  turfFarm(B, _d, rng, ctx) {
    // 草皮屋顶农舍：主屋 + 稍小的副屋 + 石墩上的储物仓，石墙围起屋后的草场
    const [ox, , oz] = B.origin;
    const rot = B.rotation;
    const lots: Lot[] = [placeHouse(B, ctx, ox, oz, rot, nhouseDims(rng, true))];
    lots.push(placeHouse(B, ctx, ox + 14, oz + 6, rot + 0.4, nhouseDims(rng, true), 0.8));
    const [sx, sz] = lotPoint(lots[0], -lots[0].hw - 8, 3);
    lots.push(stabbur(B, ctx, sx, sz, rot + 0.1));
    for (const l of lots) yard(ctx, l, 2, 0.4);
    pathNet(
      ctx,
      lots.map((l) => [l.x, l.z]),
      1.3,
      0.8,
    );
    const field = { x: lotPoint(lots[0], 4, -30)[0], z: lotPoint(lots[0], 4, -30)[1], rot };
    dryWall(B, ctx, rectLoop(field, 24, 16), 1.0, 0.85, FIELD_STONE, [lotPoint(field, 0, 16)]);
  },
};
