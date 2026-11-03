// 美国西南峡谷地图的道具：研究站、巡查传感器桩、天然岩拱、石柱（hoodoo）、游客中心、土坯房、水塔、风车、皮卡。

import { quatYawPitch } from '../propBuilder';
import type { PropFn } from './common';

const RED = 0xb4583a;

export const canyonProps: Record<string, PropFn> = {
  researchStation(B) {
    // 模块化集装箱营地
    const cols = [0xe8e4da, 0xd8d0c0, 0x8a9aa8];
    for (let i = 0; i < 4; i++) B.box(-10 + i * 7, 1.45, -6, 6, 2.9, 3.0, cols[i % 3], { mat: 'metal' }, 0);
    B.box(4, 1.45, 5, 12, 2.9, 3, 0xf0ece4, { mat: 'metal' });
    B.box(-6, 1.5, 6, 6, 3, 6, 0xd8d0c0, { mat: 'metal' });
    for (let i = 0; i < 4; i++) B.box(-12 + i * 3.2, 1.6, 12, 2.8, 0.08, 1.8, 0x1a2a4a, { mat: 'glass', solid: false }, 0);
    B.cyl(13, 3, -3, 1.8, 1.8, 6, 0xd8d8d0, 12, { mat: 'metal' });
    B.cyl(13, 6.5, -3, 1.9, 0.2, 1, 0xb0b0a8, 12, { mat: 'metal', solid: false });
    B.cyl(-15, 7, 2, 0.12, 0.08, 14, 0xd0d0d0, 6, { mat: 'metal' });
    B.anchor('blink', -15, 14.3, 2, 0, { color: 'red', period: 2 });
    B.anchor('flag', 6, 6.5, -9, 0, { color: 'us' });
    B.cyl(6, 3.3, -9, 0.06, 0.05, 6.6, 0xdddddd, 6, { solid: false });
    B.footprint(18);
  },
  sensorPost(B) {
    B.box(0, 0.3, 0, 2.5, 0.6, 2.5, 0x8a857c, { mat: 'rough' });
    B.cyl(0, 3, 0, 0.2, 0.15, 5, 0xe0e0e0, 6, { mat: 'metal' });
    B.box(0.6, 4.2, 0, 0.8, 0.6, 0.6, 0xf0f0f0, { mat: 'metal', solid: false });
    B.box(-0.5, 2.5, 0.3, 0.9, 0.05, 0.7, 0x1a2a4a, { mat: 'glass', solid: false });
    B.cyl(0, 5.7, 0, 0.3, 0.3, 0.4, 0xffd23a, 8, { mat: 'emit', solid: false });
    B.anchor('blink', 0, 5.9, 0, 0, { color: 'red', period: 1.2 });
    B.footprint(3);
  },
  arch(B, d) {
    // 天然岩拱：矩形截面沿半椭圆弧扫掠，带噪声起伏；碰撞体由沿弧的倾斜长方体组成
    const span = Number(d.p?.span ?? 80);
    const rise = Number(d.p?.rise ?? 55);
    const thick = Number(d.p?.thick ?? 14);
    const depth = Number(d.p?.depth ?? 18);
    const n = 22;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (i / n);
      pts.push([(-Math.cos(a) * span) / 2, Math.sin(a) * rise]);
    }
    const tris: number[] = [];
    const ring = (i: number, k: number): [number, number, number] => {
      const [x, y] = pts[i];
      const a = Math.PI * (i / n);
      const nx = -Math.cos(a) * (span / 2 / Math.max(span / 2, rise));
      const ny = Math.sin(a);
      const l = Math.hypot(nx, ny);
      const ox = nx / l;
      const oy = ny / l;
      const wob = 1 + 0.18 * Math.sin(i * 1.7 + k * 2.3);
      const t = (thick * wob) / 2;
      const dd = (depth * (0.85 + 0.15 * Math.cos(i * 0.9))) / 2;
      const corners: Array<[number, number, number]> = [
        [x + ox * t, y + oy * t, -dd],
        [x + ox * t, y + oy * t, dd],
        [x - ox * t, y - oy * t, dd],
        [x - ox * t, y - oy * t, -dd],
      ];
      return corners[k];
    };
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const a = ring(i, k);
        const b = ring(i + 1, k);
        const c = ring(i + 1, (k + 1) % 4);
        const e = ring(i, (k + 1) % 4);
        tris.push(...a, ...b, ...c, ...a, ...c, ...e);
      }
    }
    B.mesh(tris, RED, 'rock', 0.12);
    // 拱脚岩基
    B.sphere(-span / 2, 4, 0, thick * 1.1, 0x9a4a32, { mat: 'rock', sy: 1.4, noise: 0.3, seg: 9 });
    B.sphere(span / 2, 4, 0, thick * 1.1, 0x9a4a32, { mat: 'rock', sy: 1.4, noise: 0.3, seg: 9 });
    // 碰撞体
    const [ox, oy, oz] = B.origin;
    const rot = B.rotation;
    const s = B.scale;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      // 长方体局部 Z 轴沿弧切线：先绕 Y 转到 X 轴方向，再俯仰
      const q = quatYawPitch(rot + Math.PI / 2, -ang);
      const wx = ox + mx * Math.cos(rot) * s;
      const wz = oz - mx * Math.sin(rot) * s;
      B.colliderBoxQ([wx, oy + my * s, wz], [(depth / 2) * s, (thick / 2) * s * 0.9, (len / 2) * s * 1.05], q, { kind: 'rock', id: 'arch' });
    }
    B.footprint(span / 2 + thick);
  },
  hoodoo(B, d, rng) {
    const h = Number(d.p?.h ?? rng.range(14, 30));
    const r = Number(d.p?.r ?? rng.range(2.5, 4.5));
    let y = 0;
    let i = 0;
    const cols = [0xb4583a, 0xc87a50, 0x9a4630, 0xd4a070];
    while (y < h) {
      const seg = r * rng.range(1.4, 2.2);
      const rr = r * (1 - (y / h) * 0.35) * rng.range(0.85, 1.1);
      B.sphere(rng.range(-0.4, 0.4), y + seg / 2, rng.range(-0.4, 0.4), rr, cols[i++ % cols.length], { mat: 'rock', sy: seg / (rr * 2) + 0.1, noise: 0.25, seg: 9, solid: false });
      y += seg * 0.8;
    }
    B.sphere(0, h + r * 0.4, 0, r * 1.3, 0x7a3a28, { mat: 'rock', sy: 0.45, noise: 0.3, seg: 9, solid: false });
    B.addColliderCyl(0, h / 2, 0, h / 2 + r * 0.4, r * 0.95, { kind: 'rock' });
    B.footprint(r * 1.5 + 1);
  },
  hoodooField(B, d, rng, ctx) {
    const [cx, , cz] = B.origin;
    const r = Number(d.p?.r ?? 80);
    const n = Number(d.p?.n ?? 10);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.float()) * r;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (ctx.terrain.slopeAt(x, z) > 0.35) continue;
      B.at(x, ctx.terrain.heightAt(x, z) - 1, z, 0, 1);
      canyonProps.hoodoo(B, { type: 'hoodoo', pos: [x, 0, z] }, rng, ctx);
    }
  },
  visitorCenter(B) {
    B.box(0, 2.2, 0, 26, 4.4, 14, 0xc8a27a, {});
    B.box(0, 4.6, 0, 27, 0.5, 15, 0x8a6a4a, { solid: false });
    for (let i = -3; i <= 3; i++) B.cyl(i * 3.6, 5, 7.6, 0.18, 0.18, 0.4, 0x6a4a2a, 6, { solid: false });
    B.box(0, 1.6, 7.05, 18, 1.8, 0.1, 0x22303c, { mat: 'glass', solid: false });
    B.box(-9, 3.8, -3, 6, 2.5, 6, 0xb8926a, {});
    B.footprint(16);
  },
  adobe(B, d, rng) {
    const w = Number(d.p?.w ?? rng.range(7, 11));
    const l = Number(d.p?.l ?? rng.range(6, 9));
    const c = rng.pick([0xc8a27a, 0xb88e64, 0xd4b48c]);
    B.box(0, 1.8, 0, w, 3.6, l, c, { jitter: 0.05 });
    B.box(0, 3.75, 0, w + 0.3, 0.3, l + 0.3, 0x9a7a58, { solid: false });
    for (let i = 0; i < 3; i++) B.cyl(-w / 2 + 1 + i * (w / 3), 3.2, l / 2 + 0.15, 0.12, 0.12, 0.3, 0x5a3a20, 5, { solid: false });
    B.box(w * 0.2, 1.2, l / 2 + 0.03, 1.1, 2.2, 0.06, 0x4a3020, { solid: false });
    B.footprint(Math.hypot(w, l) / 2 + 1);
  },
  waterTower(B) {
    for (const [x, z] of [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ] as Array<[number, number]>)
      B.beam([x * 1.2, 0, z * 1.2], [x * 0.8, 10, z * 0.8], 0.25, 0x6a5040, { mat: 'std', solid: false });
    B.cyl(0, 12.5, 0, 3, 3, 5, 0x8a6a4a, 14, {});
    B.cone(0, 16, 0, 3.3, 2, 0x5a4a3a, 14, { solid: false });
    B.addColliderCyl(0, 6, 0, 6, 2.2);
    B.footprint(5);
  },
  windmill(B) {
    B.beam([-1.2, 0, -1.2], [-0.2, 11, -0.2], 0.18, 0x777777, { solid: false });
    B.beam([1.2, 0, -1.2], [0.2, 11, -0.2], 0.18, 0x777777, { solid: false });
    B.beam([1.2, 0, 1.2], [0.2, 11, 0.2], 0.18, 0x777777, { solid: false });
    B.beam([-1.2, 0, 1.2], [-0.2, 11, 0.2], 0.18, 0x777777, { solid: false });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      B.beam([0, 11.5, 0.4], [Math.cos(a) * 2.4, 11.5 + Math.sin(a) * 2.4, 0.4], 0.12, 0xd8d8d8, { solid: false });
    }
    B.box(0, 11.5, -1.5, 0.1, 1.2, 2.2, 0xd8d8d8, { solid: false });
    B.addColliderCyl(0, 5.5, 0, 5.5, 1.0);
    B.footprint(3);
  },
  truck(B, _d, rng) {
    const c = rng.pick([0xb8322a, 0xe8e8e8, 0x2f62b0, 0x3a3a3a]);
    B.box(0, 1.0, 0, 2.0, 1.1, 5.4, c, { mat: 'metal' });
    B.box(0, 1.9, -0.6, 1.9, 0.8, 2.0, c, { mat: 'metal' });
    B.box(0, 1.95, -1.65, 1.8, 0.6, 0.05, 0x1a2a38, { mat: 'glass', solid: false });
    for (const [x, z] of [
      [-1, -1.7],
      [1, -1.7],
      [-1, 1.7],
      [1, 1.7],
    ] as Array<[number, number]>)
      B.cyl(x, 0.4, z, 0.4, 0.4, 0.3, 0x1a1a1a, 10, { solid: false });
    B.footprint(3);
  },
};
