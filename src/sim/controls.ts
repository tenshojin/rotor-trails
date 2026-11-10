// 座舱控件表：模型里每个 hs_<id> 节点在这里有一行，说明它叫什么、动哪个状态、当前读数怎么显示。
// 只有逻辑，不碰画面。点击由 App 交给 operate()，Systems 里的状态变了，飞机就真的变了。

import { clamp } from '../core/math';
import { ENGINE, OVERHEAD_BREAKERS, PANEL_BREAKERS, type Systems } from './systems';
import { tr } from '../i18n';

export type ControlSound = 'rocker' | 'toggle' | 'button' | 'detent' | 'breaker' | 'lever' | 'guard' | 'none';

export interface ControlDef {
  id: string;
  /** 面板上印的字 */
  name: string;
  /** 中文说明 */
  label: string;
  /** 对应 Systems.c 里的状态 */
  key?: string;
  /** flip：两位开关；step：多挡；dial：连续旋钮；press：按一下就回来；info：只能看读数 */
  type: 'flip' | 'step' | 'dial' | 'press' | 'info';
  /** 多挡的挡数或旋钮范围 */
  max?: number;
  min?: number;
  /** 旋钮每一格走多少 */
  step?: number;
  /** 把数值写成给人看的话 */
  read?: (s: Systems, env: ReadEnv) => string;
  /** 按键的动作 */
  act?: (s: Systems, env: ActEnv) => void;
  sound: ControlSound;
}

/** 读数要用到的飞行数据（仪表显示的就是这些） */
export interface ReadEnv {
  nr: number;
  torque: number;
  airspeed: number;
  altitude: number;
  vs: number;
  heading: number;
  slip: number;
}

/** 按键动作能做的、Systems 之外的事 */
export interface ActEnv {
  /** 切到下一个导航目标 */
  nextTarget(): void;
  /** 地图范围：-1 缩小、+1 放大 */
  range(dir: number): void;
  toast(text: string): void;
}

const onOff = (k: string, on = tr('开'), off = tr('关')) => (s: Systems) => (s.c[k] > 0.5 ? on : off);
const pct = (k: string) => (s: Systems) => `${Math.round(s.c[k] * 100)}%`;

const flip = (id: string, key: string, name: string, label: string, sound: ControlSound, on = tr('开'), off = tr('关')): ControlDef => ({ id, key, name, label, type: 'flip', read: onOff(key, on, off), sound });
const dial = (id: string, key: string, name: string, label: string, step = 0.05): ControlDef => ({ id, key, name, label, type: 'dial', min: 0, max: 1, step, read: pct(key), sound: 'detent' });
const press = (id: string, name: string, label: string, act: ControlDef['act'], read?: ControlDef['read']): ControlDef => ({ id, name, label, type: 'press', act, read, sound: 'button' });

const COM_PRESETS = [118300, 121500, 122800, 123450, 129900];
export const GPS_RANGES = [500, 1000, 2000, 5000, 10000, 20000];
const VEMD_PAGES = [tr('发动机'), tr('电气'), tr('燃油'), tr('飞行记录')];
const EFB_PAGES = [tr('地图'), tr('检查单'), tr('性能'), tr('任务')];

const freq = (khz: number) => (khz / 1000).toFixed(3);

function octalStep(code: number, dir: number): number {
  // 应答机只有 0~7 这八个数字：跳过 8、9
  let c = code + dir;
  for (let i = 0; i < 40; i++) {
    if (!/[89]/.test(String(c).padStart(4, '0'))) break;
    c += dir;
  }
  return clamp(c, 0, 7777);
}

const AUDIO_KEYS = ['aCom1', 'aCom2', 'aNav', 'aAdf', 'aIcs', 'aPa', 'aSpkr', 'aMkr', 'aDme', 'aAux'];
const AUDIO_NAMES = ['COM1', 'COM2', 'NAV', 'ADF', 'ICS', 'PA', 'SPKR', 'MKR', 'DME', 'AUX'];
const AUDIO_LABELS = [tr('收听 1 号电台'), tr('收听 2 号电台'), tr('收听导航台识别码'), tr('收听无方向信标'), tr('机内通话'), tr('客舱广播'), tr('外放'), tr('指点信标'), tr('测距机识别码'), tr('外接音频')];
const PED_AUDIO_KEYS = ['aCom1', 'aCom2', 'aNav', 'aAdf', 'aDme', 'aMkr', 'aAux', 'aIcs', 'aPa', 'aSpkr', 'aVox', 'aHi', 'aNorm', 'aTest'];
const PED_AUDIO_NAMES = ['COM1', 'COM2', 'NAV', 'ADF', 'DME', 'MKR', 'AUX', 'ICS', 'PA', 'SPKR', 'VOX', 'HI', 'NORM', 'TEST'];

const BREAKER_LABEL: Record<string, string> = {
  batt: tr('电瓶继电器'), gen: tr('发电机'), stby: tr('备用汇流条（发动机显示器、增稳）'), avnx: tr('航电总电源'), gps: 'GPS', com: tr('电台'), xpdr: tr('应答机'), hyd: tr('液压'), fuel: tr('燃油泵'), start: tr('起动机'), navlt: tr('航行灯'), ldglt: tr('着陆灯'), wiper: tr('雨刷'), ics: tr('机内通话'),
  fadec: tr('发动机电子控制'), ign: tr('点火'), fire: tr('火警探测'), chip: tr('金属屑探测'), pitot: tr('皮托加温'), cabht: tr('座舱暖风'), maplt: tr('地图灯'), instlt: tr('仪表灯'), domelt: tr('顶灯'), audio: tr('音频'), elt: tr('紧急定位发射机'), horn: tr('告警喇叭'),
};

function breaker(id: string, key: string, name: string): ControlDef {
  return { id, key, name: tr`${name.toUpperCase()} 断路器`, label: BREAKER_LABEL[name] ?? name, type: 'flip', read: onOff(key, tr('合上'), tr('已拔出')), sound: 'breaker' };
}

const defs: ControlDef[] = [
  // ---------- 翘板开关 ----------
  flip('rk_batt', 'batt', 'BATT', tr('电瓶总开关：整架飞机的电都从这里来'), 'rocker'),
  flip('rk_gen', 'gen', 'GEN', tr('发电机：N1 上 58% 以后才能上线，给电瓶充电'), 'rocker'),
  flip('rk_fuelP', 'fuelP', 'FUEL P', tr('电动燃油泵：起动时必须开'), 'rocker'),
  flip('rk_acol', 'acol', 'A-COL', tr('防撞灯：机顶的红色闪灯'), 'rocker'),
  flip('rk_pitot', 'pitot', 'PITOT', tr('皮托管加温：冷天雨里不开，空速表会冻住读低'), 'rocker'),
  flip('rk_cabHt', 'cabHt', 'CAB HT', tr('座舱暖风：也能吹掉风挡上的雾'), 'rocker'),
  flip('rk_sas', 'sas', 'SAS', tr('增稳：压住姿态和航向的抖动。关掉就是裸机'), 'rocker'),
  flip('rk_hydSw', 'hydSw', 'HYD', tr('液压助力：关掉以后杆很沉'), 'rocker'),
  flip('rk_hornMute', 'hornMute', 'HORN', tr('低转速喇叭静音'), 'rocker', tr('静音'), tr('正常')),
  // ---------- 拨动开关 ----------
  flip('tg_ldg', 'ldg', 'LDG LT', tr('着陆灯'), 'toggle'),
  flip('tg_pos', 'pos', 'POS LT', tr('航行灯：红绿白'), 'toggle'),
  { id: 'tg_wiper', key: 'wiper', name: 'WIPER', label: tr('雨刷'), type: 'step', max: 2, read: (s) => [tr('关'), tr('慢'), tr('快')][s.c.wiper] ?? tr('关'), sound: 'toggle' },
  { id: 'eng_main', key: 'engMain', name: 'ENG MAIN', label: tr('发动机主开关：IDLE 自动起动，FLIGHT 调速到 100%'), type: 'step', max: 2, read: (s) => [tr('OFF 关车'), tr('IDLE 慢车'), tr('FLIGHT 飞行')][s.c.engMain] ?? '', sound: 'detent' },
  { id: 'emer_guard', key: 'emerGuard', name: tr('EMER. SW 护盖'), label: tr('掀开才能碰到应急开关'), type: 'flip', read: onOff('emerGuard', tr('掀开'), tr('盖着')), sound: 'guard' },
  { id: 'emer_lever', key: 'emer', name: 'EMER. SW', label: tr('应急切断：断开发电机和所有非必要用电'), type: 'flip', read: onOff('emer', tr('已切断'), tr('正常')), sound: 'toggle' },
  { id: 'elt', key: 'elt', name: 'ELT', label: tr('紧急定位发射机'), type: 'step', max: 2, read: (s) => ['OFF', tr('ARM 待命'), tr('ON 发射中')][s.c.elt] ?? '', sound: 'toggle' },
  // ---------- 旋钮 ----------
  flip('kn_night', 'nightMode', 'NIGHT / DAY', tr('显示器的昼夜模式'), 'detent', 'NIGHT', 'DAY'),
  dial('kn_syst', 'systLite', 'SYST. LITE', tr('告警灯板和按键亮度')),
  dial('kn_inst', 'instLite', 'INST. LITE', tr('仪表背光')),
  { id: 'adj_alt', key: 'baro', name: 'BARO', label: tr('高度表气压'), type: 'dial', min: 950, max: 1050, step: 1, read: (s) => `${Math.round(s.c.baro)} hPa`, sound: 'detent' },
  { id: 'adj_hsi', key: 'hdgBug', name: 'HDG', label: tr('航向游标'), type: 'dial', min: 0, max: 359, step: 1, read: (s) => `${Math.round(s.c.hdgBug)}°`, sound: 'detent' },
  { id: 'adj_hdg2', key: 'hdgBug', name: 'STBY HDG', label: tr('备用航向仪游标'), type: 'dial', min: 0, max: 359, step: 1, read: (s) => `${Math.round(s.c.hdgBug)}°`, sound: 'detent' },
  { id: 'ai_knob', key: 'aiTrim', name: 'PITCH', label: tr('姿态仪小飞机高度'), type: 'dial', min: -5, max: 5, step: 0.5, read: (s) => `${s.c.aiTrim.toFixed(1)}°`, sound: 'detent' },
  press('ai_sync', 'PITCH SYNC', tr('姿态仪回零'), (s) => { s.c.aiTrim = 0; }),
  press('nr_test', 'TEST', tr('按住测试低转速喇叭和灯'), (s) => { s.lampTest = true; s.hornTest = 0.7; }),
  // ---------- 拉杆 ----------
  flip('fuel_lever', 'fuelValve', 'FUEL SHUT-OFF', tr('红色手柄：燃油切断阀'), 'lever', tr('打开'), tr('切断')),
  flip('rotor_brake', 'rotorBrake', 'ROTOR BRAKE', tr('黄色手柄：旋翼刹车'), 'lever', tr('松开'), tr('刹住')),
  // ---------- 发动机显示器 ----------
  press('vk_0', 'OFF 1', tr('关闭 / 打开上屏'), (s) => { s.c.vemdOff1 = s.c.vemdOff1 > 0.5 ? 0 : 1; }, onOff('vemdOff1', tr('关'), tr('开'))),
  press('vk_1', 'OFF 2', tr('关闭 / 打开下屏'), (s) => { s.c.vemdOff2 = s.c.vemdOff2 > 0.5 ? 0 : 1; }, onOff('vemdOff2', tr('关'), tr('开'))),
  press('vk_2', 'SCROLL', tr('下屏翻页'), (s) => { s.c.vemdPage = (s.c.vemdPage + 1) % VEMD_PAGES.length; }, (s) => VEMD_PAGES[s.c.vemdPage]),
  press('vk_3', 'RESET', tr('清零本次飞行时间'), (s) => { s.flightTime = 0; }),
  press('vk_4', 'SELECT', tr('选中低油量告警值'), (s) => { s.c.vemdSel = s.c.vemdSel > 0.5 ? 0 : 1; }, (s) => (s.c.vemdSel > 0.5 ? tr('编辑中') : '')),
  press('vk_5', '+', tr('调高'), (s) => { if (s.c.vemdSel > 0.5) s.c.fuelAlert = clamp(s.c.fuelAlert + 5, 20, 150); }, (s) => tr`低油量告警 ${s.c.fuelAlert} kg`),
  press('vk_6', '-', tr('调低'), (s) => { if (s.c.vemdSel > 0.5) s.c.fuelAlert = clamp(s.c.fuelAlert - 5, 20, 150); }, (s) => tr`低油量告警 ${s.c.fuelAlert} kg`),
  press('vk_7', 'ENTER', tr('确认'), (s) => { s.c.vemdSel = 0; }),
  press('vk_8', 'BRT +', tr('屏幕调亮'), (s) => { s.c.vemdBrt = clamp(s.c.vemdBrt + 0.1, 0.1, 1); }, pct('vemdBrt')),
  press('vk_9', 'BRT -', tr('屏幕调暗'), (s) => { s.c.vemdBrt = clamp(s.c.vemdBrt - 0.1, 0.1, 1); }, pct('vemdBrt')),
  // ---------- GPS ----------
  press('gk_0', 'RNG-', tr('地图放大'), (_, e) => e.range(-1)),
  press('gk_1', 'RNG+', tr('地图缩小'), (_, e) => e.range(1)),
  press('gk_2', 'PG<', tr('上一页'), (s) => { s.c.gpsPage = (s.c.gpsPage + 2) % 3; }),
  press('gk_3', 'PG>', tr('下一页'), (s) => { s.c.gpsPage = (s.c.gpsPage + 1) % 3; }),
  press('gk_4', 'ENT', tr('确认当前航点'), (_, e) => e.nextTarget()),
  press('gk_5', 'CLR', tr('回到地图页'), (s) => { s.c.gpsPage = 0; }),
  press('gs_0', 'MAP', tr('地图页'), (s) => { s.c.gpsPage = 0; }),
  press('gs_1', 'NAV', tr('导航数据页'), (s) => { s.c.gpsPage = 1; }),
  press('gs_2', 'D>', tr('直飞下一个目标'), (_, e) => e.nextTarget()),
  press('gs_3', 'MENU', tr('航点列表'), (s) => { s.c.gpsPage = 2; }),
  { id: 'gki_0', key: 'gpsPower', name: 'PWR', label: tr('GPS 电源'), type: 'flip', read: onOff('gpsPower'), sound: 'detent' },
  { id: 'gko_0', key: 'gpsPage', name: 'PAGE', label: tr('翻页'), type: 'step', max: 2, read: (s) => [tr('地图'), tr('导航'), tr('航点')][s.c.gpsPage] ?? '', sound: 'detent' },
  { id: 'gki_1', key: 'gpsRange', name: 'RANGE', label: tr('地图范围'), type: 'step', max: GPS_RANGES.length - 1, read: (s) => `${GPS_RANGES[s.c.gpsRange] / 1000} km`, sound: 'detent' },
  { id: 'gko_1', key: 'gpsRange', name: 'RANGE', label: tr('地图范围'), type: 'step', max: GPS_RANGES.length - 1, read: (s) => `${GPS_RANGES[s.c.gpsRange] / 1000} km`, sound: 'detent' },
  // ---------- 电台 ----------
  { id: 'rd_knob', key: 'comStby', name: 'TUNE', label: tr('备用频率（滚轮调）'), type: 'dial', min: 118000, max: 136975, step: 25, read: (s) => `${freq(s.c.comStby)} MHz`, sound: 'detent' },
  press('rd_0', 'SWAP', tr('交换使用频率和备用频率'), (s) => { const a = s.c.comActive; s.c.comActive = s.c.comStby; s.c.comStby = a; }, (s) => `${freq(s.c.comActive)} / ${freq(s.c.comStby)}`),
  ...COM_PRESETS.map((f, i) => press(`rd_${i + 1}`, `CH${i + 1}`, tr`预设频率 ${freq(f)}`, (s) => { s.c.comStby = f; })),
  press('rd_6', 'MON', tr('同时监听备用频率'), (s) => { s.c.comMon = s.c.comMon > 0.5 ? 0 : 1; }, onOff('comMon')),
  press('trk_btn', 'MARK', tr('在飞行记录里打一个标记'), (_, e) => e.toast(tr('飞行记录：已标记当前位置'))),
  // ---------- 应答机 ----------
  { id: 'xp_knob', key: 'xpdrMode', name: 'MODE', label: tr('应答机模式'), type: 'step', max: 3, read: (s) => ['OFF', tr('SBY 待命'), 'ON', tr('ALT 报高度')][s.c.xpdrMode] ?? '', sound: 'detent' },
  press('xp_0', 'IDT', tr('发送识别信号（18 秒）'), (s) => { s.xpdrIdent = 18; }),
  press('xp_1', 'VFR', tr('回到目视飞行编码 7000'), (s) => { s.c.xpdrCode = 7000; }),
  press('xp_2', '+', tr('编码加一'), (s) => { s.c.xpdrCode = octalStep(s.c.xpdrCode, 1); }, (s) => String(s.c.xpdrCode).padStart(4, '0')),
  press('xp_3', '-', tr('编码减一'), (s) => { s.c.xpdrCode = octalStep(s.c.xpdrCode, -1); }, (s) => String(s.c.xpdrCode).padStart(4, '0')),
  press('xp_4', 'CLR', tr('编码清零'), (s) => { s.c.xpdrCode = 0; }),
  // ---------- 音频面板 ----------
  ...AUDIO_KEYS.map((k, i) => ({ ...flip(`au_${i}`, k, AUDIO_NAMES[i], AUDIO_LABELS[i], 'button'), sound: 'button' as const })),
  dial('au_vol', 'audioVol', 'VOL', tr('耳机音量')),
  dial('au_sql', 'audioSql', 'SQL', tr('静噪门限：调低能听到底噪')),
  ...PED_AUDIO_KEYS.map((k, i) => ({ ...flip(`pa_${i}`, k, PED_AUDIO_NAMES[i], tr('驾驶员音频选择'), 'button') })),
  dial('pa_knob', 'comVol', 'VOL', tr('电台音量')),
  // ---------- 操纵台 ----------
  flip('pt_0', 'domeLt', 'DOME', tr('顶灯'), 'toggle'),
  flip('pt_1', 'mapLt', 'MAP LT', tr('地图灯'), 'toggle'),
  flip('pt_2', 'flood', 'FLOOD', tr('仪表泛光灯'), 'toggle'),
  flip('pt_3', 'demist', 'DEMIST', tr('风挡除雾风扇'), 'toggle'),
  flip('pt_4', 'hook', 'HOOK', tr('吊钩解锁'), 'toggle'),
  flip('pt_5', 'cam', 'CAM', tr('机载摄像'), 'toggle'),
  flip('pt_6', 'float', 'FLOAT', tr('应急浮筒待命'), 'toggle'),
  flip('pt_7', 'auxSw', 'AUX', tr('备用开关'), 'toggle'),
  dial('pk_0', 'domeDim', 'DOME', tr('顶灯亮度')),
  dial('pk_1', 'mapDim', 'MAP', tr('地图灯亮度')),
  dial('pk_2', 'floodDim', 'FLOOD', tr('泛光灯亮度')),
  dial('pk_3', 'heat', 'HEAT', tr('暖风温度')),
  dial('pk_4', 'vent', 'VENT', tr('通风量：风大了能听见')),
  press('px_0', 'LAMP TEST', tr('告警灯全亮'), (s) => { s.lampTest = true; }),
  press('px_1', 'FIRE TEST', tr('火警灯和警铃'), (s) => { s.fireTest = 1.2; }),
  press('px_2', 'HORN TEST', tr('低转速喇叭'), (s) => { s.hornTest = 0.7; }),
  ...PANEL_BREAKERS.map((b, i) => breaker(`cb_${i}`, `cb_${b}`, b)),
  ...OVERHEAD_BREAKERS.map((b, i) => breaker(`ob_${i}`, `ob_${b}`, b)),
  // ---------- 仪表：看读数 ----------
  { id: 'gauge_asi', name: 'IAS', label: tr('空速表'), type: 'info', read: (s, e) => tr`${Math.round(e.airspeed * 1.9438 * s.pitotFactor)} 节`, sound: 'none' },
  { id: 'gauge_alt', name: 'ALT', label: tr('高度表'), type: 'info', read: (s, e) => tr`${Math.round((e.altitude + (s.c.baro - 1013) * 8.2) * 3.2808)} 英尺`, sound: 'none' },
  { id: 'gauge_vsi', name: 'VSI', label: tr('升降速度'), type: 'info', read: (_, e) => tr`${Math.round(e.vs * 196.85)} 英尺/分`, sound: 'none' },
  { id: 'gauge_turn', name: 'TURN', label: tr('转弯侧滑仪'), type: 'info', read: (_, e) => tr`侧滑 ${Math.round(e.slip * 57.3)}°`, sound: 'none' },
  { id: 'gauge_hsi', name: 'HDG', label: tr('航向仪'), type: 'info', read: (_, e) => `${Math.round(e.heading)}°`, sound: 'none' },
  { id: 'gauge_hdg2', name: 'STBY HDG', label: tr('备用航向仪'), type: 'info', read: (_, e) => `${Math.round(e.heading)}°`, sound: 'none' },
  { id: 'gauge_nr', name: 'NR', label: tr('旋翼转速'), type: 'info', read: (s, e) => `${Math.round(e.nr * 100)}%  N1 ${Math.round(s.n1)}%`, sound: 'none' },
  { id: 'gauge_clock', name: 'CLOCK', label: tr('时钟'), type: 'info', read: () => new Date().toTimeString().slice(0, 5), sound: 'none' },
  { id: 'gauge_ai', name: 'ATT', label: tr('姿态仪'), type: 'info', sound: 'none' },
  { id: 'gauge_vemd1', name: 'VEMD', label: tr('发动机参数'), type: 'info', read: (s, e) => tr`N1 ${Math.round(s.n1)}%  TOT ${Math.round(s.tot)}℃  扭矩 ${Math.round(e.torque * 100)}%`, sound: 'none' },
  { id: 'gauge_vemd2', name: 'VEMD', label: VEMD_PAGES.join(' / '), type: 'info', read: (s) => tr`燃油 ${Math.round(s.fuelKg)} kg  ${s.busV.toFixed(1)} V`, sound: 'none' },
  { id: 'gauge_gps', name: 'GPS', label: tr('导航仪'), type: 'info', sound: 'none' },
  {
    id: 'gauge_ann',
    name: 'CAUTION',
    label: tr('告警灯板：点一下确认主告警'),
    type: 'press',
    act: (s) => {
      s.masterCaution = false;
    },
    read: (s) => (s.masterCaution ? tr('有未确认的告警') : tr('正常')),
    sound: 'button',
  },
  {
    id: 'gauge_efb',
    key: 'efbPage',
    name: 'EFB',
    label: tr('电子飞行包：点一下翻页'),
    type: 'press',
    act: (s) => {
      s.c.efbPage = (s.c.efbPage + 1) % EFB_PAGES.length;
    },
    read: (s) => EFB_PAGES[s.c.efbPage],
    sound: 'none',
  },
];

export const CONTROLS: ReadonlyMap<string, ControlDef> = new Map(defs.map((d) => [d.id, d]));

/** 手够不到时最多等多久（秒）：模型卡住也不能让按钮失灵 */
const PRESS_WAIT = 0.9;

/**
 * 点下去到手指碰到控件之间的排队：点的时候手才抬起来，碰到的那一刻才算按下。
 * 连着点了几个控件时，手一个一个按过去。
 */
export class PressQueue<T> {
  private items: Array<{ spot: T; dir: number; age: number }> = [];

  get length(): number {
    return this.items.length;
  }

  push(spot: T, dir: number): void {
    // 滚轮滚得再快也别排出一长串
    if (this.items.length < 12) this.items.push({ spot, dir, age: 0 });
  }

  clear(): void {
    this.items.length = 0;
  }

  /** 每帧调用。reach：让手去够这个控件，返回够到了没有。够到的交给 press */
  step(dt: number, reach: (spot: T) => boolean, press: (spot: T, dir: number) => void): void {
    if (this.items.length) this.items[0].age += dt;
    while (this.items.length) {
      const head = this.items[0];
      if (!reach(head.spot) && head.age < PRESS_WAIT) return;
      this.items.shift();
      press(head.spot, head.dir);
    }
  }
}

/** 这个控件现在能不能动。护盖合着时碰不到里面的开关 */
export function blocked(def: ControlDef, s: Systems): string | null {
  if (def.id === 'emer_lever' && s.c.emerGuard < 0.5) return tr('先掀开护盖');
  return null;
}

/**
 * 操作一个控件：左键往前一挡，右键往回一挡（旋钮同理），滚轮 dir 可以是多格。
 * 返回有没有真的动（到头了就不响）。
 */
export function operate(def: ControlDef, s: Systems, dir: number, env: ActEnv): boolean {
  if (blocked(def, s)) return false;
  const c = s.c;
  const key = def.key;
  if (def.type === 'press') {
    def.act?.(s, env);
    return true;
  }
  if (!key) return false;
  if (def.type === 'flip') {
    c[key] = c[key] > 0.5 ? 0 : 1;
    return true;
  }
  if (def.type === 'step') {
    const v = clamp(Math.round(c[key]) + Math.sign(dir), 0, def.max ?? 1);
    if (v === c[key]) return false;
    c[key] = v;
    return true;
  }
  if (def.type === 'dial') {
    const lo = def.min ?? 0;
    const hi = def.max ?? 1;
    const raw = c[key] + dir * (def.step ?? 0.05);
    // 航向游标绕一圈回来；其他到头就停
    const v = def.id.startsWith('adj_h') ? (raw + 360) % 360 : clamp(raw, lo, hi);
    if (v === c[key]) return false;
    c[key] = v;
    return true;
  }
  return false;
}

export function readout(def: ControlDef, s: Systems, env: ReadEnv): string {
  return def.read?.(s, env) ?? '';
}

export const SYSTEM_LIMITS = { totLimit: ENGINE.totLimit };
