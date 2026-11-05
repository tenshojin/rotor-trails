// 训练场：阿尔卑斯谷地里的小机场。跑道和停机坪在平坦的谷底，四周是牧场和云杉林，一条小河穿过谷底，
// 远处是雪山。用于飞行教学、物理测试，也是主菜单的背景。

import { Perlin2 } from '../core/noise';
import { smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import { PathSampler, riverLine } from './routeUtil';
import type { MapDef } from './types';

const SEED = 101;
const n = new Perlin2(SEED);
const n2 = new Perlin2(SEED + 7);

/** 跑道（x = RW_X，沿 z 方向）的中心和全长 */
const RW_X = -72;
const RW_Z = -130;
const RW_L = 860;

function base(x: number, z: number): number {
  const r = Math.hypot(x, z + 60);
  // 谷底的缓坡 → 牧场 → 林山。训练航线在谷底上空，山要到 700 m 以外才起来
  const roll = 5 * n.fbm(x / 210, z / 210, 3) * smoothstep(300, 640, r);
  const foot = 70 * Math.pow(Math.max(0, n2.fbm(x / 640 + 3, z / 640, 3) + 0.5), 1.5) * smoothstep(560, 1000, r);
  // 坐标扭一下，山脊才不是一个个圆锥；细到几十米的山棱让山坡不再是光滑的一面
  const wx = x + 260 * n2.noise(x / 900, z / 900 + 4);
  const wz = z + 260 * n.noise(x / 900 + 2, z / 900);
  const hills = 340 * Math.pow(n.ridged(wx / 760, wz / 760, 7, 2.05, 0.5, 2.0), 1.45) * smoothstep(760, 1400, r);
  return 10 + roll + foot + hills;
}

/** 地图外面：山一层比一层高，最远的是雪山 */
function far(x: number, z: number): number {
  const r = Math.max(Math.abs(x), Math.abs(z));
  // 先扭一下坐标，山脊才不是一排齐刷刷的尖牙；大块的山体打底，山脊只在山体高的地方才明显
  const wx = x + 900 * n.noise(x / 3100, z / 3100 + 7);
  const wz = z + 900 * n2.noise(x / 3100 + 3, z / 3100);
  const massif = Math.pow(Math.max(0, n.fbm(wx / 4200 + 5, wz / 4200 - 2, 3) + 0.55), 1.4);
  const crest = Math.pow(n.ridged(wx / 2300, wz / 2300, 8, 2.05, 0.5, 2.0), 1.25);
  return base(x, z) + (massif * 1400 + crest * massif * 1500) * smoothstep(1100, 6000, r);
}

/** 小河：从北边的山里下来，绕过机场东边 */
const STREAM = new PathSampler([
  [440, -1400],
  [300, -980],
  [390, -620],
  [270, -300],
  [360, 40],
  [250, 360],
  [330, 720],
  [240, 1040],
  [330, 1400],
]);

/** 教学航线（飞得低）：底下不长高树 */
const LESSON: Array<[number, number]> = [
  [0, -420],
  [-260, -520],
  [-420, -150],
  [-260, -260],
];

/** 机场、跑道和教学航线一带（不长树）：0 = 里面，1 = 离开了 */
function airfield(x: number, z: number): number {
  const dx = Math.max(Math.abs(x - 20) - 150, 0);
  const dz = Math.max(Math.abs(z - RW_Z) - RW_L / 2 - 30, 0);
  let d = Math.hypot(dx, dz);
  for (let i = 0; i + 1 < LESSON.length; i++) {
    const [ax, az] = LESSON[i];
    const [bx, bz] = LESSON[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    d = Math.min(d, Math.max(0, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) - 48));
  }
  return smoothstep(0, 70, d);
}

export const TRAINING: MapDef = {
  id: 'training',
  name: '飞行训练场',
  subtitle: '基础驾驶教学',
  region: '训练基地',
  description: '雪山脚下的谷地小机场。按步骤练习起飞、加速、减速、转向、高度控制、悬停、侧风修正与安全降落。',
  difficulty: 1,
  recommendedAssist: 'novice',
  size: 2048,
  res: 513,
  seed: SEED,
  altitudeOffset: 30,
  waterLevel: null,
  erosion: 240000,
  pavedMask: true,
  buildTerrain(b) {
    b.fill(base);
    // 跑道、停机坪压平
    b.flattenRect(RW_X, RW_Z, 34, RW_L / 2 + 16, 0, 10, 70);
    b.flattenRect(30, 145, 92, 110, 0, 10, 50);
    b.flattenRect(0, -120, 40, 380, 0, 10, 60);
    // 水泥地：跑道、停机坪、连接两头的滑行道
    b.paintRect(3, RW_X, RW_Z, 0, 15, RW_L / 2, 1.2, 1);
    b.paintRect(3, 30, 150, 0, 88, 92, 1.6, 1);
    b.paintRect(2, RW_X, RW_Z, 0, 24, RW_L / 2 + 14, 4, 1);
    b.paintRect(2, 30, 150, 0, 96, 100, 6, 1);
    // 谷底的几块耕地：从空中看是一块块深浅不同的田
    for (const [x, z, rot, hw, hd, k] of [
      [-300, 210, 0.08, 96, 112, 0.5],
      [-300, 470, 0.08, 96, 120, 0.72],
      [320, 470, -0.1, 110, 90, 0.62],
      [300, -420, 0.15, 112, 100, 0.48],
      [-470, -640, 0.3, 80, 120, 0.66],
    ]) {
      b.paintRect(1, x, z, rot, hw, hd, 3, k);
      b.paintRect(2, x, z, rot, hw + 2, hd + 2, 2, 1);
    }
    // 通到停机坪的砂石路
    b.paintPath(1, [[118, 250], [165, 300], [200, 420], [150, 620], [210, 860], [160, 1024]], 3.4, 2.2, 0.85);
    b.paintPath(2, [[118, 250], [165, 300], [200, 420], [150, 620], [210, 860], [160, 1024]], 7, 3, 1);
  },
  farTerrain: far,
  rivers: [
    {
      pts: riverLine(
        STREAM,
        10,
        STREAM.len - 10,
        16,
        (s) => 16 * Math.sin(s / 95) + 9 * Math.sin(s / 41 + 1),
        (s) => 13.2 - (s / STREAM.len) * 7.2,
        (s) => 5.5 + 2.5 * Math.sin(s / 260),
        [],
      ),
      depth: 1.5,
      bank: 14,
      deep: 0x2e5a58,
      shallow: 0x7aa596,
      speed: 1.6,
      bar: 4,
    },
  ],
  spawn: { padId: 'T-start', heading: 0 },
  pads: [
    { id: 'T-start', name: '起飞坪', pos: [0, 10.4, 140], size: 22, kind: 'start', style: 'ground' },
    { id: 'T-final', name: '训练降落坪', pos: [-260, 10.4, -260], size: 20, kind: 'final', style: 'ground' },
    { id: 'T-repair', name: '维修坪', pos: [60, 10.4, 60], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 9 } },
  ],
  props: [
    { type: 'runway', pos: [RW_X, 10, RW_Z], p: { l: RW_L, w: 30 } },
    { type: 'apronLines', pos: [0, 10, 0], p: { rw: RW_X + 15 } },
    { type: 'hangar', pos: [96, 0, 150], rotY: Math.PI / 2, ground: true, p: { w: 26, l: 32, h: 10 } },
    { type: 'hangar', pos: [96, 0, 200], rotY: Math.PI / 2, ground: true, p: { w: 22, l: 28, h: 9, model: 'hangar_b' } },
    { type: 'controlTower', pos: [-22, 0, 268], rotY: Math.PI, ground: true },
    { type: 'clubhouse', pos: [34, 0, 276], rotY: Math.PI, ground: true },
    { type: 'parkedPlane', pos: [-14, 0, 204], rotY: 0.04, ground: true },
    { type: 'parkedPlane', pos: [16, 0, 203], rotY: -0.03, ground: true },
    { type: 'fuelTruck', pos: [50, 0, 108], rotY: 1.2, ground: true },
    { type: 'tank', pos: [132, 0, 112], ground: true, p: { r: 4, h: 6 } },
    { type: 'containerStack', pos: [126, 0, 72], rotY: Math.PI / 2, ground: true, p: { n: 3 } },
    { type: 'antenna', pos: [-120, 0, 250], ground: true, p: { h: 22 } },
    { type: 'windsock', pos: [-48, 0, 90], ground: true },
    // 牧场上的干草棚和围栏
    { type: 'hayBarn', pos: [-300, 0, 150], rotY: 0.5, ground: true },
    { type: 'hayBarn', pos: [-440, 0, 420], rotY: 2.0, ground: true },
    { type: 'hayBarn', pos: [190, 0, -420], rotY: 1.2, ground: true },
    { type: 'hayBarn', pos: [520, 0, 300], rotY: 3.6, ground: true },
    { type: 'hayBarn', pos: [120, 0, 560], rotY: 0.2, ground: true },
    { type: 'hayBarn', pos: [-260, 0, -700], rotY: 4.2, ground: true },
    { type: 'pasture', pos: [0, 0, 0], p: { pts: '-180,80,-380,110,-420,300,-210,330,-180,80' } },
    { type: 'pasture', pos: [0, 0, 0], p: { pts: '180,330,420,380,470,560,230,600' } },
    { type: 'pasture', pos: [0, 0, 0], p: { pts: '170,-320,420,-260,470,-470,180,-540,170,-320' } },
  ],
  vegetation: [
    // 山坡上的云杉林：成片长，片与片之间是草坡
    {
      type: 'spruce',
      density: 7000,
      scale: [0.8, 1.4],
      minH: 18,
      maxH: 900,
      maxSlope: 0.42,
      mask: (x, z, h) => smoothstep(0.44, 0.56, n.fbm(x / 340 + 9, z / 340, 3) * 0.5 + 0.5 + Math.min(0.14, (h - 18) / 900)) * airfield(x, z),
    },
    // 谷底：一丛丛的阔叶树和白桦，田边、溪边多一些
    { type: 'broadleaf', density: 520, scale: [0.8, 1.35], maxH: 80, maxSlope: 0.3, mask: (x, z) => smoothstep(0.56, 0.66, n2.fbm(x / 150, z / 150, 3) * 0.5 + 0.5) * airfield(x, z) },
    { type: 'birch', density: 380, scale: [0.8, 1.25], maxH: 70, maxSlope: 0.3, mask: (x, z) => smoothstep(0.54, 0.64, n.fbm(x / 120 - 4, z / 120, 3) * 0.5 + 0.5) * airfield(x, z) },
    { type: 'shrub', density: 420, scale: [0.7, 1.4], mask: (x, z) => smoothstep(0.5, 0.62, n2.fbm(x / 90, z / 90 + 3, 2) * 0.5 + 0.5) * airfield(x, z) },
    { type: 'boulder', density: 40, scale: [0.6, 1.6], maxSlope: 0.5, mask: (x, z) => airfield(x, z) },
  ],
  clearings: [[0, -120, 80]],
  nodes: [
    { id: 't-climb', pos: [0, 40, -40], radius: 40, speed: 10, label: '离场' },
    { id: 't-run', pos: [0, 45, -420], radius: 50, speed: 25, label: '加速直线' },
    { id: 't-turn', pos: [-260, 50, -520], radius: 50, speed: 18, label: '左转航点' },
    { id: 't-wind', pos: [-420, 40, -150], radius: 50, speed: 12, label: '侧风区' },
  ],
  legs: [
    {
      to: 'tr-land',
      paths: [{ id: 'main', label: '训练航线', detail: '', tag: 'main', nodes: ['t-climb', 't-run', 't-turn', 't-wind'] }],
    },
  ],
  mission: {
    startCargo: 0,
    main: [
      {
        id: 'tr-land',
        kind: 'land',
        title: '在训练降落坪安全降落',
        detail: '平稳接地：下降速度 < 2.5 m/s，水平漂移 < 2.5 m/s，姿态 < 12°。',
        padId: 'T-final',
        dwell: 3,
        approach: [-260, 40, -260],
      },
    ],
    optional: [],
  },
  pickups: [
    { id: 'tr-boost', kind: 'boost', pos: [0, 45, -300], note: '演示：拾取后使用动力增强' },
    { id: 'tr-shield', kind: 'shield', pos: [-120, 50, -500] },
    { id: 'tr-repair', kind: 'repair', pos: [-380, 40, -330] },
  ],
  windZones: [
    { id: 'tr-cross', name: '训练侧风区', a: [-480, -260], b: [-380, -60], radius: 120, feather: 80, kind: 'channel', dirFrom: 0, speed: 8 },
  ],
  weathers: [
    { id: 'clear', label: '晴朗', kind: 'clear', desc: '微风，能见度极好。', params: makeWeather({ windDirFrom: 250, windSpeed: 2.5, gustAmp: 0.6, cloudCover: 0.25 }) },
    { id: 'breeze', label: '晴·有风', kind: 'wind', desc: '持续西风约 7 m/s，带轻微阵风。', params: makeWeather({ windDirFrom: 270, windSpeed: 7, gustAmp: 2, cloudCover: 0.4 }) },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0xb8a77c,
    grass: 0x5d7d3a,
    grass2: 0x7a8c45,
    dirt: 0x7d6a4c,
    rock: 0x7b776f,
    rock2: 0x5d5a55,
    snow: 0xf2f4f6,
    strata: 0,
    beachTop: -100,
    snowLine: 1150,
    rockSlope: 0.3,
    waterDeep: 0x1d4560,
    waterShallow: 0x3c7a86,
    fogTint: 0xb8c8d8,
    forestFloor: 0x3e5a2c,
    mist: 0.9,
  },
  sun: [215, 42],
  ambience: { birds: 0.5, wind: 0.4 },
  landmarks: [{ name: '机库', pos: [70, 10, 170] }],
  vistas: [
    { name: '谷地全景', at: [120, 130, 420], look: [-40, -900] },
    { name: '小机场', at: [320, 45, 300], look: [-60, 100] },
    { name: '北面的雪山', at: [-40, 120, -420], look: [100, -1500] },
    { name: '小河上空', at: [300, 60, -300], look: [360, 300] },
  ],
  briefing: ['按照屏幕提示完成每一步操作。', '可通过暂停菜单跳过当前步骤或退出教学。'],
  estMinutes: [5, 8],
};
