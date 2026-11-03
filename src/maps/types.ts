// 地图配置结构（配置驱动）：地形配方、停机坪、道具、植被、航线、任务、Buff、风区、天气、视觉与环境音。

import type { AssistId } from '../config/flight';
import type { HeightBuilder } from '../sim/terrain';
import type { WeatherPreset } from '../sim/weather';
import type { WindZoneDef } from '../sim/wind';

export type V3 = [number, number, number];
export type MapId = 'training' | 'japan' | 'canyon' | 'amazon' | 'fjord' | 'himalaya';

export type PadKind = 'start' | 'delivery' | 'repair' | 'final' | 'helipad';
export type PadStyle = 'ground' | 'roof' | 'pier' | 'platform' | 'ledge' | 'raised';

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

export type TreeType = 'pine' | 'broadleaf' | 'canopy' | 'emergent' | 'palm' | 'spruce' | 'birch' | 'juniper' | 'shrub' | 'cactus';

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
  /** 岩石出现的坡度阈值（1-n.y） */
  rockSlope: number;
  waterDeep: number;
  waterShallow: number;
  fogTint: number;
  /** 森林底色：地面被树冠覆盖区域 */
  forestFloor: number;
}

export interface AmbienceDef {
  sea?: number;
  birds?: number;
  insects?: number;
  wind?: number;
  river?: number;
  gulls?: number;
}

export interface MapDef {
  id: MapId;
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
  buildTerrain(b: HeightBuilder): void;
  /** 地图外围远景地形（不参与碰撞） */
  farTerrain?(x: number, z: number): number;
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
  ambience: AmbienceDef;
  landmarks: Array<{ name: string; pos: V3 }>;
  briefing: string[];
  /** 首次游玩估计的主线时长（分钟），仅用于说明 */
  estMinutes: [number, number];
}
