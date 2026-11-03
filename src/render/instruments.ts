// 座舱仪表（Canvas 绘制，作为三维座舱中的屏幕纹理）：主飞行显示、导航多功能显示、发动机与告警面板。
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

const SPEED_K = { kmh: 3.6, kt: 1.9438, ms: 1 };
const SPEED_LABEL = { kmh: 'km/h', kt: 'kt', ms: 'm/s' };

function bg(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, w, h);
}

export function drawPFD(g: CanvasRenderingContext2D, d: InstrumentData): void {
  const W = 512;
  const H = 512;
  bg(g, W, H);
  const cx = 256;
  const cy = 236;
  const R = 150;
  // 姿态球
  g.save();
  g.beginPath();
  g.rect(cx - R, cy - R, R * 2, R * 2);
  g.clip();
  g.translate(cx, cy);
  g.rotate(-d.roll);
  const ppd = 5.2; // 每度像素
  const off = (d.pitch * 180) / Math.PI * ppd;
  g.fillStyle = '#2f78c8';
  g.fillRect(-R * 2, -R * 3 + off, R * 4, R * 3);
  g.fillStyle = '#7a5226';
  g.fillRect(-R * 2, off, R * 4, R * 3);
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-R * 2, off);
  g.lineTo(R * 2, off);
  g.stroke();
  g.font = '18px monospace';
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  for (let p = -30; p <= 30; p += 5) {
    if (p === 0) continue;
    const y = off - p * ppd;
    const w = p % 10 === 0 ? 60 : 30;
    g.beginPath();
    g.moveTo(-w, y);
    g.lineTo(w, y);
    g.stroke();
    if (p % 10 === 0) {
      g.fillText(String(Math.abs(p)), -w - 22, y + 6);
      g.fillText(String(Math.abs(p)), w + 22, y + 6);
    }
  }
  g.restore();
  // 坡度刻度
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r = (a * Math.PI) / 180;
    const len = a % 30 === 0 ? 16 : 9;
    g.beginPath();
    g.moveTo(Math.sin(r) * (R - 4), -Math.cos(r) * (R - 4));
    g.lineTo(Math.sin(r) * (R - 4 - len), -Math.cos(r) * (R - 4 - len));
    g.stroke();
  }
  g.rotate(-d.roll);
  g.fillStyle = '#ffd34a';
  g.beginPath();
  g.moveTo(0, -R + 22);
  g.lineTo(-9, -R + 36);
  g.lineTo(9, -R + 36);
  g.closePath();
  g.fill();
  g.restore();
  // 机体符号
  g.strokeStyle = '#ffd34a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx - 80, cy);
  g.lineTo(cx - 28, cy);
  g.lineTo(cx - 16, cy + 12);
  g.moveTo(cx + 80, cy);
  g.lineTo(cx + 28, cy);
  g.lineTo(cx + 16, cy + 12);
  g.stroke();
  g.fillStyle = '#ffd34a';
  g.fillRect(cx - 4, cy - 4, 8, 8);

  // 速度带
  const k = SPEED_K[d.speedUnit];
  tape(g, 10, cy - 150, 74, 300, d.airspeed * k, 10 * (d.speedUnit === 'ms' ? 0.5 : 1), d.targetSpeed !== null ? d.targetSpeed * k : null, 0);
  g.fillStyle = '#9fe';
  g.font = '16px monospace';
  g.textAlign = 'left';
  g.fillText(`${SPEED_LABEL[d.speedUnit]}`, 14, cy - 158);
  g.fillText(`GS ${Math.round(d.groundSpeed * k)}`, 10, cy + 176);
  // 高度带
  tape(g, W - 104, cy - 150, 84, 300, d.altitudeMSL, 20, d.targetAlt, 1);
  g.fillStyle = '#9fe';
  g.textAlign = 'left';
  g.fillText('ASL m', W - 102, cy - 158);
  g.fillStyle = d.agl < 15 ? '#ffb347' : '#fff';
  g.font = 'bold 20px monospace';
  g.fillText(`AGL ${d.agl < 1000 ? d.agl.toFixed(0) : '—'}`, W - 128, cy + 178);
  // 垂直速度
  const vx = W - 16;
  g.strokeStyle = '#888';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(vx, cy - 140);
  g.lineTo(vx, cy + 140);
  g.stroke();
  const vsY = cy - Math.max(-10, Math.min(10, d.vs)) * 14;
  g.strokeStyle = Math.abs(d.vs) > 5 ? '#ffb347' : '#3f6';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(vx, cy);
  g.lineTo(vx, vsY);
  g.stroke();
  // 航向带
  const hy = H - 72;
  g.fillStyle = '#0b1118';
  g.fillRect(56, hy, W - 112, 56);
  g.save();
  g.beginPath();
  g.rect(56, hy, W - 112, 56);
  g.clip();
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.font = '17px monospace';
  g.textAlign = 'center';
  const pxd = 4;
  for (let a = Math.floor(d.heading / 5) * 5 - 60; a <= d.heading + 60; a += 5) {
    const x = cx + (a - d.heading) * pxd;
    const aa = ((a % 360) + 360) % 360;
    g.beginPath();
    g.moveTo(x, hy);
    g.lineTo(x, hy + (aa % 10 === 0 ? 14 : 7));
    g.stroke();
    if (aa % 30 === 0) g.fillText(aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(aa / 10), x, hy + 34);
  }
  if (d.navBearing !== null) {
    let rel = d.navBearing - d.heading;
    rel = ((rel + 540) % 360) - 180;
    const x = cx + Math.max(-58, Math.min(58, rel)) * pxd;
    g.fillStyle = '#e050ff';
    g.beginPath();
    g.moveTo(x, hy + 2);
    g.lineTo(x - 10, hy + 18);
    g.lineTo(x + 10, hy + 18);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = '#ffd34a';
  g.beginPath();
  g.moveTo(cx, hy - 2);
  g.lineTo(cx - 8, hy - 14);
  g.lineTo(cx + 8, hy - 14);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 20px monospace';
  g.fillText(String(Math.round(d.heading) % 360).padStart(3, '0') + '°', cx, hy + 54);
}

function tape(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: number, step: number, bug: number | null, side: 0 | 1) {
  g.fillStyle = '#0b1118';
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const pxPer = 3.2 / (step / 10);
  const mid = y + h / 2;
  g.strokeStyle = '#ccc';
  g.fillStyle = '#ddd';
  g.font = '16px monospace';
  g.textAlign = side === 0 ? 'right' : 'left';
  const start = Math.floor((value - h / 2 / pxPer) / step) * step;
  for (let v = start; v < value + h / 2 / pxPer + step; v += step) {
    const yy = mid - (v - value) * pxPer;
    const major = Math.round(v / step) % 2 === 0;
    g.beginPath();
    if (side === 0) {
      g.moveTo(x + w, yy);
      g.lineTo(x + w - (major ? 14 : 7), yy);
    } else {
      g.moveTo(x, yy);
      g.lineTo(x + (major ? 14 : 7), yy);
    }
    g.stroke();
    if (major) g.fillText(String(Math.round(v)), side === 0 ? x + w - 18 : x + 18, yy + 6);
  }
  if (bug !== null) {
    const yy = Math.max(y + 6, Math.min(y + h - 6, mid - (bug - value) * pxPer));
    g.fillStyle = '#e050ff';
    if (side === 0) g.fillRect(x + w - 10, yy - 7, 10, 14);
    else g.fillRect(x, yy - 7, 10, 14);
  }
  g.restore();
  g.fillStyle = '#000';
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.fillRect(x - 2, mid - 17, w + 4, 34);
  g.strokeRect(x - 2, mid - 17, w + 4, 34);
  g.fillStyle = '#fff';
  g.font = 'bold 22px monospace';
  g.textAlign = 'center';
  g.fillText(String(Math.round(value)), x + w / 2, mid + 8);
}

export function drawMFD(g: CanvasRenderingContext2D, d: InstrumentData, minimap: HTMLCanvasElement | null, range: number): void {
  const W = 512;
  const H = 512;
  bg(g, W, H);
  const cx = W / 2;
  const cy = H * 0.6;
  const scale = (H * 0.55) / range; // 像素/米
  g.save();
  g.beginPath();
  g.rect(0, 40, W, H - 80);
  g.clip();
  g.translate(cx, cy);
  const hr = (d.heading * Math.PI) / 180;
  g.rotate(-hr);
  if (minimap) {
    const mpp = d.mapSize / minimap.width;
    const sx = (d.heliX + d.mapSize / 2) / mpp;
    const sz = (d.heliZ + d.mapSize / 2) / mpp;
    const k = mpp * scale;
    g.globalAlpha = 0.85;
    g.drawImage(minimap, -sx * k, -sz * k, minimap.width * k, minimap.height * k);
    g.globalAlpha = 1;
  }
  const P = (x: number, z: number): [number, number] => [(x - d.heliX) * scale, (z - d.heliZ) * scale];
  if (d.route.length > 1) {
    g.strokeStyle = '#e050ff';
    g.lineWidth = 4;
    g.setLineDash([]);
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
    g.arc(px, pz, 9, 0, Math.PI * 2);
    g.fill();
  }
  for (const p of d.pickups) {
    const [px, pz] = P(p.x, p.z);
    g.fillStyle = p.kind === 'boost' ? '#ffd23a' : p.kind === 'shield' ? '#46b4ff' : '#4cff7a';
    g.fillRect(px - 5, pz - 5, 10, 10);
  }
  g.restore();
  // 本机符号
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx, cy - 14);
  g.lineTo(cx - 10, cy + 10);
  g.lineTo(cx, cy + 5);
  g.lineTo(cx + 10, cy + 10);
  g.closePath();
  g.fill();
  // 距离圈
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, (range / 2) * scale, 0, Math.PI * 2);
  g.stroke();
  // 顶栏
  g.fillStyle = '#0b1118';
  g.fillRect(0, 0, W, 40);
  g.fillRect(0, H - 40, W, 40);
  g.fillStyle = '#e050ff';
  g.font = 'bold 20px sans-serif';
  g.textAlign = 'left';
  g.fillText(d.navLabel.slice(0, 16), 10, 28);
  g.textAlign = 'right';
  if (d.navDistance !== null) g.fillText(d.navDistance > 1000 ? `${(d.navDistance / 1000).toFixed(1)} km` : `${Math.round(d.navDistance)} m`, W - 10, 28);
  // 风
  g.fillStyle = '#9fe';
  g.textAlign = 'left';
  g.font = '18px sans-serif';
  g.fillText(`风 ${Math.round(d.windDirFrom).toString().padStart(3, '0')}° ${d.windSpeed.toFixed(0)} m/s`, 10, H - 13);
  g.textAlign = 'right';
  g.fillText(`范围 ${range >= 1000 ? range / 1000 + ' km' : range + ' m'}`, W - 10, H - 13);
  // 风向箭头（相对机头）
  const rel = ((d.windDirFrom + 180 - d.heading) * Math.PI) / 180;
  g.save();
  g.translate(W - 50, 80);
  g.rotate(rel);
  g.strokeStyle = '#9fe';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 18);
  g.lineTo(0, -18);
  g.lineTo(-8, -6);
  g.moveTo(0, -18);
  g.lineTo(8, -6);
  g.stroke();
  g.restore();
}

export function drawEICAS(g: CanvasRenderingContext2D, d: InstrumentData): void {
  const W = 512;
  const H = 512;
  bg(g, W, H);
  const bar = (x: number, label: string, frac: number, mark: number | null, warn: boolean) => {
    const y0 = 60;
    const h = 300;
    g.fillStyle = '#1a222c';
    g.fillRect(x, y0, 54, h);
    const f = Math.max(0, Math.min(1.1, frac));
    g.fillStyle = warn ? '#ff5a3a' : f > 0.9 ? '#ffb347' : '#3fd27a';
    g.fillRect(x, y0 + h * (1 - Math.min(1, f)), 54, h * Math.min(1, f));
    if (mark !== null) {
      g.fillStyle = '#fff';
      g.fillRect(x - 6, y0 + h * (1 - Math.min(1, mark)) - 2, 66, 4);
    }
    g.fillStyle = '#ccc';
    g.font = 'bold 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, x + 27, y0 - 14);
    g.fillStyle = '#fff';
    g.fillText(`${Math.round(frac * 100)}`, x + 27, y0 + h + 30);
  };
  bar(30, 'TQ', d.powerFrac, d.hoverPowerFrac, d.torqueLimited);
  bar(120, 'NR', d.rpm, null, d.rpm < 0.96);
  bar(210, 'COL', d.collective, null, false);
  // 耐久
  const dx = 300;
  g.fillStyle = '#ccc';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'left';
  g.fillText('机体耐久', dx, 46);
  g.fillStyle = '#1a222c';
  g.fillRect(dx, 60, 190, 30);
  const dc = d.durability >= 70 ? '#3fd27a' : d.durability >= 30 ? '#ffb347' : '#ff5a3a';
  g.fillStyle = dc;
  g.fillRect(dx, 60, (190 * d.durability) / 100, 30);
  g.fillStyle = '#fff';
  g.fillText(`${Math.round(d.durability)}  ${d.statusLabel}`, dx, 120);
  // 告警灯
  const lights: Array<[string, boolean, string]> = [
    ['悬停', d.hover !== 'off', '#3fd27a'],
    ['增强', d.boost, '#ffd23a'],
    ['护盾', d.shield, '#46b4ff'],
    ['动力上限', d.torqueLimited, '#ffb347'],
    ['地形', d.terrainWarn, '#ff5a3a'],
    ['受损', d.durability < 70, d.durability < 30 ? '#ff5a3a' : '#ffb347'],
    ['增强储备', d.boostStored, '#ffd23a'],
    [`载货 ${d.cargo}`, d.cargo > 0, '#9fe'],
  ];
  lights.forEach(([label, on, color], i) => {
    const x = dx + (i % 2) * 98;
    const y = 150 + Math.floor(i / 2) * 62;
    g.fillStyle = on ? color : '#1a222c';
    g.fillRect(x, y, 90, 48);
    g.fillStyle = on ? '#05080c' : '#56606c';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, x + 45, y + 31);
  });
}
