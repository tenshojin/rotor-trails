// 直升机与飞行辅助参数（集中配置，便于调校）。
// 机型为虚构的轻型单发通用直升机 RT-7「隼」，参数量级参考同级别真实机型。

import { DEG } from '../core/math';

export const HELI = {
  name: 'RT-7 隼',
  /** 空机 + 驾驶员 + 燃油（kg） */
  massBase: 1750,
  /** 主惯量（kg·m²）：x=俯仰，y=偏航，z=横滚 */
  inertia: { pitch: 4200, yaw: 3900, roll: 1500 },
  rotorRadius: 5.3,
  /** 桨毂在重心上方的高度（m） */
  hubHeight: 1.75,
  /** 桨尖速度（m/s），旋翼转速由调速器自动保持 */
  tipSpeed: 215,
  /** 传动系统限制功率（W），低空时的实际上限 */
  transmissionLimit: 340e3,
  /** 发动机海平面最大功率（W），高空按空气密度衰减 */
  enginePowerSL: 470e3,
  /** 发动机功率响应时间常数（s）：增大功率较慢、减小较快 */
  powerTauUp: 0.55,
  powerTauDown: 0.3,
  /** 悬停型阻功率（W） */
  profilePower: 32e3,
  /** 诱导功率修正系数 */
  kappa: 1.15,
  /**
   * 总距满行程时、海平面、无地效时的推力 / 基础重量（桨叶失速限制，随空气密度线性下降）。
   * 取 2.2：海平面和中等海拔先受功率限制；约 5000 m 时仍有约 20% 推力余量，高原上同样先受功率限制。
   */
  thrustFull: 2.2,
  /** 推力保底（相对当前重量）：任何海拔、任何载重下总距满行程至少能产生的推力，避免无法脱离的死局 */
  thrustFloor: 1.12,
  /** 机身阻力面积 Cd·A（m²）：前向、侧向、垂向 */
  dragArea: { fwd: 1.35, side: 5.4, top: 7.5 },
  /** 旋翼桨盘面内阻力（H 力，N/(m/s)），低速时更大（桨盘随相对气流后倒） */
  hForce: 70,
  /** 升降阻尼（1/s）：爬升时推力下降、下降时推力增大 */
  heaveDampUp: 0.42,
  heaveDampDown: 0.62,
  /** 平移升力增益（相同总距下的推力增量） */
  etlGain: 0.1,
  /** 地面效应最大推力比 */
  groundEffectMax: 1.16,
  /** 尾桨力臂（m）与垂尾侧向面积（Cd·A） */
  tailArm: 6.4,
  finArea: 3.0,
  /** 桨盘后倒（迎面气流产生抬头力矩，N·m/(m/s)） */
  blowback: 55,
  /** 上反效应（侧向气流产生滚转力矩，N·m/(m/s)） */
  dihedral: 75,
  /** 天然气动角速度阻尼（1/s） */
  rateDamping: { pitch: 1.9, roll: 2.4, yaw: 0.8 },
  /** 周期变距操纵能力（满推力时最大角加速度，rad/s²） */
  cyclicAuthority: { pitch: 2.6, roll: 3.4 },
  /** 尾桨最大反扭矩（N·m） */
  tailAuthority: 13000,
  /** 主旋翼反扭矩方向：+1 表示机头被推向右（逆时针旋翼，俯视） */
  torqueSign: 1,
  /** 滑橇几何（机体坐标，重心为原点，-Z 为机头） */
  skid: {
    halfSpan: 1.15,
    front: -1.45,
    rear: 1.5,
    /** 弹簧吊点高度（重心下方） */
    attachY: -0.95,
    /** 弹簧自由长度：吊点到滑橇底面 */
    restLength: 0.42,
    /** 最大行程（超过后由刚体滑橇碰撞体承受，计为重着陆） */
    travel: 0.3,
    /** 每个支点弹簧刚度（N/m）与阻尼（N·s/m） */
    stiffness: 52000,
    damping: 7600,
    friction: 0.85,
    /** 静摩擦近似：切向速度阻尼（N/(m/s)） */
    stickiness: 9000,
  },
  /** 机身碰撞体 */
  colliders: {
    cabin: { halfLength: 1.35, radius: 1.0, offsetZ: -0.35, offsetY: 0.05 },
    boom: { halfLength: 2.6, radius: 0.32, offsetZ: 4.1, offsetY: 0.55 },
    tailRotorRadius: 0.75,
    tailRotorZ: 7.15,
    tailRotorY: 1.1,
    rotorHalfHeight: 0.14,
  },
  /** 载货（每箱物资质量，kg） */
  crateMass: 140,
};

export type HeliConfig = typeof HELI;

export type AssistId = 'novice' | 'standard' | 'challenge';

export interface AssistPreset {
  id: AssistId;
  label: string;
  desc: string;
  /** attitude：松杆回到水平姿态；rate：松杆保持当前姿态（角速度指令） */
  attitudeMode: 'attitude' | 'rate';
  maxPitch: number;
  maxBank: number;
  /** 姿态→角速度增益（1/s）与角速度上限（rad/s） */
  attKp: number;
  maxRate: number;
  /** 角速度→角加速度增益（1/s） */
  rateKp: number;
  /** rate 模式下的弱自动改平增益 */
  autoLevel: number;
  /** 自动配平积分增益（消除稳态姿态误差） */
  autoTrim: number;
  /** 低速时偏航角速度上限（rad/s） */
  maxYawRate: number;
  yawKp: number;
  headingKp: number;
  /** 协调转弯程度 0..1 */
  coordination: number;
  /** 反扭矩前馈 0..1（1 = 总距变化不会引起偏航） */
  torqueFF: number;
  /** 侧滑抑制增益 */
  sideslipKp: number;
  /** 高度控制：vs = 垂直速度指令 + 高度保持；direct = 总距杆直接控制 */
  vertical: 'vs' | 'direct';
  maxClimb: number;
  maxDescent: number;
  altKp: number;
  altKi: number;
  vsKp: number;
  vsKi: number;
  /** 直接总距模式下的总距杆移动速度（1/s） */
  collectiveRate: number;
  /** 总距最大变化速度（1/s） */
  collectiveSlew: number;
  /** 近地下降限速：下降速度上限 = a + b × 离地高度（null 表示不限制） */
  descentLimiter: { a: number; b: number } | null;
  /** 无输入时的低速漂移阻尼（新手辅助） */
  driftDamping: number;
  /** 松杆时的自动减速（抬头量，rad/(m/s)） */
  autoBrake: number;
  /** 动力上限时自动减小前倾，防止掉高度 */
  envelopeProtection: boolean;
  /** 悬停辅助参数 */
  hover: { maxTilt: number; kv: number; kp: number; aMax: number; nudgeSpeed: number; climbRate: number };
  /** 输入平滑（每秒变化量） */
  inputRise: number;
  inputFall: number;
}

export const ASSISTS: Record<AssistId, AssistPreset> = {
  novice: {
    id: 'novice',
    label: '新手辅助',
    desc: '增稳最强：松开按键自动改平并缓慢减速，自动保持高度，近地自动限制下降速度。',
    attitudeMode: 'attitude',
    maxPitch: 16 * DEG,
    maxBank: 25 * DEG,
    attKp: 2.6,
    maxRate: 26 * DEG,
    rateKp: 6.5,
    autoLevel: 0,
    autoTrim: 0.9,
    maxYawRate: 40 * DEG,
    yawKp: 4.5,
    headingKp: 1.6,
    coordination: 1,
    torqueFF: 1,
    sideslipKp: 1.4,
    vertical: 'vs',
    maxClimb: 5,
    maxDescent: 4,
    altKp: 0.7,
    altKi: 0.06,
    vsKp: 0.16,
    vsKi: 0.05,
    collectiveRate: 0,
    collectiveSlew: 0.9,
    descentLimiter: { a: 0.7, b: 0.32 },
    driftDamping: 0.16,
    autoBrake: 0.05 * DEG,
    envelopeProtection: true,
    hover: { maxTilt: 10 * DEG, kv: 0.55, kp: 0.2, aMax: 2.2, nudgeSpeed: 3, climbRate: 2 },
    inputRise: 1.8,
    inputFall: 3.0,
  },
  standard: {
    id: 'standard',
    label: '标准辅助',
    desc: '默认模式：松开按键改平但保留惯性，保持垂直速度（高度会缓慢漂移），兼顾拟真与可玩性。',
    attitudeMode: 'attitude',
    maxPitch: 22 * DEG,
    maxBank: 35 * DEG,
    attKp: 2.1,
    maxRate: 32 * DEG,
    rateKp: 5.2,
    autoLevel: 0,
    autoTrim: 0.45,
    maxYawRate: 50 * DEG,
    yawKp: 4.0,
    headingKp: 1.2,
    coordination: 0.85,
    torqueFF: 1,
    sideslipKp: 1.0,
    vertical: 'vs',
    maxClimb: 7,
    maxDescent: 6,
    altKp: 0.35,
    altKi: 0,
    vsKp: 0.14,
    vsKi: 0.035,
    collectiveRate: 0,
    collectiveSlew: 1.0,
    descentLimiter: { a: 1.2, b: 0.5 },
    driftDamping: 0,
    autoBrake: 0,
    envelopeProtection: true,
    hover: { maxTilt: 12 * DEG, kv: 0.45, kp: 0.13, aMax: 2.6, nudgeSpeed: 3.5, climbRate: 2.5 },
    inputRise: 2.2,
    inputFall: 3.5,
  },
  challenge: {
    id: 'challenge',
    label: '挑战辅助',
    desc: '减少辅助：姿态按角速度控制（松杆保持当前姿态），总距杆直接控制升力，反扭矩协调不完全。',
    attitudeMode: 'rate',
    maxPitch: 38 * DEG,
    maxBank: 55 * DEG,
    attKp: 0,
    maxRate: 40 * DEG,
    rateKp: 4.2,
    autoLevel: 0.12,
    autoTrim: 0,
    maxYawRate: 60 * DEG,
    yawKp: 3.2,
    headingKp: 0.6,
    coordination: 0.5,
    torqueFF: 0.75,
    sideslipKp: 0.5,
    vertical: 'direct',
    maxClimb: 0,
    maxDescent: 0,
    altKp: 0,
    altKi: 0,
    vsKp: 0,
    vsKi: 0,
    collectiveRate: 0.42,
    collectiveSlew: 1.2,
    descentLimiter: null,
    driftDamping: 0,
    autoBrake: 0,
    envelopeProtection: false,
    hover: { maxTilt: 12 * DEG, kv: 0.35, kp: 0.08, aMax: 2.0, nudgeSpeed: 3, climbRate: 2 },
    inputRise: 2.6,
    inputFall: 4.0,
  },
};

/** 动力增强 Buff：可用功率倍率与持续时间 */
export const BOOST = { powerGain: 0.25, duration: 7, rampIn: 0.6, rampOut: 1.5, extraPitch: 5 * DEG, climbGain: 1.3 };

/** 标准大气：密度比 ρ/ρ0 */
export function densityRatio(altitudeMSL: number): number {
  return Math.exp(-Math.max(-500, altitudeMSL) / 8500);
}

/** 发动机高空功率系数（随密度衰减） */
export function engineAltitudeFactor(altitudeMSL: number): number {
  return Math.pow(densityRatio(altitudeMSL), 0.7);
}
