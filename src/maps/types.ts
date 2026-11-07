// 地图配置结构（配置驱动）：地形配方、停机坪、道具、植被、航线、任务、Buff、风区、天气、视觉与环境音。

import type { RockFormDef } from '../world/rockForm';
import type { AssistId } from '../config/flight';
import type { HeightBuilder } from '../sim/terrain';
import type { WeatherPreset } from '../sim/weather';
import type { WindZoneDef } from '../sim/wind';

export type V3 = [number, number, number];
export type MapId = 'training' | 'japan' | 'canyon' | 'amazon' | 'fjord' | 'himalaya' | 'grandcanyon';

export type PadKind = 'start' | 'delivery' | 'repair' | 'final' | 'helipad';
export type PadStyle = 'ground' | 'roof' | 'pier' | 'platform' | 'ledge' | 'raised';

/** 河流：沿下游方向排列的点 [x, z, 水面高度, 半宽] */
export interface RiverDef {
  pts: Array<[number, number, number, number]>;
  /** 河床比水面低多少（米） */
  depth: number;
  /** 河岸接回原地面的宽度（米） */
  bank: number;
  /** 河心、河边的水色（sRGB 十六进制） */
  deep: number;
  shallow: number;
  /** 水流速度（米 / 秒） */
  speed: number;
  /** 两岸卵石滩的宽度（米） */
  bar?: number;
}

export interface PadDef {
  id: string;
  name: string;
  /** 停机坪顶面中心（世界坐标） */
  pos: V3;
  /** 边长（m） */
  size: number;
  rotY?: number;
  kind: PadKind;
  style: PadStyle;
  /** 维修站：恢复量与可用次数 */
  repair?: { amount: number; uses: number };
  /** 立柱/建筑高度（roof/platform/raised 风格，用于生成支撑结构） */
  baseHeight?: number;
}

export interface PropDef {
  type: string;
  pos: V3;
  rotY?: number;
  s?: number;
  /** true：y 坐标为相对地形的偏移 */
  ground?: boolean;
  p?: Record<string, number | string>;
}

export type TreeType = 'pine' | 'broadleaf' | 'canopy' | 'emergent' | 'palm' | 'spruce' | 'birch' | 'juniper' | 'shrub' | 'cactus' | 'boulder' | 'pinyon' | 'pinyon2' | 'ujuniper' | 'ujuniper2' | 'scrub' | 'ponderosa';

export interface VegetationRule {
  type: TreeType;
  /** 每平方公里最大株数 */
  density: number;
  scale: [number, number];
  minH?: number;
  maxH?: number;
  maxSlope?: number;
  /** 返回 0..1 的分布权重 */
  mask?: (x: number, z: number, h: number, slope: number) => number;
  /** 沿沟生长的程度 0..1：沟里的权重往 1 靠（见 world/flow.ts） */
  wash?: number;
}

export interface RouteNodeDef {
  id: string;
  pos: V3;
  radius: number;
  /** 建议速度（m/s） */
  speed?: number;
  label?: string;
  checkpoint?: boolean;
  /** 最小地形净空（m），用于航线校验 */
  clearance?: number;
  /** 自动高度：生成世界后，把该航点抬高到“前后航段沿线最高障碍 + 此余量”（不会降低） */
  autoAlt?: number;
}

export interface RoutePathDef {
  id: string;
  label: string;
  detail: string;
  tag: 'safe' | 'short' | 'repair' | 'buff' | 'scenic' | 'main';
  nodes: string[];
}

export interface RouteLegDef {
  /** 本段终点的任务 id */
  to: string;
  paths: RoutePathDef[];
}

export type ObjectiveDef =
  | {
      id: string;
      kind: 'land';
      title: string;
      detail: string;
      padId: string;
      dwell: number;
      cargo?: 'load' | 'unload';
      /** 进近航点（导航用，通常位于停机坪上空） */
      approach: V3;
    }
  | {
      id: string;
      kind: 'hover';
      title: string;
      detail: string;
      /** 目标点（甲板/屋顶/岩架表面） */
      center: V3;
      radius: number;
      /** 相对目标点的高度区间 */
      minH: number;
      maxH: number;
      duration: number;
      maxSpeed: number;
      cargo?: 'drop';
      approach: V3;
    }
  | {
      id: string;
      kind: 'inspect';
      title: string;
      detail: string;
      points: Array<{ pos: V3; radius: number; label: string }>;
      maxSpeed: number;
      approach: V3;
      /** 巡查航线（可选）：导航沿此折线前进，巡查点位于航线附近（用于峡谷/河道等弯曲地形） */
      route?: V3[];
    };

export interface MissionDef {
  main: ObjectiveDef[];
  optional: ObjectiveDef[];
  /** 起飞时机上的物资箱数 */
  startCargo: number;
}

export interface PickupDef {
  id: string;
  kind: 'boost' | 'shield' | 'repair';
  pos: V3;
  /** 放在某个航点上（随该航点的 autoAlt 一起抬高；pos 仅作为默认值） */
  node?: string;
  /** 放置理由（文档/调试显示） */
  note?: string;
}

export interface BiomeDef {
  /** 地形分层颜色（线性前的 sRGB 十六进制） */
  sand: number;
  grass: number;
  grass2: number;
  dirt: number;
  rock: number;
  rock2: number;
  snow: number;
  /** 岩层条带（峡谷）强度 */
  strata: number;
  strataColors?: number[];
  /** 沙滩/河岸高度上限 */
  beachTop: number;
  /** 积雪线（世界 y） */
  snowLine: number;
  /** 空气里的气溶胶（1 = 很干净，雨林的湿热空气 2 以上，高原不到 1），决定天色和太阳周围发白的程度 */
  air?: number;
  /** 地面上一簇簇的草有多明显（缺省 1，荒漠 0.3 左右） */
  grassy?: number;
  /** 岩石出现的坡度阈值（1-n.y） */
  rockSlope: number;
  waterDeep: number;
  waterShallow: number;
  fogTint: number;
  /** 森林底色：地面被树冠覆盖区域 */
  forestFloor: number;
  /** 贴地薄雾的浓淡（湿润的海边、雨林 > 1，干燥的高原、荒漠 < 1；默认 1） */
  mist?: number;
  /** 干河道的颜色（荒漠里的沟是一条条浅色的沙；不设时沟里按植被更密处理，颜色偏深偏绿） */
  wash?: number;
}

export interface AmbienceDef {
  sea?: number;
  birds?: number;
  insects?: number;
  wind?: number;
  river?: number;
  gulls?: number;
}

/** 水上走的船（src/render/vessels.ts）：模型在这张图的模型库里，不给航线就在开阔水面上自己找一个圈 */
export interface VesselDef {
  model: string;
  /** 船长（米）：尾浪的大小 */
  len: number;
  /** 米 / 秒 */
  speed: number;
  /** 模型的船头朝哪边：-1 = -X（默认），1 = +X */
  bow?: number;
  /** 闭合的航线 [x, z] */
  route?: Array<[number, number]>;
}

/** 天上飞的（src/render/birds.ts） */
export type BirdKind = 'condor' | 'raven' | 'gull' | 'kite' | 'egret' | 'macaw';

/** 观景点（休闲模式）：at = [x, 离地高度, z]，look = 看向哪里 [x, z] */
export interface Vista {
  name: string;
  at: V3;
  look: [number, number];
}

/** 真实地形的一层：高程网格 + 航拍影像（public/<base> 下面），见 tools/real/prep_grandcanyon.py */
export interface RealLevelDef {
  /** 边长（米） */
  size: number;
  /** 网格点数（2 的幂 + 1） */
  res: number;
  heights: string;
  image: string;
  /** 高度的基准和量化步长（米） */
  base: number;
  step: number;
}

/** 中心 x、z，长，宽，转角（度，从北看顺时针），檐口高，屋脊比檐口高多少（0 = 平顶） */
export type RealBuildingDef = readonly [number, number, number, number, number, number, number];

/** 吊桥：两头的 x、z */
export type RealBridgeDef = readonly [number, number, number, number];

export interface RealTerrainDef {
  base: string;
  levels: RealLevelDef[];
  /** 数据来源：地图里要写明 */
  credit: string;
  /** 从影像里认出来的树 */
  trees?: string;
  /** 数据一共多少字节（下载进度条用） */
  bytes?: number;
  /** 岩层色表：按高度排的一条颜色（崖壁上的贴图被拉长了，靠它补回层次） */
  /** dip：地层不是完全水平的，高度 + x·dip[0] + z·dip[1] 才是这层岩石的位置 */
  /** basement：这个高度以下是基底的变质岩（发黑，没有水平的层） */
  strata?: { image: string; y0: number; y1: number; dip: [number, number]; basement?: number };
  /** 核心区 5 米一格的辅助图：R 岩缝，G 河面，B 看得到的天空 */
  aux?: string;
  /** 外圈 20 米一格的辅助图，通道和 aux 一样 */
  auxMid?: string;
  /** 核心区 5 米一格的散布密度：R 灌木，G 碎石，B 枯草（见 render/realScatter.ts） */
  scatter?: string;
  /** 照着航拍描的房子 */
  buildings?: readonly RealBuildingDef[];
  bridges?: readonly RealBridgeDef[];
}

export interface MapDef {
  id: MapId;
  /** 积云底的海拔（米）。缺省按地形算，贴着最高的山；高原上的云其实比地面高得多 */
  cloudBase?: number;
  /** 云团的尺度（米），缺省 3400 */
  cloudSize?: number;
  /** 超大地图：能飞的范围（边长，米），比核心区大，核心区外接中圈的高程 */
  flightSize?: number;
  /** 核心区外面种的树：种在哪儿（x、z）、什么树、多大 */
  outerForest?: Array<{ at: [number, number]; kinds: TreeType[]; scale: [number, number] }>;
  /** 树叶的整体偏色（默认不偏） */
  leafTint?: [number, number, number];
  /** 真实地形：高度和地表都来自测绘数据，不走程序生成 */
  real?: RealTerrainDef;
  name: string;
  subtitle: string;
  region: string;
  description: string;
  difficulty: number;
  recommendedAssist: AssistId;
  size: number;
  res: number;
  seed: number;
  altitudeOffset: number;
  waterLevel: number | null;
  /** 地表掩码 A 通道画的是水泥地（港区），不是积雪 */
  pavedMask?: boolean;
  /** 水力侵蚀的雨滴数（见 world/erosion.ts）；缺省不做 */
  /** 地形全部定下来之后再画的地表（积雪这种按高度算的：切出来的山沟不能还留着原来山顶的雪） */
  paintFinal?: (b: HeightBuilder) => void;
  /** 河流下切（见 world/fluvial.ts）：切出树枝状的水系，放在雨滴侵蚀之前 */
  dissect?: { grid: number; steps: number; k: number; maxCut: number; m?: number; creep?: number; talus?: number; soft?: (x: number, z: number) => number };
  erosion?: number;
  /** 岩层（见 world/rockForm.ts）：陡坡改成硬层成崖、软层成坡的剖面，并按同一张地层表上色 */
  rockForm?: RockFormDef;
  /** 河流（不参与飞行模拟，只有地形和画面） */
  rivers?: RiverDef[];
  buildTerrain(b: HeightBuilder): void;
  /** 地图外围远景地形（不参与碰撞） */
  farTerrain?(x: number, z: number): number;
  /** 远景地形铺到多远（地图边长的倍数，缺省 1.6） */
  farExtent?: number;
  /** 地图边缘接到远景要过渡多远（米，缺省 900）：远景和地图能对上的（比如河谷接着往外走）要短，否则中间是一道长坡 */
  farBlend?: number;
  /** 地图外面的河（只有画面，不改地形） */
  farRivers?: RiverDef[];
  spawn: { padId: string; heading: number };
  pads: PadDef[];
  props: PropDef[];
  vegetation: VegetationRule[];
  /** 不种树的区域（停机坪之外的营地、村庄等），[x, z, 半径] */
  clearings: Array<[number, number, number]>;
  legs: RouteLegDef[];
  nodes: RouteNodeDef[];
  mission: MissionDef;
  pickups: PickupDef[];
  windZones: WindZoneDef[];
  weathers: WeatherPreset[];
  defaultWeather: string;
  biome: BiomeDef;
  /** 太阳方位角与高度角（度） */
  sun: [number, number];
  /** 清晨 / 黄昏的太阳位置（可选，默认东偏南 96° 高 7.5° / 西偏南 264° 高 6.5°） */
  sunDawn?: [number, number];
  sunDusk?: [number, number];
  ambience: AmbienceDef;
  /** 地图外面再种多宽一圈真树（米）：林子密的图，地图边上不能只剩一层贴图 */
  fringe?: number;
  /** 远景地形比真实地面抬高了多少（抬到树冠的高度）：那一圈树要种在真实的地面上，树冠才是从林冠层里鼓出来的 */
  farCanopy?: (x: number, z: number) => number;
  /** 水上有什么船在走 */
  vessels?: VesselDef[];
  /** 这张图有什么鸟、各几只 */
  birds?: Partial<Record<BirdKind, number>>;
  landmarks: Array<{ name: string; pos: V3 }>;
  /** 休闲模式的观景点（第一个是出生点）；地标也会自动列进去 */
  vistas?: Vista[];
  briefing: string[];
  /** 首次游玩估计的主线时长（分钟），仅用于说明 */
  estMinutes: [number, number];
}
