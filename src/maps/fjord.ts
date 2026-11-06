// 地图四：挪威峡湾海岸。狭长峡湾、数百米高的峭壁、临水村落、木板教堂、灯塔与导航信标、悬崖农场、浓雾与侧风。

import { Perlin2 } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { Vec2 } from '../sim/terrain';
import { randomBands, type RockFormDef } from '../world/rockForm';
import { PathSampler, polylineDist, smoothPath } from './routeUtil';
import type { MapDef, RouteNodeDef, V3 } from './types';

/** 片麻岩：灰色的岩体里斜着的片理，一层硬一层软，岩壁上是一道道斜着的岩架 */
const ROCK: RockFormDef = {
  massive: true,
  y0: -120,
  y1: 3500,
  dip: [0.42, -0.55],
  waves: [
    [0.0013, 0.0009, 26, 0.7],
    [-0.0007, 0.0021, 15, 2.1],
    [0.0037, 0.0029, 6, 4.0],
  ],
  bench: 0.12,
  slope: [0.75, 1.7],
  tint: 0.18,
  warp: [
    [10, 150],
    [4, 46],
  ],
  bands: randomBands(811, 90, [0x6e6c68, 0x5f5e5c, 0x7c7a74, 0x565451, 0x87847c, 0x66625c], [8, 58]),
};

const SEED = 5501;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 9);

const FJORD: Vec2[] = [
  [-2250, 260],
  [-1750, 340],
  [-1280, 160],
  [-860, 300],
  [-450, 90],
  [-40, 220],
  [360, -80],
  [720, -40],
  [1060, -330],
  [1420, -290],
  [1700, -520],
  [1860, -610],
];
const FP = new PathSampler(FJORD);
const halfW = (s: number) => 250 + 55 * Math.sin(s / 700 + 0.5) + 25 * n.noise(s / 400, 1.7);
const WALL = 270;

function nrmL(s: number): Vec2 {
  const a = FP.at(s - 6);
  const b = FP.at(s + 6);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // 左侧（北岸）法线
  return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
}

/** 海岸线（以西是海）：x 坐标随 z 起伏 */
function coastX(z: number): number {
  return -1440 + 140 * n.noise(z / 420, 0.3) + 60 * n2.noise(z / 130, 2.1);
}

/** 内陆高原（向东逐渐升高）+ 沿海低丘 */
function plateau(x: number, z: number): number {
  const r = n.ridged(x / 1300, z / 1300, 4);
  const high = 470 + 230 * Math.pow(r, 1.3) + 35 * n2.fbm(x / 300, z / 300, 3);
  const low = 40 + 90 * Math.max(0, n.fbm(x / 350, z / 350, 4) + 0.3) + 15 * n2.fbm(x / 90, z / 90, 2);
  return low + (high - low) * smoothstep(coastX(z) + 250, coastX(z) + 1300, x);
}

function land(x: number, z: number): number {
  const dc = x - coastX(z);
  if (dc < 0) return -55 + 10 * n2.fbm(x / 200, z / 200, 2) + Math.max(-dc * -0.0, 0);
  return -3 + (plateau(x, z) + 3) * smoothstep(0, 140, dc);
}

/** 峡湾尽头的冲积平原出了地图还往内陆走：一条慢慢抬高的河谷（不然平原撞在地图边上，是一道笔直的斜坡） */
const VALLEY: Vec2[] = smoothPath(
  [
    [1960, -790],
    [2320, -720],
    [2760, -860],
    [3260, -740],
    [3880, -930],
    [4700, -780],
    [5600, -960],
  ],
  60,
  46,
);

/** 远景：海岸以外是海，内陆的高原往东抬升成积雪的山脉 */
function far(x: number, z: number): number {
  let h = land(x, z);
  // 山脚沿南北方向进进出出，雪线才不是一条直线
  const foot = x + 1000 * n2.noise(z / 2300, 3.3) + 460 * n.noise(z / 830, x / 1100);
  const k = smoothstep(2100, 5600, foot) * smoothstep(-300, 300, h);
  if (k > 0) {
    const wx = x + 500 * n2.noise(x / 2400, z / 2400);
    const crag = Math.pow(n.ridged(wx / 3600, z / 3600 + 5, 7, 2.05, 0.5, 2.0), 1.25);
    h += k * (500 + 1900 * crag);
  }
  const d = polylineDist(VALLEY, x, z, 760);
  if (d !== Infinity) {
    const t = smoothstep(2000, 5400, x);
    const floor = 12 + 470 * t + 6 * n.noise(x / 90, z / 90);
    const fw = 165 - 95 * t + 26 * n2.noise(x / 310, z / 310);
    const wobble = d + 34 * n.noise(x / 130, z / 130) + 14 * n2.noise(x / 47, z / 47);
    if (wobble < fw) h = Math.min(h, floor);
    else h = Math.min(h, floor + (h - floor) * smoothstep(fw, fw + 560, wobble) ** 0.8);
  }
  // 远景网格到 16 km 为止，飞高了能看到陆地像被刀切开一样。让陆地在那之前慢慢沉进海里，天边是海
  const end = Math.max(Math.abs(z), x) + 1500 * n.noise(x / 5200, z / 5200) + 520 * n2.noise(x / 1700, z / 1700);
  return h + (-60 - h) * smoothstep(10500, 14000, end);
}

// ---------- 关键位置 ----------
const S_ISLAND = FP.arcOf(-450, 90);
const S_FARM = FP.arcOf(-40, 220) + 180;
const S_VILLAGE = FP.arcOf(720, -40);
const S_HEAD = FP.len;

const ISL_R = 105;
const ISL: V3 = (() => {
  const c = FP.at(S_ISLAND);
  const nn = nrmL(S_ISLAND);
  const off = halfW(S_ISLAND) - ISL_R - 80;
  return [Math.round(c[0] + nn[0] * off), 0, Math.round(c[1] + nn[1] * off)];
})();

/** 悬崖农场：北岸峭壁中部的天然平台 */
const FARM: V3 = (() => {
  const c = FP.at(S_FARM);
  const nn = nrmL(S_FARM);
  const off = halfW(S_FARM) + 70;
  return [Math.round(c[0] + nn[0] * off), 268, Math.round(c[1] + nn[1] * off)];
})();
const FARM_N = nrmL(S_FARM);

/** 南岸村落（临水平地） */
const VILLAGE: V3 = (() => {
  const c = FP.at(S_VILLAGE);
  const nn = nrmL(S_VILLAGE);
  const off = -(halfW(S_VILLAGE) + 60);
  return [Math.round(c[0] + nn[0] * off), 4, Math.round(c[1] + nn[1] * off)];
})();
const V_N = nrmL(S_VILLAGE);
/** 村落码头停机坪：伸向水面 */
const PIER: V3 = [Math.round(VILLAGE[0] + V_N[0] * 128), 3.2, Math.round(VILLAGE[2] + V_N[1] * 128)];

const HEAD: V3 = (() => {
  const c = FP.at(S_HEAD);
  return [Math.round(c[0] + 40), 6, Math.round(c[1] - 25)];
})();

// 山口（村落 → 峡湾尽头的捷径）
const PASS: Vec2[] = [
  [VILLAGE[0] - V_N[0] * 45, VILLAGE[2] - V_N[1] * 45],
  [VILLAGE[0] + 150, VILLAGE[2] + 260],
  [1150, 250],
  [1500, 120],
  [1640, -20],
  [1790, -130],
  [1760, -270],
  [HEAD[0] - 60, HEAD[2] + 170],
];
const PASSP = new PathSampler(PASS);
/** 山口谷底高度（t = 0..1）：从村落后方爬升到约 360 m，再下降到峡湾尽头 */
function passFloor(t: number): number {
  return 290 + 30 * Math.sin(t * Math.PI) - 250 * smoothstep(0.78, 1, t) - 280 * (1 - smoothstep(0, 0.6, t));
}

// 峡湾口外的礁石与信标
const SKERRIES: Array<[number, number, number]> = [
  [-1880, 560, 70],
  [-1700, -130, 95],
  [-1620, 600, 60],
  [-2000, -60, 80],
  [-1900, 900, 55],
  [-1820, -560, 75],
];
const BEACONS: V3[] = [
  [-1880, 0, 560],
  [-1665, 0, -170],
  [-1620, 0, 600],
];

function skerry(x: number, z: number, cx: number, cz: number, r: number): number {
  const d = Math.hypot(x - cx, z - cz) * (1 + 0.25 * n2.noise((x - cx) / 40, (z - cz) / 40));
  if (d > r) return -Infinity;
  return 22 * Math.pow(1 - d / r, 1.2) - 2;
}

// ---------- 航点 ----------
const LOWW = 70;
const outer = FP.nodes('f-o', FP.arcOf(-1500, 250), S_ISLAND - 420, 280, () => LOWW, { label: '峡湾外段', radius: 70, speed: 40, clearance: 25 });
const wide = (() => {
  const out: RouteNodeDef[] = [];
  const ss = [S_ISLAND - 220, S_ISLAND, S_ISLAND + 220];
  ss.forEach((s, i) => {
    const c = FP.at(s);
    const nn = nrmL(s);
    const off = -(halfW(s) * 0.35);
    out.push({ id: `f-w${i}`, pos: [Math.round(c[0] + nn[0] * off), LOWW, Math.round(c[1] + nn[1] * off)], radius: 70, speed: 38, label: '主航道', clearance: 25, checkpoint: i === 0 });
  });
  return out;
})();
const strait = (() => {
  const out: RouteNodeDef[] = [];
  const ss = [S_ISLAND - 200, S_ISLAND - 70, S_ISLAND + 70, S_ISLAND + 200];
  ss.forEach((s, i) => {
    const c = FP.at(s);
    const nn = nrmL(s);
    const off = halfW(s) - 62;
    out.push({ id: `f-s${i}`, pos: [Math.round(c[0] + nn[0] * off), 45, Math.round(c[1] + nn[1] * off)], radius: 30, speed: 22, label: '近岸海峡', clearance: 15, checkpoint: i === 0 });
  });
  return out;
})();
const toFarm = FP.nodes('f-a', S_ISLAND + 380, S_FARM - 120, 200, () => LOWW, { label: '峡湾中段', radius: 70, speed: 35, clearance: 25 });
const fjordInner = FP.nodes('f-i', S_VILLAGE + 260, S_HEAD - 260, 260, () => LOWW, { label: '峡湾内段', radius: 70, speed: 40, clearance: 25 });
fjordInner[Math.floor(fjordInner.length / 2)].checkpoint = true;

const NODES: RouteNodeDef[] = [
  ...outer,
  ...wide,
  ...strait,
  ...toFarm,
  { id: 'f-fu', pos: [Math.round(FARM[0] - FARM_N[0] * 120), 300, Math.round(FARM[2] - FARM_N[1] * 120)], radius: 50, speed: 15, label: '农场下方峡湾' },
  { id: 'f-fd', pos: [Math.round(FARM[0] - FARM_N[0] * 110), 150, Math.round(FARM[2] - FARM_N[1] * 110)], radius: 50, speed: 15, label: '离开农场' },
  ...FP.nodes('f-v', S_FARM + 200, S_VILLAGE - 220, 240, () => LOWW, { label: '峡湾中段', radius: 70, speed: 40, clearance: 25 }),
  { id: 'f-vu', pos: [PIER[0], 60, PIER[2]], radius: 40, speed: 10, label: '离开码头' },
  ...fjordInner,
  ...PASSP.nodes('f-p', 120, PASSP.len - 150, 170, (s) => Math.max(passFloor(s / PASSP.len), 40) + 95, { label: '山口', radius: 70, speed: 32, clearance: 25 }, { 2: { checkpoint: true } }),
];

export const FJORD_MAP: MapDef = {
  id: 'fjord',
  name: '雾湾峡湾',
  subtitle: '挪威 · 峡湾与海岸',
  region: '挪威西海岸（虚构）',
  description: '巡查峡湾口的导航信标，向悬崖农场和临水村落运送物资，最后抵达峡湾尽头的港口。浓雾天气下能见度只有几百米，信标灯光与 HUD 导航是关键。',
  difficulty: 4,
  recommendedAssist: 'standard',
  size: 4096,
  res: 1025,
  seed: SEED,
  altitudeOffset: 0,
  waterLevel: 0,
  dissect: { grid: 385, steps: 34, k: 0.022, maxCut: 240 },
  erosion: 260000,
  rockForm: ROCK,
  buildTerrain(b) {
    b.fill(land);
    b.applySpline(FJORD, WALL + 400, (h, d, s) => {
      const w = halfW(s);
      if (d < w) return Math.min(h, -2 - 115 * (1 - Math.pow(d / w, 2)));
      const t = (d - w) / WALL;
      if (t >= 1) return h;
      // U 形峡湾：水边陡峭，上部逐渐变缓（便于森林生长）
      const prof = Math.pow(clamp(t, 0, 1), 0.55) * 0.8 + 0.2 * smoothstep(0, 1, t);
      return Math.min(h, -2 + (h + 2) * prof);
    });
    // 山口：在高原上切出一条较低的山谷
    b.applySpline(PASS, 260, (h, d, s, x, z, len) => {
      const floor = passFloor(s / len);
      const w = 90 + 45 * n2.noise(s / 170, 3.3);
      if (d < w) return Math.min(h, floor + 8 * n.noise(x / 80, z / 80));
      const k = smoothstep(w, 260, d);
      return Math.min(h, floor + (h - floor) * k);
    });
    // 海峡中的岛
    b.map((h, x, z) => {
      let v = h;
      const d = Math.hypot(x - ISL[0], z - ISL[2]) * (1 + 0.2 * n2.noise((x - ISL[0]) / 50, (z - ISL[2]) / 50));
      if (d < ISL_R) v = Math.max(v, 75 * Math.pow(1 - d / ISL_R, 0.9) - 2);
      for (const [cx, cz, r] of SKERRIES) v = Math.max(v, skerry(x, z, cx, cz, r));
      return v;
    });
    // 悬崖农场平台、村落与峡湾尽头的冲积平原
    b.flatten(FARM[0] + FARM_N[0] * 10, FARM[2] + FARM_N[1] * 10, 44, FARM[1], 85);
    b.flatten(VILLAGE[0] - V_N[0] * 15, VILLAGE[2] - V_N[1] * 15, 72, VILLAGE[1], 45);
    // 峡湾尽头：河流冲出来的平原把水面挡住，岸线自然弯曲，往里缓缓抬高
    b.map((h, x, z) => {
      const t = (x - HEAD[0] + 92) * 0.82 + (z - HEAD[2]) * -0.57;
      const l = (x - HEAD[0]) * 0.57 + (z - HEAD[2]) * 0.82;
      const shore = t + 34 * n2.noise(l / 95, 7.1) + 16 * n.noise(l / 31, 2.2);
      if (shore < -30) return h;
      const plain = 1.2 + 5.5 * smoothstep(0, 170, shore) + 0.9 * n.noise(x / 60, z / 60) + 16 * smoothstep(200, 520, shore);
      const k = smoothstep(-30, 16, shore);
      return Math.max(h, h + (plain - h) * k);
    });
    b.flatten(HEAD[0], HEAD[2], 96, HEAD[1], 70);
    b.paint(0, (_x, _z, h) => (h > -1 && h < 3 ? 1 - smoothstep(1.5, 3, h) : 0));
  },
  paintFinal: (b) => void b.paint(3, (x, z, h) => (h > 680 ? smoothstep(680, 760, h + 40 * n.noise(x / 150, z / 150)) : 0)),
  farTerrain: far,
  farExtent: 4,
  spawn: { padId: 'F-mouth', heading: 0 },
  pads: [
    { id: 'F-mouth', name: '峡湾口灯塔站', pos: [-1715, 14.45, -110], size: 18, kind: 'start', style: 'ground' },
    { id: 'F-farm', name: '悬崖农场', pos: [FARM[0], FARM[1] + 0.45, FARM[2]], size: 16, kind: 'delivery', style: 'ground' },
    { id: 'F-pier', name: '村落码头停机坪', pos: PIER, size: 18, kind: 'delivery', style: 'pier' },
    { id: 'F-head', name: '峡湾港口停机坪', pos: [HEAD[0], HEAD[1] + 0.45, HEAD[2]], size: 20, kind: 'final', style: 'ground' },
    { id: 'F-rep', name: '村落维修坪', pos: [VILLAGE[0] - V_N[0] * 30, VILLAGE[1] + 0.45, VILLAGE[2] - V_N[1] * 30], size: 16, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
  ],
  props: [
    ...BEACONS.map((b, i) => ({ type: 'beacon', pos: [b[0], 0, b[2]] as V3, ground: true, p: { h: 16, color: ['green', 'red', 'white'][i], period: [2, 3, 4][i] } })),
    { type: 'lighthouse', pos: [-1745, 0, -160], ground: true },
    { type: 'nhouse', pos: [-1690, 0, -75], rotY: 0.4, ground: true },
    { type: 'turfFarm', pos: [FARM[0] + FARM_N[0] * 34 - FARM_N[1] * 10, 0, FARM[2] + FARM_N[1] * 34 + FARM_N[0] * 10], rotY: 0.3, ground: true },
    { type: 'waterfall', pos: [FARM[0] + 160, 0, FARM[2] + 40], ground: true, p: { h: 230, w: 9 } },
    { type: 'nvillage', pos: [VILLAGE[0], 0, VILLAGE[2]], ground: true, p: { r: 85, n: 16 } },
    { type: 'staveChurch', pos: [VILLAGE[0] - V_N[0] * 55, 0, VILLAGE[2] - V_N[1] * 55], rotY: 0.6, ground: true },
    { type: 'pier', pos: [VILLAGE[0] + V_N[0] * 40, 0, VILLAGE[2] + V_N[1] * 40], rotY: -Math.atan2(V_N[1], V_N[0]), p: { len: 82, w: 6, deck: 2.4, wood: 1 } },
    { type: 'boathouse', pos: [VILLAGE[0] + V_N[0] * 55 + 40, 0, VILLAGE[2] + V_N[1] * 55 - 20], rotY: 0.2, ground: true },
    { type: 'fishFarm', pos: [VILLAGE[0] + V_N[0] * 260 - 120, 0, VILLAGE[2] + V_N[1] * 260], p: { n: 4, r: 14 } },
    { type: 'nvillage', pos: [HEAD[0], 0, HEAD[2]], ground: true, p: { r: 120, n: 24 } },
    { type: 'ferry', pos: [HEAD[0] - 200, 0, HEAD[2] + 40], rotY: 0.4 },
    { type: 'flagpole', pos: [HEAD[0] + 18, 0, HEAD[2] - 18], ground: true, p: { color: 'no' } },
    { type: 'flagpole', pos: [VILLAGE[0] + 12, 0, VILLAGE[2] + 12], ground: true, p: { color: 'no' } },
    { type: 'boat', pos: [HEAD[0] - 240, 0, HEAD[2] - 30], rotY: 1.2 },
    { type: 'boat', pos: [PIER[0] + 30, 0, PIER[2] + 25], rotY: 0.6 },
    { type: 'antenna', pos: [FARM[0] + FARM_N[0] * 44 + FARM_N[1] * 26, 0, FARM[2] + FARM_N[1] * 44 - FARM_N[0] * 26], ground: true, p: { h: 14 } },
  ],
  vegetation: [
    { type: 'spruce', density: 2300, scale: [0.8, 1.4], minH: 2, maxH: 560, maxSlope: 0.75, mask: (x, z, h) => (1 - smoothstep(380, 560, h)) * (0.6 + 0.4 * n.fbm(x / 250, z / 250, 2)) },
    { type: 'birch', density: 620, scale: [0.8, 1.25], minH: 2, maxH: 200, maxSlope: 0.55 },
    // 岩壁脚下的崩积石块和水边的礁石
    { type: 'boulder', density: 2200, scale: [0.35, 2.4], maxH: 90, maxSlope: 0.62, mask: (_x, _z, h, s) => smoothstep(0.06, 0.2, s) * (1 - smoothstep(30, 90, h)) },
    { type: 'shrub', density: 2400, scale: [0.6, 1.3], minH: 20, maxH: 700, maxSlope: 0.5, wash: 0.5, mask: (x, z) => 0.2 + 0.8 * smoothstep(0.46, 0.6, n.fbm(x / 110 + 3, z / 110, 2) * 0.5 + 0.5) },
  ],
  clearings: [
    [VILLAGE[0], VILLAGE[2], 100],
    [HEAD[0], HEAD[2], 140],
    [FARM[0], FARM[2], 40],
  ],
  nodes: NODES,
  legs: [
    { to: 'fm-beacons', paths: [{ id: 'main', label: '峡湾口', detail: '', tag: 'main', nodes: [] }] },
    {
      to: 'fm-farm',
      paths: [
        { id: 'wide', label: '宽阔主航道', detail: '沿峡湾南侧宽阔水道飞行：离峭壁远，雾天最安全', tag: 'safe', nodes: [...outer.map((x) => x.id), ...wide.map((x) => x.id), ...toFarm.map((x) => x.id), 'f-fu'] },
        { id: 'strait', label: '近岸海峡', detail: '从小岛与北岸峭壁之间的海峡穿过：距离更短，但宽度不足百米，雾中要提前减速', tag: 'short', nodes: [...outer.map((x) => x.id), ...strait.map((x) => x.id), ...toFarm.map((x) => x.id), 'f-fu'] },
      ],
    },
    { to: 'fm-pier', paths: [{ id: 'main', label: '峡湾中段', detail: '', tag: 'main', nodes: ['f-fd', ...NODES.filter((x) => x.id.startsWith('f-v') && x.id !== 'f-vu').map((x) => x.id)] }] },
    {
      to: 'fm-head',
      paths: [
        { id: 'fjord', label: '沿峡湾水道', detail: '沿蜿蜒的峡湾水面飞行，低空、开阔，距离较长', tag: 'safe', nodes: ['f-vu', ...fjordInner.map((x) => x.id)] },
        { id: 'pass', label: '翻越山口', detail: '爬升穿过高原上的山口直达港口：距离短，但山口风大、有积雪，需要较多爬升', tag: 'short', nodes: ['f-vu', ...NODES.filter((x) => x.id.startsWith('f-p')).map((x) => x.id)] },
      ],
    },
  ],
  mission: {
    startCargo: 2,
    main: [
      {
        id: 'fm-beacons',
        kind: 'inspect',
        title: '巡查峡湾口导航信标',
        detail: '依次低速飞过三座导航信标（绿、红、白，闪光节奏不同），速度低于 30 m/s。',
        points: BEACONS.map((b, i) => ({ pos: [b[0], 68, b[2]] as V3, radius: 45, label: `${['绿色', '红色', '白色'][i]}信标` })),
        maxSpeed: 30,
        approach: [BEACONS[1][0], 70, BEACONS[1][2]],
      },
      { id: 'fm-farm', kind: 'land', title: '向悬崖农场运送物资', detail: '农场建在北岸峭壁中段约 270 m 高的平台上。贴近峭壁时谨慎进近，注意侧风。', padId: 'F-farm', dwell: 4, cargo: 'unload', approach: [Math.round(FARM[0] - FARM_N[0] * 45), FARM[1] + 30, Math.round(FARM[2] - FARM_N[1] * 45)] },
      { id: 'fm-pier', kind: 'land', title: '向村落码头运送物资', detail: '停机坪建在伸入峡湾的码头上，四周是水面。安全降落并卸货。', padId: 'F-pier', dwell: 4, cargo: 'unload', approach: [PIER[0], 40, PIER[2]] },
      { id: 'fm-head', kind: 'land', title: '抵达峡湾港口', detail: '最终目标：在峡湾尽头的港口停机坪精确降落。', padId: 'F-head', dwell: 3, approach: [HEAD[0], 45, HEAD[2]] },
    ],
    optional: [
      {
        id: 'fo-falls',
        kind: 'inspect',
        title: '巡视七姐妹瀑布',
        detail: '以低于 25 m/s 的速度飞近瀑布（60 m 内）。',
        points: [{ pos: [Math.round(FARM[0] + 160 - FARM_N[0] * 60), 150, Math.round(FARM[2] + 40 - FARM_N[1] * 60)], radius: 45, label: '瀑布' }],
        maxSpeed: 25,
        approach: [Math.round(FARM[0] + 160 - FARM_N[0] * 60), 150, Math.round(FARM[2] + 40 - FARM_N[1] * 60)],
      },
      {
        id: 'fo-fish',
        kind: 'hover',
        title: '为养殖场投放饲料',
        detail: '在鲑鱼养殖网箱上方 8–25 m 悬停 5 秒。',
        center: [VILLAGE[0] + V_N[0] * 260 - 120, 0, VILLAGE[2] + V_N[1] * 260],
        radius: 30,
        minH: 8,
        maxH: 25,
        duration: 5,
        maxSpeed: 2,
        approach: [VILLAGE[0] + V_N[0] * 260 - 120, 30, VILLAGE[2] + V_N[1] * 260],
      },
    ],
  },
  pickups: [
    { id: 'fs1', kind: 'shield', pos: strait[1].pos, note: '近岸海峡（危险捷径奖励）' },
    { id: 'fb1', kind: 'boost', pos: strait[2].pos, note: '近岸海峡' },
    { id: 'fr1', kind: 'repair', pos: wide[1].pos, note: '宽阔主航道' },
    { id: 'fb2', kind: 'boost', pos: [VILLAGE[0] + 150, 120, VILLAGE[2] + 260], note: '翻越山口前的爬升' },
    { id: 'fr2', kind: 'repair', pos: fjordInner[Math.floor(fjordInner.length / 2)].pos, note: '峡湾内段' },
  ],
  windZones: [
    { id: 'f-chan1', name: '峡湾顺谷风', a: FP.at(FP.arcOf(-1400, 250)), b: FP.at(S_FARM), radius: 260, feather: 150, yMax: 500, kind: 'channel', dirFrom: 270, speed: 8 },
    { id: 'f-strait', name: '海峡侧风阵风', a: FP.at(S_ISLAND - 200), b: FP.at(S_ISLAND + 200), radius: 200, feather: 100, kind: 'gust', gust: { amp: 6, period: 12, dirFrom: 0 } },
    { id: 'f-cliff', name: '峭壁下沉气流', a: [FARM[0] - 60, FARM[2]], b: [FARM[0] + 60, FARM[2]], radius: 140, feather: 100, kind: 'lift', vertical: -2 },
    { id: 'f-pass', name: '山口强风', a: [PASS[1][0], PASS[1][1]], b: [PASS[3][0], PASS[3][1]], radius: 220, feather: 150, kind: 'channel', dirFrom: 300, speed: 13 },
  ],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '晴朗清冷，西风 5 m/s，峭壁投下深长的阴影。', params: makeWeather({ windDirFrom: 270, windSpeed: 5, gustAmp: 1.2, cloudCover: 0.35, visibility: 12000 }) },
    {
      id: 'fog',
      label: '浓雾',
      kind: 'fog',
      desc: '浓雾笼罩峡湾，能见度约 350 m。信标闪光可在雾中远距离辨认；依靠 HUD 导航、降低速度。',
      params: makeWeather({ windDirFrom: 260, windSpeed: 3, gustAmp: 0.8, cloudCover: 0.9, overcast: 0.75, visibility: 350, wetness: 0.6, zoneScale: 0.6 }),
    },
    {
      id: 'crosswind',
      label: '侧风',
      kind: 'wind',
      desc: '北风 11 m/s 横穿峡湾，在海峡与山口处形成阵风；靠近峭壁时需要持续修正。',
      params: makeWeather({ windDirFrom: 0, windSpeed: 11, gustAmp: 3.5, turbulence: 0.6, cloudCover: 0.6, overcast: 0.3, visibility: 9000, zoneScale: 1.3 }),
    },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0x9a907c,
    grass: 0x4e6a36,
    grass2: 0x657a44,
    dirt: 0x6a5a48,
    rock: 0x666a6c,
    rock2: 0x46494c,
    snow: 0xf2f4f6,
    strata: 0,
    beachTop: 2.2,
    snowLine: 800,
    air: 1.0,
    rockSlope: 0.33,
    waterDeep: 0x1b3f50,
    waterShallow: 0x2a5e62,
    fogTint: 0xc6ced4,
    forestFloor: 0x26361e,
    mist: 1.15,
  },
  sun: [200, 26],
  ambience: { sea: 0.6, gulls: 0.4, wind: 0.6, river: 0.3 },
  landmarks: [
    { name: '木板教堂', pos: [VILLAGE[0], 20, VILLAGE[2]] },
    { name: '悬崖农场', pos: FARM },
    { name: '七姐妹瀑布', pos: [FARM[0] + 160, 150, FARM[2] + 40] },
  ],
  vistas: [
    { name: '峡湾入口', at: [-1276, 100, 160], look: [-1048, 242] },
    { name: '岩壁之间', at: [-442, 100, 173], look: [-283, 229] },
    { name: '七姐妹瀑布', at: [16, 100, 198], look: [3, 8] },
    { name: '海中小岛', at: [-591, 100, -58], look: [-335, -67] },
    { name: '峡湾尽头', at: [500, 90, -200], look: [-900, 300] },
  ],
  briefing: [
    '峡湾两侧是数百米高的峭壁。宽阔主航道离峭壁远，近岸海峡宽度不足百米。',
    '浓雾中能见度只有约 350 m：彩色信标灯光可以穿透雾气，HUD 的航点标记、转弯预告和地形告警始终有效。',
    '悬崖农场在峭壁中段，背风侧有下沉气流——进近时保留动力余量。',
  ],
  estMinutes: [9, 12],
};
