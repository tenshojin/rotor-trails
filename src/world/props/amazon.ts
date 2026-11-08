// 亚马孙雨林地图的道具：高脚屋、帐篷、浮动码头、科考船、独木舟、林冠观测塔、营地生成器。
//
// 营地与地形的衔接参照亚马孙河沿岸的河民村落（ribeirinhos）：高脚屋之间是踩实的红土空地与小路，
// 一条小路通到河边，岸边伸出木板栈桥，独木舟系在栈桥旁、或拖上岸边。

import type { PropFn } from './common';
import { pathNet } from './settle';

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
      B.cyl(x, stilt / 2 - 1, z, 0.18, 0.2, stilt + 2, 0x4a3420, 6, {});
    B.box(0, stilt + 0.1, 0, w + 1.2, 0.25, l + 1.2, wood, {});
    B.box(0, stilt + 1.5, 0, w, 2.6, l, wood, { jitter: 0.1 });
    B.gable(0, stilt + 2.8, 0, l, w, 2.4, 0.9, rng.pick(THATCH), { jitter: 0.12 }, Math.PI / 2);
    B.box(0, stilt + 1.2, l / 2 + 0.03, 1.0, 1.8, 0.06, 0x2a1a10, { solid: false });
    B.endModel();
    B.colliderBox(0, stilt / 2, 0, w / 2, stilt / 2, l / 2);
    B.footprint(Math.hypot(w, l) / 2 + 2);
  },
  tent(B, _d, rng) {
    // 科考队的帆布帐篷：日晒雨淋过的军绿、卡其、灰蓝、铁锈色，不是鲜亮的色块
    const cols = [0x515c46, 0x7d6e50, 0x4b5a63, 0x724c34];
    const k = rng.pick([0, 1, 2, 3]);
    const c = cols[k];
    // Blender 模型（tools/blender/tents.py：布面下垂、接缝、卷起的门帘、拉绳和木桩）；下面的程序几何体是模型缺失时的后备
    B.beginModel(`tent_ridge_${k}`);
    B.gable(0, 0, 0, 4.5, 3.2, 2.2, 0.1, c, { mat: 'cloth' }, 0);
    // 门帘、脊杆、两头的支杆、防风绳
    B.box(2.26, 0.72, 0, 0.03, 1.44, 0.82, 0x24261f, { mat: 'cloth', solid: false });
    B.beam([-2.6, 2.25, 0], [2.6, 2.25, 0], 0.04, 0x3a2c20, { solid: false });
    for (const x of [-2.3, 2.3]) B.beam([x, 0, 0], [x, 2.25, 0], 0.035, 0x3a2c20, { solid: false });
    for (const x of [-1, 1]) {
      B.beam([x * 2.6, 2.25, 0], [x * 4.1, 0.03, 0], 0.012, 0xa8a08a, { solid: false });
      for (const z of [-1, 1]) B.beam([x * 1.9, 0.42, z * 1.62], [x * 2.5, 0.03, z * 2.8], 0.012, 0xa8a08a, { solid: false });
    }
    // 碰撞：三个盒子叠出三角形的截面（帐篷是空壳，模型自己的体素碰撞箱填不实）
    B.colliderBox(0, 0.3, 0, 2.25, 0.3, 1.5);
    B.colliderBox(0, 0.95, 0, 2.25, 0.35, 1.1);
    B.colliderBox(0, 1.65, 0, 2.25, 0.35, 0.5);
    B.endModel();
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
    if (!placed.length) return;
    // 屋前屋后踩实的红土空地、连接各家与停机坪的小路
    for (const [x, z] of placed) {
      ctx.paintCircle?.(1, x, z, 5.5, 3, 0.6);
      ctx.paintCircle?.(2, x, z, 9, 3, 1);
    }
    pathNet(ctx, [[cx, cz], ...placed], 1.2, 0.75, 1);
    // 通到河边的小路 + 木板栈桥 + 独木舟（地图上已有码头的营地用 jetty: 0 关掉）
    const wl = ctx.waterLevel;
    if (wl === null || Number(d.p?.jetty ?? 1) <= 0) return;
    let best: { x: number; z: number; ux: number; uz: number; s: number } | null = null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      for (let s = 8; s < 170; s += 2) {
        const x = cx + ux * s;
        const z = cz + uz * s;
        if (ctx.terrain.heightAt(x, z) < wl - 0.4) {
          if (!best || s < best.s) best = { x, z, ux, uz, s };
          break;
        }
      }
    }
    if (!best) return;
    // 岸边（往回退到刚好露出水面的地方）
    let sx = best.x;
    let sz = best.z;
    for (let k = 0; k < 20 && ctx.terrain.heightAt(sx, sz) < wl + 0.2; k++) {
      sx -= best.ux;
      sz -= best.uz;
    }
    ctx.paintPath?.(1, [[cx, cz], [sx, sz]], 1.2, 1.5, 0.7);
    ctx.paintPath?.(2, [[cx, cz], [sx, sz]], 3, 2, 1);
    // 局部 x 轴沿栈桥朝外（与 PropBuilder 的旋转约定一致）
    const rot = Math.atan2(-best.uz, best.ux);
    B.at(sx, wl + 0.75, sz, rot, 1);
    // Blender 模型（props_amazon.py 的 jetty：横铺的木板、纵梁和横梁、泡在水里发黑的原木桩、缆绳）；下面的程序几何体是后备，
    // 碰撞体照旧由它们生成（桥面也算：落在栈桥上不会陷进板子里）
    B.beginModel('jetty_wood');
    B.box(6, 0, 0, 14, 0.16, 2.2, 0x7a5636, { jitter: 0.14 });
    for (let x = 0; x <= 13; x += 3.25)
      for (const side of [-1, 1]) B.cyl(x, -1.7, side * 1.0, 0.11, 0.11, 3.6, 0x4a3420, 6, {});
    B.endModel();
    // 系在栈桥旁的独木舟（船身沿栈桥方向）
    B.beginModel('canoe_wood', 8, -0.86, 2.2, Math.PI / 2 + 0.06);
    B.box(8, -0.61, 2.2, 6, 0.5, 0.9, 0x7a5636, { solid: false }, 0.06);
    B.endModel();
    // 拖上岸的一条
    const bx = sx - best.ux * 4 - best.uz * 3;
    const bz = sz - best.uz * 4 + best.ux * 3;
    B.at(bx, Math.max(ctx.terrain.heightAt(bx, bz), wl + 0.05), bz, rot + 0.5, 1);
    B.beginModel('canoe_blue', 0, 0, 0, Math.PI / 2);
    B.box(0, 0.25, 0, 6, 0.5, 0.9, 0x2a5a8a, { solid: false });
    B.endModel();
  },
  dock(B, d) {
    const len = Number(d.p?.len ?? 30);
    const w = Number(d.p?.w ?? 4);
    // Blender 模型（props_amazon.py 的 float_dock：木板甲板架在三根原木浮筒上，外侧导向桩、轮胎护舷、系船缆；参考尺寸 30 × 4 m）
    B.beginModel('dock_float', 0, 0, 0, 0, len / 30, 1, w / 4);
    B.box(len / 2, 0.5, 0, len, 0.4, w, 0x7a5636, { jitter: 0.1 });
    for (let x = 3; x < len; x += 6) B.cyl(x, -1.2, w / 2 - 0.3, 0.2, 0.2, 3.5, 0x4a3420, 6, {});
    B.endModel();
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
    B.cyl(-7.5, 10.6, 0, 0.08, 0.06, 4.5, 0xdddddd, 6, {});
    B.endModel();
    B.anchor('blink', -7.5, 13.0, 0, 0, { color: 'red', period: 1.5 });
    B.footprint(15);
  },
  canoe(B, _d, rng) {
    const c = rng.pick([0x7a5636, 0x5a3e24, 0x2a5a8a]);
    B.beginModel(c === 0x2a5a8a ? 'canoe_blue' : 'canoe_wood');
    B.box(0, 0.25, 0, 0.9, 0.5, 6, c, {});
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
