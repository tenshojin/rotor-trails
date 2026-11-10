// 三维航线导航：按任务分段（leg），每段可有多条可选路线（分岔），沿人工设计且经过净空校验的航点前进。
// 支持切弯推进、偏航检测与安全回归建议（先爬升到安全高度）、提前转弯预告（高速时更早出现）。

import { DEG, clamp, headingDelta, headingOf, segDist2D } from '../core/math';
import type { MapDef, RouteNodeDef, RoutePathDef, V3 } from '../maps/types';
import type { Heightfield } from './terrain';
import { tr } from '../i18n';

export interface ForkOption {
  label: string;
  detail: string;
  tag: RoutePathDef['tag'];
  distance: number;
  bearing: number;
  target: V3;
  preferred: boolean;
}

export interface TurnPreview {
  distance: number;
  /** 转弯角度（度，正 = 右转） */
  angle: number;
  speed: number | null;
}

export type NavMode = 'route' | 'fork' | 'approach' | 'recover' | 'optional' | 'complete';

export interface NavInfo {
  mode: NavMode;
  target: V3;
  distance: number;
  /** 目标方位（度，0 = 北） */
  bearing: number;
  targetAlt: number;
  speed: number | null;
  label: string;
  pathLabel: string;
  turn: TurnPreview | null;
  forks: ForkOption[] | null;
  /** 即将经过的航点（3D 标记用），第一个是当前目标 */
  preview: Array<{ pos: V3; radius: number }>;
  offRoute: boolean;
  recoverAlt: number | null;
  message: string | null;
}

export interface NavSnapshot {
  leg: number;
  path: number | null;
  node: number;
  preferred: number;
  legStart: V3;
  focus: number;
}

interface PathRT {
  def: RoutePathDef;
  nodes: RouteNodeDef[];
  exclusive: RouteNodeDef[];
  sequence: Array<{ pos: V3; radius: number; node: RouteNodeDef | null }>;
}

const NO_PATHS: PathRT[] = [];

export class Navigator {
  readonly map: MapDef;
  private terrain: Heightfield;
  private nodeMap = new Map<string, RouteNodeDef>();
  private pathsByLeg: PathRT[][];
  private prefixes: number[];
  leg = 0;
  path: number | null = null;
  node = 0;
  preferred = 0;
  legStart: V3 = [0, 0, 0];
  /** 导航焦点：0 = 主线，1..n = 第 n 个可选任务 */
  focus = 0;
  /** 本次更新经过的检查点航点 id */
  passedCheckpoint: RouteNodeDef | null = null;
  info: NavInfo;

  constructor(map: MapDef, terrain: Heightfield) {
    this.map = map;
    this.terrain = terrain;
    for (const n of map.nodes) this.nodeMap.set(n.id, n);
    // 世界生成结束后航线节点固定；每物理步只更新分段起点和当前任务目标。
    this.pathsByLeg = map.legs.map((leg) => leg.paths.map((def): PathRT => {
      const nodes = def.nodes.map((id) => this.node$(id));
      return {
        def, nodes, exclusive: [],
        sequence: [
          { pos: [0, 0, 0], radius: 0, node: null },
          ...nodes.map((node) => ({ pos: node.pos, radius: node.radius, node })),
          { pos: [0, 0, 0], radius: 60, node: null },
        ],
      };
    }));
    this.prefixes = this.pathsByLeg.map((paths) => {
      for (const p of paths) p.exclusive = p.nodes.filter((n) => !paths.some((q) => q !== p && q.nodes.includes(n)));
      let prefix = 0;
      while (paths.length && prefix < paths[0].nodes.length && paths.every((q) => q.nodes[prefix] === paths[0].nodes[prefix])) prefix++;
      return prefix;
    });
    this.info = {
      mode: 'route',
      target: [0, 0, 0],
      distance: 0,
      bearing: 0,
      targetAlt: 0,
      speed: null,
      label: '',
      pathLabel: '',
      turn: null,
      forks: null,
      preview: [],
      offRoute: false,
      recoverAlt: null,
      message: null,
    };
  }

  node$(id: string): RouteNodeDef {
    const n = this.nodeMap.get(id);
    if (!n) throw new Error(`航点不存在：${id}`);
    return n;
  }

  private paths(): PathRT[] {
    return this.pathsByLeg[this.leg] ?? NO_PATHS;
  }

  setLeg(index: number, start: V3): void {
    this.leg = index;
    this.legStart = [...start];
    const leg = this.map.legs[index];
    this.path = leg && leg.paths.length === 1 ? 0 : null;
    this.node = 0;
    this.preferred = 0;
  }

  /** N 键：在分岔处切换推荐路线；其他时候切换导航焦点（主线 / 可选任务）。 */
  cycle(optionalCount: number): string {
    const leg = this.map.legs[this.leg];
    if (this.path === null && leg && leg.paths.length > 1 && this.focus === 0) {
      this.preferred = (this.preferred + 1) % leg.paths.length;
      return tr`推荐路线：${leg.paths[this.preferred].label}`;
    }
    this.focus = optionalCount > 0 ? (this.focus + 1) % (optionalCount + 1) : 0;
    return this.focus === 0 ? tr('导航：主线任务') : tr`导航：可选任务 ${this.focus}`;
  }

  /** 点了某张路线卡片（触屏）：把这条设成推荐路线。不在分岔处、或者在导航可选任务时不管 */
  prefer(index: number): string | null {
    const leg = this.map.legs[this.leg];
    if (this.path !== null || !leg || this.focus !== 0 || index < 0 || index >= leg.paths.length || index === this.preferred) return null;
    this.preferred = index;
    return tr`推荐路线：${leg.paths[index].label}`;
  }

  snapshot(): NavSnapshot {
    return { leg: this.leg, path: this.path, node: this.node, preferred: this.preferred, legStart: [...this.legStart], focus: this.focus };
  }

  restore(s: NavSnapshot): void {
    this.leg = s.leg;
    this.path = s.path;
    this.node = s.node;
    this.preferred = s.preferred;
    this.legStart = [...s.legStart];
    this.focus = s.focus;
  }

  /** 当前路线的点序列：分段起点 + 航点 + 任务进近点。 */
  private seq(p: PathRT, goal: V3): Array<{ pos: V3; radius: number; node: RouteNodeDef | null }> {
    p.sequence[0].pos = this.legStart;
    p.sequence[p.sequence.length - 1].pos = goal;
    return p.sequence;
  }

  /**
   * goal：当前主线任务的进近点；optionalGoal：焦点可选任务的目标点（若有）。
   * approachDist：进入任务进近模式的距离。
   */
  update(pos: { x: number; y: number; z: number }, speed: number, goal: V3 | null, goalLabel: string, optionalGoal: { pos: V3; label: string } | null): NavInfo {
    const info = this.info;
    this.passedCheckpoint = null;
    info.forks = null;
    info.turn = null;
    info.offRoute = false;
    info.recoverAlt = null;
    info.message = null;
    info.speed = null;

    if (this.focus > 0 && optionalGoal) {
      this.direct(pos, optionalGoal.pos, optionalGoal.label, 'optional');
      info.pathLabel = tr('可选任务');
      return info;
    }
    if (!goal) {
      info.mode = 'complete';
      info.preview = [];
      info.label = tr('任务完成');
      info.pathLabel = '';
      info.distance = 0;
      return info;
    }
    const paths = this.paths();
    if (paths.length === 0) {
      this.direct(pos, goal, goalLabel, 'route');
      return info;
    }

    // ---------- 分岔：等待玩家选择 ----------
    if (this.path === null) {
      // 各路线共用的前缀航点（例如先垂直爬升离开营地）：依次推进，之后才是真正的分岔
      const prefix = this.prefixes[this.leg];
      while (this.node < prefix) {
        const nd = paths[0].nodes[this.node];
        const dyN = Math.abs(pos.y - nd.pos[1]);
        if (Math.hypot(pos.x - nd.pos[0], pos.z - nd.pos[2]) < nd.radius && dyN < Math.max(45, nd.radius * 1.5)) {
          if (nd.checkpoint) this.passedCheckpoint = nd;
          this.node++;
        } else break;
      }
      if (this.node < prefix) {
        const nd = paths[0].nodes[this.node];
        this.aimAt(pos, nd.pos, nd.label ?? goalLabel);
        info.mode = 'route';
        info.pathLabel = tr('共用航段');
        info.speed = nd.speed ?? null;
        info.preview = [{ pos: nd.pos, radius: nd.radius }];
        return info;
      }
      const fromStart = Math.hypot(pos.x - this.legStart[0], pos.z - this.legStart[2]);
      const dists = paths.map((p) => this.pathDistance(p, goal, pos));
      // 靠近某条路线独有的航点，或明显更接近某条路线时自动确定选择
      let chosen: number | null = null;
      paths.forEach((p, i) => {
        for (const n of p.exclusive) {
          // 三维距离：正上方很高处的爬升航点不算“已选择”
          if (Math.hypot(pos.x - n.pos[0], (pos.y - n.pos[1]) * 1.5, pos.z - n.pos[2]) < n.radius * 1.6) chosen = i;
        }
      });
      const startRef = prefix > 0 ? paths[0].nodes[prefix - 1].pos : this.legStart;
      const fromRef = Math.hypot(pos.x - startRef[0], pos.z - startRef[2]);
      if (chosen === null && Math.min(fromStart, fromRef + 200) > 260) {
        const order = dists.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]);
        if (order[0][0] < 140 && (order.length < 2 || order[1][0] > order[0][0] * 1.8 + 40)) chosen = order[0][1];
      }
      if (chosen !== null) {
        this.path = chosen;
        this.node = prefix;
      } else {
        const pref = paths[this.preferred] ?? paths[0];
        const first = pref.nodes[prefix]?.pos ?? goal;
        this.aimAt(pos, first, pref.nodes[prefix]?.label ?? goalLabel);
        info.mode = 'fork';
        info.pathLabel = tr('路线选择');
        info.speed = pref.nodes[prefix]?.speed ?? null;
        info.forks = paths.map((p, i) => {
          const t = p.nodes[prefix]?.pos ?? goal;
          return {
            label: p.def.label,
            detail: p.def.detail,
            tag: p.def.tag,
            distance: Math.hypot(pos.x - t[0], pos.y - t[1], pos.z - t[2]),
            bearing: headingOf(t[0] - pos.x, t[2] - pos.z),
            target: t,
            preferred: i === this.preferred,
          };
        });
        info.preview = paths.map((p) => ({ pos: p.nodes[prefix]?.pos ?? goal, radius: p.nodes[prefix]?.radius ?? 60 }));
        return info;
      }
    }

    // ---------- 沿选定路线推进 ----------
    const p = paths[this.path!];
    const seq = this.seq(p, goal);
    let idx = this.node + 1; // seq 中的目标下标
    for (let guard = 0; guard < 8 && idx < seq.length - 1; guard++) {
      const prev = seq[idx - 1].pos;
      const cur = seq[idx];
      const next = seq[idx + 1].pos;
      const dCur = Math.hypot(pos.x - cur.pos[0], pos.z - cur.pos[2]);
      const segNext = segDist2D(pos.x, pos.z, cur.pos[0], cur.pos[2], next[0], next[2]);
      const segCur = segDist2D(pos.x, pos.z, prev[0], prev[2], cur.pos[0], cur.pos[2]);
      const dy = Math.abs(pos.y - cur.pos[1]);
      const reached = dCur < cur.radius && dy < Math.max(45, cur.radius * 1.5);
      // 切弯推进只在高度接近时允许（垂直爬升/下降航点必须真正到达）
      const cut = segNext.t > 0.05 && segNext.d < cur.radius * 2 + 40 && segNext.d < segCur.d && dy < Math.max(40, cur.radius);
      if (reached || cut) {
        if (cur.node?.checkpoint) this.passedCheckpoint = cur.node;
        this.node++;
        idx++;
      } else break;
    }
    const target = seq[idx];
    const prev = seq[idx - 1].pos;
    const isGoal = idx === seq.length - 1;
    const label = isGoal ? goalLabel : (target.node?.label ?? tr('航点'));
    this.aimAt(pos, target.pos, label);
    info.pathLabel = p.def.tag === 'main' ? tr('主航线') : p.def.label;
    info.mode = isGoal && info.distance < 320 ? 'approach' : 'route';
    info.speed = target.node?.speed ?? null;

    // 目标高度：沿当前航段插值；垂直航段（或已在目标正上/下方）直接取目标点高度
    const seg = segDist2D(pos.x, pos.z, prev[0], prev[2], target.pos[0], target.pos[2]);
    const segLen = Math.hypot(target.pos[0] - prev[0], target.pos[2] - prev[2]);
    info.targetAlt = segLen < 30 || Math.hypot(pos.x - target.pos[0], pos.z - target.pos[2]) < target.radius ? target.pos[1] : prev[1] + (target.pos[1] - prev[1]) * seg.t;

    // 偏航检测：离开航段太远 → 给出安全回归建议（先爬升，不强迫掉头或穿越地形）
    const offDist = Math.max(160, target.radius * 4);
    if (seg.d > offDist && !isGoal) {
      info.offRoute = true;
      info.mode = 'recover';
      const safe = this.terrain.maxAlongSegment(pos.x, pos.z, target.pos[0], target.pos[2], 45, 16) + 55;
      info.recoverAlt = Math.max(safe, target.pos[1]);
      info.message =
        info.recoverAlt > pos.y + 15
          ? tr`已偏离航线：先爬升至 ${Math.round(info.recoverAlt)} m 以上，再飞向「${label}」`
          : tr`已偏离航线：转向「${label}」重新加入航线`;
    }

    // 转弯预告：沿路线向前查找第一个明显转弯；高速时更早提示
    let acc = info.distance;
    for (let k = idx; k < Math.min(seq.length - 1, idx + 3); k++) {
      const a = seq[k - 1].pos;
      const b = seq[k].pos;
      const c = seq[k + 1].pos;
      const h1 = headingOf(b[0] - a[0], b[2] - a[2]);
      const h2 = headingOf(c[0] - b[0], c[2] - b[2]);
      const ang = headingDelta(h1, h2);
      const lead = Math.max(350, speed * 14);
      if (Math.abs(ang) > 25 && acc < lead) {
        info.turn = { distance: acc, angle: ang, speed: seq[k].node?.speed ?? null };
        break;
      }
      acc += Math.hypot(c[0] - b[0], c[2] - b[2]);
      if (acc > lead) break;
    }
    info.preview = seq.slice(idx, idx + 4).map((s) => ({ pos: s.pos, radius: s.radius || 40 }));
    return info;
  }

  private aimAt(pos: { x: number; y: number; z: number }, t: V3, label: string): void {
    const info = this.info;
    info.target = t;
    info.distance = Math.hypot(pos.x - t[0], pos.y - t[1], pos.z - t[2]);
    info.bearing = headingOf(t[0] - pos.x, t[2] - pos.z);
    info.targetAlt = t[1];
    info.label = label;
  }

  /** 直飞引导（可选任务）：给出沿直线的安全高度。 */
  private direct(pos: { x: number; y: number; z: number }, t: V3, label: string, mode: NavMode): void {
    const info = this.info;
    this.aimAt(pos, t, label);
    info.mode = mode;
    const horiz = Math.hypot(pos.x - t[0], pos.z - t[2]);
    if (horiz > 400) {
      const safe = this.terrain.maxAlongSegment(pos.x, pos.z, t[0], t[2], 45, 16) + 55;
      info.targetAlt = Math.max(safe, t[1]);
      if (safe > pos.y + 15) info.message = tr`直飞前建议先爬升至 ${Math.round(safe)} m 以上`;
    }
    info.preview = [{ pos: t, radius: 50 }];
  }

  private pathDistance(p: PathRT, goal: V3, pos: { x: number; z: number }): number {
    let best = Infinity;
    const pts = this.seq(p, goal);
    for (let i = 1; i < pts.length; i++) {
      const s = segDist2D(pos.x, pos.z, pts[i - 1].pos[0], pts[i - 1].pos[2], pts[i].pos[0], pts[i].pos[2]);
      if (s.d < best) best = s.d;
    }
    return best;
  }
}

/** 航线点序列（用于校验、小地图与调试）：返回每段每条路线的完整折线。 */
export function routePolylines(map: MapDef, spawn: V3): Array<{ leg: number; path: RoutePathDef; points: Array<{ pos: V3; clearance: number }> }> {
  const nodeMap = new Map(map.nodes.map((n) => [n.id, n] as const));
  const out: Array<{ leg: number; path: RoutePathDef; points: Array<{ pos: V3; clearance: number }> }> = [];
  let start = spawn;
  map.legs.forEach((leg, li) => {
    const obj = map.mission.main.find((o) => o.id === leg.to);
    const goal = obj ? obj.approach : start;
    for (const path of leg.paths) {
      const pts: Array<{ pos: V3; clearance: number }> = [{ pos: start, clearance: 0 }];
      for (const id of path.nodes) {
        const n = nodeMap.get(id);
        if (!n) throw new Error(`航点不存在：${id}`);
        pts.push({ pos: n.pos, clearance: n.clearance ?? 25 });
      }
      pts.push({ pos: goal, clearance: 0 });
      // 巡查任务：进近点之后依次经过各巡查点（按列出顺序）
      if (obj && obj.kind === 'inspect') for (const p of obj.route ?? obj.points.map((q) => q.pos)) pts.push({ pos: p, clearance: 18 });
      out.push({ leg: li, path, points: pts });
    }
    start = obj && obj.kind === 'inspect' ? (obj.route ?? obj.points.map((q) => q.pos)).slice(-1)[0] : goal;
  });
  return out;
}

export const NAV_CONST = { approachDist: 320, turnMinDeg: 25 * DEG, clamp };
