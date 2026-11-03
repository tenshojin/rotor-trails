// 挪威峡湾地图的道具：彩色木屋与村落生成器、木板教堂（地标）、船屋、鲑鱼养殖网箱、瀑布、草皮屋顶农舍。

import type { Rng } from '../../core/noise';
import type { PropBuilder } from '../propBuilder';
import type { PropCtx, PropFn } from './common';

const WALLS = [0x9a2a1e, 0x8c2a20, 0xe8e4dc, 0xd8b040, 0xc88a3a, 0x5a7a8a, 0xe8e4dc];
const ROOFS = [0x2a2a2e, 0x3a3a3e, 0x5a6a3a, 0x4a3a30];

function nhouse(B: PropBuilder, rng: Rng): void {
  const w = rng.range(6, 9);
  const l = rng.range(8, 12);
  const h = rng.range(4, 6);
  const wall = rng.pick(WALLS);
  B.box(0, h / 2, 0, w, h, l, wall, { jitter: 0.05 });
  for (let i = -1; i <= 1; i++) B.box(w / 2 + 0.03, h * 0.55, i * l * 0.28, 0.06, 1.2, 1.0, 0xf2f2f2, { solid: false });
  B.box(0, h * 0.35, l / 2 + 0.03, 1.1, 2.1, 0.06, 0xf2f2f2, { solid: false });
  B.gable(0, h, 0, l, w, w * 0.45, 0.45, rng.pick(ROOFS), {}, Math.PI / 2);
  B.box(0, h + w * 0.45 + 0.4, l * 0.3, 0.6, 1.2, 0.6, 0x6a6a6a, { solid: false });
  B.footprint(Math.hypot(w, l) / 2 + 1.5);
}

function nvillage(B: PropBuilder, d: { p?: Record<string, number | string>; rotY?: number }, rng: Rng, ctx: PropCtx): void {
  const [cx, , cz] = B.origin;
  const r = Number(d.p?.r ?? 100);
  const n = Number(d.p?.n ?? 12);
  const placed: Array<[number, number]> = [];
  let tries = 0;
  while (placed.length < n && tries++ < n * 30) {
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.float()) * r;
    const x = cx + Math.cos(a) * rr;
    const z = cz + Math.sin(a) * rr;
    const h = ctx.terrain.heightAt(x, z);
    if (ctx.waterLevel !== null && h < ctx.waterLevel + 1.5) continue;
    if (ctx.terrain.slopeAt(x, z) > 0.2) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 16)) continue;
    const foot = Math.min(h, ctx.terrain.heightAt(x + 4, z), ctx.terrain.heightAt(x - 4, z), ctx.terrain.heightAt(x, z + 4), ctx.terrain.heightAt(x, z - 4));
    B.at(x, foot, z, rng.range(0, Math.PI) + Number(d.rotY ?? 0), 1);
    nhouse(B, rng);
    placed.push([x, z]);
  }
}

export const fjordProps: Record<string, PropFn> = {
  nhouse(B, _d, rng) {
    nhouse(B, rng);
  },
  nvillage,
  staveChurch(B) {
    // 木板教堂：多层陡峭坡顶，深色木材
    const dark = 0x3a2a1e;
    B.box(0, 3, 0, 10, 6, 14, dark, {});
    B.gable(0, 6, 0, 14, 10, 5, 0.6, 0x2a2018, {}, Math.PI / 2);
    B.box(0, 9, 0, 7, 5, 8, dark, {});
    B.gable(0, 11.5, 0, 8, 7, 4, 0.5, 0x2a2018, {}, Math.PI / 2);
    B.box(0, 14.5, 0, 4, 3, 4, dark, {});
    B.hip(0, 16, 0, 4, 4, 6, 0.3, 0x2a2018, {}, 0.05);
    B.cone(0, 23, 0, 0.8, 4, 0x2a2018, 6, { solid: false });
    B.box(0, 1.8, 7.3, 2, 3.6, 0.6, 0x4a3a2a, {});
    B.footprint(11);
  },
  boathouse(B, _d, rng) {
    const c = rng.pick([0x9a2a1e, 0x8c2a20, 0xb8a888]);
    B.box(0, 2.5, 0, 6, 5, 10, c, {});
    B.gable(0, 5, 0, 10, 6, 2.6, 0.4, 0x2a2a2e, {}, Math.PI / 2);
    B.box(0, -1, 0, 6.2, 2.4, 10.2, 0x5a4a3a, { solid: false });
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
    // 瀑布：沿峭壁垂下的白色水帘 + 底部水雾
    const h = Number(d.p?.h ?? 120);
    const w = Number(d.p?.w ?? 8);
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const y0 = h - (h * i) / steps;
      B.box(Math.sin(i * 1.3) * 0.8, y0 - h / steps / 2, (i * 1.1) % 2.5, w * (1 + i * 0.06), h / steps + 0.5, 1.2, 0xe8f0f4, { solid: false, mat: 'std', jitter: 0.03 });
    }
    B.sphere(0, 4, 3, w * 1.4, 0xf0f4f6, { sy: 0.5, noise: 0.3, solid: false });
  },
  turfFarm(B, _d, rng) {
    nhouse(B, rng);
    B.at(B.origin[0] + 14, B.origin[1], B.origin[2] + 6, B.rotation + 0.4, 0.8);
    nhouse(B, rng);
  },
};
