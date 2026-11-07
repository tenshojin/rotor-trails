// 撞击和受损看得见：撞上东西扬起尘土、溅起水花、飞出碎片和火星，受损的发动机拖着烟，坠毁之后残骸冒黑烟。
// 只有画面，不影响飞行。几百个面向镜头的小片一次实例绘制，位置在 CPU 上算。

import * as THREE from 'three/webgpu';
import { abs, attribute, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, float, length, max, mix, normalize, perspectiveDepthToViewZ, positionGeometry, positionView, positionWorld, sin, smoothstep, sqrt, step, texture, uniform, uv, vec2 } from 'three/tsl';
import { FOG } from './atmosphere';
import { sceneDepthNode } from './mirror';
import { terrainSun } from './sunMap';
import { getNoiseTexture } from './textures';
import { VFOG } from './volumetricFog';

const CAP = 320;

/** 一片的种类：烟和尘是软的一团，碎片是硬的小块，火星自己发光 */
const SOFT = 0;
const CHIP = 1;
const SPARK = 2;

/** air：撞在半空的东西上（树、塔、别的什么），没有地面的尘土 */
export type ImpactSurface = 'ground' | 'water' | 'air';

interface Bit {
  live: boolean;
  kind: number;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 受重力的比例、空气阻力 */
  fall: number;
  drag: number;
  r0: number;
  r1: number;
  rot: number;
  seed: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
  dist: number;
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();

export class WreckFx {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly bits: Bit[] = [];
  private readonly order: Bit[] = [];
  private readonly aBit = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  private readonly aInfo = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  private readonly aTint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  private readonly uRight = uniform(new THREE.Vector3(1, 0, 0));
  private readonly uUp = uniform(new THREE.Vector3(0, 1, 0));
  private readonly uBack = uniform(new THREE.Vector3(0, 0, 1));
  private next = 0;
  private smokeAcc = 0;
  private sparkAcc = 0;
  private seed = 7;

  constructor(reversedDepth: boolean) {
    for (let i = 0; i < CAP; i++) this.bits.push({ live: false, kind: SOFT, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fall: 0, drag: 0, r0: 1, r1: 1, rot: 0, seed: 0, alpha: 1, r: 0, g: 0, b: 0, dist: 0 });
    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    g.setIndex(plane.getIndex());
    g.setAttribute('aBit', this.aBit);
    g.setAttribute('aInfo', this.aInfo);
    g.setAttribute('aTint', this.aTint);
    g.instanceCount = 0;
    this.geo = g;

    const P = attribute('aBit', 'vec4');
    const I = attribute('aInfo', 'vec4');
    const T = attribute('aTint', 'vec4');
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    m.positionNode = P.xyz.add(this.uRight.mul(positionGeometry.x.mul(P.w.mul(2)))).add(this.uUp.mul(positionGeometry.y.mul(P.w.mul(2))));
    const q = uv().mul(2).sub(1).toVar();
    const rr = length(q);
    const cs = cos(I.z);
    const sn = sin(I.z);
    const rq = vec2(q.x.mul(cs).sub(q.y.mul(sn)), q.x.mul(sn).add(q.y.mul(cs))).toVar();
    const noise = getNoiseTexture();
    const n1 = texture(noise, rq.mul(0.13).add(vec2(I.w, I.w.mul(1.7)))).r;
    const n2 = texture(noise, rq.mul(0.42).add(vec2(I.w.mul(2.3), I.w.mul(0.9)))).r;
    const n = n1.mul(0.68).add(n2.mul(0.32)).toVar();
    const k = I.x;
    const shape = clamp(float(1).sub(rr).mul(1.8).add(n.sub(0.5).mul(mix(float(1.5), float(3.0), k))).sub(0.1), 0, 1);
    const puff = smoothstep(0.0, 0.42, shape);
    // 碎片是有棱角的小块，火星是一个亮点
    const chip = step(abs(rq.x).add(abs(rq.y).mul(1.5)), 0.9);
    const spark = smoothstep(1.0, 0.1, rr);
    const hard = step(0.5, T.w);
    const glow = step(1.5, T.w);
    const body = mix(mix(puff, chip, hard), spark, glow);
    const nrm = normalize(this.uRight.mul(q.x.add(n1.sub(0.5).mul(1.2))).add(this.uUp.mul(q.y.add(n2.sub(0.5).mul(1.2)))).add(this.uBack.mul(sqrt(max(float(1).sub(rr.mul(rr)), 0.06)))));
    const ndl = dot(nrm, FOG.sunDir).mul(0.5).add(0.5);
    const sun = (VFOG.sun as unknown as THREE.Node<'vec3'>).mul(terrainSun(positionWorld)).mul(1 / Math.PI);
    const lit = FOG.color.mul(nrm.y.mul(0.2).add(0.6)).add(sun.mul(ndl.mul(ndl).mul(0.8)));
    // （火星不受光，亮度也跟着天色走：夜里亮，白天几乎看不出）
    m.colorNode = mix(T.rgb.mul(lit).mul(n.mul(0.5).add(0.76)), T.rgb.mul(max(FOG.color.mul(2.0), 2.4)), glow);
    const depth = sceneDepthNode(reversedDepth);
    const sceneZ = perspectiveDepthToViewZ(depth.r, cameraNear, cameraFar).negate();
    const soft = smoothstep(0.0, P.w.mul(0.55).add(0.25), sceneZ.sub(positionView.z.negate()));
    const near = smoothstep(P.w.mul(0.7).add(0.6), P.w.mul(1.6).add(4.0), length(P.xyz.sub(cameraPosition)));
    m.opacityNode = body.mul(I.y).mul(mix(soft.mul(near), float(1), hard));
    this.mat = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawn(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r0: number, r1: number, color: readonly [number, number, number], alpha: number, fall: number, drag: number): void {
    const p = this.bits[this.next];
    this.next = (this.next + 1) % CAP;
    p.live = true;
    p.kind = kind;
    p.age = 0;
    p.life = life;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.fall = fall;
    p.drag = drag;
    p.r0 = r0;
    p.r1 = r1;
    p.rot = this.rnd() * 6.28;
    p.seed = this.rnd();
    p.alpha = alpha;
    [p.r, p.g, p.b] = color;
  }

  /** 撞了一下。strength 0..1；vel：撞的时候飞机的速度；dust：这里的土是什么颜色 */
  burst(pos: THREE.Vector3, vel: THREE.Vector3, strength: number, surface: ImpactSurface, dust: readonly [number, number, number]): void {
    const s = Math.min(1, Math.max(0.05, strength));
    const R = (a: number, b: number): number => a + (b - a) * this.rnd();
    const water = surface === 'water';
    const puffs = Math.round(6 + 26 * s);
    for (let i = 0; i < puffs; i++) {
      const a = this.rnd() * 6.283;
      const v = R(2, 13) * (0.4 + s);
      if (water) this.spawn(SOFT, pos.x, pos.y, pos.z, Math.cos(a) * v * 0.6 + vel.x * 0.1, R(6, 18) * (0.5 + s), Math.sin(a) * v * 0.6 + vel.z * 0.1, R(0.9, 1.9), R(0.5, 1), R(2, 5) * (0.6 + s), [0.92, 0.95, 0.97], 0.8, 0.9, 0.8);
      else if (surface === 'air') {
        if (i % 3 === 0) this.spawn(SOFT, pos.x, pos.y, pos.z, Math.cos(a) * v * 0.3 + vel.x * 0.4, R(0, 2), Math.sin(a) * v * 0.3 + vel.z * 0.4, R(0.8, 1.6), R(0.4, 0.8), R(1.5, 3), [0.1, 0.1, 0.1], 0.6, 0, 1.2);
      } else this.spawn(SOFT, pos.x + R(-1, 1), pos.y + R(-0.6, 0.8), pos.z + R(-1, 1), Math.cos(a) * v + vel.x * 0.12, R(0.5, 4) * (0.4 + s), Math.sin(a) * v + vel.z * 0.12, R(1.3, 3), R(0.6, 1.4), R(3, 8) * (0.5 + s), dust, 0.72, 0.03, 1.5);
    }
    if (water) return;
    const chips = Math.round(4 + 22 * s);
    for (let i = 0; i < chips; i++) {
      const a = this.rnd() * 6.283;
      const v = R(3, 15) * (0.4 + s);
      const c = this.rnd() < 0.5 ? [0.12, 0.12, 0.13] as const : [0.62, 0.62, 0.6] as const;
      this.spawn(CHIP, pos.x, pos.y + 0.6, pos.z, Math.cos(a) * v + vel.x * 0.25, R(3, 13) * (0.5 + s), Math.sin(a) * v + vel.z * 0.25, R(1.1, 2.2), R(0.05, 0.2), R(0.05, 0.2), c, 1, 1, 0.25);
    }
    const sparks = Math.round(6 + 26 * s);
    for (let i = 0; i < sparks; i++) {
      const a = this.rnd() * 6.283;
      const v = R(5, 22);
      this.spawn(SPARK, pos.x, pos.y + 0.8, pos.z, Math.cos(a) * v + vel.x * 0.3, R(1, 12), Math.sin(a) * v + vel.z * 0.3, R(0.25, 0.7), 0.1, 0.05, [1, 0.62, 0.22], 1, 0.7, 0.6);
    }
  }

  /** 受损的发动机拖着烟。level 0..1；越重烟越黑越多 */
  damage(pos: THREE.Vector3, vel: THREE.Vector3, level: number, dt: number): void {
    this.smokeAcc += dt * (2.5 + 13 * level);
    const grey = 0.34 - 0.27 * level;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const R = this.rnd() - 0.5;
      this.spawn(SOFT, pos.x + R * 0.5, pos.y, pos.z + R * 0.5, vel.x * 0.28 + R * 1.5, vel.y * 0.28 + 1.1, vel.z * 0.28 - R * 1.5, 2.2 + 2.2 * this.rnd(), 0.4, 2.2 + 2.4 * level, [grey, grey, grey * 1.02], 0.42 + 0.34 * level, 0, 0.5);
    }
  }

  /** 残骸：一柱黑烟，时不时蹦出几颗火星。掉在水里只有一点水汽 */
  wreck(pos: THREE.Vector3, dt: number, water: boolean): void {
    this.smokeAcc += dt * (water ? 4 : 11);
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const R = this.rnd() - 0.5;
      if (water) this.spawn(SOFT, pos.x + R * 3, pos.y, pos.z - R * 3, R, 1.4, -R, 3 + 2 * this.rnd(), 1, 4, [0.86, 0.88, 0.9], 0.34, 0, 0.3);
      else this.spawn(SOFT, pos.x + R * 2, pos.y, pos.z - R * 2, R * 2, 3 + 2.4 * this.rnd(), -R * 2, 4.5 + 3.5 * this.rnd(), 1, 5 + 4 * this.rnd(), [0.05, 0.05, 0.055], 0.82, 0, 0.12);
    }
    if (water) return;
    this.sparkAcc += dt * 9;
    while (this.sparkAcc >= 1) {
      this.sparkAcc -= 1;
      const a = this.rnd() * 6.283;
      const v = 2 + 5 * this.rnd();
      this.spawn(SPARK, pos.x, pos.y, pos.z, Math.cos(a) * v, 3 + 8 * this.rnd(), Math.sin(a) * v, 0.5 + 0.7 * this.rnd(), 0.09, 0.04, [1, 0.5, 0.14], 1, 0.6, 0.4);
    }
  }

  clear(): void {
    for (const p of this.bits) p.live = false;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
    this.smokeAcc = this.sparkAcc = 0;
  }

  /** wx、wz：风（m/s）。ground：地面高度（碎片落地就停） */
  update(dt: number, cam: THREE.Camera, wx: number, wz: number, ground: (x: number, z: number) => number): void {
    const list = this.order;
    list.length = 0;
    for (const p of this.bits) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.live = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d - 9.81 * p.fall * dt;
      p.vz *= d;
      p.x += (p.vx + (p.kind === SOFT ? wx * 0.7 : 0)) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + (p.kind === SOFT ? wz * 0.7 : 0)) * dt;
      if (p.kind !== SOFT) {
        const g = ground(p.x, p.z) + 0.05;
        if (p.y < g) {
          p.y = g;
          p.vx *= 0.3;
          p.vz *= 0.3;
          p.vy = Math.abs(p.vy) * 0.2;
        }
      }
      p.dist = Math.hypot(p.x - cam.position.x, p.y - cam.position.y, p.z - cam.position.z);
      list.push(p);
    }
    this.mesh.visible = list.length > 0;
    if (!list.length) {
      this.geo.instanceCount = 0;
      return;
    }
    // 半透明的东西要从远往近画
    list.sort((a, b) => b.dist - a.dist);
    cam.matrixWorld.extractBasis(_right, _up, _back);
    (this.uRight.value as THREE.Vector3).copy(_right);
    (this.uUp.value as THREE.Vector3).copy(_up);
    (this.uBack.value as THREE.Vector3).copy(_back);
    const A = this.aBit.array as Float32Array;
    const I = this.aInfo.array as Float32Array;
    const T = this.aTint.array as Float32Array;
    list.forEach((p, i) => {
      const k = p.age / p.life;
      const o = i * 4;
      A[o] = p.x;
      A[o + 1] = p.y;
      A[o + 2] = p.z;
      A[o + 3] = p.r0 + (p.r1 - p.r0) * Math.sqrt(k);
      I[o] = k;
      // 烟团淡入再慢慢散掉；碎片、火星到最后才淡
      I[o + 1] = p.alpha * (p.kind === SOFT ? Math.min(1, k * 10) * (1 - k) ** 1.2 : Math.min(1, (1 - k) * 4));
      I[o + 2] = p.rot + k * 0.8;
      I[o + 3] = p.seed;
      T[o] = p.r;
      T[o + 1] = p.g;
      T[o + 2] = p.b;
      T[o + 3] = p.kind;
    });
    const n = list.length;
    for (const a of [this.aBit, this.aInfo, this.aTint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = n;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
