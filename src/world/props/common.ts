// 通用道具与停机坪构建。

import type { Rng } from '../../core/noise';
import type { PadDef, PropDef } from '../../maps/types';
import type { Heightfield } from '../../sim/terrain';
import type { PropBuilder } from '../propBuilder';
import { railFence } from './settle';

export interface PropCtx {
  terrain: Heightfield;
  waterLevel: number | null;
  /** 地面高度（地形与水面取高者） */
  ground(x: number, z: number): number;
  /** 往地表掩码里画（只影响地面着色与植被分布，不改地形高度）：通道 1 = 泥土 / 碎石，2 = 不长树 */
  paintPath?(channel: 0 | 1 | 2 | 3, points: Array<[number, number]>, width: number, feather: number, strength?: number): void;
  paintCircle?(channel: 0 | 1 | 2 | 3, x: number, z: number, r: number, feather: number, strength?: number): void;
  /** 旋转矩形（rot 与道具的 rotY 相同）：田地、院子 */
  paintRect?(channel: 0 | 1 | 2 | 3, x: number, z: number, rot: number, hw: number, hd: number, feather: number, strength?: number): void;
}

export type PropFn = (B: PropBuilder, d: PropDef, rng: Rng, ctx: PropCtx) => void;

export const C = {
  white: 0xe8e6e0,
  concrete: 0x9a9890,
  darkConcrete: 0x6f6d68,
  asphalt: 0x3a3b3d,
  yellow: 0xe0b020,
  orange: 0xe06a1c,
  red: 0xb8322a,
  green: 0x3c8a4a,
  blue: 0x2f62b0,
  steel: 0x8a8f96,
  darkSteel: 0x4a4e54,
  wood: 0x8a6440,
  darkWood: 0x5a3d26,
  glass: 0x6c8ea8,
  lamp: 0xfff2c0,
  redLamp: 0xff3020,
  greenLamp: 0x40ff60,
};

const PAD_COLOR: Record<PadDef['kind'], number> = {
  start: C.white,
  delivery: C.orange,
  repair: C.green,
  final: 0x2a7fd4,
  helipad: C.white,
};

/** 停机坪：顶面 = pad.pos[1]，碰撞体标记为 pad（降落判定用）。 */
export function buildPad(B: PropBuilder, pad: PadDef, ctx: PropCtx): void {
  const [x, y, z] = pad.pos;
  const s = pad.size;
  const rot = pad.rotY ?? 0;
  B.at(x, y, z, rot, 1);
  const padTag = { kind: 'pad' as const, padId: pad.id, id: pad.id };
  const structTag = { kind: 'structure' as const, id: pad.id + ':base' };
  const style = pad.style;
  const ground = ctx.ground(x, z);
  const slabT = style === 'ground' || style === 'ledge' ? 0.6 : 0.5;
  const surface = style === 'ground' || style === 'ledge' ? C.concrete : C.darkConcrete;
  B.box(0, -slabT / 2, 0, s, slabT, s, surface, { tag: padTag, mat: 'rough', jitter: 0.02 });
  // 标线：外框、H 字、接地圆
  const mk = 0.03;
  const kc = PAD_COLOR[pad.kind];
  const e = s / 2 - 0.5;
  B.flat(0, mk, -e, s - 1, 0.6, kc, 'std');
  B.flat(0, mk, e, s - 1, 0.6, kc, 'std');
  B.flat(-e, mk, 0, 0.6, s - 1, kc, 'std');
  B.flat(e, mk, 0, 0.6, s - 1, kc, 'std');
  const ring = s * 0.36;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    B.flat(Math.cos(a) * ring, mk, Math.sin(a) * ring, 0.45, (ring * Math.PI * 2) / 24 + 0.05, C.yellow, 'std', -a);
  }
  const hs = s * 0.11;
  if (pad.kind === 'repair') {
    B.flat(0, mk + 0.01, 0, hs * 2.6, hs * 0.8, C.white, 'std');
    B.flat(0, mk + 0.01, 0, hs * 0.8, hs * 2.6, C.white, 'std');
  } else {
    B.flat(-hs, mk + 0.01, 0, hs * 0.45, hs * 2.4, C.white, 'std');
    B.flat(hs, mk + 0.01, 0, hs * 0.45, hs * 2.4, C.white, 'std');
    B.flat(0, mk + 0.01, 0, hs * 2, hs * 0.4, C.white, 'std');
  }
  // 边灯
  for (const [lx, lz] of [
    [-s / 2, -s / 2],
    [s / 2, -s / 2],
    [-s / 2, s / 2],
    [s / 2, s / 2],
    [0, -s / 2],
    [0, s / 2],
    [-s / 2, 0],
    [s / 2, 0],
  ]) {
    B.box(lx, 0.12, lz, 0.25, 0.25, 0.25, pad.kind === 'final' ? 0x60a0ff : pad.kind === 'repair' ? C.greenLamp : C.lamp, { mat: 'emit', solid: false });
  }
  B.footprint(s * 0.75 + 4);
  // 支撑结构
  if (style === 'roof') {
    const h = pad.baseHeight ?? Math.max(4, y - slabT - ground);
    const bw = s + 2;
    B.box(0, -slabT - h / 2, 0, bw, h, bw, 0xb8b2a6, { tag: structTag, jitter: 0.04 });
    for (let k = 1; k < Math.floor(h / 3.2); k++) {
      B.box(0, -slabT - k * 3.2, bw / 2 + 0.02, bw - 1.2, 1.2, 0.06, C.glass, { mat: 'glass', solid: false });
      B.box(0, -slabT - k * 3.2, -bw / 2 - 0.02, bw - 1.2, 1.2, 0.06, C.glass, { mat: 'glass', solid: false });
    }
    B.footprint(bw * 0.8 + 3);
  } else if (style === 'platform' || style === 'pier' || style === 'raised') {
    const h = y - slabT - ground + 2;
    const leg = s / 2 - 1.2;
    const legR = style === 'platform' ? 0.9 : 0.35;
    for (const [lx, lz] of [
      [-leg, -leg],
      [leg, -leg],
      [-leg, leg],
      [leg, leg],
    ]) {
      B.cyl(lx, -slabT - h / 2, lz, legR, legR, h, style === 'platform' ? 0xc8a020 : C.darkWood, 10, { tag: structTag, mat: style === 'platform' ? 'metal' : 'std' });
    }
    if (style !== 'pier') {
      // 斜撑
      for (let k = 0; k < 3; k++) {
        const yy = -slabT - h * (0.25 + k * 0.25);
        B.beam([-leg, yy, -leg], [leg, yy - 2, -leg], 0.25, C.darkSteel, { solid: false });
        B.beam([-leg, yy, leg], [leg, yy - 2, leg], 0.25, C.darkSteel, { solid: false });
      }
    }
    // 栏杆
    for (const sgn of [-1, 1]) {
      B.box(0, 0.5, sgn * (s / 2 + 0.3), s, 0.08, 0.08, C.yellow, { mat: 'metal', solid: false });
      B.box(sgn * (s / 2 + 0.3), 0.5, 0, 0.08, 0.08, s, C.yellow, { mat: 'metal', solid: false });
    }
  } else if (style === 'ledge') {
    const h = Math.max(1, y - slabT - ground);
    B.box(0, -slabT - h / 2, 0, s - 1, h, s - 1, 0x857a6c, { tag: structTag, mat: 'rough' });
  } else if (style === 'ground') {
    const h = Math.max(0, y - slabT - ground + 1.5);
    if (h > 0.3) B.box(0, -slabT - h / 2, 0, s - 0.2, h, s - 0.2, C.darkConcrete, { tag: structTag, mat: 'rough' });
  }
  // 风向袋（显示该处真实风场）
  const wsx = s / 2 + 3;
  const wsz = -s / 2 - 3;
  const wsGround = ctx.ground(B.w(wsx, 0, wsz)[0], B.w(wsx, 0, wsz)[2]);
  const onDeck = style === 'platform' || style === 'pier' || style === 'roof' || style === 'raised';
  const baseY = onDeck ? 0 : wsGround - y;
  const pole = 6;
  B.cyl(wsx, baseY + pole / 2, wsz, 0.08, 0.06, pole, C.white, 6, { mat: 'metal', solid: false });
  B.anchor('windsock', wsx, baseY + pole, wsz);
}

export const commonProps: Record<string, PropFn> = {
  windsock(B) {
    B.cyl(0, 3, 0, 0.08, 0.06, 6, C.white, 6, { mat: 'metal', solid: false });
    B.anchor('windsock', 0, 6, 0);
  },
  hangar(B, d) {
    const w = Number(d.p?.w ?? 24);
    const l = Number(d.p?.l ?? 30);
    const h = Number(d.p?.h ?? 9);
    const col = Number(d.p?.color ?? 0x8f969c);
    B.beginModel(String(d.p?.model ?? 'hangar_a'), 0, 0, 0, 0, w / 24, h / 9, l / 30);
    B.box(0, h / 2, 0, w, h, l, col, { mat: 'metal' });
    B.cyl(0, h, 0, w / 2, w / 2, l, col, 12, { solid: false, mat: 'metal' });
    B.box(0, h * 0.42, -l / 2 - 0.05, w * 0.8, h * 0.84, 0.1, 0x55595e, { mat: 'metal', solid: false });
    B.endModel();
    B.colliderBox(0, h + w * 0.18, 0, w * 0.4, w * 0.18, l / 2);
    B.footprint(Math.hypot(w, l) / 2 + 2);
  },
  shed(B, d) {
    const w = Number(d.p?.w ?? 6);
    const l = Number(d.p?.l ?? 8);
    const h = Number(d.p?.h ?? 3);
    const col = Number(d.p?.color ?? 0xb0a890);
    B.box(0, h / 2, 0, w, h, l, col);
    B.gable(0, h, 0, l, w, 1.6, 0.4, Number(d.p?.roof ?? 0x6a4a3a), {}, Math.PI / 2);
    B.footprint(Math.hypot(w, l) / 2 + 1);
  },
  container(B, d) {
    const col = Number(d.p?.color ?? 0x2f62b0);
    B.box(0, 1.3, 0, 2.44, 2.6, 6.06, col, { mat: 'metal', jitter: 0.15 });
    B.footprint(3.4);
  },
  containerStack(B, d, rng) {
    const n = Number(d.p?.n ?? 6);
    const cols = [0x2f62b0, 0xb8322a, 0x3c8a4a, 0xd08a20, 0x777777, 0x8a3a8a, 0xc0c0b0];
    for (let i = 0; i < n; i++) {
      const row = i % 4;
      const lvl = Math.floor(i / 4);
      const x = (row - 1.5) * 2.6;
      B.beginModel(`container_${rng.int(0, 3)}`, x, lvl * 2.6, 0);
      B.box(x, 1.3 + lvl * 2.6, 0, 2.44, 2.6, 6.06, rng.pick(cols), { mat: 'metal', jitter: 0.1 });
      B.endModel();
    }
    B.footprint(7);
  },
  tank(B, d) {
    const r = Number(d.p?.r ?? 5);
    const h = Number(d.p?.h ?? 8);
    B.beginModel('tank_a', 0, 0, 0, 0, r / 5, h / 8, r / 5);
    B.cyl(0, h / 2, 0, r, r, h, Number(d.p?.color ?? 0xd8d8d0), 18, { mat: 'metal' });
    B.cyl(0, h + 0.6, 0, r, r * 0.3, 1.2, 0xb0b0a8, 18, { mat: 'metal', solid: false });
    B.endModel();
    B.footprint(r + 2);
  },
  antenna(B, d) {
    const h = Number(d.p?.h ?? 25);
    const legs: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [lx, lz] of legs) B.beam([lx * 1.4, 0, lz * 1.4], [lx * 0.2, h, lz * 0.2], 0.18, 0xc84030, { solid: false });
    for (let k = 1; k < 6; k++) {
      const y = (h * k) / 6;
      const r = 1.4 - (1.2 * k) / 6;
      B.box(0, y, 0, r * 2, 0.12, r * 2, 0xe0e0e0, { mat: 'metal', solid: false });
    }
    B.cyl(0, h / 2, 0, 1.0, 0.3, h, 0xc84030, 4, { solid: true, mat: 'metal' });
    B.box(0, h + 0.3, 0, 0.4, 0.4, 0.4, C.redLamp, { mat: 'emit', solid: false });
    B.anchor('blink', 0, h + 0.5, 0, 0, { color: 'red', period: 1.6 });
    B.footprint(3);
  },
  crate(B) {
    B.box(0, 0.6, 0, 1.2, 1.2, 1.2, 0x9a7444, { jitter: 0.2 });
  },
  crates(B, d, rng) {
    const n = Number(d.p?.n ?? 5);
    for (let i = 0; i < n; i++) {
      const x = rng.range(-2.5, 2.5);
      const z = rng.range(-2.5, 2.5);
      const sz = rng.range(0.8, 1.4);
      B.box(x, sz / 2 + (i > 3 ? 1.2 : 0), z, sz, sz, sz, rng.pick([0x9a7444, 0x6f7a3a, 0x8a8a7a]), { jitter: 0.15, solid: i < 4 }, rng.range(0, 1.5));
    }
    B.footprint(4);
  },
  /** 土路 / 碎石路：p.pts = "x,z;x,z;…"（世界坐标），p.w = 半宽，p.s = 浓度 */
  trail(_B, d, _rng, ctx) {
    const pts = String(d.p?.pts ?? '')
      .split(';')
      .filter(Boolean)
      .map((s) => s.split(',').map(Number) as [number, number]);
    if (pts.length < 2) return;
    const w = Number(d.p?.w ?? 2);
    ctx.paintPath?.(1, pts, w, w * 0.8 + 1, Number(d.p?.s ?? 0.85));
    ctx.paintPath?.(2, pts, w + 2, 2, 1);
  },
  /** 立柱横杆栅栏：p.pts 同上，p.h = 高度 */
  fenceLine(B, d, _rng, ctx) {
    const pts = String(d.p?.pts ?? '')
      .split(';')
      .filter(Boolean)
      .map((s) => s.split(',').map(Number) as [number, number]);
    if (pts.length >= 2) railFence(B, ctx, pts, Number(d.p?.h ?? 1.2), Number(d.p?.spacing ?? 2.8), Number(d.p?.color ?? 0x4a3a2a));
  },
  /** 圆形畜栏（牧场）：半径 p.r，朝 rotY 方向留门 */
  corral(B, d, _rng, ctx) {
    const [cx, , cz] = B.origin;
    const r = Number(d.p?.r ?? 9);
    const rot = B.rotation;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 20; k++) {
      const a = rot + 0.35 + (k / 20) * (Math.PI * 2 - 0.7);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    railFence(B, ctx, pts, 1.5, 2.6, Number(d.p?.color ?? 0x4a3a2a));
    ctx.paintCircle?.(1, cx, cz, r, 2, 0.75);
    ctx.paintCircle?.(2, cx, cz, r + 3, 2, 1);
  },
  /** 踩实的院子：半径 p.r，浓度 p.s */
  yard(_B, d, _rng, ctx) {
    const [x, , z] = d.pos;
    ctx.paintCircle?.(1, x, z, Number(d.p?.r ?? 10), Number(d.p?.f ?? 4), Number(d.p?.s ?? 0.6));
    ctx.paintCircle?.(2, x, z, Number(d.p?.r ?? 10) + 4, 3, 1);
  },
  flagpole(B, d) {
    const h = Number(d.p?.h ?? 9);
    B.cyl(0, h / 2, 0, 0.1, 0.07, h, C.white, 6, { mat: 'metal', solid: false });
    B.anchor('flag', 0, h - 0.2, 0, 0, { color: String(d.p?.color ?? 'jp') });
  },
  lamp(B) {
    B.cyl(0, 3, 0, 0.1, 0.08, 6, C.darkSteel, 6, { mat: 'metal', solid: false });
    B.box(0, 6.1, 0.3, 0.3, 0.2, 0.7, C.lamp, { mat: 'emit', solid: false });
  },
  rock(B, d, rng) {
    const r = Number(d.p?.r ?? 4);
    B.sphere(0, r * 0.35, 0, r, Number(d.p?.color ?? 0x7a756c), { mat: 'rock', sy: rng.range(0.55, 0.85), noise: 0.35, seg: 9, tag: { kind: 'rock' } });
    B.footprint(r + 1);
  },
  boulders(B, d, rng, ctx) {
    const n = Number(d.p?.n ?? 6);
    const spread = Number(d.p?.spread ?? 12);
    const col = Number(d.p?.color ?? 0x7a756c);
    for (let i = 0; i < n; i++) {
      const r = rng.range(1.2, Number(d.p?.r ?? 3.5));
      const lx = rng.range(-spread, spread);
      const lz = rng.range(-spread, spread);
      // 每块石头放在自己所在位置的地面上（地形起伏时不会悬空或埋没）
      const [wx, , wz] = B.w(lx, 0, lz);
      const gy = (ctx.terrain.heightAt(wx, wz) - B.origin[1]) / B.scale;
      B.sphere(lx, gy + r * 0.3, lz, r, col, { mat: 'rock', sy: rng.range(0.5, 0.8), noise: 0.4, seg: 8, tag: { kind: 'rock' } });
    }
    B.footprint(spread + 3);
  },
  fuel(B) {
    B.cyl(0, 1.2, 0, 1.1, 1.1, 2.6, 0xd0c040, 12, { mat: 'metal' });
    B.box(1.8, 0.8, 0, 1.0, 1.6, 0.8, 0xc03020, { mat: 'metal' });
    B.footprint(3);
  },
  beacon(B, d) {
    // 导航信标：桁架塔 + 闪光灯（雾中可见）
    const h = Number(d.p?.h ?? 14);
    const color = String(d.p?.color ?? 'white');
    B.cyl(0, 1, 0, 2.2, 2.2, 2, 0x8a8a84, 10, { mat: 'rough' });
    for (const [lx, lz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as Array<[number, number]>) {
      B.beam([lx * 1.4, 2, lz * 1.4], [lx * 0.4, h, lz * 0.4], 0.2, color === 'red' ? 0xd03a2a : color === 'green' ? 0x30a050 : 0xe8e8e8, { solid: false });
    }
    B.cyl(0, (h + 2) / 2, 0, 1.4, 0.5, h - 2, 0x888888, 4, { solid: true, mat: 'metal' });
    B.box(0, h + 0.6, 0, 1.0, 1.2, 1.0, color === 'red' ? 0xff4030 : color === 'green' ? 0x40ff70 : 0xfff6d0, { mat: 'emit', solid: false });
    B.anchor('beacon', 0, h + 0.8, 0, 0, { color, period: Number(d.p?.period ?? 2) });
    B.footprint(4);
  },
};
