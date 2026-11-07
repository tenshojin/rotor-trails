// 地图一：日本海湾与群岛（濑户内海风格）。海岸、港口、群岛、灯塔、海上平台，基础驾驶与精确着陆。

import { Perlin2 } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { MapDef } from './types';

const SEED = 2101;
/** 港口岸壁的 X 坐标 */
const QUAY_X = -925;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 7);
const n3 = new Perlin2(SEED + 13);
/** 森林区（0..1）：濑户内海的岛和山坡几乎被常绿林盖满，只有海边、平地和零星的空地露出地面 */
const forestRaw = (x: number, z: number) => 0.5 + 0.5 * n3.fbm(x / 650, z / 650, 3);
const forest = (x: number, z: number, h: number) => smoothstep(0.24, 0.36, forestRaw(x, z)) * smoothstep(5, 13, h);
/** 林缘：森林区边上灌木最多 */
const forestEdge = (x: number, z: number, h: number) => {
  const f = smoothstep(0.24, 0.42, forestRaw(x, z)) * smoothstep(4, 11, h);
  return f * (1 - f) * 4;
};

/** 海岸线（大陆在西侧）：z → x */
const COAST: Array<[number, number]> = [
  [-2200, -700],
  [-1600, -760],
  [-1150, -880],
  [-650, -920],
  [-200, -880],
  [200, -840],
  [600, -905],
  [900, -930],
  [1300, -990],
  [1700, -1070],
  [2200, -1150],
];

function coastX(z: number): number {
  let x = COAST[0][1];
  for (let i = 1; i < COAST.length; i++) {
    if (z <= COAST[i][0]) {
      const t = (z - COAST[i - 1][0]) / (COAST[i][0] - COAST[i - 1][0]);
      x = COAST[i - 1][1] + (COAST[i][1] - COAST[i - 1][1]) * (t * t * (3 - 2 * t));
      break;
    }
    x = COAST[i][1];
  }
  // 地图外面海岸线也不是一条直线（从高处能一直看到几十公里外）
  const beyond = smoothstep(2200, 3400, Math.abs(z));
  // 海湾和岬角（港口、海岸维修站两处的岸线不动）
  const bays = smoothstep(260, 620, Math.abs(z - 880)) * smoothstep(140, 420, Math.abs(z + 1000));
  return x + 70 * n.fbm(z / 320, 4.2, 3) + 45 * n2.fbm(z / 110, 1.7, 2) + bays * 230 * n2.fbm(z / 640 + 9, 1.3, 3) + beyond * (420 * Math.sin(z / 1500 + 1) + 210 * Math.sin(z / 620));
}

function island(x: number, z: number, cx: number, cz: number, rx: number, rz: number, rot: number, peak: number, sharp = 1.5, wobble = 0.22): number {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = (dx * c + dz * s) / rx;
  const lz = (-dx * s + dz * c) / rz;
  let d = Math.hypot(lx, lz);
  const a = Math.atan2(lz, lx);
  d *= 1 + wobble * n2.noise(Math.cos(a) * 1.6 + cx * 0.003, Math.sin(a) * 1.6 + cz * 0.003);
  if (d >= 1) return -(d - 1) * Math.max(rx, rz) * 0.35;
  const inner = clamp((1 - d) / 0.88, 0, 1);
  const bumps = 0.82 + 0.3 * n.fbm(x / 160, z / 160, 3);
  return 2.6 * smoothstep(1, 0.93, d) + (peak - 2.6) * Math.pow(inner, sharp) * bumps;
}

/** 大陆与海底（不含岛屿），也用作远景地形 */
function mainland(x: number, z: number): number {
  const sea = -42 + 6 * n.fbm(x / 500, z / 500, 3);
  const dw = coastX(z) - x;
  if (dw <= 0) return Math.max(sea, -dw * -0.25);
  let h: number;
  if (dw < 45) h = 2.8 * smoothstep(0, 45, dw);
  else h = 2.8 + Math.min(dw - 45, 320) * 0.17;
  const hills = 200 * Math.pow(n.ridged(x / 700, z / 700, 4), 1.4) * smoothstep(250, 900, dw);
  h += hills + 6 * n.fbm(x / 90, z / 90, 3) * smoothstep(40, 120, dw);
  // 五重塔所在的小山
  h += 55 * Math.max(0, 1 - Math.hypot(x + 1450, z - 540) / 230) ** 2;
  return h;
}

/**
 * 远景：地图外面的陆地。地图里的丘陵大小都差不多，照搬到外面从高处看是一望无际的小鼓包，
 * 这里按大块地分出平原和山地，山地里再起几道大山脊。
 */
function farLand(x: number, z: number): number {
  const h = mainland(x, z);
  if (h <= 6) return h;
  const region = smoothstep(-0.28, 0.32, n.fbm(x / 3000 + 5.3, z / 3000 - 3.1, 3));
  const range = 560 * Math.pow(n.ridged(x / 2500 + 11, z / 2500 + 4, 5), 1.7) * region * smoothstep(350, 1900, coastX(z) - x);
  return 6 + (h - 6) * (0.28 + 0.82 * region) + range;
}

function terrain(x: number, z: number): number {
  let h = mainland(x, z);
  h = Math.max(h, island(x, z, -600, -1475, 330, 135, 0.12, 62)); // 灯塔海角
  h = Math.max(h, island(x, z, -150, -455, 250, 185, 0.3, 58)); // 鸥岛
  h = Math.max(h, island(x, z, 690, 40, 290, 330, 0.15, 232, 1.3)); // 中岛北峰
  h = Math.max(h, island(x, z, 775, 570, 255, 300, -0.2, 186, 1.3)); // 中岛南峰
  h = Math.max(h, island(x, z, 1500, -950, 370, 290, -0.4, 118, 1.2)); // 东岛
  h = Math.max(h, island(x, z, -615, 300, 72, 56, 0.4, 16, 1.2, 0.3)); // 小岛（两岛之间是捷径通道）
  h = Math.max(h, island(x, z, -385, 245, 58, 46, -0.3, 19, 1.2, 0.3));
  h = Math.max(h, island(x, z, -705, 40, 42, 34, 0.0, 6, 1.0, 0.2)); // 鸟居礁
  h = Math.max(h, island(x, z, 1250, 1350, 160, 120, 0.5, 42));
  h = Math.max(h, island(x, z, -250, 1620, 210, 170, 0.2, 64));
  h = Math.max(h, island(x, z, 380, -1350, 170, 130, -0.6, 36));
  h = Math.max(h, island(x, z, 1750, 450, 130, 110, 0.0, 30));
  return h;
}

export const JAPAN: MapDef = {
  id: 'japan',
  name: '濑户湾群岛',
  subtitle: '日本 · 海岸、港口与群岛',
  region: '日本海湾（虚构）',
  description: '从港口起飞，为群岛上的观测站和海上平台运送物资，最终降落在东岛气象站。沿岸航线安全但较长，岛间捷径要穿过两座海蚀柱之间的窄门。',
  difficulty: 1,
  recommendedAssist: 'standard',
  size: 4096,
  res: 1025,
  seed: SEED,
  altitudeOffset: 0,
  waterLevel: 0,
  dissect: { grid: 385, steps: 32, k: 0.03, maxCut: 110 },
  erosion: 150000,
  pavedMask: true,
  buildTerrain(b) {
    b.fill(terrain);
    // 港口填海区与堤岸
    b.flattenRect(-1034, 875, 112, 330, 0, 2.5, 18);
    // 港内水域：岸壁外侧是竖直的码头墙，水深约 7 m
    b.map((h, x, z) => {
      if (x <= QUAY_X - 4 || x > QUAY_X + 200 || z < 500 || z > 1250) return h;
      const k = (1 - smoothstep(QUAY_X + 80, QUAY_X + 200, x)) * smoothstep(505, 560, z) * (1 - smoothstep(1190, 1245, z));
      return h + (Math.min(h, -7) - h) * k;
    });
    // 观测站与停机坪周边
    b.flatten(-150, -462, 30, 46, 25);
    b.flatten(735, 300, 34, 128, 40);
    b.flatten(1555, -975, 32, 96, 35);
    b.flatten(-950, -1000, 22, 14, 25);
    b.flatten(1000, 470, 30, 7.5, 25);
    b.paint(0, (_x, _z, h) => (h < 2.6 && h > -1.5 ? 1 - smoothstep(1.6, 2.6, h) : 0));
    // 港区水泥地面（地表掩码 A 通道，见 terrainShader）
    b.paint(3, (x, z) => smoothstep(-1126, -1120, x) * smoothstep(560, 572, z) * (1 - smoothstep(1188, 1200, z)) * (x < QUAY_X + 4 ? 1 : 0));
    b.paintPath(1, [
      [-1140, 600],
      [-1120, 870],
      [-1150, 1180],
    ], 6, 3, 0.85);
    b.paintPath(1, [
      [-1120, 870],
      [-1330, 760],
      [-1450, 560],
    ], 4, 3, 0.7);
  },
  farTerrain: farLand,
  spawn: { padId: 'J-port', heading: 20 },
  pads: [
    { id: 'J-port', name: '港口直升机坪', pos: [-1060, 2.95, 870], size: 22, kind: 'start', style: 'ground' },
    { id: 'J-A', name: '鸥岛观测站', pos: [-150, 46.45, -462], size: 18, kind: 'delivery', style: 'ground' },
    { id: 'J-B', name: '中岛山脊观测站', pos: [735, 128.45, 300], size: 18, kind: 'delivery', style: 'ground' },
    { id: 'J-C', name: '东岛气象站', pos: [1555, 96.45, -975], size: 18, kind: 'final', style: 'ground' },
    { id: 'J-P', name: '海上平台', pos: [230, 22.4, 1250], size: 20, kind: 'helipad', style: 'platform' },
    { id: 'J-rep1', name: '海岸维修站', pos: [-950, 14.45, -1000], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
    { id: 'J-rep2', name: '东岸渔村维修坪', pos: [1000, 7.95, 470], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
  ],
  props: [
    // 港口
    { type: 'quay', pos: [QUAY_X, 2.5, 875], p: { len: 640 } },
    { type: 'portYard', pos: [QUAY_X, 2.5, 875], p: { len: 620, n: 26 } },
    { type: 'portApron', pos: [QUAY_X, 2.5, 875] },
    { type: 'warehouse', pos: [-1010, 2.5, 640], rotY: 0, p: { w: 22, l: 40, h: 10, model: 'pshed_a' } },
    { type: 'warehouse', pos: [-1080, 2.5, 700], rotY: 0, p: { w: 20, l: 30, h: 8, model: 'pshed_d' } },
    { type: 'warehouse', pos: [-1088, 2.5, 640], rotY: 0, p: { w: 20, l: 30, h: 8, model: 'pshed_c' } },
    { type: 'warehouse', pos: [-1085, 2.5, 760], rotY: 0, p: { w: 18, l: 26, h: 8, model: 'pshed_b' } },
    { type: 'warehouse', pos: [-1010, 2.5, 1110], rotY: 0, p: { w: 24, l: 44, h: 11, model: 'pshed_b' } },
    { type: 'warehouse', pos: [-1085, 2.5, 1160], rotY: 0, p: { w: 18, l: 26, h: 8, model: 'pshed_a' } },
    { type: 'warehouse', pos: [-1010, 2.5, 1010], rotY: 0, p: { w: 22, l: 34, h: 9, model: 'pshed_d' } },
    { type: 'warehouse', pos: [-1090, 2.5, 1060], rotY: 0, p: { w: 20, l: 30, h: 8, model: 'pshed_c' } },
    { type: 'crane', pos: [-938, 2.5, 960], rotY: 0 },
    { type: 'crane', pos: [-938, 2.5, 1120], rotY: 0.2 },
    { type: 'containerStack', pos: [-1000, 2.5, 950], rotY: Math.PI / 2, p: { n: 4 } },
    { type: 'containerStack', pos: [-1036, 2.5, 748], rotY: 0, p: { n: 4 } },
    { type: 'containerStack', pos: [-1036, 2.5, 776], rotY: 0, p: { n: 3 } },
    { type: 'containerStack', pos: [-1062, 2.5, 790], rotY: Math.PI / 2, p: { n: 3 } },
    { type: 'containerStack', pos: [-1040, 2.5, 1048], rotY: 0, p: { n: 3 } },
    { type: 'pier', pos: [-928, 0, 690], p: { len: 95, w: 9 } },
    { type: 'pier', pos: [-928, 0, 880], p: { len: 110, w: 12 } },
    { type: 'pier', pos: [-928, 0, 1070], p: { len: 90, w: 9 } },
    { type: 'boat', pos: [-860, 0, 715], rotY: 0.05 },
    { type: 'boat', pos: [-875, 0, 665], rotY: -0.1 },
    { type: 'boat', pos: [-850, 0, 1045], rotY: 0.08 },
    { type: 'boat', pos: [-760, 0, 1210], rotY: 1.2 },
    { type: 'boat', pos: [-610, 0, 820], rotY: 2.4 },
    { type: 'ferry', pos: [-850, 0, 920], rotY: 0 },
    { type: 'breakwater', pos: [-905, 0, 1250], rotY: -0.25, p: { len: 170, light: 'hlight_r' } },
    { type: 'breakwater', pos: [-905, 0, 505], rotY: 0.3, p: { len: 150, light: 'hlight_g' } },
    { type: 'flagpole', pos: [-1000, 0, 860], ground: true, p: { color: 'jp' } },
    { type: 'tank', pos: [-1110, 2.5, 625], p: { r: 7, h: 10 } },
    { type: 'tank', pos: [-1110, 2.5, 595], p: { r: 6, h: 9 } },
    // 城镇与地标
    { type: 'jvillage', pos: [-1215, 0, 790], ground: true, p: { r: 105, n: 16 } },
    { type: 'jvillage', pos: [-1240, 0, 1060], ground: true, p: { r: 120, n: 20 } },
    { type: 'jvillage', pos: [-1380, 0, 900], ground: true, p: { r: 110, n: 12 } },
    { type: 'jvillage', pos: [-1310, 0, 420], ground: true, p: { r: 100, n: 9 } },
    { type: 'pagoda', pos: [-1450, 0, 540], ground: true },
    { type: 'shrine', pos: [-1415, 0, 590], rotY: 0.6, ground: true },
    { type: 'torii', pos: [-655, -1.5, 40], rotY: Math.PI / 2 },
    { type: 'lighthouse', pos: [-372, 0, -1478], ground: true },
    // 鞆之浦式的常夜灯：从港口停机坪朝东走到岸边，立在码头上，前面是下到海里的雁木石阶
    { type: 'joyato', pos: [-1060, 0, 820], ground: true, p: { dir: 90 } },
    { type: 'jvillage', pos: [-820, 0, -1080], ground: true, p: { r: 90, n: 7 } },
    { type: 'hangar', pos: [-985, 0, -1040], rotY: 0.2, ground: true, p: { w: 16, l: 20, h: 7 } },
    // 群岛
    { type: 'seaStack', pos: [-362, 0, -62], p: { h: 38, r: 9 } },
    { type: 'seaStack', pos: [-288, 0, -28], p: { h: 33, r: 8 } },
    { type: 'seaStack', pos: [-140, 0, 120], p: { h: 24, r: 7 } },
    { type: 'obsStation', pos: [-120, 0, -440], rotY: 0.4, ground: true },
    { type: 'obsStation', pos: [755, 0, 275], rotY: -0.3, ground: true },
    { type: 'antenna', pos: [690, 0, 30], ground: true, p: { h: 28 } },
    { type: 'jvillage', pos: [1050, 0, 420], ground: true, p: { r: 90, n: 11 } },
    { type: 'hangar', pos: [990, 0, 505], rotY: 0.1, ground: true, p: { w: 14, l: 18, h: 6 } },
    { type: 'boat', pos: [1110, 0, 470], rotY: 0.3 },
    { type: 'boat', pos: [1120, 0, 380], rotY: -0.4 },
    { type: 'obsStation', pos: [1528, 0, -1000], rotY: 0.8, ground: true },
    { type: 'antenna', pos: [1590, 0, -1005], ground: true, p: { h: 22 } },
    { type: 'boulders', pos: [-150, 0, -540], ground: true, p: { n: 8, spread: 25, r: 3, color: 0x6e665c } },
  ],
  // 植被参照濑户内海沿岸：山坡上是成片的松林与常绿阔叶林（森林区由大尺度噪声划出），
  // 海边零星的黑松，村子、海岸与平地保持开阔；林缘与空地上灌木较多。
  vegetation: [
    { type: 'pine', density: 520, scale: [0.8, 1.35], minH: 3, maxSlope: 0.5, mask: (x, z, h) => (h > 3 ? 0.4 + 0.4 * n.fbm(x / 220, z / 220, 2) : 0) },
    { type: 'pine', density: 5200, scale: [0.85, 1.5], minH: 8, maxSlope: 0.6, mask: (x, z, h) => forest(x, z, h) * 0.8 },
    { type: 'broadleaf', density: 6200, scale: [0.9, 1.6], minH: 12, maxSlope: 0.55, mask: (x, z, h) => forest(x, z, h) * (h > 30 ? 1 : 0.6) },
    { type: 'broadleaf', density: 260, scale: [0.85, 1.3], minH: 10, maxSlope: 0.38, mask: (x, z) => 0.3 + 0.5 * n2.fbm(x / 300, z / 300, 2) },
    { type: 'shrub', density: 700, scale: [0.7, 1.4], minH: 3, maxSlope: 0.6, mask: (x, z, h) => 0.35 + 0.65 * forestEdge(x, z, h) },
    // 岬角下面的礁石：一段段的，不是整圈海岸都有
    { type: 'boulder', density: 2600, scale: [0.35, 2.2], maxH: 6, maxSlope: 0.7, mask: (x, z) => smoothstep(0.5, 0.62, 0.5 + 0.5 * n2.fbm(x / 120, z / 120, 2)) },
  ],
  clearings: [
    [-1030, 720, 170],
    [-1030, 1020, 180],
    [-1060, 870, 60],
    [-1450, 540, 40],
    [-372, -1478, 30],
  ],
  nodes: [
    { id: 'j-c1', pos: [-860, 55, 520], radius: 60, speed: 40, label: '港口北航道' },
    { id: 'j-c2', pos: [-700, 60, -160], radius: 70, speed: 45, label: '西海岸' },
    { id: 'j-c3', pos: [-800, 70, -820], radius: 70, speed: 40, label: '海岸维修站', checkpoint: true },
    { id: 'j-c4', pos: [-480, 75, -1180], radius: 70, speed: 40, label: '灯塔海角' },
    { id: 'j-c5', pos: [-290, 75, -820], radius: 70, speed: 35, label: '鸥岛北侧' },
    { id: 'j-s1', pos: [-640, 50, 600], radius: 50, speed: 35, label: '离港' },
    { id: 'j-s2', pos: [-500, 36, 285], radius: 40, speed: 30, label: '小岛水道' },
    { id: 'j-s3', pos: [-325, 30, -45], radius: 22, speed: 20, label: '海蚀柱窄门', clearance: 20 },
    { id: 'j-p1', pos: [-10, 60, -120], radius: 70, speed: 45, label: '离岛航线' },
    { id: 'j-p2', pos: [110, 55, 600], radius: 70, speed: 45, label: '外海', checkpoint: true },
    { id: 'j-r1', pos: [470, 85, 830], radius: 60, speed: 30, label: '中岛南坡' },
    { id: 'j-r2', pos: [615, 150, 525], radius: 55, speed: 25, label: '南峰山肩', checkpoint: true },
    { id: 'j-e1', pos: [720, 55, 1040], radius: 70, speed: 40, label: '中岛南岸' },
    { id: 'j-e2', pos: [1160, 60, 700], radius: 70, speed: 40, label: '东岸渔村', checkpoint: true },
    { id: 'j-e3', pos: [1010, 120, 300], radius: 60, speed: 30, label: '东侧山谷' },
    { id: 'j-f0', pos: [1010, 160, 250], radius: 70, speed: 40, label: '中岛东侧' },
    { id: 'j-f1', pos: [1170, 140, -230], radius: 70, speed: 45, label: '北航线' },
    { id: 'j-f2', pos: [1340, 135, -650], radius: 70, speed: 40, label: '东岛西侧', checkpoint: true },
  ],
  legs: [
    {
      to: 'jm-a',
      paths: [
        { id: 'coast', label: '沿岸安全航线', detail: '沿大陆海岸北上绕过海角，较长但开阔，途经海岸维修站', tag: 'safe', nodes: ['j-c1', 'j-c2', 'j-c3', 'j-c4', 'j-c5'] },
        { id: 'islets', label: '岛间捷径', detail: '穿过小岛群与两座海蚀柱之间的窄门，距离短一半，有动力和护盾补给', tag: 'short', nodes: ['j-s1', 'j-s2', 'j-s3'] },
      ],
    },
    { to: 'jm-p', paths: [{ id: 'main', label: '外海航线', detail: '', tag: 'main', nodes: ['j-p1', 'j-p2'] }] },
    {
      to: 'jm-b',
      paths: [
        { id: 'ridge', label: '越岭直飞', detail: '翻越南峰山肩直达观测站：距离短，需要持续爬升，山脊有阵风', tag: 'short', nodes: ['j-r1', 'j-r2'] },
        { id: 'coast', label: '绕岛东岸', detail: '沿南岸与东岸低空飞行，经过渔村维修坪，再从东侧山谷爬升', tag: 'safe', nodes: ['j-e1', 'j-e2', 'j-e3'] },
      ],
    },
    { to: 'jm-c', paths: [{ id: 'main', label: '北航线', detail: '', tag: 'main', nodes: ['j-f0', 'j-f1', 'j-f2'] }] },
  ],
  mission: {
    startCargo: 3,
    main: [
      { id: 'jm-a', kind: 'land', title: '向鸥岛观测站运送物资', detail: '降落在鸥岛观测站停机坪并卸下第一箱物资（停稳 4 秒）。', padId: 'J-A', dwell: 4, cargo: 'unload', approach: [-150, 85, -462] },
      {
        id: 'jm-p',
        kind: 'hover',
        title: '向海上平台投放物资',
        detail: '在平台甲板上方 6–15 m 稳定悬停 6 秒，用绞车放下物资（水平速度 < 1.5 m/s）。',
        center: [230, 22.4, 1250],
        radius: 8,
        minH: 6,
        maxH: 15,
        duration: 6,
        maxSpeed: 1.5,
        cargo: 'drop',
        approach: [230, 50, 1250],
      },
      { id: 'jm-b', kind: 'land', title: '向中岛山脊观测站运送物资', detail: '观测站位于两座山峰之间的鞍部，常有侧风与阵风。安全降落并卸货。', padId: 'J-B', dwell: 4, cargo: 'unload', approach: [735, 170, 300] },
      { id: 'jm-c', kind: 'land', title: '降落在东岛气象站', detail: '最终目标：在悬崖顶的气象站停机坪精确降落。', padId: 'J-C', dwell: 3, approach: [1555, 135, -975] },
    ],
    optional: [
      {
        id: 'jo-lh',
        kind: 'inspect',
        title: '巡视海角灯塔',
        detail: '以低于 25 m/s 的速度依次飞过灯塔周围的三个巡查点。',
        points: [
          { pos: [-450, 60, -1450], radius: 28, label: '灯塔西侧' },
          { pos: [-372, 60, -1400], radius: 28, label: '灯塔南侧' },
          { pos: [-300, 60, -1490], radius: 28, label: '灯塔东侧' },
        ],
        maxSpeed: 25,
        approach: [-372, 60, -1400],
      },
      {
        id: 'jo-torii',
        kind: 'hover',
        title: '拍摄海上鸟居',
        detail: '在海上鸟居附近 45 m 内、海面以上 6–40 m 低速悬停 4 秒。',
        center: [-655, 0, 40],
        radius: 45,
        minH: 6,
        maxH: 40,
        duration: 4,
        maxSpeed: 3,
        approach: [-655, 35, 40],
      },
    ],
  },
  pickups: [
    { id: 'jb1', kind: 'boost', pos: [-500, 36, 285], note: '岛间捷径水道' },
    { id: 'js1', kind: 'shield', pos: [-325, 30, -45], note: '海蚀柱窄门（危险捷径的奖励）' },
    { id: 'jr1', kind: 'repair', pos: [110, 55, 600], note: '外海航线上的维修补给' },
    { id: 'jb2', kind: 'boost', pos: [720, 55, 1040], note: '绕岛东岸' },
    { id: 'js2', kind: 'shield', pos: [615, 150, 525], note: '越岭山肩' },
    { id: 'jr2', kind: 'repair', pos: [1170, 140, -230], note: '最后航段前' },
  ],
  windZones: [
    { id: 'j-gate', name: '海蚀柱窄门', a: [-360, 40], b: [-290, -130], radius: 60, feather: 50, kind: 'channel', dirFrom: 165, speed: 9 },
    { id: 'j-ridge', name: '中岛山脊阵风区', a: [600, 560], b: [735, 300], radius: 170, feather: 120, kind: 'gust', gust: { amp: 6, period: 11, dirFrom: 100 } },
    { id: 'j-cape', name: '海角北风', a: [-760, -1300], b: [-260, -1420], radius: 200, feather: 150, kind: 'channel', dirFrom: 20, speed: 8 },
  ],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '晴朗，东南微风 4 m/s，能见度极佳。', params: makeWeather({ windDirFrom: 150, windSpeed: 4, gustAmp: 1, cloudCover: 0.3, visibility: 12000 }) },
    {
      id: 'rain',
      label: '小雨',
      kind: 'lightRain',
      desc: '小雨，阴天，能见度约 3 km，地面湿滑。',
      params: makeWeather({ rain: 0.35, overcast: 0.65, cloudCover: 0.75, visibility: 3200, windDirFrom: 160, windSpeed: 6, gustAmp: 2, wetness: 0.8 }),
    },
    { id: 'breeze', label: '海风', kind: 'wind', desc: '东南海风 9 m/s，伴有阵风，适合练习侧风修正。', params: makeWeather({ windDirFrom: 125, windSpeed: 9, gustAmp: 3.5, cloudCover: 0.45, zoneScale: 1.3, visibility: 9000 }) },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0xd6c69c,
    grass: 0x4d7836,
    grass2: 0x6a8a42,
    dirt: 0x8a7556,
    rock: 0x7f776a,
    rock2: 0x5c554d,
    snow: 0xf0f2f4,
    strata: 0,
    beachTop: 2.6,
    snowLine: 9999,
    air: 1.7,
    rockSlope: 0.4,
    waterDeep: 0x123f5e,
    waterShallow: 0x2a8a96,
    fogTint: 0xbdd2de,
    forestFloor: 0x2f4a26,
    mist: 1.3,
  },
  sun: [235, 38],
  ambience: { sea: 1, gulls: 0.6, wind: 0.25 },
  birds: { gull: 18, kite: 7 },
  landmarks: [
    { name: '五重塔', pos: [-1450, 60, 540] },
    { name: '海角灯塔', pos: [-372, 30, -1478] },
    { name: '海上鸟居', pos: [-655, 5, 40] },
  ],
  vistas: [
    { name: '内海的岛', at: [-300, 70, 300], look: [400, -500] },
    { name: '海岸全景', at: [900, 300, 200], look: [-2100, -300] },
    { name: '五重塔', at: [-1169, 90, 435], look: [-1450, 540] },
    { name: '海角灯塔', at: [-299, 90, -1187], look: [-372, -1478] },
    { name: '海上鸟居', at: [-356, 90, 22], look: [-655, 40] },
  ],
  briefing: [
    '作为第一关，这张地图的航线开阔、风力温和，适合熟悉起飞、加速、转弯、悬停和精确着陆。',
    '机上共有 3 箱物资（每箱 140 kg），载重会让悬停和爬升需要更多动力；每卸下一箱，飞机都会变轻。',
  ],
  estMinutes: [8, 10],
};
