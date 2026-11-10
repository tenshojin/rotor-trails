// 机载系统（超仿真模式）：电源、发动机、燃油、液压、灯光、告警。
// 这里只有数值和逻辑，不碰画面和声音，飞行模型和座舱都读这份状态。
// 机型 RT-7 是虚构的单发涡轴直升机，数量级取同级别机型（470 kW 涡轴、24 V 镍镉电瓶、三片桨）。
// 启动程序按全权数字控制的涡轴发动机来：主开关打到 IDLE 自动起动，打到 FLIGHT 调速器把旋翼带到 100%。

import { approach, clamp, smoothstep } from '../core/math';
import { tr } from '../i18n';

/** 所有按钮和开关的当前位置（数值含义见 controls.ts），存档点恢复时整份复制 */
export type ControlState = Record<string, number>;

/** 断路器：面板下方两排 + 顶部操纵盒两排 */
export const PANEL_BREAKERS = ['batt', 'gen', 'stby', 'avnx', 'gps', 'com', 'xpdr', 'hyd', 'fuel', 'start', 'navlt', 'ldglt', 'wiper', 'ics'] as const;
export const OVERHEAD_BREAKERS = ['fadec', 'ign', 'fire', 'chip', 'pitot', 'cabht', 'maplt', 'instlt', 'domelt', 'audio', 'elt', 'horn'] as const;

export const ENGINE = {
  /** 慢车 N1（%）与此时调速器要的旋翼转速 */
  idleN1: 68,
  idleNr: 0.68,
  /** 起动机最高把 N1 带到这里；超过脱开 */
  starterCut: 44,
  /** 点火的 N1 门槛 */
  lightOff: 12,
  /** 排气温度（℃）：起动限制、连续限制 */
  totStartLimit: 865,
  totLimit: 880,
  /** 主减速器限制功率（W），超过算超扭 */
  torqueLimit: 340e3,
  fuelMax: 430,
  /** 每千瓦时耗油（kg），涡轴在这个功率段的量级 */
  sfc: 0.36,
  /** 起飞时油箱里有多少 */
  fuelStart: 300,
} as const;

/** 飞行模型每步给的东西 */
export interface SystemsInput {
  dt: number;
  /** 旋翼转速比（1 = 100%） */
  nr: number;
  /** 调速器此刻要的轴功率（W） */
  powerDemand: number;
  /** 发动机现在输出的轴功率（W） */
  shaftPower: number;
  altitudeMSL: number;
  /** 外界气温（℃） */
  oat: number;
  /** 雨量 0..1 */
  rain: number;
  airspeed: number;
  /** 飞机在地面上 */
  onGround: boolean;
  /** 当前高度的最大可用功率（W） */
  powerMax: number;
}

/** 告警灯板：4 行 × 6 列，顺序与 tools/blender/cockpit_layout.py 的 ANNUNCIATOR 相同 */
export interface Caution {
  gov: boolean;
  engP: boolean;
  fuelP: boolean;
  gen: boolean;
  batt: boolean;
  horn: boolean;
  tqLim: boolean;
  nrLow: boolean;
  xmsn: boolean;
  hyd: boolean;
  pitot: boolean;
  lowFuel: boolean;
  engChip: boolean;
  mgbChip: boolean;
  tgbChip: boolean;
  fire: boolean;
  sand: boolean;
  rotorBrake: boolean;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
  spot: string;
  key: string;
  want: number;
}

function defaults(): ControlState {
  const c: ControlState = {
    // 翘板开关
    batt: 0,
    gen: 0,
    fuelP: 0,
    acol: 0,
    pitot: 0,
    cabHt: 0,
    sas: 0,
    hydSw: 1,
    hornMute: 0,
    demist: 0,
    domeLt: 0,
    mapLt: 0,
    // 发动机主开关：0 OFF，1 IDLE，2 FLIGHT
    engMain: 0,
    // 拉杆：1 = 打开（燃油）/ 松开（旋翼刹车）
    fuelValve: 1,
    rotorBrake: 1,
    // 护盖开关：guard 1 = 打开护盖，emer 1 = 切断
    emerGuard: 0,
    emer: 0,
    ldg: 0,
    pos: 0,
    wiper: 0,
    // 旋钮 0..1
    nightMode: 0,
    systLite: 0.8,
    instLite: 0.5,
    audioVol: 0.7,
    audioSql: 0.5,
    baro: 1013,
    hdgBug: 0,
    aiTrim: 0,
    // 发动机显示器
    vemdOff1: 0,
    vemdOff2: 0,
    vemdPage: 0,
    vemdBrt: 0.85,
    vemdSel: 0,
    fuelAlert: 60,
    // GPS
    gpsPower: 1,
    gpsPage: 0,
    gpsRange: 2,
    // 电台（kHz），COM 音量
    comActive: 118300,
    comStby: 121500,
    comVol: 0.6,
    // 应答机：0 OFF，1 SBY，2 ON，3 ALT
    xpdrMode: 0,
    xpdrCode: 7000,
    xpdrIdent: 0,
    // 紧急定位发射机：0 OFF，1 ARM，2 ON
    elt: 1,
    // 音频面板
    aCom1: 1,
    aCom2: 0,
    aNav: 0,
    aAdf: 0,
    aIcs: 1,
    aPa: 0,
    aSpkr: 0,
    aMkr: 0,
    aDme: 0,
    aAux: 0,
    aVox: 0,
    aHi: 0,
    aNorm: 1,
    aTest: 0,
    comMon: 0,
    // 操纵台
    flood: 0,
    hook: 0,
    cam: 0,
    float: 0,
    auxSw: 0,
    domeDim: 0.7,
    mapDim: 0.7,
    floodDim: 0.5,
    heat: 0.5,
    vent: 0.3,
    // 平板页面
    efbPage: 0,
  };
  for (const b of PANEL_BREAKERS) c[`cb_${b}`] = 1;
  for (const b of OVERHEAD_BREAKERS) c[`ob_${b}`] = 1;
  return c;
}

export class Systems {
  c: ControlState = defaults();
  // ---------- 电源 ----------
  /** 主汇流条电压（V） */
  busV = 0;
  /** 电瓶电量 0..1 */
  soc = 0.92;
  /** 电瓶电流（A，放电为正） */
  battAmps = 0;
  genOnline = false;
  // ---------- 发动机 ----------
  n1 = 0;
  tot = 15;
  oilP = 0;
  oilT = 15;
  /** 燃油压力（bar） */
  fuelPress = 0;
  fuelKg: number = ENGINE.fuelStart;
  fuelFlow = 0;
  lit = false;
  starter = false;
  igniting = false;
  /** 起动失败、超温等留下的发动机损伤 0..1 */
  engineWear = 0;
  /** 最近一次起动的 TOT 峰值 */
  startPeak = 0;
  // ---------- 传动与液压 ----------
  /** 液压压力（bar） */
  hydP = 0;
  /** 超扭累计（秒）：过久主减速器损坏 */
  overTorque = 0;
  mgbDamage = 0;
  /** 皮托管结冰 0..1 */
  pitotIce = 0;
  /** 风挡起雾 0..1 */
  fog = 0;
  // ---------- 其它 ----------
  /** 发动机运转计时（小时） */
  hobbs = 1284.3;
  /** 灯泡测试按住时全亮 */
  lampTest = false;
  /** 测试按钮：火警灯、低转速喇叭响多久（秒） */
  fireTest = 0;
  hornTest = 0;
  /** 应答机识别信号还剩多久（秒） */
  xpdrIdent = 0;
  /** 主告警：亮了新灯就响，按灯板确认 */
  masterCaution = false;
  /** 本次飞行计时（秒，发动机运转时走） */
  flightTime = 0;
  private lastLit = new Set<string>();
  /** 第一次把电瓶打开时，仪表自检一小段时间 */
  selfTest = 0;
  private wasPowered = false;
  private overTemp = 0;
  private fireT = 0;

  /** 燃油用掉多少（kg），飞行模型按它减轻重量 */
  get fuelBurnt(): number {
    return ENGINE.fuelStart - this.fuelKg;
  }

  private on(id: string): boolean {
    return this.c[id] > 0.5;
  }

  /** 汇流条有电 */
  get powered(): boolean {
    return this.busV > 16;
  }

  /** 这个设备有电吗：汇流条有电、断路器合着、应急开关没切 */
  feeds(cb: string): boolean {
    return this.powered && this.c[cb] > 0.5 && !this.on('emer');
  }

  /** 应急开关只切航电和灯，留下发动机需要的基本供电 */
  private essential(cb: string): boolean {
    return this.powered && this.c[cb] > 0.5;
  }

  get fadecOk(): boolean {
    return this.essential('ob_fadec');
  }

  /** 调速器此刻要的旋翼转速（0 = 不调速） */
  get nrTarget(): number {
    if (!this.lit) return 0;
    if (this.c.engMain >= 2 && this.fadecOk) return 1;
    return ENGINE.idleNr;
  }

  /** 发动机此刻最多能拿出的轴功率（W） */
  shaftAvail(powerMax: number): number {
    if (!this.lit) return 0;
    const k = clamp((this.n1 - 28) / 72, 0, 1);
    return powerMax * Math.pow(k, 1.55) * (1 - 0.35 * this.engineWear);
  }

  /** 旋翼刹车的力矩（N·m） */
  get brakeTorque(): number {
    return this.c.rotorBrake < 0.5 ? 2400 : 0;
  }

  /** 液压助力 0..1：没有液压时操纵很沉 */
  get hydraulics(): number {
    return clamp(this.hydP / 40, 0, 1);
  }

  get sasActive(): boolean {
    return this.on('sas') && this.feeds('cb_stby');
  }

  /** 操纵机构要的灯：着陆灯、航行灯、防撞灯 */
  get landingLight(): boolean {
    return this.on('ldg') && this.feeds('cb_ldglt');
  }

  get navLights(): boolean {
    return this.on('pos') && this.feeds('cb_navlt');
  }

  get beacon(): boolean {
    return this.on('acol') && this.powered && !this.on('emer');
  }

  get wiperSpeed(): number {
    return this.feeds('cb_wiper') ? this.c.wiper : 0;
  }

  get avionics(): boolean {
    return this.feeds('cb_avnx');
  }

  get vemdOn(): boolean {
    return this.essential('cb_stby') && this.selfTest >= 0;
  }

  /** 显示屏亮度 0..1 */
  get screenLevel(): number {
    return this.vemdOn ? 0.15 + 0.85 * this.c.vemdBrt * (this.c.nightMode > 0.5 ? 0.45 : 1) : 0;
  }

  /** 把飞机放到“已经在飞”的状态：空中出生、瞬移、从检查点恢复 */
  setRunning(): void {
    const c = this.c;
    c.batt = c.gen = c.fuelP = c.acol = c.pitot = 1;
    c.pos = c.sas = c.hydSw = 1;
    c.engMain = 2;
    c.fuelValve = c.rotorBrake = 1;
    c.emer = c.emerGuard = 0;
    for (const k of Object.keys(c)) if (k.startsWith('cb_') || k.startsWith('ob_')) c[k] = 1;
    c.xpdrMode = 3;
    this.lit = true;
    this.starter = this.igniting = false;
    this.genOnline = true;
    this.n1 = 86;
    this.tot = 640;
    this.oilP = 3.6;
    this.oilT = 78;
    this.fuelPress = 1.3;
    this.hydP = 40;
    this.busV = 28;
    this.selfTest = 0;
    this.wasPowered = true;
    this.lastLit.clear();
  }

  update(i: SystemsInput): void {
    const { dt } = i;
    this.updateElectrics(i);
    this.updateFuel(i);
    this.updateEngine(i);
    this.updateHydraulics(i);
    this.updateEnvironment(i);
    if (this.powered && !this.wasPowered) this.selfTest = 2.4;
    this.wasPowered = this.powered;
    if (this.selfTest > 0) this.selfTest = Math.max(0, this.selfTest - dt);
    this.fireTest = Math.max(0, this.fireTest - dt);
    this.hornTest = Math.max(0, this.hornTest - dt);
    this.xpdrIdent = Math.max(0, this.xpdrIdent - dt);
    if (this.lit || i.nr > 0.2) {
      this.flightTime += dt;
      this.hobbs += dt / 3600;
    }
    this.updateMaster();
  }

  private updateElectrics(i: SystemsInput): void {
    const c = this.c;
    const battRelay = this.on('batt') && c.cb_batt > 0.5;
    this.genOnline = this.on('gen') && c.cb_gen > 0.5 && this.n1 > 58 && !this.on('emer') && (battRelay || this.n1 > 62);
    // 用电：底噪 + 起动机。起动电流大，电压明显掉下去，这是真的：电瓶没电时起动机转不动
    let load = 6;
    if (this.on('fuelP') && this.fuelPumpFed()) load += 6;
    if (this.avionics) load += 9;
    if (this.landingLight) load += 12;
    if (this.navLights) load += 3;
    if (this.beacon) load += 2;
    if (this.on('cabHt') && this.feeds('ob_cabht')) load += 10;
    if (this.on('pitot') && this.feeds('ob_pitot')) load += 6;
    if (this.wiperSpeed > 0) load += 3;
    if (this.starter) load += 260 * (1 - clamp(this.n1 / ENGINE.starterCut, 0, 0.72));
    if (this.genOnline) {
      this.busV = approach(this.busV, 28.2, 40 * i.dt);
      // 发电机顶着用电，还给电瓶充电
      this.battAmps = battRelay ? -clamp((1 - this.soc) * 90, 0, 45) : 0;
      if (battRelay) this.soc = Math.min(1, this.soc + (-this.battAmps * i.dt) / (17 * 3600));
    } else if (battRelay) {
      const open = 22.5 + 3.4 * Math.pow(this.soc, 0.6);
      this.busV = approach(this.busV, open - load * 0.018, 60 * i.dt);
      this.battAmps = load;
      this.soc = Math.max(0, this.soc - (load * i.dt) / (17 * 3600));
    } else {
      this.busV = approach(this.busV, 0, 120 * i.dt);
      this.battAmps = 0;
    }
  }

  private fuelPumpFed(): boolean {
    return this.feeds('cb_fuel');
  }

  private updateFuel(i: SystemsInput): void {
    const pump = this.on('fuelP') && this.fuelPumpFed() && this.fuelKg > 0;
    // 发动机自带的高压泵：转起来以后就算电动泵关了也有油压，只是低一点
    const engine = clamp(this.n1 / 60, 0, 1) * 0.9;
    const want = this.fuelKg <= 0 ? 0 : Math.max(pump ? 1.3 : 0, engine);
    this.fuelPress = approach(this.fuelPress, want, 1.8 * i.dt);
    const open = this.c.fuelValve > 0.5 && this.fuelKg > 0;
    if (this.lit) {
      const kw = Math.max(i.shaftPower, 42e3) / 1000;
      this.fuelFlow = kw * ENGINE.sfc;
      this.fuelKg = Math.max(0, this.fuelKg - (this.fuelFlow / 3600) * i.dt);
    } else this.fuelFlow = 0;
    if (this.lit && (!open || this.fuelPress < 0.2)) this.flameOut();
  }

  private flameOut(): void {
    this.lit = false;
    this.igniting = false;
  }

  private updateEngine(i: SystemsInput): void {
    const { dt } = i;
    const c = this.c;
    const want = c.engMain;
    if (want < 1 && this.lit) this.flameOut();
    // 起动机：主开关到 IDLE、有电、断路器合着；N1 上来后自动脱开
    const canCrank = want >= 1 && !this.lit && this.essential('cb_start') && this.n1 < ENGINE.starterCut;
    const assist = want >= 1 && this.lit && this.n1 < ENGINE.starterCut && this.essential('cb_start');
    this.starter = canCrank || assist;
    const ignOk = this.essential('ob_ign') && this.fadecOk;
    this.igniting = this.starter && this.n1 > ENGINE.lightOff * 0.8 && ignOk;
    if (!this.lit && want >= 1 && this.igniting && this.n1 >= ENGINE.lightOff && c.fuelValve > 0.5 && this.fuelPress > 0.7) {
      this.lit = true;
      this.startPeak = this.tot;
    }
    // 起动机力量看电压：电瓶弱就转得慢，N1 爬得慢，燃烧室里油多气少，温度更高
    const volts = clamp((this.busV - 15) / 9, 0, 1);
    let target: number;
    let rate: number;
    if (this.lit) {
      const idle = ENGINE.idleN1 * (1 + 0.05 * clamp(i.altitudeMSL / 4000, 0, 1));
      // 轴功率要多少，N1 就去多少；功率和 N1 的关系与 shaftAvail 相反
      const frac = clamp(i.powerDemand / Math.max(1, i.powerMax), 0, 1.12);
      const need = 28 + 72 * Math.pow(frac, 1 / 1.55);
      target = this.fadecOk ? Math.max(idle, need) : Math.max(idle, this.n1);
      if (want >= 2 && this.fadecOk) target = Math.max(target, 74);
      target = Math.min(target, 104);
      const starting = this.n1 < idle - 2;
      rate = starting ? 1.6 + 1.0 * volts : target > this.n1 ? 14 : 16;
      if (starting) {
        const k = clamp(this.n1 / idle, 0, 1);
        rate *= 0.55 + 1.1 * k * (1 - k) * 2;
      }
    } else if (this.starter) {
      target = 20 + 12 * volts;
      rate = 1.7 + 3.1 * volts;
    } else {
      target = 0;
      rate = this.n1 > 30 ? 9 : 3.4;
    }
    this.n1 = approach(this.n1, target, rate * dt);
    // 排气温度：点火后冲一个峰，再回到和功率对应的值
    let totTarget: number;
    if (this.lit) {
      const starting = this.n1 < ENGINE.idleN1 - 1;
      const load = clamp(i.shaftPower / Math.max(1, i.powerMax), 0, 1.15);
      totTarget = 470 + 330 * Math.pow(load, 0.75) + 8 * Math.max(0, i.oat - 15);
      if (starting) totTarget = 690 + 150 * (1 - volts) + 6 * Math.max(0, i.oat - 15);
    } else totTarget = Math.max(i.oat, this.n1 > 8 ? 120 : i.oat);
    const up = this.lit ? (this.n1 < 30 ? 210 : 70) : 0;
    const down = this.lit ? 42 : this.n1 > 8 ? 55 : 12;
    this.tot = approach(this.tot, totTarget, (totTarget > this.tot ? up : down) * dt);
    if (this.lit && this.n1 < ENGINE.idleN1) this.startPeak = Math.max(this.startPeak, this.tot);
    // 超温：起动超限或长时间过热，发动机留下损伤；再严重就起火
    const limit = this.n1 < ENGINE.idleN1 ? ENGINE.totStartLimit : ENGINE.totLimit;
    if (this.lit && this.tot > limit) {
      this.overTemp += dt;
      this.engineWear = Math.min(1, this.engineWear + 0.02 * dt * (1 + (this.tot - limit) / 40));
    } else this.overTemp = Math.max(0, this.overTemp - dt * 0.5);
    this.fireT = this.overTemp > 9 ? this.fireT + dt : Math.max(0, this.fireT - dt);
    // 滑油：压力跟着 N1，温度慢慢上来
    this.oilP = approach(this.oilP, 4.2 * smoothstep(0, 72, this.n1), 2.2 * dt);
    this.oilT = approach(this.oilT, this.lit ? 62 + 30 * clamp(this.n1 / 100, 0, 1) : Math.max(i.oat, this.oilT - 1), (this.lit ? 0.32 : 0.05) * dt);
    // 超扭：短时间可以，久了主减速器受不了
    if (i.shaftPower > ENGINE.torqueLimit * 1.04) {
      this.overTorque += dt * (i.shaftPower / ENGINE.torqueLimit - 1) * 10;
      if (this.overTorque > 20) this.mgbDamage = Math.min(1, this.mgbDamage + 0.01 * dt);
    } else this.overTorque = Math.max(0, this.overTorque - dt * 0.15);
  }

  private updateHydraulics(i: SystemsInput): void {
    const on = this.on('hydSw') && this.c.cb_hyd > 0.5;
    const want = on ? 42 * smoothstep(0.2, 0.62, i.nr) : 0;
    this.hydP = approach(this.hydP, want, (want > this.hydP ? 70 : 30) * i.dt);
  }

  private updateEnvironment(i: SystemsInput): void {
    const { dt } = i;
    // 皮托管：冷而湿的空气里，不加温就慢慢结冰，空速表开始读低
    const heated = this.on('pitot') && this.feeds('ob_pitot');
    const icing = i.oat < 3 && i.rain > 0.1 ? i.rain : 0;
    this.pitotIce = clamp(this.pitotIce + (heated ? -0.2 : icing * 0.03) * dt, 0, 1);
    // 风挡起雾：潮湿、外面比舱里冷；暖风和除雾能吹掉
    const heater = this.on('cabHt') && this.feeds('ob_cabht') ? 1 : 0;
    const demist = this.on('demist') && this.powered ? 1 : 0;
    const humid = clamp(i.rain * 1.1 + (i.oat < 8 ? 0.25 : 0), 0, 1);
    const wet = humid * (1 - 0.8 * heater) * (1 - demist);
    this.fog = clamp(this.fog + (wet * 0.012 - (heater * 0.05 + demist * 0.12 + 0.002)) * dt, 0, 0.75);
  }

  /** 空速表能感到的比例：皮托管冻住以后读数往下掉 */
  get pitotFactor(): number {
    return 1 - 0.85 * this.pitotIce;
  }

  caution(nr: number, shaftPower: number, onGround: boolean): Caution {
    const live = this.essential('cb_stby') || this.powered;
    const nrAlarm = nr < 0.93 && (!onGround || (this.c.engMain >= 2 && this.lit));
    return {
      gov: live && (!this.fadecOk || (this.lit && this.c.engMain < 2) || (!this.lit && this.c.engMain >= 1 && this.n1 < 5)),
      engP: live && this.oilP < 1.2,
      fuelP: live && this.fuelPress < 0.6,
      gen: live && !this.genOnline,
      batt: live && (this.c.batt < 0.5 || this.c.cb_batt < 0.5 || this.soc < 0.25),
      horn: live && this.c.hornMute > 0.5,
      tqLim: live && shaftPower > ENGINE.torqueLimit,
      nrLow: live && nrAlarm,
      xmsn: live && (nr < 0.3 || this.mgbDamage > 0.02),
      hyd: live && this.hydP < 24,
      pitot: live && (this.c.pitot < 0.5 || this.pitotIce > 0.3),
      lowFuel: live && this.fuelKg < this.c.fuelAlert,
      engChip: live && this.engineWear > 0.45,
      mgbChip: live && this.mgbDamage > 0.3,
      tgbChip: false,
      fire: live && (this.fireT > 0 || this.fireTest > 0),
      sand: false,
      rotorBrake: live && this.c.rotorBrake < 0.5,
    };
  }

  /** 新告警亮起：主告警灯和提示音 */
  private updateMaster(): void {
    if (!this.powered) {
      this.lastLit.clear();
      this.masterCaution = false;
    }
  }

  /** 给界面和声音用：有没有新亮的告警灯 */
  noteCautions(c: Caution): boolean {
    const now = new Set(Object.entries(c).filter(([, v]) => v).map(([k]) => k));
    let fresh = false;
    for (const k of now) if (!this.lastLit.has(k) && k !== 'horn' && k !== 'rotorBrake') fresh = true;
    this.lastLit = now;
    if (fresh) this.masterCaution = true;
    return fresh;
  }

  /** 冷舱时的检查单：每一项都看真实状态，做到就打勾。spot 是要动的控件，want 是它该到的位置 */
  checklist(nr: number): ChecklistItem[] {
    const c = this.c;
    const started = this.lit && this.n1 >= ENGINE.idleN1 - 1;
    return [
      { text: tr('旋翼刹车 松开'), done: c.rotorBrake > 0.5, spot: 'rotor_brake', key: 'rotorBrake', want: 1 },
      { text: tr('燃油阀 打开'), done: c.fuelValve > 0.5, spot: 'fuel_lever', key: 'fuelValve', want: 1 },
      { text: tr('电瓶 BATT 开'), done: c.batt > 0.5, spot: 'rk_batt', key: 'batt', want: 1 },
      { text: tr('防撞灯 A-COL 开'), done: c.acol > 0.5, spot: 'rk_acol', key: 'acol', want: 1 },
      { text: tr('燃油泵 FUEL P 开'), done: c.fuelP > 0.5 && this.fuelPress > 0.7, spot: 'rk_fuelP', key: 'fuelP', want: 1 },
      { text: tr('发动机主开关 → IDLE（等 N1 稳在 68%）'), done: started, spot: 'eng_main', key: 'engMain', want: 1 },
      { text: tr('发电机 GEN 开'), done: this.genOnline, spot: 'rk_gen', key: 'gen', want: 1 },
      { text: tr('皮托加温 PITOT 开'), done: c.pitot > 0.5, spot: 'rk_pitot', key: 'pitot', want: 1 },
      { text: tr('增稳 SAS 开（键盘飞行建议打开）'), done: c.sas > 0.5, spot: 'rk_sas', key: 'sas', want: 1 },
      { text: tr('发动机主开关 → FLIGHT（等旋翼 100%）'), done: c.engMain >= 2 && nr > 0.97, spot: 'eng_main', key: 'engMain', want: 2 },
    ];
  }
}
