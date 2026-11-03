// 地图三：巴西亚马孙雨林。茂密树冠、宽阔主河道、狭窄支流、牛轭湖、河边营地、林间空地、暴雨。

import { Perlin2 } from '../core/noise';
import { smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { Vec2 } from '../sim/terrain';
import { PathSampler } from './routeUtil';
import type { MapDef, RouteNodeDef, V3 } from './types';

const SEED = 4401;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 5);

const RIVER: Vec2[] = [
  [-2200, 380],
  [-1750, 520],
  [-1320, 300],
  [-900, 540],
  [-480, 360],
  [-120, 540],
  [230, 320],
  [470, 40],
  [800, -90],
  [1160, -170],
  [1500, -40],
  [1860, -280],
  [2200, -220],
];
const TRIB: Vec2[] = [
  [-200, -1700],
  [40, -1250],
  [210, -930],
  [400, -700],
  [640, -560],
  [820, -360],
  [960, -150],
];
const OXBOW: Vec2[] = [
  [-60, 780],
  [140, 930],
  [400, 900],
  [500, 730],
];
const CREEK: Vec2[] = [
  [-900, 2200],
  [-760, 1500],
  [-640, 1000],
  [-520, 420],
];

const RP = new PathSampler(RIVER);
const TP = new PathSampler(TRIB);
const riverHalf = (s: number) => 92 + 30 * Math.sin(s / 520 + 0.7) + 14 * n.noise(s / 300, 2.2);
const tribHalf = (s: number) => 34 + 6 * Math.sin(s / 260);

function base(x: number, z: number): number {
  const hills = 70 * Math.pow(Math.max(0, n.fbm(x / 900 + 3, z / 900 - 2, 4) + 0.15), 1.5);
  return 14 + 7 * n.fbm(x / 260, z / 260, 4) + hills + 3 * n2.fbm(x / 60, z / 60, 2);
}

function nrm(p: PathSampler, s: number): Vec2 {
  const a = p.at(s - 6);
  const b = p.at(s + 6);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
}

/** 河岸边一点（side = 1 / -1，offset = 离岸距离） */
function bank(p: PathSampler, half: (s: number) => number, s: number, side: number, offset: number, y: number): V3 {
  const c = p.at(s);
  const nn = nrm(p, s);
  const d = half(s) + offset;
  return [Math.round(c[0] + nn[0] * d * side), y, Math.round(c[1] + nn[1] * d * side)];
}

const S_A = RP.arcOf(-480, 360);
const CAMP_A = bank(RP, riverHalf, S_A, -1, 34, 0);
const S_VIL = RP.arcOf(560, 0);
const VILLAGE = bank(RP, riverHalf, S_VIL, 1, 40, 0);
const S_BOAT = RP.arcOf(1160, -170);
const BOAT = RP.point(S_BOAT, 0);
const S_B = TP.arcOf(400, -700);
const CLEAR_B = bank(TP, tribHalf, S_B, 1, 55, 0);
const FINAL: V3 = [1560, 0, -820];
const START = bank(RP, riverHalf, RP.arcOf(-1750, 520), -1, 40, 0);

// ---------- 航点 ----------
const CRUISE = 110;
const riverNodes = RP.nodes('a-r', RP.arcOf(-1650, 470), S_A - 220, 260, () => 34, { label: '主河道', radius: 60, speed: 32, clearance: 20 });
riverNodes[Math.floor(riverNodes.length / 2)].checkpoint = true;
const tribNodes = TP.nodes('a-t', S_B + 90, TP.len - 120, 100, () => 22, { label: '狭窄支流', radius: 32, speed: 18, clearance: 12 });
tribNodes[0].label = '支流入口';
tribNodes[0].checkpoint = true;

const NODES: RouteNodeDef[] = [
  { id: 'a-up', pos: [START[0], 78, START[2]], radius: 40, speed: 10, label: '垂直爬升离开营地' },
  { id: 'a-up2', pos: [CLEAR_B[0], 95, CLEAR_B[2]], radius: 35, speed: 8, label: '垂直爬升出空地' },
  { id: 'a-up1', pos: [CAMP_A[0], 90, CAMP_A[2]], radius: 40, speed: 10, label: '爬升离开营地' },
  { id: 'a-tin', pos: [tribNodes[0].pos[0], 75, tribNodes[0].pos[2]], radius: 35, speed: 8, label: '下降进入支流' },
  ...riverNodes,
  { id: 'a-c1', pos: [-1250, CRUISE + 10, 380], radius: 70, speed: 40, label: '林冠上空' },
  { id: 'a-c2', pos: [-850, CRUISE + 10, 300], radius: 70, speed: 40, label: '林冠上空', checkpoint: true },
  { id: 'a-m1', pos: [-200, CRUISE, 150], radius: 70, speed: 40, label: '河湾' },
  { id: 'a-m2', pos: [150, CRUISE, -350], radius: 70, speed: 35, label: '支流上空', checkpoint: true },
  ...tribNodes,
  { id: 'a-o1', pos: [CLEAR_B[0] + 200, CRUISE + 8, CLEAR_B[2] + 60], radius: 70, speed: 40, label: '林冠上空' },
  { id: 'a-o2', pos: [800, CRUISE + 8, -280], radius: 70, speed: 40, label: '林冠上空', checkpoint: true },
  { id: 'a-f1', pos: [BOAT[0] + 120, CRUISE, BOAT[2] - 120], radius: 70, speed: 35, label: '离开河道', checkpoint: true },
  { id: 'a-f2', pos: [1450, CRUISE + 5, -650], radius: 60, speed: 30, label: '观测塔附近' },
];

export const AMAZON: MapDef = {
  id: 'amazon',
  name: '雨林河湾',
  subtitle: '巴西 · 亚马孙雨林',
  region: '亚马孙流域（虚构）',
  description: '沿着蜿蜒的大河为科考营地运送物资：在林间小空地垂直起降、在科考船上方悬停投放，最后降落在高出树冠的观测平台。暴雨会让能见度骤降。',
  difficulty: 3,
  recommendedAssist: 'standard',
  size: 4096,
  res: 1025,
  seed: SEED,
  altitudeOffset: 60,
  waterLevel: 0,
  buildTerrain(b) {
    b.fill(base);
    const river = (p: Vec2[], half: (s: number) => number, depth: number, bankW: number) =>
      b.applySpline(p, 260, (h, d, s) => {
        const w = half(s);
        if (d > w + bankW) return h;
        if (d < w) return Math.min(h, -depth * (1 - Math.pow(d / w, 2)) - 0.5);
        const t = (d - w) / bankW;
        return Math.min(h, -0.5 + (h + 0.5) * smoothstep(0, 1, t));
      });
    river(RIVER, riverHalf, 9, 26);
    river(TRIB, tribHalf, 4, 14);
    river(OXBOW, () => 42, 5, 16);
    river(CREEK, () => 18, 3, 12);
    // 沙洲与河岸
    b.paint(0, (x, z, h) => (h > -0.5 && h < 2.5 ? 1 - smoothstep(1.2, 2.5, h) : 0));
    b.paint(0, (x, z, h) => (h > 2 && h < 8 ? 0.35 * (1 - smoothstep(4, 8, h)) * (0.5 + 0.5 * n.noise(x / 40, z / 40)) : 0));
  },
  farTerrain: base,
  spawn: { padId: 'A-base', heading: 80 },
  pads: [
    { id: 'A-base', name: '河岸基地', pos: [START[0], 5.45, START[2]], size: 20, kind: 'start', style: 'ground' },
    { id: 'A-camp', name: '河湾科考营地', pos: [CAMP_A[0], 4.45, CAMP_A[2]], size: 18, kind: 'delivery', style: 'ground' },
    { id: 'A-clear', name: '林间空地营地', pos: [CLEAR_B[0], 8.45, CLEAR_B[2]], size: 13, kind: 'delivery', style: 'ground' },
    { id: 'A-village', name: '河畔村庄维修坪', pos: [VILLAGE[0], 5.45, VILLAGE[2]], size: 16, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 2 } },
    { id: 'A-final', name: '林冠观测平台', pos: [FINAL[0], 38.4, FINAL[2]], size: 14, kind: 'final', style: 'raised' },
  ],
  props: [
    { type: 'camp', pos: [START[0], 0, START[2]], ground: true, p: { r: 45, n: 6 } },
    { type: 'dock', pos: [START[0] + 30, 0, START[2] + 40], rotY: 0.6 },
    { type: 'canoe', pos: [START[0] + 50, 0.1, START[2] + 60], rotY: 0.8 },
    { type: 'camp', pos: [CAMP_A[0], 0, CAMP_A[2]], ground: true, p: { r: 38, n: 5 } },
    { type: 'antenna', pos: [CAMP_A[0] - 30, 0, CAMP_A[2] + 25], ground: true, p: { h: 18 } },
    { type: 'camp', pos: [CLEAR_B[0], 0, CLEAR_B[2]], ground: true, p: { r: 20, n: 3 } },
    { type: 'camp', pos: [VILLAGE[0], 0, VILLAGE[2]], ground: true, p: { r: 55, n: 8 } },
    { type: 'riverBoat', pos: [BOAT[0], 0.3, BOAT[2]], rotY: Math.atan2(-(RP.at(S_BOAT + 10)[1] - BOAT[2]), RP.at(S_BOAT + 10)[0] - BOAT[0]) },
    { type: 'canoe', pos: [VILLAGE[0] - 40, 0.1, VILLAGE[2] - 30], rotY: 1.2 },
    { type: 'canoe', pos: [VILLAGE[0] - 55, 0.1, VILLAGE[2] - 20], rotY: 1.5 },
    { type: 'canopyTower', pos: [FINAL[0] + 26, 0, FINAL[2] + 18], ground: true, p: { h: 52 } },
    { type: 'flagpole', pos: [START[0] - 20, 0, START[2] - 18], ground: true, p: { color: 'br', h: 10 } },
  ],
  vegetation: [
    {
      type: 'canopy',
      density: 1700,
      scale: [0.8, 1.25],
      minH: 2.5,
      maxSlope: 0.5,
      mask: (x, z) => 0.75 + 0.25 * n.fbm(x / 200, z / 200, 2),
    },
    { type: 'emergent', density: 32, scale: [0.85, 1.15], minH: 4, maxSlope: 0.3 },
    { type: 'palm', density: 260, scale: [0.8, 1.3], minH: 1.5, maxH: 9, maxSlope: 0.4 },
    { type: 'broadleaf', density: 200, scale: [0.9, 1.4], minH: 2, maxH: 12, maxSlope: 0.4 },
  ],
  clearings: [
    [START[0], START[2], 70],
    [CAMP_A[0], CAMP_A[2], 55],
    [CLEAR_B[0], CLEAR_B[2], 24],
    [VILLAGE[0], VILLAGE[2], 75],
    [FINAL[0], FINAL[2], 32],
  ],
  nodes: NODES,
  legs: [
    {
      to: 'am-camp',
      paths: [
        { id: 'river', label: '沿主河道', detail: '沿宽阔的主河道低空飞行：最安全，河道是天然的导航线，但弯道多、距离长', tag: 'safe', nodes: ['a-up', ...riverNodes.map((x) => x.id)] },
        { id: 'canopy', label: '林冠直飞', detail: '在树冠上空直线飞行：距离短，但下方没有备降场地，雨天能见度差', tag: 'short', nodes: ['a-up', 'a-c1', 'a-c2'] },
      ],
    },
    { to: 'am-clear', paths: [{ id: 'main', label: '河湾航线', detail: '', tag: 'main', nodes: ['a-up1', 'a-m1', 'a-m2'] }] },
    {
      to: 'am-boat',
      paths: [
        { id: 'trib', label: '狭窄支流', detail: '贴着水面沿蜿蜒支流飞行：两岸树冠很近，弯道急，有动力与护盾补给', tag: 'short', nodes: ['a-up2', 'a-tin', ...tribNodes.map((x) => x.id)] },
        { id: 'canopy', label: '林冠绕行', detail: '爬升到树冠上空飞向主河道，较安全，途经河畔村庄维修坪', tag: 'safe', nodes: ['a-up2', 'a-o1', 'a-o2'] },
      ],
    },
    { to: 'am-final', paths: [{ id: 'main', label: '观测平台', detail: '', tag: 'main', nodes: ['a-f1', 'a-f2'] }] },
  ],
  mission: {
    startCargo: 3,
    main: [
      { id: 'am-camp', kind: 'land', title: '向河湾科考营地运送物资', detail: '营地建在河湾的沙洲旁。降落并卸下第一箱物资。', padId: 'A-camp', dwell: 4, cargo: 'unload', approach: [CAMP_A[0], 55, CAMP_A[2]] },
      { id: 'am-clear', kind: 'land', title: '在林间空地营地降落', detail: '空地很小（停机坪 13 m），四周树冠高约 30 m。在树冠上方悬停对准，再垂直下降。', padId: 'A-clear', dwell: 4, cargo: 'unload', approach: [CLEAR_B[0], 72, CLEAR_B[2]] },
      {
        id: 'am-boat',
        kind: 'hover',
        title: '向科考船投放样本箱',
        detail: '在科考船甲板上方 6–15 m 稳定悬停 6 秒（水平速度 < 1.5 m/s）。',
        center: [BOAT[0], 2.5, BOAT[2]],
        radius: 8,
        minH: 6,
        maxH: 15,
        duration: 6,
        maxSpeed: 1.5,
        cargo: 'drop',
        approach: [BOAT[0], 32, BOAT[2]],
      },
      { id: 'am-final', kind: 'land', title: '降落在林冠观测平台', detail: '平台高出地面 38 m，略高于周围树冠。精确降落在 14 m 的平台上。', padId: 'A-final', dwell: 3, approach: [FINAL[0], 88, FINAL[2]] },
    ],
    optional: [
      {
        id: 'ao-oxbow',
        kind: 'inspect',
        title: '巡查牛轭湖',
        detail: '以低于 25 m/s 的速度飞过牛轭湖上空的两个观测点。',
        points: [
          { pos: [140, 25, 930], radius: 35, label: '牛轭湖西段' },
          { pos: [420, 25, 880], radius: 35, label: '牛轭湖东段' },
        ],
        maxSpeed: 25,
        approach: [140, 40, 930],
      },
      {
        id: 'ao-kapok',
        kind: 'hover',
        title: '观察巨型木棉树',
        detail: '在河湾北岸的巨木林冠上方 8–30 m 悬停 4 秒（巨木高约 55 m）。',
        center: [-250, 52, -120],
        radius: 40,
        minH: 8,
        maxH: 30,
        duration: 4,
        maxSpeed: 3,
        approach: [-250, 100, -120],
      },
    ],
  },
  pickups: [
    { id: 'ar1', kind: 'repair', pos: riverNodes[Math.floor(riverNodes.length / 2)].pos, note: '主河道中段' },
    { id: 'ab1', kind: 'boost', pos: tribNodes[1].pos, note: '狭窄支流' },
    { id: 'as1', kind: 'shield', pos: tribNodes[Math.floor(tribNodes.length / 2)].pos, note: '狭窄支流中段（危险捷径奖励）' },
    { id: 'ar2', kind: 'repair', pos: [800, CRUISE + 8, -280], note: '林冠绕行' },
    { id: 'ab2', kind: 'boost', pos: [1450, CRUISE + 5, -650], note: '观测平台附近' },
  ],
  windZones: [
    { id: 'a-river', name: '河道顺风', a: RP.at(RP.arcOf(-1300, 300)), b: RP.at(S_BOAT), radius: 180, feather: 120, yMax: 120, kind: 'channel', dirFrom: 280, speed: 5 },
    { id: 'a-storm', name: '雷暴下击暴流区', a: [600, -600], b: [1300, -500], radius: 300, feather: 200, kind: 'gust', gust: { amp: 6, period: 14, dirFrom: 40 } },
  ],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '闷热晴朗，微风，远处有积云。', params: makeWeather({ windDirFrom: 90, windSpeed: 2.5, gustAmp: 0.8, cloudCover: 0.45, visibility: 9000, zoneScale: 0.3 }) },
    { id: 'rain', label: '小雨', kind: 'lightRain', desc: '小雨，能见度约 2.5 km，树冠与河面湿润。', params: makeWeather({ rain: 0.4, overcast: 0.7, cloudCover: 0.8, visibility: 2500, windDirFrom: 70, windSpeed: 4, gustAmp: 1.8, wetness: 0.9, zoneScale: 0.6 }) },
    {
      id: 'storm',
      label: '暴雨',
      kind: 'storm',
      desc: '热带暴雨：能见度约 700 m，雷电，阵风 6 m/s。暴雨本身不会扣耐久，但需要降低速度、依靠导航。',
      params: makeWeather({ rain: 1, overcast: 1, cloudCover: 1, visibility: 700, lightning: 0.7, windDirFrom: 40, windSpeed: 7, gustAmp: 4.5, turbulence: 0.9, wetness: 1, zoneScale: 1.2 }),
    },
    {
      id: 'dynamic',
      label: '晴转暴雨',
      kind: 'storm',
      desc: '起飞时晴朗；完成第二个任务后约一分钟内雷暴移入，最后一段在暴雨中飞行。',
      params: makeWeather({ windDirFrom: 90, windSpeed: 2.5, gustAmp: 0.8, cloudCover: 0.5, visibility: 9000, zoneScale: 0.3 }),
      schedule: [{ afterObjective: 2, to: 'storm', duration: 60 }],
    },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0xc9b08a,
    grass: 0x3f6a2a,
    grass2: 0x4f7a30,
    dirt: 0x7a5a3a,
    rock: 0x6a6052,
    rock2: 0x4e463c,
    snow: 0xf0f0f0,
    strata: 0,
    beachTop: 2.2,
    snowLine: 9999,
    rockSlope: 0.55,
    waterDeep: 0x4a3e22,
    waterShallow: 0x7a6a40,
    fogTint: 0xb8c4b0,
    forestFloor: 0x24401c,
  },
  sun: [250, 52],
  ambience: { insects: 1, birds: 0.6, river: 0.6 },
  landmarks: [
    { name: '林冠观测塔', pos: [FINAL[0] + 26, 55, FINAL[2] + 18] },
    { name: '牛轭湖', pos: [250, 0, 880] },
  ],
  briefing: [
    '主河道是最可靠的导航参照。支流狭窄弯曲，两岸树冠离旋翼很近，需要低速飞行。',
    '林间空地只有 13 m 宽：在树冠上方悬停对准后再垂直下降，下降时注意水平漂移。',
    '选择“晴转暴雨”时，雷暴会在中途移入：能见度降到约 700 m，可降低速度、开启悬停辅助等待或依靠 HUD 导航。',
  ],
  estMinutes: [9, 12],
};
