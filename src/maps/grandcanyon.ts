// 大峡谷：真实地形。高程来自 USGS 3DEP（2.5 米一格），地表来自 2023 年 NAIP 航拍（1.25 米/像素）。
// 地图中心在南缘和科罗拉多河之间（北纬 36.085，西经 112.095），世界坐标 x 向东、-z 向北、y 就是海拔。
// 数据和处理流程见 tools/real/。这是一张超大地图：核心区 10 公里是精细数据，往外到 41 公里也能飞（20 米高程、10 米影像），
// 北缘、大景观点、隐士歇脚处都在里面。任务是救援模式（rescues），高度写 0 的坪按当地地面算。

import { makeWeather } from '../sim/weather';
import { GRAND_CANYON_BRIDGES, GRAND_CANYON_BUILDINGS } from './grandcanyonBuildings';
import type { MapDef, PadDef, RescueDef } from './types';

/** 南缘崖边的一块平地，光明天使步道口以东：停在这里往北就是峡谷 */
const PAD: [number, number, number] = [-1660, 2166.3, 2290];

const field = (id: string, name: string, x: number, z: number, size = 18): PadDef => ({ id, name, pos: [x, 0, z], size, kind: 'delivery', style: 'field' });

const CLINIC = '南缘诊所的操场已经清空，医生在等你。';

const RESCUES: RescueDef[] = [
  {
    id: 'plateau',
    title: '普拉托角的中暑者',
    summary: '有人在光明天使步道的尽头中暑倒下。飞进峡谷，落在托恩托平台上，把人送到南缘诊所。',
    stars: 2,
    km: 33,
    minutes: [12, 20],
    start: 'R-base',
    heading: 0,
    golden: 40,
    stops: [
      { pad: 'R-plateau', task: '飞往普拉托角，接伤员', radio: '普拉托角有一名中暑的徒步者，意识模糊。平台够大，可以直接落。起飞吧。', what: 'load', dwell: 12 },
      { pad: 'R-clinic', task: '送到南缘诊所', radio: `伤员上机了。${CLINIC}飞稳一点。`, what: 'unload', dwell: 10 },
      { pad: 'R-base', task: '返回基地', radio: '交接完成，干得好。飞回基地。' },
    ],
  },
  {
    id: 'rim2rim',
    title: '横跨大峡谷',
    summary: '幻影牧场有人从崖上摔下来。先飞到北缘接医生，再下到谷底，最后翻回南缘。来回穿过整个峡谷。',
    stars: 3,
    km: 59,
    minutes: [22, 32],
    start: 'R-base',
    heading: 0,
    golden: 70,
    stops: [
      { pad: 'R-north', task: '飞到北缘客栈，接医生', radio: '幻影牧场报告一名坠崖伤员。值班医生在北缘客栈，先把人接上。航线要翻过整个峡谷，高度保持 2800 米以上。', dwell: 8 },
      { pad: 'R-phantom', task: '下到幻影牧场，接伤员', radio: '医生上机了。现在下到谷底：从北缘到河边要下降 1700 米，一路看着旋翼和下降率，别下得太猛。', what: 'load', dwell: 14 },
      { pad: 'R-clinic', task: '爬出峡谷，送到南缘诊所', radio: `伤员固定好了。从谷底爬到南缘要爬 1300 米，机上多了人，注意扭矩。${CLINIC}`, what: 'unload', dwell: 10 },
      { pad: 'R-base', task: '返回基地', radio: '交接完成。飞回基地，今天的活干完了。' },
    ],
  },
  {
    id: 'hance',
    title: '汉斯急流翻船',
    summary: '一条皮划艇在汉斯急流翻了，有人被困在河边的岩台上，落不了地，只能悬停吊运。',
    stars: 4,
    km: 53,
    minutes: [22, 32],
    start: 'R-base',
    heading: 45,
    golden: 65,
    stops: [
      { pad: 'R-grandview', task: '飞到大景观点，接救援员', radio: '汉斯急流翻船，一人被困在岩台上。救援员在大景观点等你，带上吊运设备。', dwell: 8 },
      { pad: 'R-hance', task: '悬停吊运岩台上的伤员', radio: '岩台太窄，落不下去。悬停在离地 12 到 32 米之间，稳住 18 秒，救援员下去把人带上来。', what: 'hoist' },
      { pad: 'R-mesa', task: '在马蹄台地落地，把伤员安顿好', radio: '人吊上来了，还挂在绳子上。到马蹄台地落一下，把伤员抬进机舱。', dwell: 12 },
      { pad: 'R-clinic', task: '送到南缘诊所', radio: `固定好了，走。${CLINIC}`, what: 'unload', dwell: 10 },
      { pad: 'R-base', task: '返回基地', radio: '交接完成。飞回基地。' },
    ],
  },
  {
    id: 'shift',
    title: '一整天的值班',
    summary: '三起呼救接连进来，从西边的隐士急流一直到东边的皇家角，差不多要飞一百公里。油够，人够不够撑得住就看你了。',
    stars: 5,
    km: 104,
    minutes: [45, 65],
    start: 'R-base',
    heading: 300,
    golden: 45,
    stops: [
      { pad: 'R-hermit', task: '飞到隐士歇脚处，接救援员', radio: '早上好。隐士急流的河滩上有人摔断了腿。救援员在隐士歇脚处等你。', dwell: 8 },
      { pad: 'R-hermitc', task: '悬停吊运河滩上的伤员', radio: '河滩上全是石头，落不下去。悬停在离地 12 到 32 米之间，稳住 18 秒。', what: 'hoist' },
      { pad: 'R-clinic', task: '送到南缘诊所', radio: `人上来了。${CLINIC}`, what: 'unload', dwell: 10 },
      { pad: 'R-garden', task: '下到印第安花园，接伤员', radio: '第二起：印第安花园有人心脏不舒服。就在脚下，直接下去。', what: 'load', dwell: 12 },
      { pad: 'R-clinic', task: '送回南缘诊所', radio: '上机了，赶紧送回去。', what: 'unload', dwell: 10 },
      { pad: 'R-north', task: '飞到北缘客栈，接急救员', radio: '第三起：皇家角的观景台有人晕倒。北缘客栈的急救员跟你一起去，翻过峡谷，高度 2800 米以上。', dwell: 8 },
      { pad: 'R-royal', task: '飞往皇家角，接伤员', radio: '皇家角在北缘最东头，一路都是森林和断崖。', what: 'load', dwell: 12 },
      { pad: 'R-north', task: '送到北缘客栈的急救站', radio: '接到了，回北缘客栈。', what: 'unload', dwell: 10 },
      { pad: 'R-base', task: '横跨峡谷，飞回基地', radio: '今天三个人都送到了。最后一段，飞回南缘基地，辛苦了。' },
    ],
  },
];

export const GRAND_CANYON: MapDef = {
  id: 'grandcanyon',
  name: '大峡谷',
  subtitle: '超大地图 · 真实地形',
  region: '美国亚利桑那州 · 真实测绘数据',
  description: '不是算法生成的山：每一座峰、每一层岩石都在现实里的位置上。41 公里见方，南缘北缘都能飞到。',
  difficulty: 3,
  recommendedAssist: 'standard',
  size: 10240,
  flightSize: 40960,
  rescues: RESCUES,
  res: 4097,
  seed: 1,
  altitudeOffset: 0,
  waterLevel: null,
  real: {
    base: 'real/grandcanyon/',
    credit: '高程：USGS 3DEP；影像：USDA NAIP 2023（经 USGS The National Map）。美国政府公有领域数据。',
    levels: [
      { size: 10240, res: 4097, heights: 'core.dem', image: 'core.webp', base: 724, step: 0.05 },
      { size: 40960, res: 2049, heights: 'mid.dem', image: 'mid.webp', base: 647, step: 0.1 },
      { size: 163840, res: 1025, heights: 'far.dem', image: 'far.webp', base: 39, step: 0.25 },
    ],
    // 倾角是拟合的：让崖壁的高度分布最集中（往北每公里抬升约 16 米，和两岸的地层高差对得上）
    strata: { image: 'strata.png', y0: 600, y1: 2420, dip: [-0.004, 0.016] },
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
  pads: [
    { id: 'G-rim', name: '南缘起降场', pos: PAD, size: 22, kind: 'start', style: 'ground' },
    // 大峡谷机场的停机坪旁边：现实里国家公园的直升机基地就在这里
    { id: 'R-base', name: '南缘救援基地', pos: [-4840, 0, 14860], size: 24, kind: 'start', style: 'ground' },
    // 村里学校的操场：航拍上一大块平地
    { id: 'R-clinic', name: '南缘诊所', pos: [-3918, 0, 3702], size: 20, kind: 'final', style: 'ground' },
    field('R-plateau', '普拉托角', -2322, -762),
    field('R-garden', '印第安花园', -2890, 645),
    field('R-phantom', '幻影牧场', -65, -2030),
    field('R-north', '北缘客栈', 3960, -12440, 20),
    field('R-royal', '皇家角', 13280, -3660),
    field('R-grandview', '大景观点', 9360, 10140),
    field('R-mesa', '马蹄台地', 10220, 6700),
    field('R-hance', '汉斯急流', 13920, 4700),
    field('R-hermit', '隐士歇脚处', -10140, 2580),
    field('R-hermitc', '隐士急流', -10420, -1780),
  ],
  props: [
    { type: 'shed', pos: [-4790, 0, 14826], ground: true, rotY: 0.7, p: { w: 22, l: 26, h: 7, color: 0x9aa0a6, roof: 0x70767c } },
    { type: 'shed', pos: [-4800, 0, 14905], ground: true, rotY: 0.7, p: { w: 8, l: 12, h: 3.4, color: 0xb6ac98 } },
    { type: 'shed', pos: [-3958, 0, 3672], ground: true, rotY: 0.2, p: { w: 10, l: 18, h: 3.6, color: 0xd8d2c4, roof: 0x7a4a3a } },
  ],
  vegetation: [],
  clearings: [],
  legs: [],
  nodes: [],
  mission: { main: [], optional: [], startCargo: 0 },
  pickups: [],
  windZones: [],
  weathers: [
    { id: 'clear', label: '晴天', kind: 'clear', desc: '高原的空气很干净，对岸的崖壁一层一层看得清楚。', params: makeWeather({ windDirFrom: 240, windSpeed: 4, gustAmp: 1, cloudCover: 0.12, visibility: 70000 }) },
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
  // 核心区外面的降落点周围种一片树（只在这几处：外圈的影像只有 10 米一个像素，认不出一棵棵的树）
  outerForest: [
    { pad: 'R-north', kinds: ['spruce', 'pine'], scale: [0.8, 1.25] },
    { pad: 'R-royal', kinds: ['pinyon', 'ujuniper', 'pinyon2'], scale: [0.7, 1.15] },
    { pad: 'R-grandview', kinds: ['pinyon', 'ujuniper', 'ujuniper2'], scale: [0.75, 1.2] },
    { pad: 'R-hermit', kinds: ['ujuniper', 'pinyon2', 'ujuniper2'], scale: [0.7, 1.1] },
    { pad: 'R-base', kinds: ['ujuniper', 'ujuniper2', 'scrub'], scale: [0.6, 1], keep: 180 },
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
  briefing: ['真实地形，超大地图：救援模式或者休闲飞行。'],
  estMinutes: [10, 60],
};
