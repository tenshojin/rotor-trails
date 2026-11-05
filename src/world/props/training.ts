// 训练场：阿尔卑斯谷地里的小机场。跑道标线、停机坪、控制塔、俱乐部木屋、停着的轻型飞机、牧场上的干草棚。
// 模型在 tools/blender/props_training.py；模型缺失时退回下面的简单几何体。

import type { PropFn } from './common';
import { railFence } from './settle';

const PAINT = 0xbdbbb1;
const AMBER = 0xb98f2c;

/** 七段式的跑道编号：每位 3.6 × 9 m，top = 字顶朝向（+1 = 局部 +z） */
const SEGS: Record<string, string> = { '1': 'bc', '3': 'abcdg', '6': 'acdefg', '8': 'abcdefg' };

export const trainingProps: Record<string, PropFn> = {
  /** 跑道：局部原点在跑道中心，z 沿跑道 */
  runway(B, d) {
    const L = Number(d.p?.l ?? 860);
    const W = Number(d.p?.w ?? 30);
    const Y = 0.035;
    const paint = (x: number, z: number, w: number, l: number) => B.flat(x, Y, z, w, l, PAINT, 'rough');
    for (const s of [-1, 1]) paint(s * (W / 2 - 0.9), 0, 0.5, L - 6);
    for (let z = -L / 2 + 70; z < L / 2 - 70; z += 32) paint(0, z, 0.6, 18);
    const digit = (cx: number, cz: number, ch: string, top: number) => {
      const seg = (x: number, z: number, w: number, l: number) => paint(cx + x * top, cz + z * top, w, l);
      const S = SEGS[ch];
      if (S.includes('a')) seg(0, 4.2, 3.6, 0.8);
      if (S.includes('b')) seg(-1.4, 2.2, 0.8, 4.2);
      if (S.includes('c')) seg(-1.4, -2.2, 0.8, 4.2);
      if (S.includes('d')) seg(0, -4.2, 3.6, 0.8);
      if (S.includes('e')) seg(1.4, -2.2, 0.8, 4.2);
      if (S.includes('f')) seg(1.4, 2.2, 0.8, 4.2);
      if (S.includes('g')) seg(0, 0, 3.6, 0.8);
    };
    for (const e of [-1, 1]) {
      // 跑道头的琴键、瞄准点、接地带
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) paint(s * (2.4 + i * 2.5), e * (L / 2 - 16), 1.4, 22);
      for (const s of [-1, 1]) paint(s * 4.6, e * (L / 2 - 150), 2.6, 34);
      for (const k of [0, 1]) for (const s of [-1, 1]) paint(s * (3 + k * 1.8), e * (L / 2 - 86), 1.1, 16);
      // 编号：南头 36、北头 18，字顶朝跑道中间
      const [a, b] = e > 0 ? ['3', '6'] : ['1', '8'];
      const top = -e;
      digit(-3 * e, e * (L / 2 - 46), a, top);
      digit(3 * e, e * (L / 2 - 46), b, top);
    }
    B.footprint(1);
  },
  /** 停机坪上的地面标线：世界坐标（放在原点） */
  apronLines(B, d) {
    const Y = 0.035;
    const line = (x0: number, z0: number, x1: number, z1: number, w = 0.3) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      B.flat((x0 + x1) / 2, Y, (z0 + z1) / 2, w, len, AMBER, 'rough', Math.atan2(x1 - x0, z1 - z0));
    };
    const rw = Number(d.p?.rw ?? -56);
    // 滑行线：从跑道沿停机坪边上走，分岔到飞机位
    line(rw, 236, 40, 236);
    line(rw, 62, -30, 62);
    line(-30, 62, -30, 236);
    for (const x of [-14, 16, 46]) line(x, 236, x, 216);
    // 等待线（跑道边的双实线加虚线）
    for (const z of [62, 236]) {
      line(rw + 4, z - 9, rw + 4, z + 9, 0.3);
      line(rw + 4.6, z - 9, rw + 4.6, z + 9, 0.3);
      for (let k = -9; k < 9; k += 1.8) line(rw + 5.6, z + k, rw + 5.6, z + k + 0.9, 0.3);
    }
    // 飞机位的框
    for (const x of [-14, 16, 46]) {
      line(x - 11, 192, x - 11, 212, 0.16);
      line(x + 11, 192, x + 11, 212, 0.16);
    }
    B.footprint(1);
  },
  controlTower(B) {
    B.beginModel('tower_a', 0, 0, 0, 0);
    B.box(0, 2, 0, 10, 4, 7, 0xd8d2c4);
    B.box(0, 8.6, 0, 4.2, 9.2, 4.2, 0xd8d2c4);
    B.cyl(0, 15.5, 0, 3.6, 3.6, 2.4, 0x1c252d, 8);
    B.endModel();
    B.colliderBox(0, 2.1, 0, 5.2, 2.1, 3.7);
    B.colliderBox(0, 10, 0, 2.2, 8, 2.2);
    B.addColliderCyl(0, 15.6, 0, 1.6, 4.3);
    B.footprint(8);
  },
  clubhouse(B) {
    B.beginModel('club_a', 0, 0, 0, 0);
    B.box(0, 3, 0, 15, 6, 9.5, 0xd8d2c4);
    B.gable(0, 6, 0, 15, 9.5, 2.8, 1.2, 0x34363a);
    B.endModel();
    B.colliderBox(0, 3.9, 0, 7.8, 3.9, 5.2);
    B.footprint(11);
  },
  hayBarn(B) {
    B.beginModel('barn_a', 0, 0, 0, 0);
    B.box(0, 1.7, 0, 9, 3.4, 6.5, 0x4a4238);
    B.gable(0, 3.4, 0, 9, 6.5, 2.3, 0.7, 0x34363a);
    B.endModel();
    B.colliderBox(0, 2.6, 0, 4.7, 2.6, 3.4);
    B.footprint(6);
  },
  parkedPlane(B) {
    B.beginModel('plane_a', 0, 0, 0, 0);
    B.box(0, 1.4, 0, 1.1, 1.5, 8, 0xe9e7e0);
    B.box(0, 2.45, 0, 11, 0.12, 1.5, 0xe9e7e0);
    B.endModel();
    B.colliderBox(0, 1.3, 0, 0.7, 1.3, 4.2);
    B.colliderBox(0, 2.45, 0, 5.6, 0.2, 0.8);
    B.footprint(6.5);
  },
  fuelTruck(B) {
    B.beginModel('truck_fuel', 0, 0, 0, 0);
    B.box(0, 1.5, 0, 2.2, 2.6, 7, 0xd8d5cc);
    B.endModel();
    B.colliderBox(0, 1.5, 0, 1.2, 1.5, 3.7);
    B.footprint(4.5);
  },
  /** 牧场围栏：p.pts = [x, z, x, z, ...] */
  pasture(B, d, _rng, ctx) {
    const flat = String(d.p?.pts ?? '').split(',').map(Number);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    if (pts.length >= 2) railFence(B, ctx, pts, 1.15, 3.2, 0x5a4a38);
  },
};
