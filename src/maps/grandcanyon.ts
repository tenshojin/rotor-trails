// 大峡谷：真实地形。高程来自 USGS 3DEP（2.5 米一格），地表来自 2023 年 NAIP 航拍（1.25 米/像素）。
// 地图中心在南缘和科罗拉多河之间（北纬 36.085，西经 112.095），世界坐标 x 向东、-z 向北、y 就是海拔。
// 数据和处理流程见 tools/real/。这是一张超大地图：核心区 10 公里是精细数据，往外到 41 公里也能飞（20 米高程、10 米影像），
// 北缘、大景观点、隐士歇脚处都在里面。玩法是休闲飞行。

import { makeWeather } from '../sim/weather';
import { GRAND_CANYON_BRIDGES, GRAND_CANYON_BUILDINGS } from './grandcanyonBuildings';
import type { MapDef } from './types';

/** 南缘崖边的一块平地，光明天使步道口以东：停在这里往北就是峡谷 */
const PAD: [number, number, number] = [-1660, 2166.3, 2290];

export const GRAND_CANYON: MapDef = {
  id: 'grandcanyon',
  name: '大峡谷',
  subtitle: '超大地图 · 真实地形',
  region: '美国亚利桑那州 · 真实测绘数据',
  description: '不是算法生成的山：每一座峰、每一层岩石都在现实里的位置上。41 公里见方，南缘北缘都能飞到。',
  difficulty: 3,
  recommendedAssist: 'standard',
  // 夏天的积云底在南缘上方两公里左右
  cloudBase: 4300,
  cloudSize: 7000,
  size: 10240,
  flightSize: 40960,
  res: 4097,
  seed: 1,
  altitudeOffset: 0,
  waterLevel: null,
  real: {
    base: 'real/grandcanyon/',
    credit: '高程：USGS 3DEP；影像：USDA NAIP 2023（经 USGS The National Map）。美国政府公有领域数据。',
    levels: [
      { size: 10240, res: 4097, heights: 'core.dem', image: 'core.webp', base: 724, step: 0.05 },
      { size: 40960, res: 4097, heights: 'mid.dem', image: 'mid.webp', base: 647, step: 0.1 },
      { size: 163840, res: 1025, heights: 'far.dem', image: 'far.webp', base: 39, step: 0.25 },
    ],
    // 倾角是拟合的：让崖壁的高度分布最集中（往北每公里抬升约 16 米，和两岸的地层高差对得上）
    strata: { image: 'strata.png', y0: 600, y1: 2420, dip: [-0.004, 0.016], basement: 1030 },
    aux: 'sky_river.webp',
    auxMid: 'sky_river_mid.webp',
    scatter: 'scatter.webp',
    buildings: GRAND_CANYON_BUILDINGS,
    bridges: GRAND_CANYON_BRIDGES,
    // 后缀别用 .bin、.gz：下载软件会把这些请求拦走，游戏只收到一个空的 204
    trees: 'trees.dat',
  },
  buildTerrain() {
    // 高度已经从测绘数据里读好了
  },
  spawn: { padId: 'G-rim', heading: 0 },
  pads: [{ id: 'G-rim', name: '南缘起降场', pos: PAD, size: 22, kind: 'start', style: 'ground' }],
  props: [],
  vegetation: [],
  clearings: [],
  legs: [],
  nodes: [],
  mission: { main: [], optional: [], startCargo: 0 },
  pickups: [],
  windZones: [],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '高原的空气很干净，对岸的崖壁一层一层看得清楚。', params: makeWeather({ windDirFrom: 240, windSpeed: 4, gustAmp: 1, cloudCover: 0.17, visibility: 70000 }) },
    { id: 'haze', label: '夏日薄霾', kind: 'clear', desc: '远处的岩层一层层淡下去。', params: makeWeather({ windDirFrom: 220, windSpeed: 5, gustAmp: 1.4, cloudCover: 0.25, visibility: 32000 }) },
  ],
  defaultWeather: 'clear',
  biome: {
    sand: 0xc9a26e,
    grass: 0x8a8458,
    grass2: 0x9a9060,
    dirt: 0xb98550,
    rock: 0xa8704c,
    rock2: 0x7e4a34,
    snow: 0xf0f0f0,
    strata: 0,
    beachTop: -100,
    snowLine: 9999,
    air: 0.8,
    grassy: 0.3,
    rockSlope: 0.3,
    waterDeep: 0x3a5a4a,
    waterShallow: 0x6a7a5a,
    fogTint: 0xdcd2c4,
    forestFloor: 0x6a6448,
    mist: 0.3,
  },
  // 核心区外面几个景点周围种一片树（只在这几处：外圈的影像只有 10 米一个像素，认不出一棵棵的树）
  outerForest: [
    { at: [3960, -12440], kinds: ['spruce', 'pine'], scale: [0.8, 1.25] },
    { at: [13280, -3660], kinds: ['pinyon', 'ujuniper', 'pinyon2'], scale: [0.7, 1.15] },
    { at: [9360, 10140], kinds: ['pinyon', 'ujuniper', 'ujuniper2'], scale: [0.75, 1.2] },
    { at: [-10140, 2580], kinds: ['ujuniper', 'pinyon2', 'ujuniper2'], scale: [0.7, 1.1] },
  ],
  // 上午的斜阳：崖壁的影子能拉出来，方向和航拍接近，影像里残留的明暗不会和太阳打架
  sun: [108, 33],
  // 南缘的矮松和刺柏是发灰的橄榄绿
  leafTint: [1, 1, 1],
  ambience: { wind: 0.9, birds: 0.12 },
  // 山顶的位置和海拔来自高程数据（和公开的海拔对得上：琐罗亚斯德 2171 m、梵天 2301 m、胡夫金字塔 1646 m、战舰 1783 m）
  landmarks: [
    { name: '马瑟观景点', pos: [-1176, 2162, 2570] },
    { name: '亚基角', pos: [989, 2210, 3016] },
    { name: '幻影牧场', pos: [31, 777, -2297] },
    { name: '琐罗亚斯德神殿', pos: [4520, 2174, -3720] },
    { name: '梵天神殿', pos: [5000, 2302, -4900] },
    { name: '胡夫金字塔', pos: [-2230, 1647, -3930] },
    { name: '战舰岩', pos: [-3940, 1783, 960] },
  ],
  vistas: [
    { name: '南缘上空', at: [-1176, 260, 2300], look: [31, -2297] },
    { name: '内峡谷与科罗拉多河', at: [-600, 420, -900], look: [400, -2000] },
    { name: '幻影牧场', at: [31, 200, -1800], look: [31, -2297] },
    { name: '琐罗亚斯德神殿', at: [2900, 300, -2600], look: [4520, -3720] },
    { name: '战舰岩', at: [-2600, 300, 700], look: [-3940, 960] },
    { name: '北缘客栈', at: [3700, 260, -11300], look: [1500, -2400] },
    { name: '皇家角', at: [12600, 320, -2300], look: [9000, 2000] },
    { name: '隐士歇脚处', at: [-10400, 300, 1500], look: [-6000, -3000] },
  ],
  briefing: ['真实地形，超大地图，休闲飞行。'],
  estMinutes: [10, 60],
};
