// 航线净空校验：沿每条航线采样，检查与地形、建筑、树冠之间的垂直/横向净空。
// 用于单元测试与地图可视化调试工具，保证导航路径不会穿过山体或障碍物。

import type { V3 } from '../maps/types';
import { routePolylines } from './nav';
import type { WorldData } from '../world/worldgen';
import { TREE_SPECS, TREE_TYPES, forTreesNear } from '../world/vegetation';

export interface ClearanceIssue {
  leg: number;
  path: string;
  x: number;
  z: number;
  y: number;
  obstacle: number;
  need: number;
}

/** 某点附近（半径 r）最高的障碍物顶面：地形、水面、建筑碰撞体、树冠。 */
export function obstacleTop(world: WorldData, x: number, z: number, r: number): number {
  let top = world.terrain.maxInRadius(x, z, r, 10);
  if (world.map.waterLevel !== null) top = Math.max(top, world.map.waterLevel);
  for (const c of world.colliders) {
    let cx: number, cz: number, rad: number, ctop: number;
    if (c.kind === 'box' || c.kind === 'boxq') {
      cx = c.c[0];
      cz = c.c[2];
      rad = Math.hypot(c.h[0], c.h[2]);
      ctop = c.c[1] + c.h[1] + (c.kind === 'boxq' ? Math.max(c.h[0], c.h[2]) : 0);
    } else if (c.kind === 'ball') {
      cx = c.c[0];
      cz = c.c[2];
      rad = c.r;
      ctop = c.c[1] + c.r;
    } else {
      cx = c.c[0];
      cz = c.c[2];
      rad = c.r;
      ctop = c.c[1] + c.hh + (c.kind === 'capsule' ? c.r : 0);
    }
    if (Math.hypot(cx - x, cz - z) < rad + r) top = Math.max(top, ctop);
  }
  forTreesNear(world.trees, x, z, r + 14, (i) => {
    const spec = TREE_SPECS[TREE_TYPES[world.trees.type[i]]];
    if (!spec.collide) return;
    const s = world.trees.s[i];
    if (Math.hypot(world.trees.x[i] - x, world.trees.z[i] - z) > r + spec.crownR * s) return;
    top = Math.max(top, world.trees.y[i] + (spec.crownY + spec.crownRy) * s);
  });
  return top;
}

export function checkRoutes(world: WorldData, spawn: V3, lateral = 14): ClearanceIssue[] {
  const issues: ClearanceIssue[] = [];
  const lines = routePolylines(world.map, spawn);
  for (const line of lines) {
    const pts = line.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
      const n = Math.max(1, Math.ceil(len / 10));
      // 首段从停机坪起飞、末段向任务点进近：端点附近允许较低净空（起降过程）
      const firstSeg = i === 1;
      const lastSeg = i === pts.length - 1;
      const baseNeed = Math.min(a.clearance || 25, b.clearance || 25);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = a.pos[0] + (b.pos[0] - a.pos[0]) * t;
        const z = a.pos[2] + (b.pos[2] - a.pos[2]) * t;
        const y = a.pos[1] + (b.pos[1] - a.pos[1]) * t;
        let need = baseNeed;
        const dA = t * len;
        const dB = (1 - t) * len;
        // 起飞段：先垂直离地，前 40 m 视为起飞区
        if (firstSeg && dA < 40) continue;
        if (firstSeg && dA < 260) need = Math.min(need, 2 + (dA - 40) * 0.1);
        if (lastSeg && dB < 260) need = Math.min(need, 6 + dB * 0.08);
        const top = obstacleTop(world, x, z, lateral);
        if (y - top < need) issues.push({ leg: line.leg, path: line.path.id, x, z, y, obstacle: top, need });
      }
    }
  }
  return issues;
}
