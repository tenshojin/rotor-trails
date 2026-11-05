// 通用数学工具。仿真层与渲染层共用，不依赖 DOM。

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G = 9.81;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 以给定速率把 current 推向 target（线性限速）。 */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** 与帧率无关的指数平滑：rate 越大越快。 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** 把角度（弧度）归一化到 (-PI, PI]。 */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** 把角度（度）归一化到 [0, 360)。 */
export function wrap360(a: number): number {
  a %= 360;
  return a < 0 ? a + 360 : a;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** 平滑的软限幅：小信号近似线性，大信号趋近 ±limit。 */
export function softClamp(v: number, limit: number): number {
  return limit * Math.tanh(v / limit);
}

export function hypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** 点到线段距离（二维），返回距离与线段参数 t。 */
export function segDist2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp01(t);
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return { d: Math.sqrt(cx * cx + cz * cz), t };
}

/** 航向（度，0=北/-Z，90=东/+X）由方向向量计算。 */
export function headingOf(dx: number, dz: number): number {
  return wrap360(Math.atan2(dx, -dz) * RAD);
}

/** 两个航向（度）之间的有符号差值，结果在 (-180, 180]，正值表示向右。 */
export function headingDelta(from: number, to: number): number {
  let d = wrap360(to - from);
  if (d > 180) d -= 360;
  return d;
}
