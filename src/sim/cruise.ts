// 休闲模式的自动巡航：沿着地图的景点一个接一个慢慢飞，玩家只管看风景（或者切到电影镜头）。
// 和测试用的自动驾驶一样，只通过玩家的操纵输入飞，不直接改飞机状态。动任何一个飞行键就交回给玩家。

import { RAD, clamp, headingDelta, wrap360 } from '../core/math';
import type { MapDef, Vista } from '../maps/types';
import { obstacleTop } from './routeCheck';
import type { GameSession } from './session';

/** 巡航速度（m/s）、离地高度（m） */
const SPEED = 36;
const CLEAR = 85;
/** 离景点多近就算到了（m） */
const ARRIVE = 260;
/** 看前方多远的地形（m） */
const LOOK = [0, 80, 180, 320, 500, 720];

/** 这张图可以去的地方：地图自己的观景点，加上地标（站在旁边看它） */
export function vistasOf(map: MapDef): Vista[] {
  const list: Vista[] = [...(map.vistas ?? [])];
  for (const l of map.landmarks) {
    if (list.some((v) => v.name === l.name)) continue;
    // 从地图中心那一侧看过去，身后留得出飞的地方
    const d = Math.hypot(l.pos[0], l.pos[2]) || 1;
    const k = Math.min(1, 300 / d);
    list.push({ name: l.name, at: [l.pos[0] - l.pos[0] * k, 90, l.pos[2] - l.pos[2] * k], look: [l.pos[0], l.pos[2]] });
  }
  return list;
}

export class ScenicCruise {
  private i = 0;
  private readonly stops: Array<[number, number]>;

  constructor(private readonly s: GameSession, vistas: Vista[]) {
    const half = s.world.map.size / 2 - 180;
    const lim = (v: number) => clamp(v, -half, half);
    this.stops = vistas.map((v): [number, number] => [lim(v.look[0]), lim(v.look[1])]);
    // 从最近的一个开始，不要一上来就横穿整张地图
    let best = Infinity;
    const p = s.body.pos;
    this.stops.forEach(([x, z], i) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best && d > ARRIVE * 1.5) {
        best = d;
        this.i = i;
      }
    });
    if (s.flight.hoverOn) s.toggleHover();
  }

  /** 计算一步的操纵输入（写入 session.input） */
  update(): void {
    const s = this.s;
    const inp = s.input;
    const b = s.body;
    if (s.state !== 'running' || this.stops.length === 0) return;
    let [tx, tz] = this.stops[this.i];
    if (Math.hypot(tx - b.pos.x, tz - b.pos.z) < ARRIVE) {
      this.i = (this.i + 1) % this.stops.length;
      [tx, tz] = this.stops[this.i];
    }
    const tel = s.flight.telemetry;
    const hdg = wrap360(tel.heading * RAD);
    const err = headingDelta(hdg, Math.atan2(tx - b.pos.x, -(tz - b.pos.z)) * RAD);
    inp.turn = clamp(err / 26, -1, 1);
    // 大角度转弯时慢下来，弯才转得优雅
    let want = Math.abs(err) > 45 ? 18 : SPEED;
    const sinH = Math.sin(tel.heading);
    const cosH = Math.cos(tel.heading);
    const vF = b.vel.x * sinH - b.vel.z * cosH;
    // 高度：看机头前方（和两侧一点）要飞过的地形，留够净空
    let need = -Infinity;
    for (const d of LOOK) {
      for (const side of [-0.28, 0, 0.28]) {
        const x = b.pos.x + (sinH + cosH * side) * d;
        const z = b.pos.z + (-cosH + sinH * side) * d;
        const g = obstacleTop(s.world, x, z, 12, Infinity, undefined, false) + CLEAR;
        if (g > need) need = g;
      }
    }
    // 前面有山：慢下来，先爬上去再过，不要硬往山上撞（爬升一秒只有几米，高原上更少）
    const short = need - b.pos.y;
    if (short > 10) want *= Math.max(0, 1 - (short - 10) / 45);
    inp.pitch = clamp((want - vF) / 8, -1, 1);
    inp.lateral = 0;
    inp.vertical = clamp(short / 14 - b.vel.y * 0.08, -1, 1);
  }
}
