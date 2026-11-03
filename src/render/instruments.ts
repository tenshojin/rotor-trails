// 座舱电子显示（Canvas 绘制，作为三维座舱里屏幕的贴图）：发动机参数显示器上下两屏、电子姿态仪、
// GPS 移动地图、告警灯板；以及机械仪表指针的角度换算（与 tools/blender/cockpit_textures.py 画的刻度一致）。
// 所有数值都来自真实游戏状态（InstrumentData），没有装饰性的假数据。

export interface InstrumentData {
  pitch: number; // rad
  roll: number; // rad
  heading: number; // deg 0..360
  airspeed: number; // m/s
  groundSpeed: number; // m/s
  altitudeMSL: number; // m
  agl: number; // m
  vs: number; // m/s
  /** 机体偏航角速度（°/s，向右为正） */
  yawRate: number;
  /** 侧滑角（rad） */
  slip: number;
  targetAlt: number | null;
  targetSpeed: number | null;
  navBearing: number | null; // deg
  navDistance: number | null; // m
  navLabel: string;
  windDirFrom: number;
  windSpeed: number;
  powerFrac: number; // 0..1+
  hoverPowerFrac: number;
  rpm: number;
  durability: number;
  statusLabel: string;
  torqueLimited: boolean;
  hover: string;
  boost: boolean;
  boostStored: boolean;
  shield: boolean;
  terrainWarn: boolean;
  cargo: number;
  collective: number;
  heliX: number;
  heliZ: number;
  route: Array<[number, number]>;
  objectives: Array<{ x: number; z: number; main: boolean }>;
  pickups: Array<{ x: number; z: number; kind: string }>;
  mapSize: number;
  speedUnit: 'kmh' | 'kt' | 'ms';
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- 机械仪表指针角度（度，0 = 12 点，顺时针）

export const NEEDLE = {
  /** 空速表：0–180 kt，40 kt 以下压缩 */
  asi(ms: number): number {
    const kt = clamp(ms * 1.9438, 0, 180);
    const a40 = (40 / 180) * 320;
    return kt <= 40 ? (kt / 180) * 320 : a40 + ((kt - 40) / 140) * (320 - a40);
  },
  /** 高度表：长针 100 ft/格（一圈 1000 ft），短针一圈 10000 ft */
  alt100(m: number): number {
    const ft = m * 3.2808;
    return ((((ft % 1000) + 1000) % 1000) / 1000) * 360;
  },
  alt1000(m: number): number {
    const ft = m * 3.2808;
    return ((((ft % 10000) + 10000) % 10000) / 10000) * 360;
  },
  /** 升降速度表：0 在 9 点钟，±2000 ft/min 各 170°，零点附近刻度放大 */
  vsi(ms: number): number {
    const fpm = ms * 196.85;
    const k = Math.min(1, Math.abs(fpm) / 2000) ** 0.85;
    return -90 + Math.sign(fpm) * 170 * k;
  },
  /** 旋翼转速：100% = 390 rpm；250–450 rpm 对应 -150°–150° */
  nr(frac: number): number {
    const rpm = clamp(frac * 390, 250, 450);
    return -150 + ((rpm - 250) / 200) * 300;
  },
  /** 转弯指针：标准转弯率（3°/s）偏转 20° */
  turn(yawRateDeg: number): number {
    return clamp((yawRateDeg / 3) * 20, -40, 40);
  },
  /** 侧滑小球：沿底部弧形管移动（绕表心转动的角度），侧滑向右时球偏左 */
  ball(slip: number): number {
    return clamp(-slip * 160, -28, 28);
  },
};

// ---------------------------------------------------------------- 通用

function bg(g: CanvasRenderingContext2D, w: number, h: number, c = '#04070b') {
  g.fillStyle = c;
  g.fillRect(0, 0, w, h);
}

const FONT = '"Bahnschrift","Arial Narrow","Segoe UI",sans-serif';
const MONO = '"Consolas","Courier New",monospace';

/** 外界温度（标准大气，°C） */
function oat(altM: number): number {
  return 15 - 6.5 * (Math.max(0, altM) / 1000);
}

// ---------------------------------------------------------------- 发动机参数显示器（上屏）：第一限制指示 + 数字

export function drawVemdTop(g: CanvasRenderingContext2D, d: InstrumentData, W: number, H: number): void {
  bg(g, W, H);
  const cx = W * 0.42;
  const cy = H * 0.56;
  const R = H * 0.36;
  // 第一限制指示（FLI）：扭矩、T4、N1 里最接近限制的一项，0–10 刻度
  const tq = d.powerFrac * 100;
  const n1 = 72 + d.powerFrac * 28;
  const t4 = 420 + d.powerFrac * 420 + (d.torqueLimited ? 30 : 0);
  const fli = clamp(Math.max(tq / 10, (n1 - 70) / 3, (t4 - 400) / 45), 0, 11);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const ang = (x: number) => a0 + (a1 - a0) * (x / 11);
  g.lineWidth = R * 0.11;
  const arc = (x0: number, x1: number, c: string) => {
    g.strokeStyle = c;
    g.beginPath();
    g.arc(cx, cy, R, ang(x0), ang(x1));
    g.stroke();
  };
  arc(0, 9, '#1fae4c');
  arc(9, 10, '#e8b622');
  arc(10, 11, '#e0352a');
  g.strokeStyle = '#e8e8e2';
  g.fillStyle = '#e8e8e2';
  g.lineWidth = 3;
  g.font = `${Math.round(R * 0.2)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 11; i++) {
    const a = ang(i);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
    g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
    g.stroke();
    if (i % 2 === 0) g.fillText(String(i), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
  }
  const a = ang(fli);
  g.strokeStyle = fli > 10 ? '#ff5a3a' : '#ffffff';
  g.lineWidth = R * 0.06;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
  g.stroke();
  g.fillStyle = '#9aa';
  g.font = `${Math.round(R * 0.16)}px ${FONT}`;
  g.fillText('FLI', cx, cy + R * 0.42);
  // 右侧数字栏
  const x = W * 0.82;
  const row = (label: string, val: string, y: number, warn = false) => {
    g.fillStyle = '#7fc6ff';
    g.font = `${Math.round(H * 0.07)}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(label, x, y);
    g.fillStyle = warn ? '#ffb347' : '#ffffff';
    g.font = `bold ${Math.round(H * 0.1)}px ${MONO}`;
    g.fillText(val, x, y + H * 0.085);
  };
  row('TRQ %', tq.toFixed(0), H * 0.14, d.torqueLimited);
  row('T4 °C', t4.toFixed(0), H * 0.38);
  row('N1 %', n1.toFixed(1), H * 0.62);
  row('OAT', `${oat(d.altitudeMSL).toFixed(0)}°`, H * 0.84);
}

// ---------------------------------------------------------------- 发动机参数显示器（下屏）：机体与任务状态

export function drawVemdBottom(g: CanvasRenderingContext2D, d: InstrumentData, W: number, H: number): void {
  bg(g, W, H);
  g.textBaseline = 'middle';
  const pad = W * 0.06;
  // 机体耐久条
  g.fillStyle = '#7fc6ff';
  g.font = `${Math.round(H * 0.075)}px ${FONT}`;
  g.textAlign = 'left';
  g.fillText('AIRFRAME', pad, H * 0.1);
  const bw = W - pad * 2;
  g.fillStyle = '#1a222c';
  g.fillRect(pad, H * 0.16, bw, H * 0.09);
  const dc = d.durability >= 70 ? '#3fd27a' : d.durability >= 30 ? '#ffb347' : '#ff5a3a';
  g.fillStyle = dc;
  g.fillRect(pad, H * 0.16, (bw * d.durability) / 100, H * 0.09);
  g.fillStyle = '#ffffff';
  g.fillRect(pad + bw * 0.7 - 1, H * 0.15, 2, H * 0.11);
  g.fillRect(pad + bw * 0.3 - 1, H * 0.15, 2, H * 0.11);
  g.textAlign = 'right';
  g.font = `bold ${Math.round(H * 0.08)}px ${MONO}`;
  g.fillStyle = dc;
  g.fillText(`${Math.round(d.durability)}%`, W - pad, H * 0.1);
  // 状态行
  const rows: Array<[string, string, string]> = [
    ['NR', `${Math.round(d.rpm * 100)} %`, d.rpm < 0.96 ? '#ff5a3a' : '#ffffff'],
    ['BOOST', d.boost ? 'ACTIVE' : d.boostStored ? 'READY' : '---', d.boost ? '#ffd23a' : d.boostStored ? '#ffd23a' : '#56606c'],
    ['SHIELD', d.shield ? 'ON' : '---', d.shield ? '#46b4ff' : '#56606c'],
    ['HOVER', d.hover === 'off' ? 'OFF' : d.hover === 'braking' ? 'BRAKE' : 'HOLD', d.hover === 'off' ? '#56606c' : '#3fd27a'],
    ['CARGO', `${d.cargo}`, d.cargo > 0 ? '#ffffff' : '#56606c'],
  ];
  rows.forEach(([k, v, c], i) => {
    const y = H * (0.36 + i * 0.13);
    g.textAlign = 'left';
    g.fillStyle = '#7fc6ff';
    g.font = `${Math.round(H * 0.075)}px ${FONT}`;
    g.fillText(k, pad, y);
    g.textAlign = 'right';
    g.fillStyle = c;
    g.font = `bold ${Math.round(H * 0.085)}px ${MONO}`;
    g.fillText(v, W - pad, y);
  });
}

// ---------------------------------------------------------------- 电子姿态仪（方形屏）

export function drawAttitude(g: CanvasRenderingContext2D, d: InstrumentData, W: number, H: number): void {
  const cx = W / 2;
  const cy = H * 0.5;
  const ppd = H / 70; // 每度像素
  g.save();
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.translate(cx, cy);
  g.rotate(-d.roll);
  const off = ((d.pitch * 180) / Math.PI) * ppd;
  g.fillStyle = '#2d73c4';
  g.fillRect(-W * 2, -H * 3 + off, W * 4, H * 3);
  g.fillStyle = '#7a5226';
  g.fillRect(-W * 2, off, W * 4, H * 3);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = Math.max(2, W / 160);
  g.beginPath();
  g.moveTo(-W * 2, off);
  g.lineTo(W * 2, off);
  g.stroke();
  g.font = `${Math.round(H * 0.045)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let p = -30; p <= 30; p += 5) {
    if (p === 0) continue;
    const y = off - p * ppd;
    const w = p % 10 === 0 ? W * 0.16 : W * 0.07;
    g.beginPath();
    g.moveTo(-w, y);
    g.lineTo(w, y);
    g.stroke();
    if (p % 10 === 0) {
      g.fillText(String(Math.abs(p)), -w - W * 0.06, y);
      g.fillText(String(Math.abs(p)), w + W * 0.06, y);
    }
  }
  g.restore();
  // 坡度刻度 + 指针
  const R = W * 0.4;
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(2, W / 180);
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r = (a * Math.PI) / 180;
    const len = a % 30 === 0 ? R * 0.12 : R * 0.07;
    g.beginPath();
    g.moveTo(Math.sin(r) * R, -Math.cos(r) * R);
    g.lineTo(Math.sin(r) * (R - len), -Math.cos(r) * (R - len));
    g.stroke();
  }
  g.rotate(-d.roll);
  g.fillStyle = '#ffd34a';
  g.beginPath();
  g.moveTo(0, -R + R * 0.14);
  g.lineTo(-R * 0.06, -R + R * 0.26);
  g.lineTo(R * 0.06, -R + R * 0.26);
  g.closePath();
  g.fill();
  g.restore();
  // 机体符号
  g.strokeStyle = '#ffd34a';
  g.lineWidth = Math.max(4, W / 70);
  g.beginPath();
  g.moveTo(cx - W * 0.3, cy);
  g.lineTo(cx - W * 0.1, cy);
  g.lineTo(cx - W * 0.06, cy + H * 0.04);
  g.moveTo(cx + W * 0.3, cy);
  g.lineTo(cx + W * 0.1, cy);
  g.lineTo(cx + W * 0.06, cy + H * 0.04);
  g.stroke();
  g.fillStyle = '#ffd34a';
  g.fillRect(cx - 4, cy - 4, 8, 8);
  // 底部航向小字
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, H * 0.9, W, H * 0.1);
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(H * 0.06)}px ${MONO}`;
  g.textAlign = 'center';
  g.fillText(String(Math.round(d.heading) % 360).padStart(3, '0') + '°', cx, H * 0.95);
}

// ---------------------------------------------------------------- GPS 移动地图

export function drawGps(g: CanvasRenderingContext2D, d: InstrumentData, minimap: HTMLCanvasElement | null, range: number, W: number, H: number): void {
  bg(g, W, H, '#0a1018');
  const cx = W / 2;
  const cy = H * 0.62;
  const scale = (H * 0.55) / range; // 像素/米
  g.save();
  g.beginPath();
  g.rect(0, H * 0.14, W, H * 0.86);
  g.clip();
  g.translate(cx, cy);
  g.rotate((-d.heading * Math.PI) / 180);
  if (minimap) {
    const mpp = d.mapSize / minimap.width;
    const sx = (d.heliX + d.mapSize / 2) / mpp;
    const sz = (d.heliZ + d.mapSize / 2) / mpp;
    const k = mpp * scale;
    g.globalAlpha = 0.9;
    g.drawImage(minimap, -sx * k, -sz * k, minimap.width * k, minimap.height * k);
    g.globalAlpha = 1;
  }
  const P = (x: number, z: number): [number, number] => [(x - d.heliX) * scale, (z - d.heliZ) * scale];
  if (d.route.length > 1) {
    g.strokeStyle = '#e050ff';
    g.lineWidth = Math.max(3, W / 110);
    g.beginPath();
    d.route.forEach(([x, z], i) => {
      const [px, pz] = P(x, z);
      if (i === 0) g.moveTo(px, pz);
      else g.lineTo(px, pz);
    });
    g.stroke();
  }
  for (const o of d.objectives) {
    const [px, pz] = P(o.x, o.z);
    g.fillStyle = o.main ? '#42ff8a' : '#c08bff';
    g.beginPath();
    g.arc(px, pz, W * 0.018, 0, Math.PI * 2);
    g.fill();
  }
  for (const p of d.pickups) {
    const [px, pz] = P(p.x, p.z);
    g.fillStyle = p.kind === 'boost' ? '#ffd23a' : p.kind === 'shield' ? '#46b4ff' : '#4cff7a';
    g.fillRect(px - W * 0.01, pz - W * 0.01, W * 0.02, W * 0.02);
  }
  g.restore();
  // 本机符号
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx, cy - W * 0.03);
  g.lineTo(cx - W * 0.02, cy + W * 0.022);
  g.lineTo(cx, cy + W * 0.012);
  g.lineTo(cx + W * 0.02, cy + W * 0.022);
  g.closePath();
  g.fill();
  // 顶栏：下一航点、距离、地速
  g.fillStyle = '#0b1118';
  g.fillRect(0, 0, W, H * 0.14);
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(H * 0.085)}px ${FONT}`;
  g.fillStyle = '#e050ff';
  g.textAlign = 'left';
  g.fillText(d.navLabel.slice(0, 14), W * 0.02, H * 0.07);
  g.textAlign = 'right';
  g.fillStyle = '#fff';
  const dist = d.navDistance === null ? '---' : d.navDistance > 1000 ? `${(d.navDistance / 1852).toFixed(1)}NM` : `${Math.round(d.navDistance)}m`;
  g.fillText(`${dist}  GS${Math.round(d.groundSpeed * 1.9438)}`, W * 0.98, H * 0.07);
  g.font = `${Math.round(H * 0.06)}px ${FONT}`;
  g.fillStyle = '#9fe';
  g.textAlign = 'left';
  g.fillText(`${range >= 1000 ? range / 1000 + 'km' : range + 'm'}`, W * 0.02, H * 0.95);
}

// ---------------------------------------------------------------- 告警灯板

const ANN_LABELS = ['GOV', 'ENG P', 'FUEL P', 'GEN', 'BATT', 'HORN', 'TQ LIM', 'NR LOW', 'XMSN', 'HYD', 'PITOT', 'LOW FUEL', 'DAMAGE', 'TERRAIN', 'BOOST', 'SHIELD', 'HOVER', 'CARGO', 'ENG CHIP', 'MGB CHIP', 'TGB CHIP', 'FIRE', 'SAND', 'AUX'];

export function drawAnnunciator(g: CanvasRenderingContext2D, d: InstrumentData, W: number, H: number, t: number): void {
  bg(g, W, H, '#050505');
  const cols = 6;
  const rows = 4;
  const cw = W / cols;
  const ch = H / rows;
  const blink = Math.floor(t * 2.5) % 2 === 0;
  const lit: Record<string, string | null> = {
    'TQ LIM': d.torqueLimited ? '#ffb020' : null,
    'NR LOW': d.rpm < 0.96 ? '#ff3a2a' : null,
    DAMAGE: d.durability < 30 ? (blink ? '#ff3a2a' : null) : d.durability < 70 ? '#ffb020' : null,
    TERRAIN: d.terrainWarn ? (blink ? '#ff3a2a' : null) : null,
    BOOST: d.boost ? '#3fd27a' : null,
    SHIELD: d.shield ? '#46b4ff' : null,
    HOVER: d.hover !== 'off' ? '#3fd27a' : null,
    CARGO: d.cargo > 0 ? '#e8e8e8' : null,
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(ch * 0.34)}px ${FONT}`;
  ANN_LABELS.forEach((label, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    const c = lit[label];
    g.fillStyle = c ?? '#141516';
    g.fillRect(x + cw * 0.06, y + ch * 0.1, cw * 0.88, ch * 0.8);
    g.fillStyle = c ? '#111' : '#3a3d42';
    g.fillText(label, x + cw / 2, y + ch / 2 + 1);
  });
}
