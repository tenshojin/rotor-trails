// 亚马孙雨林地图的道具：高脚屋、帐篷、浮动码头、科考船、独木舟、林冠观测塔、营地生成器。

import type { PropFn } from './common';

const THATCH = [0x8a7444, 0x7a6438, 0x9a8250];
const WOOD = [0x6a4a2c, 0x5a3e24, 0x7a5636];

export const amazonProps: Record<string, PropFn> = {
  stiltHut(B, d, rng) {
    const w = Number(d.p?.w ?? rng.range(6, 9));
    const l = Number(d.p?.l ?? rng.range(7, 10));
    const stilt = Number(d.p?.stilt ?? 2.2);
    const wood = rng.pick(WOOD);
    // Blender 模型（参考尺寸 7.5 × 8.5 m、桩高 2.2 m）；深色那种木材用风化灰木板款
    B.beginModel(wood === WOOD[1] ? 'stilt_hut_b' : 'stilt_hut_a', 0, stilt - 2.2, 0, 0, w / 7.5, 1, l / 8.5);
    for (const [x, z] of [
      [-w / 2 + 0.4, -l / 2 + 0.4],
      [w / 2 - 0.4, -l / 2 + 0.4],
      [-w / 2 + 0.4, l / 2 - 0.4],
      [w / 2 - 0.4, l / 2 - 0.4],
    ] as Array<[number, number]>)
      B.cyl(x, stilt / 2 - 1, z, 0.18, 0.2, stilt + 2, 0x4a3420, 6, { solid: false });
    B.box(0, stilt + 0.1, 0, w + 1.2, 0.25, l + 1.2, wood, {});
    B.box(0, stilt + 1.5, 0, w, 2.6, l, wood, { jitter: 0.1 });
    B.gable(0, stilt + 2.8, 0, l, w, 2.4, 0.9, rng.pick(THATCH), { jitter: 0.12 }, Math.PI / 2);
    B.box(0, stilt + 1.2, l / 2 + 0.03, 1.0, 1.8, 0.06, 0x2a1a10, { solid: false });
    B.endModel();
    B.colliderBox(0, stilt / 2, 0, w / 2, stilt / 2, l / 2);
    B.footprint(Math.hypot(w, l) / 2 + 2);
  },
  tent(B, _d, rng) {
    const c = rng.pick([0x3a6a8a, 0xc85a2a, 0x4a7a3a, 0xd8c060]);
    B.gable(0, 0, 0, 4.5, 3.2, 2.2, 0.1, c, { mat: 'cloth' }, 0);
    B.footprint(3);
  },
  camp(B, d, rng, ctx) {
    // 营地：若干高脚屋 + 帐篷 + 物资箱
    const [cx, cy, cz] = B.origin;
    const r = Number(d.p?.r ?? 40);
    const n = Number(d.p?.n ?? 4);
    const placed: Array<[number, number]> = [];
    for (let tries = 0; placed.length < n && tries < n * 12; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = r * rng.range(0.35, 1);
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const h = ctx.terrain.heightAt(x, z);
      if (ctx.waterLevel !== null && h < ctx.waterLevel + 0.5) continue;
      // 只在营地所在的河岸平地上建屋（不爬上旁边的山坡），且彼此不重叠
      if (Math.abs(h - cy) > 4 || ctx.terrain.slopeAt(x, z) > 0.25) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 13)) continue;
      // 避开停机坪
      if (Math.hypot(x - cx, z - cz) < 16) continue;
      placed.push([x, z]);
      B.at(x, h, z, a + Math.PI / 2, 1);
      if (placed.length % 3 === 0) amazonProps.tent(B, d, rng, ctx);
      else amazonProps.stiltHut(B, { type: 'stiltHut', pos: [x, h, z] }, rng, ctx);
    }
  },
  dock(B, d) {
    const len = Number(d.p?.len ?? 30);
    const w = Number(d.p?.w ?? 4);
    B.box(len / 2, 0.5, 0, len, 0.4, w, 0x7a5636, { jitter: 0.1 });
    for (let x = 3; x < len; x += 6) B.cyl(x, -1.2, w / 2 - 0.3, 0.2, 0.2, 3.5, 0x4a3420, 6, { solid: false });
  },
  riverBoat(B) {
    // 客运木船（Blender 模型参照马瑙斯港的河船）：船体 + 两层开敞甲板 + 船头一侧的驾驶室与桅杆
    const l = 26;
    const w = 7;
    B.beginModel('river_boat');
    B.box(0, 0.7, 0, l, 2.4, w, 0xe8e4da, { jitter: 0.03 });
    B.box(-l / 2 - 1, 0.9, 0, 2.4, 1.6, w * 0.7, 0xe8e4da, { solid: false });
    B.box(0, -0.4, 0, l - 0.5, 0.4, w - 0.4, 0x2a6a4a, { solid: false });
    B.box(-0.5, 3.7, 0, 24, 4.4, w, 0xf2efe8, {});
    B.box(-0.5, 3.4, 0, 24.1, 0.8, w + 0.1, 0x22303c, { mat: 'glass', solid: false });
    B.box(-7.5, 7.1, 0, 5, 2.4, w - 2, 0xf2efe8, {});
    B.cyl(-7.5, 10.6, 0, 0.08, 0.06, 4.5, 0xdddddd, 6, { solid: false });
    B.endModel();
    B.anchor('blink', -7.5, 13.0, 0, 0, { color: 'red', period: 1.5 });
    B.footprint(15);
  },
  canoe(B, _d, rng) {
    const c = rng.pick([0x7a5636, 0x5a3e24, 0x2a5a8a]);
    B.beginModel(c === 0x2a5a8a ? 'canoe_blue' : 'canoe_wood');
    B.box(0, 0.25, 0, 0.9, 0.5, 6, c, { solid: false });
    B.endModel();
    B.footprint(3);
  },
  canopyTower(B, d) {
    // 林冠观测塔：高于树冠的钢架塔 + 观测平台
    const h = Number(d.p?.h ?? 50);
    const s = 3;
    // Blender 模型（参考高度 50 m，按 h 竖向缩放）
    B.beginModel('canopy_tower', 0, 0, 0, 0, 1, h / 50, 1);
    for (const [x, z] of [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ] as Array<[number, number]>)
      B.beam([x, 0, z], [x * 0.6, h, z * 0.6], 0.3, 0x8a8f96, { solid: false });
    for (let k = 1; k <= 6; k++) {
      const y = (h * k) / 6;
      const r = s * (1 - (0.4 * k) / 6);
      B.box(0, y, r, r * 2, 0.15, 0.15, 0x8a8f96, { mat: 'metal', solid: false });
      B.box(0, y, -r, r * 2, 0.15, 0.15, 0x8a8f96, { mat: 'metal', solid: false });
      B.box(r, y, 0, 0.15, 0.15, r * 2, 0x8a8f96, { mat: 'metal', solid: false });
      B.box(-r, y, 0, 0.15, 0.15, r * 2, 0x8a8f96, { mat: 'metal', solid: false });
    }
    B.addColliderCyl(0, h / 2, 0, h / 2, s * 0.85);
    B.box(0, h + 0.2, 0, 7, 0.4, 7, 0x7a5636, {});
    B.box(0, h + 1.4, 3.4, 7, 2, 0.1, 0x6a4a2c, { solid: false });
    B.gable(0, h + 3, 0, 7, 7, 1.6, 0.4, 0x3a5a3a, { mat: 'metal' }, 0);
    B.endModel();
    B.anchor('blink', 0, h + 5, 0, 0, { color: 'red', period: 2 });
    B.footprint(6);
  },
};
