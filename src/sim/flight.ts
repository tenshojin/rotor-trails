// 直升机飞行动力学 + 飞行辅助系统。
// 本模块只计算“力与力矩”，位置/速度/姿态的积分由 Rapier 刚体完成（唯一的运动状态来源）。
// 机体坐标：+X 右，+Y 上，-Z 机头。世界坐标：+X 东，+Y 上，-Z 北。

import { Quaternion, Vector3 } from 'three';
import { HELI, ASSISTS, BOOST, densityRatio, engineAltitudeFactor, type AssistId, type AssistPreset } from '../config/flight';
import { approach, clamp, DEG, G, smoothstep, wrapPi } from '../core/math';

export interface BodyState {
  pos: Vector3;
  quat: Quaternion;
  vel: Vector3;
  angVel: Vector3;
}

export interface PilotInput {
  /** +1 = W（前倾加速），-1 = S（后倾减速） */
  pitch: number;
  /** +1 = D（右转），-1 = A（左转） */
  turn: number;
  /** +1 = E（向右平移），-1 = Q */
  lateral: number;
  /** +1 = 爬升键（默认空格），-1 = 下降键（默认 C） */
  vertical: number;
}

export interface FlightEnv {
  wind: Vector3;
  altitudeMSL: number;
  mass: number;
  /** 损伤性能系数（1 = 完好） */
  perf: number;
  /** 损伤严重度 0..1（轻微、可预测的稳定性影响） */
  severity: number;
  /** 动力增强 0..1（含渐入渐出） */
  boost: number;
  /** 桨毂到下方地表的距离（地面效应） */
  rotorClearance: number;
  /** 滑橇离地高度 */
  agl: number;
  /** 滑橇承重比（0 = 空中，1 = 全部重量在滑橇上） */
  weightOnSkids: number;
  /** 接触地面的滑橇支点数 */
  gearContacts: number;
  time: number;
}

export type HoverPhase = 'off' | 'braking' | 'holding';

export interface FlightTelemetry {
  thrust: number;
  powerReq: number;
  powerAvail: number;
  powerUsed: number;
  /** 当前使用功率占可用功率比例 */
  powerFrac: number;
  /** 悬停所需功率占可用功率比例（用于“动力余量”） */
  hoverPowerFrac: number;
  torqueLimited: boolean;
  collective: number;
  pitch: number;
  roll: number;
  heading: number;
  airspeed: number;
  forwardAirspeed: number;
  groundSpeed: number;
  verticalSpeed: number;
  sideslip: number;
  etl: number;
  groundEffect: number;
  rotorRpm: number;
  hover: HoverPhase;
  stickPitch: number;
  stickRoll: number;
  pedal: number;
  density: number;
  /** 指令的垂直速度（新手/标准模式），用于仪表游标 */
  vsCommand: number;
  altitudeHold: number | null;
}

const ROTOR_AREA = Math.PI * HELI.rotorRadius * HELI.rotorRadius;
const OMEGA = HELI.tipSpeed / HELI.rotorRadius;

/** 旋翼需用功率（动量理论 + 型阻功率 + 推力做功），单位 W。 */
export function powerRequired(T: number, rho: number, vAxial: number, vEdge: number, ge = 1): number {
  const mu = vEdge / HELI.tipSpeed;
  const p0 = HELI.profilePower * (rho / 1.225) * (1 + 4.65 * mu * mu);
  if (T <= 1) return p0;
  const vh2 = T / (2 * rho * ROTOR_AREA);
  const vh = Math.sqrt(vh2);
  let vi = vh;
  for (let k = 0; k < 10; k++) {
    const den = Math.max(Math.hypot(vEdge, vAxial + vi), 0.55 * vh);
    vi = 0.5 * vi + 0.5 * (vh2 / den);
  }
  return Math.max(0, (HELI.kappa * T * vi) / ge + T * vAxial + p0);
}

/** 在给定功率下能产生的最大推力（二分法）。 */
function thrustForPower(P: number, Tmax: number, rho: number, vAxial: number, vEdge: number, ge: number): number {
  if (powerRequired(Tmax, rho, vAxial, vEdge, ge) <= P) return Tmax;
  let lo = 0;
  let hi = Tmax;
  for (let i = 0; i < 18; i++) {
    const mid = 0.5 * (lo + hi);
    if (powerRequired(mid, rho, vAxial, vEdge, ge) <= P) lo = mid;
    else hi = mid;
  }
  return lo;
}

const _fwd = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _qInv = new Quaternion();
const _vAir = new Vector3();
const _vAirB = new Vector3();
const _wB = new Vector3();
const _tmp = new Vector3();
const _tb = new Vector3();

export class FlightModel {
  assist: AssistPreset = ASSISTS.standard;
  // 平滑后的操纵输入
  inP = 0;
  inT = 0;
  inL = 0;
  inV = 0;
  collective = 0;
  enginePower = 0;
  altRef: number | null = null;
  headingRef: number | null = null;
  hoverOn = false;
  posHold = false;
  posRefX = 0;
  posRefZ = 0;
  trimP = 0;
  trimR = 0;
  yawTrim = 0;
  vsInt = 0;
  altInt = 0;
  envScale = 1;
  /** 悬停辅助的风修正积分（m/s²，前/右） */
  hoverIntF = 0;
  hoverIntR = 0;
  lastThrust = HELI.massBase * G;
  groundTimer = 0;
  /** 着陆后自动关闭悬停辅助时置位，供界面提示 */
  hoverAutoOff = false;
  private stickP = 0;
  private stickR = 0;
  private pedal = 0;

  readonly telemetry: FlightTelemetry = {
    thrust: 0,
    powerReq: 0,
    powerAvail: 1,
    powerUsed: 0,
    powerFrac: 0,
    hoverPowerFrac: 0.6,
    torqueLimited: false,
    collective: 0,
    pitch: 0,
    roll: 0,
    heading: 0,
    airspeed: 0,
    forwardAirspeed: 0,
    groundSpeed: 0,
    verticalSpeed: 0,
    sideslip: 0,
    etl: 0,
    groundEffect: 1,
    rotorRpm: 1,
    hover: 'off',
    stickPitch: 0,
    stickRoll: 0,
    pedal: 0,
    density: 1,
    vsCommand: 0,
    altitudeHold: null,
  };

  setAssist(id: AssistId): void {
    this.assist = ASSISTS[id];
    this.trimP = this.trimR = this.vsInt = this.altInt = this.yawTrim = 0;
  }

  setHover(on: boolean): void {
    if (on === this.hoverOn) return;
    this.hoverOn = on;
    this.posHold = false;
    this.altRef = null;
    this.vsInt = 0;
    this.hoverIntF = this.hoverIntR = 0;
  }

  /** 检查点恢复或重生后：把控制器状态对齐到当前机体状态，避免突变。 */
  resetTo(b: BodyState, mass: number, altitudeMSL: number, grounded: boolean): void {
    this.inP = this.inT = this.inL = this.inV = 0;
    this.trimP = this.trimR = this.vsInt = this.altInt = this.yawTrim = 0;
    this.hoverIntF = this.hoverIntR = 0;
    this.envScale = 1;
    this.altRef = grounded ? null : b.pos.y;
    this.headingRef = null;
    this.posHold = false;
    const sigma = densityRatio(altitudeMSL);
    const W = mass * G;
    const Tfull = Math.max(HELI.thrustFull * HELI.massBase * G * sigma, HELI.thrustFloor * W);
    this.collective = grounded ? 0 : clamp(W / Tfull, 0, 1);
    this.enginePower = grounded ? HELI.profilePower : powerRequired(W, 1.225 * sigma, 0, 0, 1);
    this.lastThrust = grounded ? 0 : W;
    this.groundTimer = 0;
  }

  /**
   * 计算本步作用在机体上的合外力与合外力矩（世界坐标，不含重力）。
   * 重力由物理世界施加；滑橇弹簧力由起落架模块施加。
   */
  update(b: BodyState, env: FlightEnv, input: PilotInput, dt: number, outForce: Vector3, outTorque: Vector3): void {
    const H = HELI;
    const A = this.assist;
    const tel = this.telemetry;

    // ---------- 输入平滑 ----------
    this.inP = smoothAxis(this.inP, input.pitch, A, dt);
    this.inT = smoothAxis(this.inT, input.turn, A, dt);
    this.inL = smoothAxis(this.inL, input.lateral, A, dt);
    this.inV = smoothAxis(this.inV, input.vertical, A, dt);

    // ---------- 机体坐标与姿态 ----------
    const q = b.quat;
    _qInv.copy(q).invert();
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _up.set(0, 1, 0).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    const heading = Math.atan2(_fwd.x, -_fwd.z);
    const pitch = Math.asin(clamp(_fwd.y, -1, 1));
    const roll = Math.atan2(-_right.y, _up.y);
    _wB.copy(b.angVel).applyQuaternion(_qInv);
    const pitchRate = _wB.x;
    const yawRateR = -_wB.y;
    const rollRateR = -_wB.z;

    // ---------- 相对气流（地速 - 风速） ----------
    _vAir.copy(b.vel).sub(env.wind);
    _vAirB.copy(_vAir).applyQuaternion(_qInv);
    const forwardAir = -_vAirB.z;
    const lateralAir = _vAirB.x;
    const vAxial = _vAir.dot(_up);
    _tmp.copy(_up).multiplyScalar(vAxial);
    const vEdge = _tmp.subVectors(_vAir, _tmp).length();
    const sigma = densityRatio(env.altitudeMSL);
    const rho = 1.225 * sigma;

    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const vF = b.vel.x * sinH - b.vel.z * cosH; // 水平前向地速
    const vR = b.vel.x * cosH + b.vel.z * sinH; // 水平右向地速
    const groundSpeed = Math.hypot(b.vel.x, b.vel.z);

    // ---------- 可用功率 ----------
    const W = env.mass * G;
    const perfNorm = clamp((env.perf - 0.7) / 0.3, 0, 1);
    const pRaw = Math.min(H.transmissionLimit, H.enginePowerSL * engineAltitudeFactor(env.altitudeMSL)) * env.perf * (1 + BOOST.powerGain * env.boost);
    // 动力保底：任何情况下都能产生当前重量 110% 的悬停推力，避免无法脱离的死局
    const pHoverOGE = powerRequired(W, rho, 0, 0, 1);
    const pFloor = powerRequired(1.1 * W, rho, 0, 0, 1);
    const pAvail = Math.max(pRaw, pFloor);

    // ---------- 地面效应与平移升力 ----------
    let ge = 1;
    const z = env.rotorClearance;
    if (z < H.rotorRadius * 2.5) {
      const k = H.rotorRadius / (4 * Math.max(z, 0.35 * H.rotorRadius));
      ge = Math.min(H.groundEffectMax, 1 / Math.max(0.05, 1 - k * k));
      ge = 1 + (ge - 1) * (1 - smoothstep(5, 14, vEdge));
    }
    const etl = H.etlGain * smoothstep(4, 16, vEdge);
    const Tfull = Math.max(H.thrustFull * H.massBase * G * sigma, H.thrustFloor * W) * (1 + etl) * ge;

    const grounded = env.weightOnSkids > 0.55;
    // 三个以上滑橇支点触地：视为已经坐在地面上（即使总距还没完全放下）
    const onSkids = grounded || env.gearContacts >= 3;
    const coordBlend = smoothstep(6, 16, Math.max(0, forwardAir));

    // 着陆后自动关闭悬停辅助
    if (onSkids) this.groundTimer += dt;
    else this.groundTimer = 0;
    if (this.hoverOn && this.groundTimer > 1.2 && this.inV <= 0.05) {
      this.setHover(false);
      this.hoverAutoOff = true;
    }

    // ---------- 姿态指令 ----------
    let pitchCmd = 0;
    let rollCmd = 0;
    let pitchRateCmd: number;
    let rollRateCmd: number;
    let hoverPhase: HoverPhase = 'off';
    const boostPitch = BOOST.extraPitch * env.boost;

    if (this.hoverOn) {
      const hv = A.hover;
      const nudge = Math.abs(this.inP) > 0.05 || Math.abs(this.inL) > 0.05;
      if (nudge) this.posHold = false;
      else if (!this.posHold && groundSpeed < 2.0) {
        this.posHold = true;
        this.posRefX = b.pos.x;
        this.posRefZ = b.pos.z;
      }
      const eF = this.inP * hv.nudgeSpeed - vF;
      const eR = this.inL * hv.nudgeSpeed - vR;
      // 低速时积分修正持续风（否则在侧风中会有稳态漂移）
      if (groundSpeed < 8 && !grounded) {
        const ki = 0.18 * (0.6 + 0.4 * perfNorm);
        this.hoverIntF = clamp(this.hoverIntF + eF * ki * dt, -2.5, 2.5);
        this.hoverIntR = clamp(this.hoverIntR + eR * ki * dt, -2.5, 2.5);
      }
      let aF = hv.kv * eF + this.hoverIntF;
      let aR = hv.kv * eR + this.hoverIntR;
      if (this.posHold) {
        const ex = this.posRefX - b.pos.x;
        const ez = this.posRefZ - b.pos.z;
        aF += hv.kp * (ex * sinH - ez * cosH);
        aR += hv.kp * (ex * cosH + ez * sinH);
      }
      const aMax = hv.aMax * (0.6 + 0.4 * perfNorm);
      const aMag = Math.hypot(aF, aR);
      if (aMag > aMax) {
        aF *= aMax / aMag;
        aR *= aMax / aMag;
      }
      const tilt = hv.maxTilt * (0.85 + 0.15 * perfNorm);
      pitchCmd = clamp(-Math.atan(aF / G), -tilt, tilt);
      rollCmd = clamp(Math.atan(aR / G), -tilt, tilt);
      hoverPhase = this.posHold ? 'holding' : 'braking';
    } else {
      const maxFwd = A.maxPitch * this.envScale + boostPitch;
      pitchCmd = this.inP > 0 ? -this.inP * maxFwd : -this.inP * A.maxPitch * 0.85;
      rollCmd = this.inT * (coordBlend * A.maxBank + (1 - coordBlend) * 4 * DEG) + this.inL * A.maxBank * 0.55;
      if (Math.abs(this.inP) < 0.05 && A.autoBrake > 0) pitchCmd += clamp(A.autoBrake * vF, -6 * DEG, 6 * DEG);
      if (A.driftDamping > 0 && groundSpeed < 10) {
        const w = 1 - smoothstep(6, 10, groundSpeed);
        if (Math.abs(this.inP) < 0.05) pitchCmd += clamp(Math.atan((A.driftDamping * vF) / G), -4 * DEG, 4 * DEG) * w;
        if (Math.abs(this.inL) < 0.05 && Math.abs(this.inT) < 0.05) rollCmd += clamp(Math.atan((-A.driftDamping * vR) / G), -4 * DEG, 4 * DEG) * w;
      }
    }

    const rateMode = A.attitudeMode === 'rate' && !this.hoverOn;
    const attKp = rateMode ? 0 : this.hoverOn && A.attKp === 0 ? 2.0 : A.attKp;
    if (rateMode) {
      const lim = A.maxPitch + boostPitch;
      pitchRateCmd = -this.inP * A.maxRate + A.autoLevel * (0 - pitch);
      rollRateCmd = (this.inT * (0.35 + 0.65 * coordBlend) + this.inL * 0.6) * A.maxRate + A.autoLevel * (0 - roll);
      // 姿态包线：超过最大俯仰/坡度时把角速度指令推回
      if (pitch > lim) pitchRateCmd = Math.min(pitchRateCmd, -2 * (pitch - lim));
      if (pitch < -lim) pitchRateCmd = Math.max(pitchRateCmd, -2 * (pitch + lim));
      if (roll > A.maxBank) rollRateCmd = Math.min(rollRateCmd, -2 * (roll - A.maxBank));
      if (roll < -A.maxBank) rollRateCmd = Math.max(rollRateCmd, -2 * (roll + A.maxBank));
    } else {
      pitchRateCmd = clamp(attKp * (pitchCmd - pitch), -A.maxRate, A.maxRate);
      rollRateCmd = clamp(attKp * (rollCmd - roll), -A.maxRate, A.maxRate);
    }

    if (grounded) {
      // 滑橇承重时不与地面“较劲”：保持当前姿态，清空积分
      pitchRateCmd = 0;
      rollRateCmd = 0;
      this.trimP = this.trimR = 0;
    } else if (!rateMode && A.autoTrim > 0) {
      this.trimP = clamp(this.trimP + A.autoTrim * (pitchCmd - pitch) * dt * 4, -1.2, 1.2);
      this.trimR = clamp(this.trimR + A.autoTrim * (rollCmd - roll) * dt * 4, -1.2, 1.2);
    }

    const thrustRatio = clamp(this.lastThrust / (H.massBase * G), 0.3, 1.25);
    const authority = thrustRatio * (1 - 0.15 * env.severity);
    const sas = 1 - 0.12 * env.severity;
    let alphaP = A.rateKp * sas * (pitchRateCmd - pitchRate) + H.rateDamping.pitch * pitchRateCmd + this.trimP;
    let alphaR = A.rateKp * sas * (rollRateCmd - rollRateR) + H.rateDamping.roll * rollRateCmd + this.trimR;
    alphaP = clamp(alphaP, -H.cyclicAuthority.pitch * authority, H.cyclicAuthority.pitch * authority);
    alphaR = clamp(alphaR, -H.cyclicAuthority.roll * authority, H.cyclicAuthority.roll * authority);

    // ---------- 偏航（尾桨）与协调转弯 ----------
    const coordRate = coordBlend * A.coordination * ((G * Math.tan(clamp(roll, -1.2, 1.2))) / Math.max(forwardAir, 10));
    const beta = Math.atan2(lateralAir, Math.max(3, Math.abs(forwardAir)));
    const slipFix = coordBlend * A.coordination * A.sideslipKp * beta;
    let yawRateCmd: number;
    const turning = Math.abs(this.inT) > 0.05;
    if (this.hoverOn) {
      if (turning) {
        yawRateCmd = this.inT * A.maxYawRate * 0.7;
        this.headingRef = null;
      } else {
        if (this.headingRef === null && Math.abs(yawRateR) < 4 * DEG) this.headingRef = heading;
        yawRateCmd = this.headingRef !== null ? clamp(A.headingKp * wrapPi(this.headingRef - heading), -0.4, 0.4) : 0;
      }
    } else if (turning) {
      yawRateCmd = (1 - coordBlend) * this.inT * A.maxYawRate + coordRate + slipFix;
      this.headingRef = null;
    } else {
      if (this.headingRef === null && Math.abs(yawRateR) < 3 * DEG) this.headingRef = heading;
      const hold = this.headingRef !== null ? clamp(A.headingKp * wrapPi(this.headingRef - heading), -A.maxYawRate * 0.5, A.maxYawRate * 0.5) : 0;
      yawRateCmd = (1 - coordBlend) * hold + coordRate + slipFix;
      if (coordBlend > 0.5) this.headingRef = heading;
    }
    if (grounded) {
      yawRateCmd = 0;
      this.headingRef = heading;
      this.yawTrim = 0;
    }
    const yawErr = yawRateCmd - yawRateR;
    this.yawTrim = clamp(this.yawTrim + yawErr * dt * (A.torqueFF < 1 ? 0.6 : 1.5), -1.5, 1.5);
    const alphaY = A.yawKp * yawErr + H.rateDamping.yaw * yawRateCmd + (grounded ? 0 : this.yawTrim);

    // ---------- 垂直控制（总距） ----------
    let vsCmd = 0;
    const climbMax = (A.vertical === 'vs' ? A.maxClimb : 7) * (1 + (BOOST.climbGain - 1) * env.boost);
    const autoVertical = A.vertical === 'vs' || this.hoverOn;
    if (autoVertical) {
      const lim = A.descentLimiter ?? (this.hoverOn ? { a: 1.2, b: 0.5 } : null);
      let maxDesc = A.vertical === 'vs' ? A.maxDescent : 5;
      if (this.hoverOn) maxDesc = Math.min(maxDesc, A.hover.climbRate * 1.2);
      // 下降限制随离地高度放宽；高原上动力余量小、拉住下降更慢，限制相应收紧
      const marginK = 0.65 + 0.35 * clamp((pAvail / pHoverOGE - 1) / 0.4, 0, 1);
      // 预判：按约 0.7 s 后的离地高度计算，避免下降率来不及减小
      const aglLead = Math.max(0, env.agl + Math.min(0, b.vel.y) * 0.7);
      if (lim) maxDesc = Math.min(maxDesc, (lim.a + lim.b * aglLead) * marginK);
      const climbLim = this.hoverOn ? A.hover.climbRate : climbMax;
      if (this.inV > 0.05) {
        vsCmd = this.inV * climbLim;
        this.altRef = null;
        this.altInt = 0;
      } else if (this.inV < -0.05) {
        vsCmd = this.inV * maxDesc;
        this.altRef = null;
        this.altInt = 0;
      } else if (env.gearContacts >= 2) {
        // 滑橇已触地且没有上升指令：继续缓慢放下总距直到停稳，而不是“悬”在地面上
        vsCmd = -0.6;
        this.altRef = null;
        this.altInt = 0;
      } else {
        if (this.altRef === null) this.altRef = b.pos.y + b.vel.y * 0.6;
        const kp = this.hoverOn ? Math.max(0.6, A.altKp) : A.altKp;
        const ki = this.hoverOn ? Math.max(0.05, A.altKi) : A.altKi;
        const err = this.altRef - b.pos.y;
        this.altInt = clamp(this.altInt + err * dt * ki, -1.5, 1.5);
        vsCmd = clamp(kp * err + this.altInt, -maxDesc, climbLim * 0.7);
      }
      const vsKp = A.vertical === 'vs' ? A.vsKp : 0.14;
      const vsKi = A.vertical === 'vs' ? A.vsKi : 0.035;
      const vsErr = vsCmd - b.vel.y;
      let cmd: number;
      if (onSkids && vsCmd <= 0.3) {
        cmd = 0;
        this.vsInt = 0;
        this.altRef = null;
      } else {
        this.vsInt = clamp(this.vsInt + vsErr * vsKi * dt, -0.25, 0.25);
        const tilt = Math.max(0.35, _up.y);
        const ff = W / tilt / Tfull;
        cmd = ff + vsKp * vsErr + this.vsInt;
      }
      this.collective = approach(this.collective, clamp(cmd, 0, 1), A.collectiveSlew * dt);
      // 动力上限保护：持续掉高度时自动减小前倾
      if (A.envelopeProtection) {
        const sinking = tel.torqueLimited && vsErr > 0.8 && this.inP > 0.1;
        this.envScale = approach(this.envScale, sinking ? 0.55 : 1, (sinking ? 0.25 : 0.15) * dt);
      }
    } else {
      this.collective = clamp(this.collective + this.inV * A.collectiveRate * dt, 0, 1);
    }

    // ---------- 推力（总距 → 推力 → 功率限制） ----------
    const heave = vAxial > 0 ? H.heaveDampUp : H.heaveDampDown;
    const Tdes = Math.max(0, this.collective * Tfull - heave * env.mass * vAxial);
    const pReq = powerRequired(Tdes, rho, vAxial, vEdge, ge);
    const pTarget = Math.min(pReq, pAvail);
    const tau = pTarget > this.enginePower ? H.powerTauUp : H.powerTauDown;
    this.enginePower += (pTarget - this.enginePower) * (1 - Math.exp(-dt / tau));
    let thrust = Tdes;
    if (pReq > this.enginePower + 1) thrust = thrustForPower(this.enginePower, Tdes, rho, vAxial, vEdge, ge);
    this.lastThrust = thrust;
    const torqueLimited = pReq > pAvail * 1.002;

    // ---------- 力 ----------
    outForce.copy(_up).multiplyScalar(thrust);
    const half = 0.5 * rho;
    _tb.set(
      -half * H.dragArea.side * _vAirB.x * Math.abs(_vAirB.x),
      -half * H.dragArea.top * _vAirB.y * Math.abs(_vAirB.y),
      -half * H.dragArea.fwd * _vAirB.z * Math.abs(_vAirB.z),
    ).applyQuaternion(q);
    outForce.add(_tb);
    // 桨盘面内阻力（H 力，含低速时桨盘随风后倒的效果：悬停时侧风会推着飞机漂移），随推力变化
    _tmp.copy(_up).multiplyScalar(vAxial);
    const hk = H.hForce * (1 - 0.6 * smoothstep(10, 30, vEdge));
    _tb.subVectors(_vAir, _tmp).multiplyScalar(-hk * thrustRatio);
    outForce.add(_tb);

    // ---------- 力矩（机体坐标：抬头、右偏航、右滚转） ----------
    const I = H.inertia;
    const massScale = env.mass / H.massBase;
    const Ip = I.pitch * (1 + 0.6 * (massScale - 1));
    const Ir = I.roll * (1 + 0.6 * (massScale - 1));
    const Iy = I.yaw * (1 + 0.6 * (massScale - 1));
    let tauPitch = Ip * alphaP;
    let tauRoll = Ir * alphaR;
    // 天然气动阻尼
    tauPitch -= Ip * H.rateDamping.pitch * pitchRate;
    tauRoll -= Ir * H.rateDamping.roll * rollRateR;
    // 桨盘后倒与上反效应（阵风会产生可恢复的姿态扰动）
    tauPitch += H.blowback * forwardAir * thrustRatio;
    tauRoll += -H.dihedral * lateralAir * thrustRatio;
    // 损伤：轻微、规律、可预测的摆动
    if (env.severity > 0) {
      const s2 = env.severity * env.severity;
      tauRoll += Ir * 0.22 * s2 * Math.sin(env.time * 2.2);
      tauPitch += Ip * 0.14 * s2 * Math.sin(env.time * 1.7 + 1.3);
    }
    // 主旋翼反扭矩 + 尾桨
    const qMain = H.torqueSign * (this.enginePower / OMEGA);
    let tailTorque = Iy * alphaY - qMain * A.torqueFF;
    const tailMax = H.tailAuthority * Math.max(0.5, sigma) * (1 - 0.1 * env.severity);
    tailTorque = clamp(tailTorque, -tailMax, tailMax);
    const yawDamp = Iy * (H.rateDamping.yaw + 0.01 * Math.abs(forwardAir)) * yawRateR;
    const fin = 0.5 * rho * H.finArea * lateralAir * Math.abs(lateralAir) * H.tailArm;
    const tauYawRight = tailTorque + qMain - yawDamp + fin;

    outTorque.set(tauPitch, -tauYawRight, -tauRoll).applyQuaternion(q);

    // ---------- 驾驶舱操纵杆动画与遥测 ----------
    this.stickP += (clamp(alphaP / H.cyclicAuthority.pitch, -1, 1) - this.stickP) * Math.min(1, dt * 10);
    this.stickR += (clamp(alphaR / H.cyclicAuthority.roll, -1, 1) - this.stickR) * Math.min(1, dt * 10);
    this.pedal += (clamp(tailTorque / H.tailAuthority, -1, 1) - this.pedal) * Math.min(1, dt * 10);

    tel.thrust = thrust;
    tel.powerReq = pReq;
    tel.powerAvail = pAvail;
    tel.powerUsed = this.enginePower;
    tel.powerFrac = this.enginePower / pAvail;
    tel.hoverPowerFrac = pHoverOGE / pAvail;
    tel.torqueLimited = torqueLimited;
    tel.collective = this.collective;
    tel.pitch = pitch;
    tel.roll = roll;
    tel.heading = heading;
    tel.airspeed = _vAir.length();
    tel.forwardAirspeed = forwardAir;
    tel.groundSpeed = groundSpeed;
    tel.verticalSpeed = b.vel.y;
    tel.sideslip = beta;
    tel.etl = etl;
    tel.groundEffect = ge;
    tel.rotorRpm = 1 - 0.04 * clamp((pReq - this.enginePower) / pAvail, 0, 1);
    tel.hover = this.hoverOn ? hoverPhase : 'off';
    tel.stickPitch = this.stickP;
    tel.stickRoll = this.stickR;
    tel.pedal = this.pedal;
    tel.density = sigma;
    tel.vsCommand = vsCmd;
    tel.altitudeHold = this.altRef;
  }
}

function smoothAxis(current: number, target: number, A: AssistPreset, dt: number): number {
  const rising = Math.abs(target) > Math.abs(current) && Math.sign(target) === Math.sign(current || target);
  const rate = rising ? A.inputRise : A.inputFall;
  return approach(current, clamp(target, -1, 1), rate * dt);
}
