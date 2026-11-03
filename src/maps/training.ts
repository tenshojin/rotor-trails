// 训练场：平坦的草原机场，周围有低矮丘陵。用于飞行教学与物理测试。

import { Perlin2 } from '../core/noise';
import { smoothstep } from '../core/math';
import { makeWeather } from '../sim/weather';
import type { MapDef } from './types';

const SEED = 101;
const n = new Perlin2(SEED);

function base(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const hills = 160 * Math.pow(n.ridged(x / 520, z / 520, 4), 1.6) * smoothstep(520, 980, r);
  const roll = 4 * n.fbm(x / 180, z / 180, 3);
  return 10 + roll * smoothstep(250, 600, r) + hills;
}

export const TRAINING: MapDef = {
  id: 'training',
  name: '飞行训练场',
  subtitle: '基础驾驶教学',
  region: '训练基地',
  description: '平坦开阔的草原机场。按步骤练习起飞、加速、减速、转向、高度控制、悬停、侧风修正与安全降落。',
  difficulty: 1,
  recommendedAssist: 'novice',
  size: 2048,
  res: 513,
  seed: SEED,
  altitudeOffset: 30,
  waterLevel: null,
  buildTerrain(b) {
    b.fill(base);
    b.flattenRect(0, -120, 40, 380, 0, 10, 60);
    b.paintPath(1, [[0, 230], [0, -480]], 16, 3, 0.9);
    b.paintPath(2, [[0, 230], [0, -480]], 24, 4, 1);
  },
  spawn: { padId: 'T-start', heading: 0 },
  pads: [
    { id: 'T-start', name: '起飞坪', pos: [0, 10.4, 140], size: 22, kind: 'start', style: 'ground' },
    { id: 'T-final', name: '训练降落坪', pos: [-260, 10.4, -260], size: 20, kind: 'final', style: 'ground' },
    { id: 'T-repair', name: '维修坪', pos: [60, 10.4, 60], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 9 } },
  ],
  props: [
    { type: 'hangar', pos: [70, 0, 150], rotY: Math.PI / 2, ground: true, p: { w: 26, l: 32, h: 10 } },
    { type: 'hangar', pos: [70, 0, 205], rotY: Math.PI / 2, ground: true, p: { w: 22, l: 28, h: 9, color: 0x9aa2a8 } },
    { type: 'antenna', pos: [-60, 0, 180], ground: true, p: { h: 22 } },
    { type: 'tank', pos: [-70, 0, 230], ground: true, p: { r: 5, h: 7 } },
    { type: 'fuel', pos: [32, 0, 120], ground: true },
    { type: 'containerStack', pos: [-55, 0, 120], rotY: 0.3, ground: true, p: { n: 7 } },
    { type: 'windsock', pos: [-30, 0, 90], ground: true },
    { type: 'shed', pos: [95, 0, 80], ground: true, p: { w: 8, l: 10, h: 3.5, roof: 0x3d5a7a } },
  ],
  vegetation: [
    { type: 'broadleaf', density: 160, scale: [0.8, 1.3], maxSlope: 0.3, mask: (x, z) => smoothstep(420, 560, Math.hypot(x, z)) * (0.5 + 0.5 * n.fbm(x / 140, z / 140, 2)) },
    { type: 'pine', density: 120, scale: [0.8, 1.2], maxSlope: 0.35, mask: (x, z) => smoothstep(650, 820, Math.hypot(x, z)) },
    { type: 'shrub', density: 260, scale: [0.7, 1.4], mask: (x, z) => smoothstep(260, 420, Math.hypot(x, z)) },
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
    { id: 'tr-boost', kind: 'boost', pos: [0, 45, -300], note: '演示：拾取后按 Shift 使用' },
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
    snowLine: 9999,
    rockSlope: 0.32,
    waterDeep: 0x1d4560,
    waterShallow: 0x3c7a86,
    fogTint: 0xb8c8d8,
    forestFloor: 0x3e5a2c,
    mist: 0.9,
  },
  sun: [215, 42],
  ambience: { birds: 0.5, wind: 0.4 },
  landmarks: [{ name: '机库', pos: [70, 10, 170] }],
  briefing: ['按照屏幕提示完成每一步操作。', '任何时候都可以按 Esc 暂停、跳过当前步骤或退出教学。'],
  estMinutes: [5, 8],
};
