// 地图五：尼泊尔高山雪域（喜马拉雅风格）。冰川谷、雪峰、山脊寺院、冰川营地、强风山口、高海拔平台。
// 世界 y = 0 对应海拔 2800 m；可用功率随空气密度逐渐下降（HUD 显示动力余量与空气密度）。

import { Perlin2 } from '../core/noise';
import { smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { Vec2 } from '../sim/terrain';
import { randomBands, type RockFormDef } from '../world/rockForm';
import { PathSampler, riverLine } from './routeUtil';
import type { MapDef, RouteNodeDef, V3 } from './types';

/** 被挤压抬升过的变质岩：倾角很大，深灰、褐黄、铁锈色的岩层斜穿山体 */
const ROCK: RockFormDef = {
  y0: -200,
  y1: 5200,
  dip: [0.3, 0.16],
  waves: [
    [0.0011, -0.0008, 60, 1.3],
    [0.0006, 0.0017, 34, 0.2],
    [-0.0029, 0.0023, 12, 3.1],
  ],
  bench: 0.6,
  slope: [0.8, 1.7],
  tint: 0.62,
  talus: 3.2,
  warp: [
    [14, 170],
    [5, 55],
  ],
  bands: randomBands(611, 120, [0x4f4a46, 0x6b6056, 0x8a7b68, 0x5c5048, 0x7a6a58, 0x9a8c78, 0x46423e], [10, 64]),
};

const SEED = 6601;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 11);
const ALT0 = 2800;

/** 主冰川谷：西南（低）→ 东北（高） */
const VALLEY: Vec2[] = [
  [-2200, 1650],
  [-1650, 1350],
  [-1150, 1180],
  [-700, 820],
  [-300, 560],
  [120, 300],
  [520, -60],
  [800, -420],
];
const VP = new PathSampler(VALLEY);
const valleyFloor = (s: number) => 120 + 950 * Math.pow(s / VP.len, 1.35);

const PEAKS: Array<[number, number, number, number]> = [
  // x, z, 高度, 半径
  [-1150, 300, 2150, 900],
  [-150, -350, 2600, 1000],
  [900, 450, 2350, 850],
  [1650, -250, 2700, 900],
  [700, -1350, 2950, 950],
  [1750, -1500, 2500, 700],
  [-1500, -900, 2300, 900],
  [-700, 1900, 1700, 700],
  [300, 1500, 2000, 800],
];

/** 山体：山群包络 × 扭曲后的山脊噪声（形成刃脊、角峰与冰斗），而不是圆锥 */
function mountains(x: number, z: number): number {
  let mask = 0;
  for (const [cx, cz, ph, pr] of PEAKS) {
    const d = Math.hypot(x - cx, z - cz) / pr;
    if (d < 1.3) mask = Math.max(mask, (ph / 2900) * (1 - smoothstep(0.05, 1.25, d)));
  }
  const wx = x + 220 * n2.noise(x / 800, z / 800);
  const wz = z + 220 * n2.noise(x / 800 + 5.2, z / 800 + 3.1);
  const r = n.ridged(wx / 1050, wz / 1050, 6, 2.05, 0.5, 2.2);
  const crag = Math.pow(r, 1.25);
  const lowRidge = 260 * Math.pow(n.ridged(x / 700 + 9, z / 700 - 4, 4), 1.5);
  return 330 + 90 * n2.fbm(x / 450, z / 450, 3) + lowRidge * (1 - mask) + mask * 2950 * (0.32 + 0.68 * crag);
}

/** 远景：地图外面是一圈真正的高峰，从谷底望过去雪峰压在天边 */
function farRange(x: number, z: number): number {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const k = smoothstep(2200, 6500, r);
  const wx = x + 700 * n2.noise(x / 2600, z / 2600);
  const wz = z + 700 * n2.noise(x / 2600 + 7.1, z / 2600 - 2.3);
  const crag = Math.pow(n.ridged(wx / 5200, wz / 5200, 7, 2.05, 0.5, 2.0), 1.2);
  return mountains(x, z) * (1 - 0.7 * k) + k * (1500 + 2900 * crag);
}

/**
 * 天然地形在 (x,z) 周围 r 米内的中位高度。站点建在自然地形上（只做小范围整平），
 * 不会出现“柱子”或“深坑”。仅用于主冰川谷改造范围（谷线 900 m）以外的站点。
 */
function siteHeight(x: number, z: number, r: number): number {
  const hs = [mountains(x, z)];
  for (let a = 0; a < 12; a++) hs.push(mountains(x + r * Math.cos((a * Math.PI) / 6), z + r * Math.sin((a * Math.PI) / 6)));
  hs.sort((p, q) => p - q);
  return Math.round(hs[6]);
}

// ---------- 站点 ----------
const S_BASE = VP.arcOf(-1650, 1350);
const BASE: V3 = (() => {
  const p = VP.at(S_BASE);
  return [Math.round(p[0] + 60), Math.round(valleyFloor(S_BASE) + 4), Math.round(p[1] - 40)];
})();
/** 山脊寺院：谷地北侧山脊的一个平台 */
const MONASTERY: V3 = [-560, 650, 380];
/** 冰川营地（悬停投放）：主谷尽头的冰川平台 */
const S_GLACIER = VP.len - 40;
const GLACIER: V3 = (() => {
  const p = VP.at(S_GLACIER);
  return [Math.round(p[0]), Math.round(valleyFloor(S_GLACIER) + 2), Math.round(p[1])];
})();
/** 山口研究站：主谷尽头以北、东西两座雪峰之间的天然鞍部（约 4390 m），南侧是一条陡峭的冰川谷道 */
const COL_STATION: V3 = [1312, siteHeight(1312, -1562, 18), -1562];
const COL = COL_STATION;
/** 最终：西侧雪峰东坡上的冰斗平台（约 5140 m），东面敞开、正对山口 */
const SUMMIT: V3 = [940, siteHeight(940, -1430, 25), -1430];
/** 维修：谷地中段的直升机坪 */
const S_MID = VP.arcOf(-300, 560);
const MID: V3 = (() => {
  const p = VP.at(S_MID);
  return [Math.round(p[0] - 50), Math.round(valleyFloor(S_MID) + 3), Math.round(p[1] - 40)];
})();

// ---------- 航点 ----------
// 山谷内航点沿冰川谷中心线；离开山谷的航点使用 autoAlt（生成地形后按实际障碍自动抬高）。
const S_MONV = VP.arcOf(MONASTERY[0], MONASTERY[2]);
const valleyNodes = VP.nodes('h-v', S_BASE + 150, S_MONV, 260, (s) => valleyFloor(s) + 110, { label: '冰川谷', radius: 70, speed: 35, clearance: 25 });
const valley2 = VP.nodes('h-w', S_MONV + 260, S_GLACIER - 260, 240, (s) => valleyFloor(s) + 120, { label: '上游冰川谷', radius: 70, speed: 30, clearance: 25, autoAlt: 30 });
valley2[0].checkpoint = true;
const monUp: V3 = [MONASTERY[0] + 25, MONASTERY[1] + 110, MONASTERY[2] + 25];

const NODES: RouteNodeDef[] = [
  ...valleyNodes,
  { id: 'h-mup', pos: monUp, radius: 45, speed: 12, label: '寺院上空', autoAlt: 40 },
  { id: 'h-r1', pos: [-1450, 400, 1050], radius: 70, speed: 25, label: '山脊爬升', checkpoint: true, autoAlt: 45 },
  { id: 'h-r2', pos: [-1180, 600, 700], radius: 60, speed: 22, label: '刀脊', autoAlt: 45 },
  { id: 'h-d1', pos: [...VP.point(S_MONV + 120, valleyFloor(S_MONV + 120) + 140)], radius: 70, speed: 25, label: '下降回冰川谷', autoAlt: 35 },
  ...valley2,
  // 山口航段 A：冰川谷道（短、低，但有下坡风与阵风）
  { id: 'h-c1', pos: [1120, 1250, -780], radius: 70, speed: 28, label: '冰川谷道入口', checkpoint: true, autoAlt: 45 },
  { id: 'h-c2', pos: [1395, 1240, -1110], radius: 60, speed: 20, label: '冰川谷道', autoAlt: 40 },
  { id: 'h-c3', pos: [1350, COL_STATION[1] + 30, -1340], radius: 50, speed: 15, label: '山口谷道', autoAlt: 35 },
  // 山口航段 B：高空越脊（先在开阔的盆地上空爬到岩壁以上，沿谷道东缘高空飞到山口正上方再垂直下降）
  { id: 'h-s1', pos: [1180, 1500, -720], radius: 70, speed: 25, label: '高空越脊爬升', checkpoint: true, autoAlt: 60 },
  { id: 'h-s2', pos: [1420, 1750, -900], radius: 70, speed: 25, label: '冰川谷上空', autoAlt: 60 },
  { id: 'h-s3', pos: [1480, 1830, -1180], radius: 70, speed: 22, label: '谷道东缘上空', autoAlt: 60 },
  { id: 'h-s4', pos: [1330, 1840, -1480], radius: 50, speed: 12, label: '山口上空', autoAlt: 50 },
  // 最后一段：先在山口上空垂直爬升（两侧岩壁很近），再向南在谷道上空借东侧岩壁的上升气流盘旋爬升，
  // 然后向西北长距离爬升到冰斗出口上空，从东面进近平台（在开阔空域里爬升，而不是贴着山脊）
  { id: 'h-f1', pos: [COL_STATION[0] + 6, COL_STATION[1] + 320, COL_STATION[2] + 15], radius: 40, speed: 10, label: '垂直爬出山口', checkpoint: true },
  { id: 'h-f1b', pos: [1395, COL_STATION[1] + 560, -1310], radius: 60, speed: 14, label: '借上升气流爬升', autoAlt: 45 },
  { id: 'h-f2', pos: [1110, SUMMIT[1] + 40, -1490], radius: 60, speed: 16, label: '冰斗出口上空', autoAlt: 45 },
];

export const HIMALAYA: MapDef = {
  id: 'himalaya',
  name: '雪域山口',
  subtitle: '尼泊尔 · 喜马拉雅高山',
  region: '喜马拉雅山区（虚构）',
  description: '从冰川谷底的大本营出发，向山脊寺院和冰川营地运送物资，穿越强风山口，最终降落在海拔约 5100 m 的冰斗平台。越往高处空气越稀薄，可用动力逐渐下降。',
  difficulty: 5,
  recommendedAssist: 'standard',
  size: 4096,
  res: 1025,
  seed: SEED,
  altitudeOffset: ALT0,
  waterLevel: null,
  erosion: 220000,
  rockForm: ROCK,
  rivers: [
    {
      // 冰川融水：磨细的岩粉让河水是不透明的乳蓝色，从冰川脚下一路冲下来
      pts: riverLine(
        VP,
        30,
        VP.len - 130,
        16,
        (s) => (0.26 * Math.sin(s / 170 + 1) + 0.12 * Math.sin(s / 67 + 0.4)) * (150 + 40 * Math.sin(s / 500)),
        (s) => valleyFloor(s) - 0.8,
        (s) => 3.5 + 7.5 * (1 - s / VP.len),
        [
          [BASE[0], BASE[2], 70],
          [BASE[0] + 70, BASE[2] - 40, 40],
          [BASE[0] - 60, BASE[2] + 70, 100],
          [BASE[0] + 40, BASE[2] + 50, 26],
          [MID[0], MID[2], 60],
          [MID[0] + 60, MID[2] + 60, 80],
          [MID[0] - 30, MID[2] - 30, 36],
          [MID[0] + 25, MID[2] - 35, 18],
        ],
      ),
      depth: 1.1,
      bank: 12,
      deep: 0x6fb3b4,
      shallow: 0xa9d2cc,
      speed: 2.4,
      bar: 22,
    },
  ],
  buildTerrain(b) {
    b.fill(mountains);
    // U 形冰川谷
    b.applySpline(VALLEY, 900, (h, d, s, x, z) => {
      const floor = valleyFloor(s) + 6 * n.noise(x / 60, z / 60);
      const w = 150 + 40 * Math.sin(s / 500);
      if (d < w) return Math.min(h, floor + 25 * Math.pow(d / w, 2));
      const t = smoothstep(w, w + 750, d);
      return Math.min(h, floor + 25 + (h - floor - 25) * Math.pow(t, 0.75));
    });
    // 站点平台
    b.flatten(MONASTERY[0], MONASTERY[2], 45, MONASTERY[1], 50);
    b.flatten(GLACIER[0], GLACIER[2], 60, GLACIER[1], 60);
    b.flatten(BASE[0], BASE[2], 80, BASE[1], 60);
    // 山口与冰斗平台：建在天然高度上，只整平站点本身
    b.flatten(COL_STATION[0], COL_STATION[2], 22, COL_STATION[1], 30);
    b.flatten(SUMMIT[0], SUMMIT[2], 26, SUMMIT[1], 35);
    // 积雪：高处与缓坡
    b.paint(3, (x, z, h) => smoothstep(1050, 1250, h + 120 * n.noise(x / 200, z / 200)));
    b.paint(0, (x, z, h) => (h < 700 ? 0.5 * (0.5 + 0.5 * n2.noise(x / 80, z / 80)) * (1 - smoothstep(400, 700, h)) : 0));
  },
  farTerrain: farRange,
  farExtent: 3.4,
  spawn: { padId: 'H-base', heading: 60 },
  pads: [
    { id: 'H-base', name: '大本营停机坪', pos: [BASE[0], BASE[1] + 0.45, BASE[2]], size: 22, kind: 'start', style: 'ground' },
    { id: 'H-mon', name: '山脊寺院', pos: [MONASTERY[0], MONASTERY[1] + 0.45, MONASTERY[2]], size: 15, kind: 'delivery', style: 'ground' },
    { id: 'H-col', name: '山口研究站', pos: [COL_STATION[0], COL_STATION[1] + 0.45, COL_STATION[2]], size: 16, kind: 'delivery', style: 'ground' },
    { id: 'H-summit', name: '冰斗平台', pos: [SUMMIT[0], SUMMIT[1] + 0.45, SUMMIT[2]], size: 14, kind: 'final', style: 'ground' },
    { id: 'H-mid', name: '谷地维修坪', pos: [MID[0], MID[1] + 0.45, MID[2]], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
  ],
  props: [
    { type: 'hvillage', pos: [BASE[0] - 60, 0, BASE[2] + 70], ground: true, p: { r: 90, n: 14 } },
    { type: 'tentCamp', pos: [BASE[0] + 70, 0, BASE[2] - 40], ground: true, p: { n: 8 } },
    { type: 'chorten', pos: [BASE[0] - 10, 0, BASE[2] - 60], ground: true },
    { type: 'maniWall', pos: [BASE[0] + 40, 0, BASE[2] + 50], rotY: 0.5, ground: true },
    { type: 'flagpole', pos: [BASE[0] + 20, 0, BASE[2] - 20], ground: true, p: { color: 'np', h: 8 } },
    { type: 'monastery', pos: [MONASTERY[0] + 8, 0, MONASTERY[2] - 34], rotY: 0.2, ground: true },
    { type: 'chorten', pos: [MONASTERY[0] - 30, 0, MONASTERY[2] + 18], ground: true },
    { type: 'tentCamp', pos: [GLACIER[0] + 20, 0, GLACIER[2] + 30], ground: true, p: { n: 7 } },
    { type: 'prayerFlags', pos: [GLACIER[0] - 30, 0, GLACIER[2] - 25], ground: true, p: { x2: 30, z2: 12, h: 5 } },
    { type: 'colHut', pos: [COL_STATION[0] - 2, 0, COL_STATION[2] - 19], rotY: 0.08, ground: true },
    { type: 'prayerFlags', pos: [COL_STATION[0] - 21, 0, COL_STATION[2] + 12], ground: true, p: { x2: -2, z2: -30, h: 5 } },
    { type: 'antenna', pos: [SUMMIT[0] - 14, 0, SUMMIT[2] - 18], ground: true, p: { h: 12 } },
    { type: 'prayerFlags', pos: [SUMMIT[0] - 20, 0, SUMMIT[2] + 12], ground: true, p: { x2: 6, z2: -26, h: 4 } },
    { type: 'hvillage', pos: [MID[0] + 60, 0, MID[2] + 60], ground: true, p: { r: 70, n: 8 } },
    { type: 'hangar', pos: [MID[0] - 30, 0, MID[2] - 30], rotY: 0.8, ground: true, p: { w: 14, l: 18, h: 6 } },
    { type: 'chorten', pos: [MID[0] + 25, 0, MID[2] - 35], ground: true },
  ],
  vegetation: [
    { type: 'pine', density: 420, scale: [0.7, 1.15], maxH: 520, maxSlope: 0.45, mask: (x, z, h) => (1 - smoothstep(380, 520, h)) * (0.5 + 0.5 * n.fbm(x / 200, z / 200, 2)) },
    // 冰碛：谷底和山脚散落的大石块
    { type: 'boulder', density: 1500, scale: [0.25, 1.7], maxH: 1020, maxSlope: 0.5, mask: (x, z, _h, s) => smoothstep(0.5, 0.62, 0.5 + 0.5 * n.fbm(x / 210 - 5, z / 210, 3)) * (1 - smoothstep(0.34, 0.5, s)) },
    // 灌丛成片长：一片片深色的杜松、杜鹃灌丛，中间是草甸和碎石
    // 谷里是一片片的云杉林（沿着沟长上山坡），林子外面是成丛的灌木
    { type: 'spruce', density: 1500, scale: [0.55, 1.15], minH: 300, maxH: 950, maxSlope: 0.52, wash: 0.25, mask: (x, z) => smoothstep(0.46, 0.6, 0.5 + 0.5 * n2.fbm(x / 170, z / 170, 3)) },
    { type: 'juniper', density: 120, scale: [0.5, 0.85], minH: 300, maxH: 1050, maxSlope: 0.5, mask: (x, z) => smoothstep(0.42, 0.62, 0.5 + 0.5 * n.fbm(x / 240, z / 240, 3)) },
    { type: 'shrub', density: 2400, scale: [0.5, 1.05], maxH: 1150, maxSlope: 0.55, wash: 0.5, mask: (x, z) => 0.12 + 0.88 * smoothstep(0.4, 0.6, 0.5 + 0.5 * n.fbm(x / 130 + 3, z / 130, 3)) },
  ],
  clearings: [
    [BASE[0], BASE[2], 60],
    [MONASTERY[0], MONASTERY[2], 45],
  ],
  nodes: NODES,
  legs: [
    {
      to: 'hm-mon',
      paths: [
        { id: 'valley', label: '沿冰川谷', detail: '沿宽阔谷地缓慢爬升，再从山谷一侧爬升到寺院上空：较长，坡度缓', tag: 'safe', nodes: [...valleyNodes.map((x) => x.id), 'h-mup'] },
        { id: 'ridge', label: '刀脊直上', detail: '沿山脊直线爬升到寺院：距离短，但需要持续大坡度爬升，山脊风大', tag: 'short', nodes: ['h-r1', 'h-r2', 'h-mup'] },
      ],
    },
    { to: 'hm-glacier', paths: [{ id: 'main', label: '上游冰川谷', detail: '', tag: 'main', nodes: ['h-mup', 'h-d1', ...valley2.map((x) => x.id)] }] },
    {
      to: 'hm-col',
      paths: [
        { id: 'gully', label: '冰川谷道', detail: '沿陡峭的冰川谷道直接爬向山口：距离短、爬升少，但谷道里有顺坡而下的强风和规律阵风，两侧岩壁很近', tag: 'short', nodes: ['h-c1', 'h-c2', 'h-c3'] },
        { id: 'high', label: '高空越脊', detail: '先在开阔的盆地上空爬升到岩壁以上，沿谷道东缘高空飞到山口正上方再垂直下降：避开谷道里的强风和阵风，但要多爬升约 200 m，空气更稀薄、更费动力（低云天气可尽早爬到云上）', tag: 'safe', nodes: ['h-s1', 'h-s2', 'h-s3', 'h-s4'] },
      ],
    },
    { to: 'hm-summit', paths: [{ id: 'main', label: '冰斗平台', detail: '', tag: 'main', nodes: ['h-f1', 'h-f1b', 'h-f2'] }] },
  ],
  mission: {
    startCargo: 2,
    main: [
      { id: 'hm-mon', kind: 'land', title: '向山脊寺院运送物资', detail: '寺院建在海拔约 3450 m 的山脊平台上，停机坪只有 15 m。卸下第一箱物资。', padId: 'H-mon', dwell: 4, cargo: 'unload', approach: [MONASTERY[0], MONASTERY[1] + 35, MONASTERY[2]] },
      {
        id: 'hm-glacier',
        kind: 'hover',
        title: '向冰川营地空投物资',
        detail: '冰川营地海拔约 3900 m。在营地标记上方 6–14 m 稳定悬停 6 秒放下物资。',
        center: GLACIER,
        radius: 9,
        minH: 6,
        maxH: 14,
        duration: 6,
        maxSpeed: 1.5,
        cargo: 'drop',
        approach: [GLACIER[0], GLACIER[1] + 35, GLACIER[2]],
      },
      { id: 'hm-col', kind: 'land', title: '降落在山口研究站', detail: `研究站建在海拔约 ${Math.round((ALT0 + COL_STATION[1]) / 10) * 10} m 的山口鞍部，两侧是岩壁，谷道里常有顺坡而下的强风。接载科研人员。`, padId: 'H-col', dwell: 4, approach: [COL_STATION[0], COL_STATION[1] + 35, COL_STATION[2]] },
      {
        id: 'hm-summit',
        kind: 'land',
        title: '降落在冰斗平台',
        detail: `最终目标：海拔约 ${Math.round((ALT0 + SUMMIT[1]) / 10) * 10} m 的冰斗平台（14 m）。空气稀薄、动力余量小；平台东侧有背风下沉气流，先爬到平台高度以上再进近，提前减速、平稳下降。`,
        padId: 'H-summit',
        dwell: 3,
        approach: [SUMMIT[0], SUMMIT[1] + 32, SUMMIT[2]],
      },
    ],
    optional: [
      {
        id: 'ho-chorten',
        kind: 'hover',
        title: '绕行大本营白塔祈福',
        detail: '在大本营白塔上空 15–45 m 悬停 4 秒。',
        center: [BASE[0] - 10, BASE[1], BASE[2] - 60],
        radius: 30,
        minH: 15,
        maxH: 45,
        duration: 4,
        maxSpeed: 3,
        approach: [BASE[0] - 10, BASE[1] + 35, BASE[2] - 60],
      },
      {
        id: 'ho-icefall',
        kind: 'inspect',
        title: '侦察冰瀑',
        detail: '以低于 25 m/s 的速度飞过冰川谷上游的两个冰瀑观测点。',
        points: [
          { pos: [VP.point(S_GLACIER - 600, 0)[0], Math.round(valleyFloor(S_GLACIER - 600) + 90), VP.point(S_GLACIER - 600, 0)[2]], radius: 45, label: '冰瀑下段' },
          { pos: [VP.point(S_GLACIER - 300, 0)[0], Math.round(valleyFloor(S_GLACIER - 300) + 90), VP.point(S_GLACIER - 300, 0)[2]], radius: 45, label: '冰瀑上段' },
        ],
        maxSpeed: 25,
        approach: [VP.point(S_GLACIER - 600, 0)[0], Math.round(valleyFloor(S_GLACIER - 600) + 90), VP.point(S_GLACIER - 600, 0)[2]],
      },
    ],
  },
  pickups: [
    { id: 'hb1', kind: 'boost', pos: [-1450, 560, 1050], node: 'h-r1', note: '刀脊爬升起点' },
    { id: 'hr1', kind: 'repair', pos: valleyNodes[Math.floor(valleyNodes.length / 2)].pos, node: valleyNodes[Math.floor(valleyNodes.length / 2)].id, note: '冰川谷' },
    { id: 'hs1', kind: 'shield', pos: [1395, 1240, -1110], node: 'h-c2', note: '冰川谷道（强风捷径奖励）' },
    { id: 'hb2', kind: 'boost', pos: [1420, 1750, -900], node: 'h-s2', note: '高空越脊爬升' },
    { id: 'hb3', kind: 'boost', pos: [COL_STATION[0] + 6, COL_STATION[1] + 320, COL_STATION[2] + 15], node: 'h-f1', note: '最后爬升（山口正上方）' },
    { id: 'hr2', kind: 'repair', pos: valley2[valley2.length - 1].pos, node: valley2[valley2.length - 1].id, note: '冰川营地前' },
  ],
  windZones: [
    { id: 'h-valley', name: '冰川谷谷风', a: VP.at(S_BASE), b: VP.at(S_GLACIER), radius: 260, feather: 200, kind: 'channel', dirFrom: 230, speed: 7 },
    // 冰川谷道：冷空气顺坡下泄（下坡风），飞得比山脊高就基本避开
    { id: 'h-col', name: '山口下坡风', a: [1400, -1090], b: [1310, -1600], radius: 110, feather: 100, yMax: COL_STATION[1] + 150, kind: 'channel', dirFrom: 345, speed: 11 },
    { id: 'h-colgust', name: '谷道阵风', a: [1390, -1150], b: [1320, -1540], radius: 100, feather: 80, yMax: COL_STATION[1] + 150, kind: 'gust', gust: { amp: 6, period: 11, dirFrom: 335 } },
    { id: 'h-ridge', name: '刀脊横风', a: [-1450, 1050], b: [-1000, 560], radius: 160, feather: 120, kind: 'gust', gust: { amp: 6, period: 10, phase: 4, dirFrom: 200 } },
    { id: 'h-lee', name: '平台背风下沉气流', a: [SUMMIT[0] + 100, SUMMIT[2] + 60], b: [SUMMIT[0] + 110, SUMMIT[2] - 70], radius: 55, feather: 60, yMin: SUMMIT[1] - 150, yMax: SUMMIT[1] + 60, kind: 'lift', vertical: -1.8 },
    { id: 'h-up', name: '东侧岩壁上升气流', a: [1415, -1260], b: [1430, -1540], radius: 60, feather: 60, yMax: COL_STATION[1] + 650, kind: 'lift', vertical: 2.5 },
  ],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '晴朗寒冷，西南风 6 m/s，能见度极佳。', params: makeWeather({ windDirFrom: 240, windSpeed: 6, gustAmp: 1.5, cloudCover: 0.25, visibility: 16000 }) },
    {
      id: 'lowcloud',
      label: '低云',
      kind: 'lowCloud',
      desc: '海拔约 4000–4250 m 有一层低云：冰川营地在云下，山口和平台在云上。冰川谷道会钻进云里，高空越脊可以更早爬到云上；在云中依靠 HUD 航线与姿态仪飞行。',
      params: makeWeather({ windDirFrom: 230, windSpeed: 7, gustAmp: 2, cloudCover: 0.6, overcast: 0.35, lowCloud: 0.9, cloudBase: 1200, cloudTop: 1450, visibility: 8000 }),
    },
    {
      id: 'windy',
      label: '强风',
      kind: 'wind',
      desc: '西风 13 m/s，山口与山脊处有强阵风（有规律，约每 10–11 秒一次）。',
      params: makeWeather({ windDirFrom: 280, windSpeed: 13, gustAmp: 4, turbulence: 0.8, cloudCover: 0.45, overcast: 0.15, zoneScale: 1.35, visibility: 12000 }),
    },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0x8f887a,
    grass: 0x6f7a4e,
    grass2: 0x857a58,
    dirt: 0x736858,
    rock: 0x6e6c6a,
    rock2: 0x504e4d,
    snow: 0xf4f6f8,
    strata: 0,
    beachTop: -100,
    snowLine: 1150,
    rockSlope: 0.4,
    waterDeep: 0x2a4a6a,
    waterShallow: 0x5a8aa0,
    fogTint: 0xd0dae6,
    forestFloor: 0x3a4430,
    mist: 0.75,
  },
  sun: [160, 40],
  ambience: { wind: 1.2, birds: 0.1 },
  landmarks: [
    { name: '山脊寺院', pos: MONASTERY },
    { name: '山口', pos: COL },
    { name: '冰斗平台', pos: SUMMIT },
  ],
  briefing: [
    '海拔每升高 1000 m，空气密度下降约 11%，发动机功率与旋翼效率随之下降：HUD 的“动力余量”和“密度”会直观显示。变化是连续、可预期的，不会突然失去升力。',
    '起飞时机上有 2 箱物资（共 280 kg），越重越费动力；在高处悬停前确认动力余量。带前飞速度爬升比原地垂直爬升省功率。',
    '冰川谷道里有顺坡而下的强风与规律阵风；高空越脊避开强风，但要飞得更高。最后的冰斗平台东侧有背风下沉气流，先爬高再进近。',
  ],
  estMinutes: [9, 12],
};
