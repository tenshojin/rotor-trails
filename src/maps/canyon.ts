// 地图二：美国西南部峡谷（科罗拉多高原风格）。红色砂岩台地、阶梯状峭壁、蜿蜒峡谷、孤丘、天然岩拱、石柱。
// 峡谷内的航点沿峡谷中心线样条自动生成，保证航线与峡谷走向一致。

import { Perlin2 } from '../core/noise';
import { smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { Vec2 } from '../sim/terrain';
import type { RockFormDef } from '../world/rockForm';
import { PathSampler, riverLine } from './routeUtil';
import type { MapDef, RouteNodeDef, V3 } from './types';

/**
 * 地层（从谷底往上）：深色基岩 → 褐色砂岩崖 → 灰绿页岩缓坡 → 石灰岩 → 一整层红色的大崖 → 红色的薄层岩架 →
 * 红色页岩缓坡 → 浅色砂岩崖 → 奶油色的盖层（就是台地的边缘）。再往上是孤丘才有的层。
 */
const ROCK: RockFormDef = {
  y0: 40,
  y1: 900,
  dip: [0.004, -0.003],
  waves: [
    [0.0011, 0.0007, 5, 1.1],
    [-0.0006, 0.0017, 3.5, 2.4],
    [0.0031, -0.0023, 1.6, 0.4],
  ],
  bench: 0.9,
  slope: [0.5, 1.15],
  tint: 0.82,
  debris: 0.75,
  // 崖线的扭动要分好几个尺度：只有一个小尺度时，从台地上看过去崖边是一排一样大的锯齿
  warp: [
    [14, 118],
    [6, 67],
    [2.6, 31],
    [1.2, 13],
  ],
  bands: [
    { t: 30, hard: 0.75, c: 0x54423a },
    { t: 14, hard: 0.9, c: 0x80593f },
    { t: 26, hard: 0.08, c: 0x8d7b5e },
    { t: 12, hard: 0.6, c: 0x9c8466 },
    { t: 44, hard: 1, c: 0xa9553a },
    { t: 10, hard: 0.15, c: 0x8e4a35 },
    { t: 9, hard: 0.85, c: 0xa65a3c },
    { t: 7, hard: 0.15, c: 0x96503a },
    { t: 11, hard: 0.9, c: 0xb0623f },
    { t: 6, hard: 0.15, c: 0x8f4e38 },
    { t: 10, hard: 0.85, c: 0xa85b3d },
    { t: 22, hard: 0.1, c: 0x9c4f3a },
    { t: 26, hard: 1, c: 0xd8c09a },
    { t: 12, hard: 0.35, c: 0xc2a27c },
    { t: 26, hard: 0.95, c: 0xd9c8a6 },
    { t: 24, hard: 0.2, c: 0xa8603f },
    { t: 36, hard: 1, c: 0xc07a4e },
    { t: 18, hard: 0.2, c: 0x9e5a3e },
    { t: 44, hard: 1, c: 0xc98a5a },
    { t: 20, hard: 0.2, c: 0xa4684a },
    { t: 40, hard: 1, c: 0xb8734c },
    { t: 22, hard: 0.2, c: 0xa8684a },
    { t: 48, hard: 1, c: 0xc9875a },
    { t: 24, hard: 0.2, c: 0xa0624a },
    { t: 44, hard: 1, c: 0xbe7a50 },
    { t: 30, hard: 0.2, c: 0xa86c4e },
    { t: 60, hard: 1, c: 0xc48458 },
    { t: 60, hard: 0.5, c: 0xb47650 },
  ],
};

const SEED = 3301;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 3);

export const CANYON_MAIN: Vec2[] = [
  [-2150, 1250],
  [-1750, 1150],
  [-1380, 1250],
  [-1060, 1060],
  [-1000, 720],
  [-760, 430],
  [-430, 460],
  [-160, 250],
  [-120, -80],
  [150, -330],
  [500, -260],
  [790, -520],
  [780, -880],
  [1060, -1110],
  [1420, -1010],
  [1760, -1260],
  [2150, -1300],
];

const CANYON_SIDE: Vec2[] = [
  [-160, 250],
  [-420, -40],
  [-520, -420],
  [-820, -660],
  [-1020, -1020],
];

const PLATEAU = 300;
const MAINP = new PathSampler(CANYON_MAIN);
const floorAt = (s: number) => 118 - 60 * (s / MAINP.len);
const WALL = 125;

// 关键位置（沿峡谷弧长）
const S_ENTRY = MAINP.arcOf(-1430, 1215);
const S_CONF = MAINP.arcOf(-160, 250);
const S_STATION = S_CONF + 90;
const S_SENS = [S_STATION + 420, S_STATION + 820, S_STATION + 1200];
const S_ARCH = S_SENS[2] + 520;
const S_LEDGE = S_ARCH + 360;

const [ARCH_X, ARCH_Z] = MAINP.at(S_ARCH);
const STATION = MAINP.point(S_STATION, floorAt(S_STATION) + 0.45);

function dirAt(s: number): Vec2 {
  const a = MAINP.at(s - 8);
  const b = MAINP.at(s + 8);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}
const ARCH_DIR = dirAt(S_ARCH);
/** 岩拱横跨峡谷：跨度方向垂直于峡谷走向 */
const ARCH_ROT = -Math.atan2(ARCH_DIR[0], -ARCH_DIR[1]);

function plateau(x: number, z: number): number {
  return PLATEAU + 16 * n.fbm(x / 650, z / 650, 4) + 5 * n2.fbm(x / 120, z / 120, 3);
}

/** 远景：地平线上一座座平顶的孤山和石柱（纪念碑谷那样），而不是一直平到天边 */
const BUTTES: Array<[number, number, number, number]> = [
  // x, z, 半径, 高度
  [-4200, -3100, 900, 300],
  [-5600, 400, 1300, 240],
  [-4600, 3300, 700, 340],
  [-1800, 5100, 1000, 260],
  [2300, 5300, 800, 380],
  [5200, 3400, 1200, 280],
  [5900, -900, 900, 330],
  [4700, -4300, 1100, 250],
  [1100, -5600, 800, 360],
  [-2500, -5200, 1000, 290],
  [-3100, -4400, 330, 420],
  [3600, 4700, 300, 440],
  [5000, 900, 280, 400],
];

function farLand(x: number, z: number): number {
  let h = plateau(x, z);
  for (const [cx, cz, r, ph] of BUTTES) {
    const a = Math.atan2(z - cz, x - cx);
    const d = Math.hypot(x - cx, z - cz) / (r * (1 + 0.28 * n.noise(Math.cos(a) * 1.7 + cx * 0.001, Math.sin(a) * 1.7 + cz * 0.001)));
    if (d >= 1.25) continue;
    // 顶部平、四周是陡崖，崖脚堆着缓坡
    const cliff = smoothstep(1.0, 0.86, d);
    const talus = smoothstep(1.25, 0.98, d) * 0.22;
    h = Math.max(h, PLATEAU + ph * Math.max(cliff, talus) + 7 * n2.fbm(x / 240, z / 240, 2));
  }
  return h;
}

/** 阶梯剖面：每级 60% 平台 + 40% 陡崖 */
function terrace(t: number, steps: number): number {
  const u = Math.min(0.9999, Math.max(0, t)) * steps;
  const k = Math.floor(u);
  const f = u - k;
  return (k + smoothstep(0.32, 0.72, f)) / steps;
}

/** 峡谷谷底半宽：窄峡与岩拱峡口处收窄 */
function floorHalf(s: number, x: number, z: number): number {
  let fw = 56 + 28 * Math.sin(s / 640 + 1.2) + 12 * n.noise(s / 280, 0.5);
  fw *= 0.62 + 0.38 * smoothstep(60, 260, Math.hypot(x - ARCH_X, z - ARCH_Z));
  fw *= 0.55 + 0.45 * smoothstep(80, 320, Math.hypot(x + 600, z - 440));
  return Math.max(24, fw);
}

// 岩架：位于岩拱下游、峡谷南侧峭壁中部
const LEDGE_N: Vec2 = (() => {
  const d = dirAt(S_LEDGE);
  return [-d[1], d[0]];
})();
const LEDGE: V3 = (() => {
  const c = MAINP.at(S_LEDGE);
  const fw = floorHalf(S_LEDGE, c[0], c[1]);
  const dist = fw + WALL * 0.5;
  const fl = floorAt(S_LEDGE);
  return [Math.round(c[0] + LEDGE_N[0] * dist), Math.round(fl + (PLATEAU - fl) * 0.5), Math.round(c[1] + LEDGE_N[1] * dist)];
})();

function mesa(x: number, z: number, cx: number, cz: number, r: number, top: number, base: number, steps = 3): number {
  const d = Math.hypot(x - cx, z - cz) * (1 + 0.12 * n2.noise(Math.atan2(z - cz, x - cx) * 2, cx * 0.01));
  if (d > r) return -Infinity;
  const t = 1 - Math.max(0, (d - r * 0.62) / (r * 0.38));
  return base + (top - base) * terrace(t, steps);
}

const MESA: V3 = [1380, 452, -1640];
const ALT = (s: number) => floorAt(s) + 76;
const LOW = (s: number) => floorAt(s) + 32;

// ---------- 航点 ----------
const canyonNodes = MAINP.nodes('c-k', S_ENTRY, S_STATION - 160, 230, ALT, { label: '峡谷', radius: 45, speed: 24, clearance: 20 });
canyonNodes[0].label = '峡谷入口';
canyonNodes[0].pos = [canyonNodes[0].pos[0], 365, canyonNodes[0].pos[2]];
canyonNodes[0].clearance = 25;
const narrowIdx = canyonNodes.reduce((bi, nd, i) => (Math.hypot(nd.pos[0] + 600, nd.pos[2] - 440) < Math.hypot(canyonNodes[bi].pos[0] + 600, canyonNodes[bi].pos[2] - 440) ? i : bi), 0);
canyonNodes[narrowIdx].label = '窄峡';
canyonNodes[narrowIdx].checkpoint = true;
canyonNodes[narrowIdx].speed = 18;
canyonNodes[1].pos = [canyonNodes[1].pos[0], 210, canyonNodes[1].pos[2]];

const sensorLeg = MAINP.nodes('c-s', S_STATION + 140, S_SENS[0] - 120, 200, ALT, { label: '下游峡谷', radius: 45, speed: 24, clearance: 20 });
const archNodes = MAINP.nodes('c-a', S_SENS[2] + 160, S_LEDGE - 170, 110, LOW, { label: '岩拱峡', radius: 30, speed: 14, clearance: 14 });
const archIdx = archNodes.reduce((bi, nd, i) => (Math.hypot(nd.pos[0] - ARCH_X, nd.pos[2] - ARCH_Z) < Math.hypot(archNodes[bi].pos[0] - ARCH_X, archNodes[bi].pos[2] - ARCH_Z) ? i : bi), 0);
archNodes[archIdx].pos = [Math.round(ARCH_X), Math.round(LOW(S_ARCH)), Math.round(ARCH_Z)];
archNodes[archIdx].label = '大岩拱';
archNodes[0].checkpoint = true;
archNodes[0].label = '岩拱峡入口';

const S3 = MAINP.point(S_SENS[2], ALT(S_SENS[2]));
const RANGER: V3 = [420, 305.45, -760];
const NODES: RouteNodeDef[] = [
  ...canyonNodes,
  { id: 'c-r1', pos: [-1150, 380, 520], radius: 70, speed: 45, label: '北缘高空' },
  { id: 'c-r2', pos: [-640, 380, 60], radius: 70, speed: 45, label: '石林上空', checkpoint: true },
  { id: 'c-r3', pos: [STATION[0] - 60, 345, STATION[2] - 40], radius: 60, speed: 25, label: '研究站上空' },
  ...sensorLeg,
  ...archNodes,
  { id: 'c-b1', pos: [S3[0], 370, S3[2]], radius: 60, speed: 15, label: '爬出峡谷' },
  { id: 'c-b2', pos: [RANGER[0] + 120, 370, RANGER[2] - 80], radius: 70, speed: 40, label: '护林站上空', checkpoint: true },
  { id: 'c-b3', pos: [Math.round(LEDGE[0] - LEDGE_N[0] * 30), 370, Math.round(LEDGE[2] - LEDGE_N[1] * 30)], radius: 50, speed: 15, label: '岩架上空' },
  { id: 'c-m1', pos: [Math.round(LEDGE[0] - LEDGE_N[0] * 20), 350, Math.round(LEDGE[2] - LEDGE_N[1] * 20)], radius: 50, speed: 12, label: '垂直爬升出谷', checkpoint: true },
  { id: 'c-m2', pos: [Math.round((LEDGE[0] + MESA[0]) / 2 + 60), 485, Math.round((LEDGE[2] + MESA[2]) / 2)], radius: 60, speed: 25, label: '台地边缘' },
];

export const CANYON: MapDef = {
  id: 'canyon',
  name: '赤岩峡谷',
  subtitle: '美国西南部 · 峡谷与台地',
  region: '科罗拉多高原（虚构）',
  description: '红色砂岩台地上切出一条蜿蜒的大峡谷。为谷底研究站运送补给、巡查传感器、在峭壁岩架投放设备，最后降落在高耸的天空台地之巅。',
  difficulty: 3,
  recommendedAssist: 'standard',
  size: 4096,
  res: 1025,
  seed: SEED,
  altitudeOffset: 1500,
  waterLevel: null,
  erosion: 200000,
  rockForm: ROCK,
  rivers: [
    {
      // 谷底的河：泥沙不多的时候是灰绿色，绕着研究站和岩拱的石脚流
      pts: riverLine(
        MAINP,
        40,
        MAINP.len - 40,
        22,
        (s) => {
          const c = MAINP.at(s);
          return floorHalf(s, c[0], c[1]) * (0.34 * Math.sin(s / 190 + 0.6) + 0.15 * Math.sin(s / 83 + 2.1));
        },
        (s) => floorAt(s) - 1.1,
        (s) => 10 + 3.5 * Math.sin(s / 420 + 1) + 1.5 * Math.sin(s / 150),
        [
          [STATION[0], STATION[2], 46],
          [STATION[0] + 30, STATION[2] + 22, 36],
          ...S_SENS.map((s): [number, number, number] => {
            const p = MAINP.at(s);
            return [p[0] + 12, p[1] + 6, 22];
          }),
        ],
      ),
      depth: 1.6,
      bank: 18,
      deep: 0x3e5a4c,
      shallow: 0x7a8064,
      speed: 1.6,
      bar: 16,
    },
  ],
  buildTerrain(b) {
    b.fill(plateau);
    const carve = (path: Vec2[], maxD: number, fwF: (s: number, x: number, z: number) => number, floorF: (s: number, len: number) => number, wallW: number) =>
      b.applySpline(path, maxD, (h, d, s, x, z, len) => {
        const fw = fwF(s, x, z);
        const ww = wallW + 24 * n.noise(s / 380, 3.3);
        const floor = floorF(s, len) + 2.5 * n2.noise(x / 70, z / 70);
        if (d >= fw + ww) return h;
        if (d < fw) {
          const wash = d < 9 ? -2.5 * (1 - d / 9) : 0;
          return Math.min(h, floor + wash + 3 * smoothstep(fw * 0.55, fw, d));
        }
        const t = (d - fw) / ww;
        return Math.min(h, floor + (h - floor) * terrace(t + 0.04 * n2.noise(x / 40, z / 40), 3));
      });
    carve(CANYON_MAIN, 300, floorHalf, (s) => floorAt(s), WALL);
    carve(
      CANYON_SIDE,
      200,
      (s) => 26 + 10 * Math.sin(s / 300),
      (s, len) => floorAt(S_CONF) - 4 + 150 * Math.pow(s / len, 1.6),
      80,
    );
    // 孤丘（谷中矗立的台状岩丘）与天空台地
    b.map((h, x, z) => {
      let v = h;
      v = Math.max(v, mesa(x, z, -1500, -700, 160, 380, PLATEAU - 10, 2));
      v = Math.max(v, mesa(x, z, MESA[0], MESA[2], 230, MESA[1], PLATEAU - 10, 4));
      return v;
    });
    // 岩架（悬崖中部的平台）
    b.flatten(LEDGE[0], LEDGE[2], 15, LEDGE[1], 8);
    b.flatten(MESA[0], MESA[2], 26, MESA[1], 20, 'min');
    b.paintPath(1, CANYON_MAIN, 7, 5, 0.7);
    b.paint(0, (x, z, h) => (h < 125 ? 0.6 * (1 - smoothstep(95, 125, h)) * (0.6 + 0.4 * n.noise(x / 50, z / 50)) : 0));
  },
  farTerrain: farLand,
  farExtent: 5,
  spawn: { padId: 'C-visitor', heading: 110 },
  pads: [
    { id: 'C-visitor', name: '峡谷游客中心', pos: [-1480, 308.45, 820], size: 22, kind: 'start', style: 'ground' },
    { id: 'C-station', name: '谷底研究站', pos: STATION, size: 20, kind: 'delivery', style: 'ground' },
    { id: 'C-mesa', name: '天空台地研究站', pos: [MESA[0], MESA[1] + 0.45, MESA[2]], size: 18, kind: 'final', style: 'ground' },
    { id: 'C-ranger', name: '护林站维修坪', pos: RANGER, size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
    { id: 'C-view', name: '石林观景台', pos: [-760, 309.45, 160], size: 16, kind: 'helipad', style: 'ground' },
  ],
  props: [
    { type: 'visitorCenter', pos: [-1525, 0, 775], rotY: 0.3, ground: true },
    { type: 'truck', pos: [-1450, 0, 790], rotY: 1.2, ground: true },
    { type: 'truck', pos: [-1440, 0, 776], rotY: 1.3, ground: true },
    { type: 'flagpole', pos: [-1500, 0, 860], ground: true, p: { color: 'us' } },
    { type: 'waterTower', pos: [-1570, 0, 860], ground: true },
    { type: 'researchStation', pos: [STATION[0] + 30, 0, STATION[2] + 22], rotY: 0.6, ground: true },
    ...S_SENS.map((s) => {
      const p = MAINP.at(s);
      return { type: 'sensorPost', pos: [p[0] + 12, 0, p[1] + 6] as V3, ground: true };
    }),
    { type: 'arch', pos: [ARCH_X, floorAt(S_ARCH) - 3, ARCH_Z], rotY: ARCH_ROT, p: { span: 104, rise: 86, thick: 15, depth: 20 } },
    { type: 'hoodooField', pos: [-640, 0, 220], ground: true, p: { r: 110, n: 16 } },
    { type: 'hoodooField', pos: [-1250, 0, 380], ground: true, p: { r: 120, n: 12 } },
    { type: 'hoodooField', pos: [1000, 0, -300], ground: true, p: { r: 100, n: 10 } },
    { type: 'adobe', pos: [RANGER[0] + 15, 0, RANGER[2] + 25], ground: true },
    { type: 'shed', pos: [RANGER[0] - 25, 0, RANGER[2] + 20], rotY: 0.4, ground: true, p: { w: 6, l: 9, h: 3.2, roof: 0x7a5a40, color: 0xc8a27a } },
    { type: 'windmill', pos: [RANGER[0] + 30, 0, RANGER[2] - 25], ground: true },
    // 护林站：土路把维修坪、土坯房、工具棚、风车连起来；风车边是木栅栏围的圆形畜栏
    { type: 'trail', pos: [RANGER[0], 0, RANGER[2]], p: { w: 2.2, pts: `${RANGER[0] - 25},${RANGER[2] + 20};${RANGER[0] - 4},${RANGER[2] + 14};${RANGER[0] + 15},${RANGER[2] + 25}` } },
    { type: 'trail', pos: [RANGER[0], 0, RANGER[2]], p: { w: 2, pts: `${RANGER[0] + 10},${RANGER[2] - 6};${RANGER[0] + 22},${RANGER[2] - 18};${RANGER[0] + 30},${RANGER[2] - 25}` } },
    { type: 'corral', pos: [RANGER[0] + 44, 0, RANGER[2] - 38], rotY: 2.4, ground: true, p: { r: 9 } },
    { type: 'antenna', pos: [MESA[0] + 85, 0, MESA[2] + 70], ground: true, p: { h: 24 } },
    { type: 'researchStation', pos: [MESA[0] - 40, 0, MESA[2] + 52], rotY: -0.3, ground: true },
    { type: 'boulders', pos: [-245, 0, 405], ground: true, p: { n: 9, spread: 26, r: 4, color: 0x9a4a32 } },
    { type: 'boulders', pos: [700, 0, -700], ground: true, p: { n: 8, spread: 30, r: 4, color: 0x9a4a32 } },
    { type: 'adobe', pos: [-1570, 0, 740], ground: true },
    { type: 'adobe', pos: [-1420, 0, 905], ground: true },
    // 游客中心一带：皮卡停在土石停车场，土路通向水塔、两栋土坯房；停车场边是原木栅栏
    { type: 'yard', pos: [-1445, 0, 784], p: { r: 14, s: 0.8 } },
    { type: 'trail', pos: [-1525, 0, 775], p: { w: 2.6, pts: '-1445,784;-1500,790;-1525,800;-1550,830;-1570,860' } },
    { type: 'trail', pos: [-1525, 0, 775], p: { w: 2.2, pts: '-1525,800;-1550,770;-1570,740' } },
    { type: 'trail', pos: [-1525, 0, 775], p: { w: 2.2, pts: '-1445,784;-1430,830;-1425,870;-1420,905' } },
    { type: 'fenceLine', pos: [-1445, 0, 784], p: { pts: '-1462,768;-1436,764;-1424,778;-1426,800', h: 1.1 } },
  ],
  vegetation: [
    // 高原上是一片片的杜松林和成丛的鼠尾草（疏密不均），谷底才有仙人掌
    { type: 'juniper', density: 620, scale: [0.7, 1.4], maxSlope: 0.3, wash: 0.3, mask: (x, z, h) => (h > 200 ? smoothstep(-0.05, 0.4, n.fbm(x / 340, z / 340, 3)) : 0.1) },
    { type: 'cactus', density: 45, scale: [0.7, 1.2], maxSlope: 0.2, mask: (_x, _z, h) => (h < 200 ? 1 : 0.15) },
    // 崖脚的崩塌石块：只落在陡崖下面的缓坡和岩架上
    { type: 'boulder', density: 5200, scale: [0.22, 1.9], maxSlope: 0.5, mask: (_x, _z, h, s) => (h < 295 ? (0.12 + 0.88 * smoothstep(0.01, 0.07, s)) * (1 - smoothstep(0.34, 0.5, s)) : 0) },
    { type: 'shrub', density: 7200, scale: [0.5, 1.15], maxSlope: 0.34, wash: 0.75, mask: (x, z) => 0.6 * smoothstep(-0.25, 0.3, n.fbm(x / 170 + 9, z / 170, 3)) },
  ],
  clearings: [
    [-1500, 820, 70],
    [STATION[0], STATION[2], 50],
  ],
  nodes: NODES,
  legs: [
    {
      to: 'cm-station',
      paths: [
        { id: 'canyon', label: '峡谷内低空', detail: '下降进入峡谷，沿蜿蜒的谷底前进：弯道连续、窄峡有阵风，需要提前减速', tag: 'short', nodes: canyonNodes.map((x) => x.id) },
        { id: 'rim', label: '高处绕行', detail: '在台地上空直线飞行，开阔但高处风大，最后需要垂直下降约 240 m 进入峡谷', tag: 'safe', nodes: ['c-r1', 'c-r2', 'c-r3'] },
      ],
    },
    { to: 'cm-sensors', paths: [{ id: 'main', label: '下游峡谷', detail: '', tag: 'main', nodes: sensorLeg.map((x) => x.id) }] },
    {
      to: 'cm-ledge',
      paths: [
        { id: 'arch', label: '穿越岩拱峡', detail: '低空穿过狭窄峡口和大岩拱下方：距离短，有护盾奖励，峡口阵风有规律', tag: 'short', nodes: archNodes.map((x) => x.id) },
        { id: 'rim', label: '东缘高空绕行', detail: '垂直爬出峡谷沿台地飞行，较长但没有狭窄通道，途经护林站维修坪', tag: 'safe', nodes: ['c-b1', 'c-b2', 'c-b3'] },
      ],
    },
    { to: 'cm-mesa', paths: [{ id: 'main', label: '天空台地', detail: '', tag: 'main', nodes: ['c-m1', 'c-m2'] }] },
  ],
  mission: {
    startCargo: 2,
    main: [
      { id: 'cm-station', kind: 'land', title: '向谷底研究站运送补给', detail: '研究站位于两条峡谷的汇流口，四周是阶梯状峭壁。提前减速，垂直下降并卸货。', padId: 'C-station', dwell: 4, cargo: 'unload', approach: [STATION[0], STATION[1] + 55, STATION[2]] },
      {
        id: 'cm-sensors',
        kind: 'inspect',
        title: '巡查下游传感器',
        detail: '沿峡谷依次低速飞过 3 个传感器桩（速度 < 25 m/s，半径 32 m 内）。',
        points: S_SENS.map((s, i) => ({ pos: MAINP.point(s, floorAt(s) + 36), radius: 32, label: `传感器 ${'ABC'[i]}` })),
        maxSpeed: 25,
        approach: MAINP.point(S_SENS[0], floorAt(S_SENS[0]) + 40),
        route: MAINP.nodes('r', S_SENS[0], S_SENS[2], 90, (s) => floorAt(s) + 36, { label: '' }).map((x) => x.pos),
      },
      {
        id: 'cm-ledge',
        kind: 'hover',
        title: '在峭壁岩架投放设备',
        detail: '岩架位于峭壁中段。在岩架上方 5–12 m 稳定悬停 5 秒放下设备，注意旋翼与峭壁的距离。',
        center: LEDGE,
        radius: 9,
        minH: 5,
        maxH: 12,
        duration: 5,
        maxSpeed: 1.5,
        cargo: 'drop',
        approach: [LEDGE[0] - LEDGE_N[0] * 30, LEDGE[1] + 30, LEDGE[2] - LEDGE_N[1] * 30],
      },
      { id: 'cm-mesa', kind: 'land', title: '降落在天空台地研究站', detail: '台地高出周围约 150 m，顶部风大，背风侧有下沉气流。精确降落。', padId: 'C-mesa', dwell: 3, approach: [MESA[0], MESA[1] + 38, MESA[2]] },
    ],
    optional: [
      {
        id: 'co-arch',
        kind: 'inspect',
        title: '穿越大岩拱',
        detail: '以低于 30 m/s 的速度从大岩拱下方穿过。',
        points: [{ pos: [ARCH_X, LOW(S_ARCH), ARCH_Z], radius: 24, label: '岩拱下方' }],
        maxSpeed: 30,
        approach: [ARCH_X, LOW(S_ARCH), ARCH_Z],
      },
      { id: 'co-view', kind: 'land', title: '石林观景台降落', detail: '降落在石林边缘的观景台（停稳 3 秒）。', padId: 'C-view', dwell: 3, approach: [-760, 345, 160] },
    ],
  },
  pickups: [
    { id: 'cb1', kind: 'boost', pos: canyonNodes[2].pos, note: '峡谷路线弯道' },
    { id: 'cs1', kind: 'shield', pos: [ARCH_X, LOW(S_ARCH), ARCH_Z], note: '岩拱下方（危险捷径奖励）' },
    { id: 'cr1', kind: 'repair', pos: [-640, 380, 60], note: '高处绕行路线' },
    { id: 'cr2', kind: 'repair', pos: sensorLeg[0].pos, note: '巡查前' },
    { id: 'cb2', kind: 'boost', pos: [Math.round(LEDGE[0] - LEDGE_N[0] * 20), 300, Math.round(LEDGE[2] - LEDGE_N[1] * 20)], note: '长距离爬升途中的动力补给' },
  ],
  windZones: [
    { id: 'c-v1', name: '峡谷顺谷风', a: MAINP.at(S_ENTRY), b: MAINP.at(S_CONF - 600), radius: 150, feather: 110, yMax: 280, kind: 'channel', dirFrom: 245, speed: 8 },
    { id: 'c-narrows', name: '窄峡阵风', a: [-860, 470], b: [-380, 450], radius: 110, feather: 80, kind: 'gust', gust: { amp: 7, period: 10, dirFrom: 270 } },
    { id: 'c-v2', name: '下游顺谷风', a: MAINP.at(S_STATION + 200), b: MAINP.at(S_SENS[2]), radius: 150, feather: 110, yMax: 280, kind: 'channel', dirFrom: 280, speed: 8 },
    { id: 'c-gorge', name: '岩拱峡口阵风', a: MAINP.at(S_ARCH - 200), b: MAINP.at(S_ARCH + 200), radius: 100, feather: 80, kind: 'gust', gust: { amp: 6, period: 9, phase: 3, dirFrom: 230 } },
    { id: 'c-rim', name: '台地高空风', a: [-1400, 700], b: [900, -900], radius: 650, feather: 300, yMin: 320, kind: 'channel', dirFrom: 255, speed: 12 },
    { id: 'c-lift', name: '台地迎风坡上升气流', a: [MESA[0] - 260, MESA[2] - 40], b: [MESA[0] - 230, MESA[2] + 120], radius: 90, feather: 80, kind: 'lift', vertical: 3 },
    { id: 'c-sink', name: '台地背风下沉气流', a: [MESA[0] + 230, MESA[2] - 40], b: [MESA[0] + 210, MESA[2] + 120], radius: 110, feather: 90, kind: 'lift', vertical: -3 },
  ],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '晴朗干燥，西风 5 m/s。', params: makeWeather({ windDirFrom: 260, windSpeed: 5, gustAmp: 1.2, cloudCover: 0.15, visibility: 14000 }) },
    { id: 'gusty', label: '局部阵风', kind: 'wind', desc: '峡谷窄口与岩拱处阵风增强（有规律，约每 10 秒一次），注意 HUD 阵风预警。', params: makeWeather({ windDirFrom: 250, windSpeed: 7, gustAmp: 3, zoneScale: 1.5, cloudCover: 0.35, visibility: 11000 }) },
    { id: 'windy', label: '山谷大风', kind: 'wind', desc: '西南风 11 m/s，台地顶部更强，空气中有扬尘。', params: makeWeather({ windDirFrom: 235, windSpeed: 11, gustAmp: 4.5, zoneScale: 1.3, cloudCover: 0.4, overcast: 0.15, visibility: 5500 }) },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0xd2a66e,
    grass: 0xa58a5c,
    grass2: 0xb49866,
    dirt: 0xbf8550,
    rock: 0xb05a3c,
    rock2: 0x7e3a28,
    snow: 0xf0f0f0,
    strata: 1,
    strataColors: [0xb85f3e, 0xd9935c, 0x9a4630, 0xe6c08a],
    beachTop: -100,
    snowLine: 9999,
    rockSlope: 0.3,
    waterDeep: 0x2a4a5a,
    waterShallow: 0x5a8a8a,
    fogTint: 0xe6cfb4,
    forestFloor: 0x7a6a48,
    mist: 0.5,
    wash: 0xdcc39a,
  },
  sun: [220, 34],
  ambience: { wind: 0.9, birds: 0.15 },
  landmarks: [
    { name: '大岩拱', pos: [ARCH_X, 140, ARCH_Z] },
    { name: '天空台地', pos: MESA },
    { name: '石林', pos: [-640, 300, 220] },
  ],
  vistas: [
    { name: '峡谷深处', at: [-949, 100, 626], look: [-805, 457] },
    { name: '石林与远方的台地', at: [-1150, 100, 520], look: [-640, 60] },
    { name: '大岩拱', at: [802, 100, -603], look: [783, -712] },
    { name: '天空台地', at: [783, 100, -712], look: [771, -850] },
    { name: '河流转弯处', at: [-594, 100, 441], look: [-378, 440] },
  ],
  briefing: [
    '峡谷内风小但弯道连续、通道狭窄；台地上空开阔但风大。高速进入急弯会冲出航线——注意 HUD 的转弯预告并提前减速。',
    '阵风是有节奏的（约每 9–10 秒一次），HUD 会提前 2–3 秒提示“阵风将至”。',
    '高原海拔约 1500–2000 m，空气稍稀薄，可用动力略低于海平面。',
  ],
  estMinutes: [9, 11],
};
