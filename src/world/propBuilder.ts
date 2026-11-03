// 程序化建筑/道具构建器：同一套图元同时生成渲染几何（按材质与空间分块合批）和物理碰撞体，
// 保证“看到的”与“撞到的”一致。仿真（Node 测试）中可只生成碰撞体。

import type { ColliderTag } from '../sim/physics';
import type { V3 } from '../maps/types';

export type MatKey = 'std' | 'rough' | 'metal' | 'glass' | 'emit' | 'cloth' | 'rock';

export type ColliderSpec =
  | { kind: 'box'; c: V3; h: V3; rotY: number; tag: ColliderTag }
  | { kind: 'boxq'; c: V3; h: V3; q: [number, number, number, number]; tag: ColliderTag }
  | { kind: 'cyl'; c: V3; hh: number; r: number; tag: ColliderTag }
  | { kind: 'ball'; c: V3; r: number; tag: ColliderTag }
  | { kind: 'capsule'; c: V3; hh: number; r: number; tag: ColliderTag };

export interface Batch {
  pos: number[];
  nor: number[];
  col: number[];
}

export interface PrimOpts {
  mat?: MatKey;
  solid?: boolean;
  tag?: ColliderTag;
  /** 颜色随机扰动幅度 0..1 */
  jitter?: number;
}

export interface Footprint {
  x: number;
  z: number;
  r: number;
}

const TILE = 1024;

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export class PropBuilder {
  readonly withMesh: boolean;
  readonly colliders: ColliderSpec[] = [];
  readonly batches = new Map<string, Batch>();
  readonly footprints: Footprint[] = [];
  /** 动画/特殊对象的锚点（风向袋、旗帜、信标灯等），渲染层据此生成 */
  readonly anchors: Array<{ type: string; pos: V3; rotY: number; s: number; p?: Record<string, number | string> }> = [];
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private rot = 0;
  private cr = 1;
  private sr = 0;
  private sc = 1;
  private tile = '0_0';
  private seed = 1;
  defaultTag: ColliderTag = { kind: 'structure' };

  constructor(withMesh: boolean) {
    this.withMesh = withMesh;
  }

  /** 设置当前变换（每个道具开始时调用）。 */
  at(x: number, y: number, z: number, rotY = 0, s = 1): this {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    this.rot = rotY;
    this.cr = Math.cos(rotY);
    this.sr = Math.sin(rotY);
    this.sc = s;
    this.tile = `${Math.floor((x + 8192) / TILE)}_${Math.floor((z + 8192) / TILE)}`;
    this.seed = (Math.floor(x * 13.7) * 73856093) ^ (Math.floor(z * 7.3) * 19349663);
    return this;
  }

  /** 记录占地（用于植被避让）。r 为局部半径。 */
  footprint(r: number, lx = 0, lz = 0): this {
    const [x, , z] = this.w(lx, 0, lz);
    this.footprints.push({ x, z, r: r * this.sc });
    return this;
  }

  anchor(type: string, lx: number, ly: number, lz: number, rotY = 0, p?: Record<string, number | string>): this {
    this.anchors.push({ type, pos: this.w(lx, ly, lz), rotY: this.rot + rotY, s: this.sc, p });
    return this;
  }

  /** 局部坐标 → 世界坐标 */
  w(x: number, y: number, z: number): V3 {
    const s = this.sc;
    const X = x * s;
    const Z = z * s;
    return [this.tx + X * this.cr + Z * this.sr, this.ty + y * s, this.tz - X * this.sr + Z * this.cr];
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) | 0;
    return ((this.seed >>> 0) % 10000) / 10000;
  }

  private batch(mat: MatKey): Batch {
    const key = `${mat}|${this.tile}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { pos: [], nor: [], col: [] };
      this.batches.set(key, b);
    }
    return b;
  }

  private color(hex: number, jitter: number): [number, number, number] {
    const [r, g, b] = hexToRgb(hex);
    if (jitter <= 0) return [r, g, b];
    const k = 1 + (this.rnd() - 0.5) * jitter;
    return [Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k)];
  }

  /** 推入一个三角形（局部坐标，法线自动计算）。 */
  private tri(b: Batch, a: V3, c: V3, d: V3, col: [number, number, number]): void {
    const A = this.w(a[0], a[1], a[2]);
    const C = this.w(c[0], c[1], c[2]);
    const D = this.w(d[0], d[1], d[2]);
    const ux = C[0] - A[0];
    const uy = C[1] - A[1];
    const uz = C[2] - A[2];
    const vx = D[0] - A[0];
    const vy = D[1] - A[1];
    const vz = D[2] - A[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    b.pos.push(A[0], A[1], A[2], C[0], C[1], C[2], D[0], D[1], D[2]);
    b.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    b.col.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  }

  private quad(b: Batch, a: V3, c: V3, d: V3, e: V3, col: [number, number, number]): void {
    this.tri(b, a, c, d, col);
    this.tri(b, a, d, e, col);
  }

  private addCollider(spec: ColliderSpec): void {
    this.colliders.push(spec);
  }

  /** 长方体：中心 (cx,cy,cz)，尺寸 (sx,sy,sz)，可额外绕 Y 旋转 ry。 */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, o: PrimOpts = {}, ry = 0): this {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    if (this.withMesh) {
      const b = this.batch(o.mat ?? 'std');
      const col = this.color(color, o.jitter ?? 0.08);
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      const p = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
      const v = [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz), p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz)];
      this.quad(b, v[4], v[5], v[6], v[7], col); // +z
      this.quad(b, v[1], v[0], v[3], v[2], col); // -z
      this.quad(b, v[5], v[1], v[2], v[6], col); // +x
      this.quad(b, v[0], v[4], v[7], v[3], col); // -x
      this.quad(b, v[3], v[7], v[6], v[2], col); // +y
      this.quad(b, v[0], v[1], v[5], v[4], col); // -y
    }
    if (o.solid !== false) {
      const s = this.sc;
      this.addCollider({ kind: 'box', c: this.w(cx, cy, cz), h: [hx * s, hy * s, hz * s], rotY: this.rot + ry, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  /** 圆柱/圆台（轴沿 Y），r1 = 底半径，r2 = 顶半径。 */
  cyl(cx: number, cy: number, cz: number, r1: number, r2: number, h: number, color: number, seg = 12, o: PrimOpts = {}): this {
    if (this.withMesh) {
      const b = this.batch(o.mat ?? 'std');
      const col = this.color(color, o.jitter ?? 0.06);
      const y0 = cy - h / 2;
      const y1 = cy + h / 2;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const p0: V3 = [cx + c0 * r1, y0, cz + s0 * r1];
        const p1: V3 = [cx + c1 * r1, y0, cz + s1 * r1];
        const q0: V3 = [cx + c0 * r2, y1, cz + s0 * r2];
        const q1: V3 = [cx + c1 * r2, y1, cz + s1 * r2];
        if (r2 > 0.001) this.quad(b, p0, q0, q1, p1, col);
        else this.tri(b, p0, q0, p1, col);
        if (r2 > 0.001) this.tri(b, [cx, y1, cz], q1, q0, col);
        this.tri(b, [cx, y0, cz], p0, p1, col);
      }
    }
    if (o.solid !== false) {
      const s = this.sc;
      const r = Math.max(r1, r2) * 0.92;
      this.addCollider({ kind: 'cyl', c: this.w(cx, cy, cz), hh: (h / 2) * s, r: r * s, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  cone(cx: number, cy: number, cz: number, r: number, h: number, color: number, seg = 10, o: PrimOpts = {}): this {
    // 碰撞体用下半部的圆柱近似
    this.cyl(cx, cy, cz, r, 0, h, color, seg, { ...o, solid: false });
    if (o.solid !== false) {
      const s = this.sc;
      this.addCollider({ kind: 'cyl', c: this.w(cx, cy - h * 0.15, cz), hh: h * 0.35 * s, r: r * 0.6 * s, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  /** 低多边形球（可选噪声变形，用于岩石、树冠）。 */
  sphere(cx: number, cy: number, cz: number, r: number, color: number, o: PrimOpts & { sy?: number; noise?: number; seg?: number } = {}): this {
    if (this.withMesh) {
      const b = this.batch(o.mat ?? 'std');
      const seg = o.seg ?? 8;
      const rings = Math.max(3, Math.floor(seg / 2));
      const sy = o.sy ?? 1;
      const nz = o.noise ?? 0;
      const pts: V3[][] = [];
      for (let i = 0; i <= rings; i++) {
        const v = i / rings;
        const phi = v * Math.PI;
        const row: V3[] = [];
        for (let j = 0; j <= seg; j++) {
          const th = (j / seg) * Math.PI * 2;
          const k = j === seg ? 0 : j;
          let rr = r;
          if (nz > 0 && i > 0 && i < rings) {
            const h = Math.sin(i * 12.9898 + k * 78.233 + this.tx * 0.37 + this.tz * 0.11) * 43758.5453;
            rr *= 1 + (h - Math.floor(h) - 0.5) * nz;
          }
          row.push([cx + Math.sin(phi) * Math.cos(th) * rr, cy + Math.cos(phi) * rr * sy, cz + Math.sin(phi) * Math.sin(th) * rr]);
        }
        pts.push(row);
      }
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j < seg; j++) {
          const col = this.color(color, o.jitter ?? 0.1);
          const a = pts[i][j];
          const c = pts[i + 1][j];
          const d = pts[i + 1][j + 1];
          const e = pts[i][j + 1];
          if (i === 0) this.tri(b, a, d, c, col);
          else if (i === rings - 1) this.tri(b, a, e, c, col);
          else this.quad(b, a, e, d, c, col);
        }
      }
    }
    if (o.solid !== false) {
      const s = this.sc;
      this.addCollider({ kind: 'ball', c: this.w(cx, cy, cz), r: r * Math.min(1, o.sy ?? 1) * 0.95 * s, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  /** 人字形屋顶：沿 X 方向的屋脊，w = X 长度，d = Z 进深，h = 屋脊高度，ov = 出檐。 */
  gable(cx: number, cy: number, cz: number, w: number, d: number, h: number, ov: number, color: number, o: PrimOpts = {}, ry = 0): this {
    if (this.withMesh) {
      const b = this.batch(o.mat ?? 'rough');
      const col = this.color(color, o.jitter ?? 0.08);
      const hw = w / 2 + ov;
      const hd = d / 2 + ov;
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      const p = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
      const yE = -ov * (h / (d / 2));
      const A = p(-hw, yE, -hd);
      const B = p(hw, yE, -hd);
      const C = p(hw, h, 0);
      const D = p(-hw, h, 0);
      const E = p(-hw, yE, hd);
      const F = p(hw, yE, hd);
      this.quad(b, A, D, C, B, col);
      this.quad(b, E, F, C, D, col);
      const gcol = this.color(color, 0.02);
      gcol[0] *= 0.82;
      gcol[1] *= 0.82;
      gcol[2] *= 0.82;
      this.tri(b, p(-w / 2, 0, -d / 2), p(-w / 2, 0, d / 2), p(-w / 2, h, 0), gcol);
      this.tri(b, p(w / 2, 0, d / 2), p(w / 2, 0, -d / 2), p(w / 2, h, 0), gcol);
      // 屋檐底面
      this.quad(b, A, B, F, E, gcol);
    }
    if (o.solid !== false) {
      const sc = this.sc;
      this.addCollider({ kind: 'box', c: this.w(cx, cy + h * 0.33, cz), h: [(w / 2) * sc, h * 0.33 * sc, (d / 2) * 0.8 * sc], rotY: this.rot + ry, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  /** 四坡顶（攒尖/庑殿简化）。 */
  hip(cx: number, cy: number, cz: number, w: number, d: number, h: number, ov: number, color: number, o: PrimOpts = {}, ridge = 0.35): this {
    if (this.withMesh) {
      const b = this.batch(o.mat ?? 'rough');
      const col = this.color(color, o.jitter ?? 0.08);
      const hw = w / 2 + ov;
      const hd = d / 2 + ov;
      const rw = (w / 2) * ridge;
      const yE = -ov * 0.4;
      const A: V3 = [cx - hw, cy + yE, cz - hd];
      const B: V3 = [cx + hw, cy + yE, cz - hd];
      const C: V3 = [cx + hw, cy + yE, cz + hd];
      const D: V3 = [cx - hw, cy + yE, cz + hd];
      const R1: V3 = [cx - rw, cy + h, cz];
      const R2: V3 = [cx + rw, cy + h, cz];
      this.quad(b, A, R1, R2, B, col);
      this.quad(b, C, R2, R1, D, col);
      this.tri(b, B, R2, C, col);
      this.tri(b, D, R1, A, col);
      this.quad(b, A, B, C, D, col);
    }
    if (o.solid !== false) {
      const sc = this.sc;
      this.addCollider({ kind: 'box', c: this.w(cx, cy + h * 0.33, cz), h: [(w / 2) * sc, h * 0.33 * sc, (d / 2) * sc], rotY: this.rot, tag: o.tag ?? this.defaultTag });
    }
    return this;
  }

  /** 竖直矩形面片（双面材质，用于旗帜/标牌）。 */
  panel(cx: number, cy: number, cz: number, w: number, h: number, color: number, ry = 0, mat: MatKey = 'cloth'): this {
    if (!this.withMesh) return this;
    const b = this.batch(mat);
    const col = this.color(color, 0.05);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const p = (x: number, y: number): V3 => [cx + x * c, cy + y, cz - x * s];
    this.quad(b, p(-w / 2, -h / 2), p(w / 2, -h / 2), p(w / 2, h / 2), p(-w / 2, h / 2), col);
    return this;
  }

  /** 水平面片（甲板标线、停机坪标志）。 */
  flat(cx: number, cy: number, cz: number, w: number, d: number, color: number, mat: MatKey = 'std', ry = 0): this {
    if (!this.withMesh) return this;
    const b = this.batch(mat);
    const col = this.color(color, 0.02);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const p = (x: number, z: number): V3 => [cx + x * c + z * s, cy, cz - x * s + z * c];
    this.quad(b, p(-w / 2, d / 2), p(w / 2, d / 2), p(w / 2, -d / 2), p(-w / 2, -d / 2), col);
    return this;
  }

  /** 两点之间的方柱（杆件、桁架、缆索）。 */
  beam(a: V3, b: V3, t: number, color: number, o: PrimOpts = {}): this {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return this;
    if (this.withMesh) {
      const bt = this.batch(o.mat ?? 'metal');
      const col = this.color(color, o.jitter ?? 0.04);
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      // 构造两个与轴线垂直的方向
      let px = -uz;
      let py = 0;
      let pz = ux;
      let pl = Math.hypot(px, py, pz);
      if (pl < 1e-3) {
        px = 1;
        py = 0;
        pz = 0;
        pl = 1;
      }
      px /= pl;
      py /= pl;
      pz /= pl;
      const qx = uy * pz - uz * py;
      const qy = uz * px - ux * pz;
      const qz = ux * py - uy * px;
      const h = t / 2;
      const corner = (base: V3, i: number): V3 => {
        const sx = i === 0 || i === 3 ? -h : h;
        const sy = i < 2 ? -h : h;
        return [base[0] + px * sx + qx * sy, base[1] + py * sx + qy * sy, base[2] + pz * sx + qz * sy];
      };
      const A = [0, 1, 2, 3].map((i) => corner(a, i));
      const B = [0, 1, 2, 3].map((i) => corner(b, i));
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        this.quad(bt, A[i], A[j], B[j], B[i], col);
      }
    }
    if (o.solid) {
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const s = this.sc;
      // 用胶囊/盒子近似：竖直杆件用圆柱，其余用 boxq
      if (Math.abs(dy) > 0.95 * len) this.addCollider({ kind: 'cyl', c: this.w(mid[0], mid[1], mid[2]), hh: (len / 2) * s, r: (t / 2) * s, tag: o.tag ?? this.defaultTag });
      else {
        const yaw = Math.atan2(dx, dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const q = quatYawPitch(this.rot + yaw, -pitch);
        this.addCollider({ kind: 'boxq', c: this.w(mid[0], mid[1], mid[2]), h: [(t / 2) * s, (t / 2) * s, (len / 2) * s], q, tag: o.tag ?? this.defaultTag });
      }
    }
    return this;
  }

  /** 自定义网格（局部坐标三角形列表）。 */
  mesh(tris: number[], color: number, mat: MatKey = 'rock', jitter = 0.06): this {
    if (!this.withMesh) return this;
    const b = this.batch(mat);
    for (let i = 0; i < tris.length; i += 9) {
      const col = this.color(color, jitter);
      this.tri(b, [tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]], col);
    }
    return this;
  }

  colliderBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ry = 0, tag?: ColliderTag): this {
    const s = this.sc;
    this.addCollider({ kind: 'box', c: this.w(cx, cy, cz), h: [hx * s, hy * s, hz * s], rotY: this.rot + ry, tag: tag ?? this.defaultTag });
    return this;
  }

  addColliderCyl(cx: number, cy: number, cz: number, hh: number, r: number, tag?: ColliderTag): this {
    const s = this.sc;
    this.addCollider({ kind: 'cyl', c: this.w(cx, cy, cz), hh: hh * s, r: r * s, tag: tag ?? this.defaultTag });
    return this;
  }

  addColliderBall(cx: number, cy: number, cz: number, r: number, tag?: ColliderTag): this {
    this.addCollider({ kind: 'ball', c: this.w(cx, cy, cz), r: r * this.sc, tag: tag ?? this.defaultTag });
    return this;
  }

  colliderBoxQ(c: V3, h: V3, q: [number, number, number, number], tag?: ColliderTag): this {
    this.addCollider({ kind: 'boxq', c, h, q, tag: tag ?? this.defaultTag });
    return this;
  }

  get rotation(): number {
    return this.rot;
  }
  get scale(): number {
    return this.sc;
  }
  get origin(): V3 {
    return [this.tx, this.ty, this.tz];
  }
}

/** 先绕 Y 偏航再绕本地 X 俯仰的四元数（x,y,z,w）。 */
export function quatYawPitch(yaw: number, pitch: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = qYaw * qPitch
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}
