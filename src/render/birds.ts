// 天上的活物：风景里最便宜的一笔“活的”。一共几十只，一个实例网格，一次绘制；位置在 CPU 上算（几十个矩阵），
// 翅膀在顶点着色器里扇。鸟绕着观景点和起降场盘旋，直升机靠近会让开。夜里和大雨的时候都收起来了。

import * as THREE from 'three/webgpu';
import { abs, instanceIndex, positionGeometry, positionLocal, uniformArray } from 'three/tsl';
import { clamp, damp } from '../core/math';
import { mulberry32 } from '../core/noise';
import type { BirdKind } from '../maps/types';

interface Species {
  /** 翼展的一半（米） */
  half: number;
  /** 颜色（线性） */
  color: [number, number, number];
  speed: number;
  /** 飞多高（离盘旋圈里最高的地面） */
  alt: [number, number];
  radius: [number, number];
  /** 扇翅：频率（赫兹）、幅度（弧度）、一轮扇多久、滑翔多久 */
  hz: number;
  amp: number;
  beat: [number, number];
  glide: [number, number];
  /** 滑翔时翅膀抬起的角度 */
  dihedral: number;
}

const SPECIES: Record<BirdKind, Species> = {
  condor: { half: 1.45, color: [0.02, 0.02, 0.022], speed: 15, alt: [50, 170], radius: [130, 320], hz: 1.5, amp: 0.3, beat: [1.2, 2.5], glide: [14, 40], dihedral: 0.13 },
  raven: { half: 0.62, color: [0.012, 0.012, 0.016], speed: 13, alt: [25, 110], radius: [60, 180], hz: 3.2, amp: 0.5, beat: [2, 5], glide: [2, 7], dihedral: 0.05 },
  gull: { half: 0.65, color: [0.72, 0.73, 0.74], speed: 11, alt: [14, 70], radius: [50, 170], hz: 2.6, amp: 0.55, beat: [1.5, 4], glide: [2, 6], dihedral: 0.1 },
  kite: { half: 0.85, color: [0.09, 0.06, 0.04], speed: 11, alt: [40, 150], radius: [70, 200], hz: 2.2, amp: 0.38, beat: [1, 2], glide: [8, 22], dihedral: 0.04 },
  egret: { half: 0.78, color: [0.8, 0.8, 0.77], speed: 10, alt: [12, 55], radius: [90, 260], hz: 1.9, amp: 0.62, beat: [30, 60], glide: [1, 3], dihedral: 0.03 },
  macaw: { half: 0.5, color: [0.5, 0.045, 0.03], speed: 15, alt: [22, 70], radius: [80, 240], hz: 4.5, amp: 0.6, beat: [30, 60], glide: [0.5, 1.5], dihedral: 0.02 },
};

interface Bird {
  s: Species;
  x: number;
  y: number;
  z: number;
  r: number;
  /** 转圈的角速度（有方向）和当前角度 */
  w: number;
  a: number;
  /** 高度和圈子的缓慢漂移 */
  ph: number;
  /** 这一段（扇翅或滑翔）还有多久 */
  left: number;
  flapping: boolean;
  /** 翅膀走到哪了 */
  wing: number;
  beat: number;
  /** 被直升机赶开了多少（0..1） */
  shy: number;
}

/** 一只鸟：机身、两片翅膀分三段、翅尖几根飞羽、扇形的尾巴。朝 -z 飞，翼展的一半是 1 */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const shade: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ka: number, kb: number, kc: number): void => {
    pos.push(...a, ...b, ...c);
    shade.push(ka, kb, kc);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], ka: number, kb: number): void => {
    tri(a, b, c, ka, ka, kb);
    tri(a, c, d, ka, kb, kb);
  };
  // 机身：一根细长的纺锤，四条棱
  const rings = [[-0.42, 0.012], [-0.28, 0.05], [0.0, 0.075], [0.26, 0.04], [0.42, 0.012]];
  for (let i = 0; i + 1 < rings.length; i++) {
    const [z0, r0] = rings[i];
    const [z1, r1] = rings[i + 1];
    for (let k = 0; k < 4; k++) {
      const a0 = (k * Math.PI) / 2;
      const a1 = ((k + 1) * Math.PI) / 2;
      quad([Math.cos(a0) * r0, Math.sin(a0) * r0 * 0.8, z0], [Math.cos(a1) * r0, Math.sin(a1) * r0 * 0.8, z0], [Math.cos(a1) * r1, Math.sin(a1) * r1 * 0.8, z1], [Math.cos(a0) * r1, Math.sin(a0) * r1 * 0.8, z1], 0.75, 0.75);
    }
  }
  // 尾巴
  tri([0, 0, 0.3], [-0.14, 0, 0.62], [0.14, 0, 0.62], 0.7, 0.7, 0.7);
  for (const s of [-1, 1]) {
    const root = [[0.05, -0.17], [0.05, 0.17]];
    const mid = [[0.48, -0.2], [0.5, 0.18]];
    const out = [[0.82, -0.15], [0.8, 0.12]];
    const p = (q: number[], y: number): number[] => [q[0] * s, y, q[1]];
    quad(p(root[0], 0), p(mid[0], 0.015), p(mid[1], 0.015), p(root[1], 0), 1, 1);
    quad(p(mid[0], 0.015), p(out[0], 0.03), p(out[1], 0.03), p(mid[1], 0.015), 1, 0.9);
    // 飞羽：翅尖不是一块板，是分开的几根
    for (let f = 0; f < 4; f++) {
      const k = f / 3;
      const z0 = -0.15 + 0.27 * k;
      const z1 = z0 + 0.075;
      const tip = [1.0 - 0.1 * Math.abs(k - 0.35), z0 + 0.03 - 0.06 * (1 - k)];
      tri(p([0.82, z0], 0.03), p(tip, 0.035), p([0.82, z1], 0.03), 0.8, 0.3, 0.8);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 明暗放在顶点色里（翅尖暗一点），鸟本来的颜色是实例色
  g.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((k) => [k, k, k]), 3));
  g.computeVertexNormals();
  return g;
}

const _p = new THREE.Vector3();
const _next = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _roll = new THREE.Quaternion();
const _fwd = new THREE.Vector3(0, 0, -1);
const _c = new THREE.Color();

export class Birds {
  readonly group = new THREE.Group();
  private birds: Bird[] = [];
  private mesh: THREE.InstancedMesh;
  private mat: THREE.MeshStandardNodeMaterial;
  private geo: THREE.BufferGeometry;
  /** 每只鸟翅膀抬起的方向和大小（这只鸟的“上”× 翼展 × 翅膀的角度） */
  private lifts: THREE.Vector3[];

  /**
   * kinds：这张图有什么鸟、各几只。anchors：鸟绕着哪些地方飞（观景点、起降场）。
   * ground：地面高度（水面算地面），用来把盘旋的圈抬到山上面
   */
  constructor(kinds: Partial<Record<BirdKind, number>>, anchors: Array<[number, number]>, ground: (x: number, z: number) => number, seed: number) {
    const rng = mulberry32(seed);
    for (const k of Object.keys(kinds) as BirdKind[]) {
      const s = SPECIES[k];
      for (let i = 0; i < (kinds[k] ?? 0); i++) {
        const at = anchors[Math.floor(rng() * anchors.length)];
        const r = s.radius[0] + (s.radius[1] - s.radius[0]) * rng();
        const off = 80 + 520 * rng();
        const dir = rng() * Math.PI * 2;
        const x = at[0] + Math.cos(dir) * off;
        const z = at[1] + Math.sin(dir) * off;
        let top = ground(x, z);
        for (let j = 0; j < 8; j++) top = Math.max(top, ground(x + Math.cos(j * 0.785) * r, z + Math.sin(j * 0.785) * r));
        this.birds.push({
          s,
          x,
          y: top + s.alt[0] + (s.alt[1] - s.alt[0]) * rng(),
          z,
          r,
          w: ((rng() < 0.5 ? -1 : 1) * s.speed) / r,
          a: rng() * Math.PI * 2,
          ph: rng() * 40,
          left: rng() * 6,
          flapping: false,
          wing: rng() * 6,
          beat: 0,
          shy: 0,
        });
      }
    }
    const n = this.birds.length;
    this.lifts = Array.from({ length: Math.max(1, n) }, () => new THREE.Vector3());
    const lifts = uniformArray(this.lifts, 'vec3') as unknown as { element(i: unknown): THREE.Node<'vec3'> };
    this.geo = birdGeometry();
    this.mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    // 绕翅根转：离机身越远抬得越高，翅尖再多弯一点
    // （实例矩阵这时候已经乘过了：positionLocal 是世界里的位置，翼根到翅尖要看模型自己的坐标）
    const reach = abs(positionGeometry.x);
    this.mat.positionNode = positionLocal.add(lifts.element(instanceIndex).mul(reach.add(reach.mul(reach).mul(0.35))));
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, n));
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.birds.forEach((b, i) => {
      // 同一种鸟的颜色也略有差别
      const v = 0.85 + 0.3 * rng();
      this.mesh.setColorAt(i, _c.setRGB(b.s.color[0] * v, b.s.color[1] * v, b.s.color[2] * v));
    });
    this.group.add(this.mesh);
    this.update(0.016, 0, null, true);
  }

  update(dt: number, t: number, heli: THREE.Vector3 | null, show: boolean): void {
    this.group.visible = show && this.birds.length > 0;
    if (!this.group.visible || dt <= 0) return;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const s = b.s;
      b.a += b.w * dt;
      // 这一圈不是死的：圈子大小和高度都在慢慢变，看不出是绕着一个点转
      const swell = 1 + 0.18 * Math.sin((t + b.ph) * 0.07);
      const lift = Math.sin((t + b.ph) * 0.11) * 9;
      this.place(_p, b, b.a, swell, lift);
      this.place(_next, b, b.a + Math.sign(b.w) * 0.02, swell, lift);
      // 直升机来了就躲：往外、往上让开，走远了再慢慢回来
      let shy = 0;
      if (heli) {
        const d = _p.distanceTo(heli);
        shy = clamp((130 - d) / 80, 0, 1);
        b.shy = damp(b.shy, shy, shy > b.shy ? 2.2 : 0.35, dt);
        if (b.shy > 0.002) {
          _x.subVectors(_p, heli).setY(0).normalize();
          _p.addScaledVector(_x, b.shy * 90);
          _next.addScaledVector(_x, b.shy * 90);
          _p.y += b.shy * 30;
          _next.y += b.shy * 30;
        }
      }
      // 扇几下，滑一段
      b.left -= dt;
      if (b.left <= 0) {
        b.flapping = !b.flapping || b.shy > 0.2;
        const span = b.flapping ? s.beat : s.glide;
        b.left = span[0] + (span[1] - span[0]) * Math.abs(Math.sin(b.ph + t));
      }
      b.beat = damp(b.beat, b.flapping ? 1 : 0, 5, dt);
      b.wing += dt * s.hz * Math.PI * 2 * (0.4 + 0.6 * b.beat);
      const wing = s.dihedral + Math.sin(b.wing) * s.amp * b.beat;
      // 朝着前进方向，转弯时压一点坡度
      _z.subVectors(_next, _p).normalize();
      _q.setFromUnitVectors(_fwd, _z);
      const bank = clamp((b.w * s.speed) / 9.81, -0.7, 0.7);
      _roll.setFromAxisAngle(_y.set(0, 0, 1), -bank);
      _q.multiply(_roll);
      this.lifts[i].set(0, 1, 0).applyQuaternion(_q).multiplyScalar(s.half * wing);
      _m.compose(_p, _q, _s.setScalar(s.half));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private place(out: THREE.Vector3, b: Bird, a: number, swell: number, lift: number): void {
    out.set(b.x + Math.cos(a) * b.r * swell, b.y + lift, b.z + Math.sin(a) * b.r * swell);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
    this.geo.dispose();
    this.birds.length = 0;
  }
}
