// 日本海湾地图的建筑与地标：民居（瓦顶）、村落生成器、港口仓库、龙门吊、码头、渔船、渡轮、灯塔、
// 海上鸟居、神社、五重塔、观测站、海蚀柱、防波堤。

import type { Rng } from '../../core/noise';
import type { PropDef } from '../../maps/types';
import type { PropBuilder } from '../propBuilder';
import { C, type PropCtx, type PropFn } from './common';

const ROOF = [0x3b4350, 0x434b56, 0x4a3f3a, 0x2f3640];
const WALL = [0xe9e3d6, 0xdcd4c2, 0x6b5440, 0xcfc6b2, 0x8a6a4c];

export function jhouse(B: PropBuilder, rng: Rng, big = false): void {
  const w = rng.range(7, 10) * (big ? 1.3 : 1);
  const d = rng.range(6, 8) * (big ? 1.2 : 1);
  const h = 3;
  const wall = rng.pick(WALL);
  const roof = rng.pick(ROOF);
  const twoStory = rng.chance(big ? 0.9 : 0.45);
  // Blender 模型（参考尺寸 8.5 × 7 m，按本栋的宽/深缩放）；褐色墙 → 杉板外墙款
  const wood = wall === 0x6b5440 || wall === 0x8a6a4c;
  B.beginModel(`jhouse_${twoStory ? 2 : 1}${wood ? 'b' : 'a'}`, 0, 0, 0, 0, w / 8.5, 1, d / 7);
  B.box(0, h / 2, 0, w, h, d, wall, { jitter: 0.06 });
  B.box(0, 0.25, 0, w + 0.2, 0.5, d + 0.2, 0x6f6a62, { solid: false });
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
  B.footprint(Math.hypot(w, d) / 2 + 1.5);
}

/** 村落：在半径内按地形自动放置民居（避开水面与陡坡）。 */
function village(B: PropBuilder, d: PropDef, rng: Rng, ctx: PropCtx): void {
  const [cx, , cz] = B.origin;
  const r = Number(d.p?.r ?? 120);
  const n = Number(d.p?.n ?? 14);
  const minH = Number(d.p?.minH ?? 1.5);
  const placed: Array<[number, number]> = [];
  let tries = 0;
  while (placed.length < n && tries++ < n * 25) {
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.float()) * r;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const h = ctx.terrain.heightAt(x, z);
    if (h < minH || (ctx.waterLevel !== null && h < ctx.waterLevel + 1.2)) continue;
    if (ctx.terrain.slopeAt(x, z) > 0.18) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 15)) continue;
    // 朝向大致对齐（村落街道感）
    const rot = Math.round(rng.range(0, 4)) * (Math.PI / 2) + Number(d.rotY ?? 0) + rng.range(-0.08, 0.08);
    const minFoot = Math.min(h, ctx.terrain.heightAt(x + 4, z), ctx.terrain.heightAt(x - 4, z), ctx.terrain.heightAt(x, z + 4), ctx.terrain.heightAt(x, z - 4));
    B.at(x, minFoot, z, rot, 1);
    jhouse(B, rng, rng.chance(0.15));
    placed.push([x, z]);
  }
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
