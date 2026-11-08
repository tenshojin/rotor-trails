// 风向袋：机场常见的五节橙白布袋，喉口一个钢圈，用 V 形支架挂在杆顶的转轴上。
// 布是软的：风小的时候只有前面几节鼓起来，后面的耷拉下来；大约每节代表 3 节风速，
// 7.7 m/s（15 节）以上整条吹平。风大时尾巴左右甩、布面一鼓一鼓。
// 以前是一根硬的锥筒整根往下转，条纹按顶点插值（橙白之间糊成一段粉色的渐变）。
// 只有几个，形变在 CPU 上算（每个 420 个顶点），离得远就隔几帧才算。

import * as THREE from 'three/webgpu';

/** 尺寸（米）：布袋长、喉口半径、尾口半径、支架伸出去多远；五节；一圈几个点；每节几圈 */
export const SOCK = { L: 2.8, R0: 0.42, R1: 0.2, ARM: 0.35, BANDS: 5, RAD: 14, PER: 6 } as const;

/** 被风吹平的风速（m/s），15 节 */
export const SOCK_FULL = 7.7;

/** 布的颜色（线性空间）：褪了一点色的国际橙、米白 */
const ORANGE = [0.86, 0.19, 0.025];
const WHITE = [0.78, 0.77, 0.74];

/** 风速 v 下，从喉口算起鼓起来的长度占几成（喉口有钢圈撑着，没风也张着一小段） */
export function inflated(v: number): number {
  const f = Math.min(1, Math.max(0, v / SOCK_FULL));
  return 0.12 + 0.88 * f;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 每一圈在布袋上的位置（0 = 喉口，1 = 尾口）。节与节的交界处两圈重合，颜色才不会糊 */
function ringPositions(): number[] {
  const s: number[] = [];
  for (let k = 0; k < SOCK.BANDS; k++) for (let j = 0; j < SOCK.PER; j++) s.push((k + j / (SOCK.PER - 1)) / SOCK.BANDS);
  return s;
}

/** 喉口的钢圈、V 形支架和转轴（不跟着布动），一个几何体，所有风向袋共用（由调用方释放） */
export function windsockHardware(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(SOCK.R0, 0.022, 6, 22);
  ring.rotateY(Math.PI / 2);
  ring.translate(SOCK.ARM, 0, 0);
  parts.push(ring);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 6, 1, true);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
    parts.push(g);
  };
  const o = new THREE.Vector3(0.02, 0, 0);
  rod(o, new THREE.Vector3(SOCK.ARM, SOCK.R0, 0), 0.018);
  rod(o, new THREE.Vector3(SOCK.ARM, -SOCK.R0, 0), 0.018);
  const cap = new THREE.CylinderGeometry(0.075, 0.08, 0.16, 10);
  cap.translate(0, 0.02, 0);
  parts.push(cap);
  // 各部分属性一致（位置、法线、uv）才能合并：手工拼
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export class Windsock {
  /** 杆顶的转轴：绕 Y 转到下风方向（+X 指向下风） */
  readonly pivot = new THREE.Object3D();
  readonly cloth: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly s = ringPositions();
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  /** 每一圈的中心、切向转角（这一帧） */
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;

  constructor(clothMat: THREE.Material, hardwareMat: THREE.Material, hardware: THREE.BufferGeometry) {
    const rings = this.s.length;
    const n = rings * SOCK.RAD;
    this.pos = new Float32Array(n * 3);
    this.nor = new Float32Array(n * 3);
    this.cx = new Float32Array(rings);
    this.cy = new Float32Array(rings);
    const col = new Float32Array(n * 3);
    for (let r = 0; r < rings; r++) {
      const band = Math.floor(r / SOCK.PER);
      const c = band % 2 === 0 ? ORANGE : WHITE;
      for (let a = 0; a < SOCK.RAD; a++) col.set(c, (r * SOCK.RAD + a) * 3);
    }
    const idx: number[] = [];
    for (let r = 0; r < rings - 1; r++) {
      if ((r + 1) % SOCK.PER === 0) continue; // 节和节之间不连面（两圈重合）
      for (let a = 0; a < SOCK.RAD; a++) {
        const a1 = (a + 1) % SOCK.RAD;
        const i0 = r * SOCK.RAD + a;
        const i1 = r * SOCK.RAD + a1;
        const j0 = (r + 1) * SOCK.RAD + a;
        const j1 = (r + 1) * SOCK.RAD + a1;
        idx.push(i0, j0, i1, i1, j0, j1);
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    // 形状每帧在变：包围球按最大可能的范围给
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(SOCK.ARM + SOCK.L * 0.4, -SOCK.L * 0.3, 0), SOCK.L + 0.6);
    this.cloth = new THREE.Mesh(this.geo, clothMat);
    this.cloth.castShadow = true;
    this.cloth.receiveShadow = true;
    const hw = new THREE.Mesh(hardware, hardwareMat);
    hw.castShadow = true;
    this.pivot.add(this.cloth, hw);
    this.shape(0, 0, 0);
  }

  /** 按风速 v（m/s）摆出布袋的形状；t 是时间（秒），phase 让每个风向袋甩得不一样 */
  shape(v: number, t: number, phase: number): void {
    const { L, R0, R1, ARM, RAD } = SOCK;
    const sInf = inflated(v);
    const f = Math.min(1, v / SOCK_FULL);
    // 鼓起来的那段也会往下沉一点；风越小沉得越多。耷拉的部分没风时垂直，有点风是斜着往下坠
    const base = Math.pow(1 - f, 1.2) * 0.5;
    const hangMax = 1.5 - 0.35 * f;
    // 有风才甩：2.5 m/s 以下几乎不动
    const g = smooth(2.5, 9, v);
    const s = this.s;
    let px = ARM;
    let py = 0;
    let prevS = 0;
    let prevTh = base;
    for (let r = 0; r < s.length; r++) {
      const si = s[r];
      const hang = smooth(sInf, sInf + 0.5, si);
      const th = base + (hangMax - base) * hang + 0.05 * g * si * Math.sin(4.3 * t + phase - 3 * si);
      // 沿中心线积分（梯形）：前后两圈重合时长度为 0
      const ds = (si - prevS) * L;
      if (ds > 0) {
        const m = (th + prevTh) / 2;
        px += Math.cos(m) * ds;
        py -= Math.sin(m) * ds;
      }
      prevS = si;
      prevTh = th;
      this.cx[r] = px;
      this.cy[r] = py;
      // 截面：鼓起来是圆的，耷拉的部分压扁（沿 N 方向扁、两侧窄一点），布面随风一鼓一鼓
      const collapse = smooth(sInf - 0.05, sInf + 0.2, si);
      const breathe = 1 + 0.05 * g * si * Math.sin(11 * t - 9 * si + phase * 2);
      const r0 = (R0 + (R1 - R0) * si) * breathe;
      const rN = r0 * (1 - 0.7 * collapse);
      const rB = r0 * (1 - 0.25 * collapse);
      // 尾巴左右甩
      const wag = 0.18 * g * si * si * Math.sin(6.5 * t - 5 * si + phase);
      // 切向 T = (cos, -sin, 0)；B = (0, 0, 1)；N = B × T = (sin, cos, 0)
      const nx = Math.sin(th);
      const ny = Math.cos(th);
      for (let a = 0; a < RAD; a++) {
        const ang = (a / RAD) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const i = (r * RAD + a) * 3;
        this.pos[i] = px + ca * rN * nx;
        this.pos[i + 1] = py + ca * rN * ny;
        this.pos[i + 2] = wag + sa * rB;
        // 椭圆的法线：∝ cos·rB·N + sin·rN·B
        let ex = ca * rB * nx;
        let ey = ca * rB * ny;
        let ez = sa * rN;
        const len = Math.hypot(ex, ey, ez) || 1;
        ex /= len;
        ey /= len;
        ez /= len;
        this.nor[i] = ex;
        this.nor[i + 1] = ey;
        this.nor[i + 2] = ez;
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 尾口中心（转轴坐标系），给测试用 */
  tip(): [number, number] {
    const n = this.s.length - 1;
    return [this.cx[n], this.cy[n]];
  }

  /** 只释放自己的布；钢圈支架是共用的 */
  dispose(): void {
    this.geo.dispose();
  }
}
