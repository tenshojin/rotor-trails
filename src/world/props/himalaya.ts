// 尼泊尔高山地图的道具：石屋与村落、佛塔（白塔）、经幡、寺院、高山营地帐篷、玛尼石堆、气象站。

import type { Rng } from '../../core/noise';
import type { PropBuilder } from '../propBuilder';
import type { PropCtx, PropFn } from './common';

const STONE = [0x8a8278, 0x7a7268, 0x9a9286, 0xa89e90];

function stoneHouse(B: PropBuilder, rng: Rng): void {
  const w = rng.range(6, 9);
  const l = rng.range(7, 10);
  const h = rng.range(3.5, 5.5);
  B.box(0, h / 2, 0, w, h, l, rng.pick(STONE), { mat: 'rough', jitter: 0.08 });
  B.box(0, h + 0.25, 0, w + 0.6, 0.5, l + 0.6, 0x5a4a3a, { solid: false });
  B.box(0, h * 0.85, l / 2 + 0.03, w * 0.9, 0.5, 0.06, 0x8a2a1a, { solid: false });
  for (let i = -1; i <= 1; i += 2) B.box(i * w * 0.25, h * 0.55, l / 2 + 0.04, 0.9, 1.1, 0.06, 0x1a1a1a, { solid: false });
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
  stoneHouse(B, _d, rng) {
    stoneHouse(B, rng);
  },
  hvillage(B, d, rng, ctx: PropCtx) {
    const [cx, , cz] = B.origin;
    const r = Number(d.p?.r ?? 80);
    const n = Number(d.p?.n ?? 10);
    const placed: Array<[number, number]> = [];
    for (let tries = 0; placed.length < n && tries < n * 25; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.float()) * r;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (ctx.terrain.slopeAt(x, z) > 0.22) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 14)) continue;
      const foot = Math.min(ctx.terrain.heightAt(x, z), ctx.terrain.heightAt(x + 4, z), ctx.terrain.heightAt(x - 4, z), ctx.terrain.heightAt(x, z + 4), ctx.terrain.heightAt(x, z - 4));
      B.at(x, foot, z, rng.range(0, Math.PI), 1);
      stoneHouse(B, rng);
      placed.push([x, z]);
    }
  },
  chorten(B) {
    // 白塔（佛塔）
    B.box(0, 1.5, 0, 9, 3, 9, 0xe8e4dc, { mat: 'rough' });
    B.box(0, 4, 0, 7, 2, 7, 0xe8e4dc, { mat: 'rough' });
    B.sphere(0, 7.5, 0, 3.6, 0xf2f0ea, { sy: 0.85, seg: 12 });
    B.box(0, 10.6, 0, 2.2, 1.4, 2.2, 0xe8e4dc, {});
    B.cone(0, 14, 0, 1.2, 5.5, 0xc8a050, 10, { mat: 'metal' });
    B.box(0, 10.6, 1.15, 1.2, 0.8, 0.05, 0x2a4a8a, { solid: false });
    prayerLine(B, [0, 16, 0], [18, 2, 6]);
    prayerLine(B, [0, 16, 0], [-17, 2, -8]);
    B.footprint(8);
  },
  prayerFlags(B, d) {
    const x2 = Number(d.p?.x2 ?? 30);
    const z2 = Number(d.p?.z2 ?? 0);
    const h = Number(d.p?.h ?? 5);
    B.cyl(0, h / 2, 0, 0.08, 0.06, h, 0x6a5a4a, 6, { solid: false });
    B.cyl(x2, h / 2, z2, 0.08, 0.06, h, 0x6a5a4a, 6, { solid: false });
    prayerLine(B, [0, h, 0], [x2, h, z2]);
  },
  monastery(B, _d, rng) {
    // 寺院：白墙、红色檐带、金顶
    B.box(0, 4, 0, 22, 8, 16, 0xe8e4dc, { mat: 'rough' });
    B.box(0, 8.4, 0, 22.4, 0.8, 16.4, 0x8a2a1a, { solid: false });
    B.box(0, 10, 0, 12, 4, 9, 0xe8e4dc, { mat: 'rough' });
    B.hip(0, 12, 0, 13, 10, 3, 0.8, 0xc8a050, { mat: 'metal' }, 0.3);
    B.cone(0, 16, 0, 0.8, 2.5, 0xd8b060, 8, { mat: 'metal', solid: false });
    for (let i = -2; i <= 2; i++) B.box(i * 4, 3.5, 8.04, 1.2, 1.8, 0.06, 0x1a1a1a, { solid: false });
    B.box(-16, 3, 4, 8, 6, 10, rng.pick(STONE), { mat: 'rough' });
    prayerLine(B, [11, 9, -8], [30, 2, -20]);
    prayerLine(B, [-11, 9, 8], [-26, 1, 22]);
    B.footprint(18);
  },
  tentCamp(B, d, rng, ctx: PropCtx) {
    const n = Number(d.p?.n ?? 6);
    const cols = [0xd8601a, 0xe8c020, 0x2a6ab0, 0xc0302a];
    const [cx, , cz] = B.origin;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 14 + rng.range(0, 6);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      // 帐篷跟随地面（取四角最低点，避免悬空）
      const foot = Math.min(ctx.terrain.heightAt(x + 1.5, z), ctx.terrain.heightAt(x - 1.5, z), ctx.terrain.heightAt(x, z + 1.5), ctx.terrain.heightAt(x, z - 1.5));
      B.at(x, foot, z, a, 1);
      B.sphere(0, 0.2, 0, 2.2, rng.pick(cols), { sy: 0.7, seg: 8, mat: 'cloth', solid: false });
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
    B.box(0, 0.8, 0, len, 1.6, 2, 0x7a7268, { mat: 'rough' });
    for (let x = -len / 2 + 1; x < len / 2; x += 2) B.box(x, 1.7, 0, 1.6, 0.3, 1.8, 0x8a8278, { mat: 'rough', solid: false });
    B.footprint(len / 2 + 1);
  },
};
