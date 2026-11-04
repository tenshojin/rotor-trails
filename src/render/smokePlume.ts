// 任务目标的烟幕：一串面向镜头的烟团，一次实例绘制。
//   · 同一时刻放出的烟团摆动同相，连起来是一条弯弯曲曲、往下风方向散开的烟柱；
//   · 每团按半球法线受光：朝太阳的一面亮、背面暗，逆光时薄的地方透亮，和场景同一个太阳和天光；
//   · 用场景深度做软边：烟穿过树冠、贴着地面时不会切出一条硬边；
//   · 镜头靠近或者钻进烟里时淡出（否则一大片烟糊在座舱上）。

import * as THREE from 'three/webgpu';
import { attribute, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, float, length, max, mix, normalize, perspectiveDepthToViewZ, positionGeometry, positionView, positionWorld, pow, sin, smoothstep, sqrt, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { FOG } from './atmosphere';
import { sceneDepthNode } from './mirror';
import { terrainSun } from './sunMap';
import { getNoiseTexture } from './textures';
import { VFOG } from './volumetricFog';

/** 一团烟能活多久（秒）、每秒放几团 */
const LIFE = 26;
const RATE = 5;
const STEADY = LIFE * RATE;
/** 换目标时旧的烟柱还要飘一会儿散掉：同时最多两条 */
const CAP = STEADY * 2;

interface Puff {
  live: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  /** 放出来的时刻（决定摆动的相位）和随机数 */
  t0: number;
  seed: number;
  /** 这一帧的位置和离镜头的距离 */
  px: number;
  py: number;
  pz: number;
  dist: number;
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();

export class SmokePlume {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly puffs: Puff[] = [];
  private readonly order: Puff[] = [];
  private readonly aPuff = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  private readonly aInfo = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  private readonly uRight = uniform(new THREE.Vector3(1, 0, 0));
  private readonly uUp = uniform(new THREE.Vector3(0, 1, 0));
  private readonly uBack = uniform(new THREE.Vector3(0, 0, 1));
  /** 烟罐口的火光（天黑时看得见） */
  private readonly uFlare = uniform(0);
  private acc = 0;
  private time = 0;
  private srcX = 1e9;
  private srcY = 0;
  private srcZ = 0;
  private seed = 1;

  constructor(reversedDepth: boolean) {
    for (let i = 0; i < CAP; i++) this.puffs.push({ live: false, age: 0, x: 0, y: 0, z: 0, t0: 0, seed: 0, px: 0, py: 0, pz: 0, dist: 0 });
    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    g.setIndex(plane.getIndex());
    g.setAttribute('aPuff', this.aPuff);
    g.setAttribute('aInfo', this.aInfo);
    g.instanceCount = 0;
    this.geo = g;

    const P = attribute('aPuff', 'vec4');
    const I = attribute('aInfo', 'vec4');
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.positionNode = P.xyz.add(this.uRight.mul(positionGeometry.x.mul(P.w.mul(2)))).add(this.uUp.mul(positionGeometry.y.mul(P.w.mul(2))));
    const q = uv().mul(2).sub(1).toVar();
    const rr = length(q);
    // 烟团的形状：圆形减去噪声，越老边缘被吃得越碎
    const cs = cos(I.z);
    const sn = sin(I.z);
    const rq = vec2(q.x.mul(cs).sub(q.y.mul(sn)), q.x.mul(sn).add(q.y.mul(cs)));
    const noise = getNoiseTexture();
    const n1 = texture(noise, rq.mul(0.13).add(vec2(I.w, I.w.mul(1.7)))).r;
    const n2 = texture(noise, rq.mul(0.42).add(vec2(I.w.mul(2.3), I.w.mul(0.9)))).r;
    const n = n1.mul(0.68).add(n2.mul(0.32)).toVar();
    const k = I.x;
    const shape = clamp(float(1).sub(rr).mul(1.8).add(n.sub(0.5).mul(mix(float(1.5), float(3.0), k))).sub(0.1), 0, 1);
    const body = smoothstep(0.0, 0.8, shape).toVar();
    // 受光：把方块当半球，法线再按噪声扰动一点，表面才有鼓包
    const nrm = normalize(this.uRight.mul(q.x.add(n1.sub(0.5).mul(1.2))).add(this.uUp.mul(q.y.add(n2.sub(0.5).mul(1.2)))).add(this.uBack.mul(sqrt(max(float(1).sub(rr.mul(rr)), 0.06)))));
    const ndl = dot(nrm, FOG.sunDir).mul(0.5).add(0.5);
    const sun = (VFOG.sun as unknown as THREE.Node<'vec3'>).mul(terrainSun(positionWorld)).mul(1 / Math.PI);
    const look = normalize(positionWorld.sub(cameraPosition));
    const through = pow(max(dot(look, FOG.sunDir), 0.0), 6.0).mul(float(1).sub(body).mul(0.8).add(0.2));
    const albedo = mix(vec3(0.82, 0.4, 0.17), vec3(0.8, 0.74, 0.68), smoothstep(0.02, 0.3, k));
    const sky = FOG.color.mul(nrm.y.mul(0.22).add(0.62));
    const lit = sky.add(sun.mul(ndl.mul(ndl).mul(1.15).add(through.mul(1.4))));
    const heat = float(1).sub(smoothstep(0.0, 0.05, k));
    m.colorNode = albedo.mul(lit).mul(n.mul(0.5).add(0.76)).add(vec3(1.0, 0.33, 0.07).mul(this.uFlare.mul(heat).mul(heat).mul(0.9)));
    // 软边与淡出
    const depth = sceneDepthNode(reversedDepth);
    const sceneZ = perspectiveDepthToViewZ(depth.r, cameraNear, cameraFar).negate();
    const soft = smoothstep(0.0, P.w.mul(0.55).add(0.6), sceneZ.sub(positionView.z.negate()));
    const near = smoothstep(P.w.mul(0.8).add(3.0), P.w.mul(2.0).add(12.0), length(P.xyz.sub(cameraPosition)));
    m.opacityNode = body.mul(I.y).mul(soft).mul(near);
    this.mat = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawn(x: number, y: number, z: number, age: number): Puff {
    let p = this.puffs.find((q) => !q.live);
    if (!p) {
      p = this.puffs[0];
      for (const q of this.puffs) if (q.age > p.age) p = q;
    }
    p.live = true;
    p.age = age;
    p.x = x;
    p.y = y;
    p.z = z;
    p.t0 = this.time - age;
    p.seed = this.rnd();
    return p;
  }

  /** 水平飘动的速度比例：贴地时风小，越高越顺风 */
  private static blow(a: number): number {
    return 0.22 + 0.62 * Math.min(1, a / 10);
  }

  /** src：烟罐的位置（null = 不再放烟，已有的烟继续飘散）；wx、wz：风（m/s）；flare：烟罐口的火光 0..1 */
  update(dt: number, src: THREE.Vector3 | null, wx: number, wz: number, cam: THREE.Camera, flare: number): void {
    this.time += dt;
    for (const p of this.puffs) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= LIFE) {
        p.live = false;
        continue;
      }
      const b = SmokePlume.blow(p.age);
      p.x += wx * b * dt;
      p.z += wz * b * dt;
    }
    if (src) {
      if (Math.hypot(src.x - this.srcX, src.y - this.srcY, src.z - this.srcZ) > 5) {
        // 新目标：烟柱已经升起来了，不是从地上慢慢长出来
        this.srcX = src.x;
        this.srcY = src.y;
        this.srcZ = src.z;
        for (let i = 0; i < STEADY; i++) {
          const a = (i + 0.5) / RATE;
          let drift = 0;
          for (let s = 0; s < a; s += 0.5) drift += SmokePlume.blow(s) * 0.5;
          this.spawn(src.x + wx * drift, src.y, src.z + wz * drift, a);
        }
      }
      this.acc += dt * RATE;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.spawn(src.x, src.y, src.z, this.acc / RATE);
      }
    }
    // 从远到近画
    const o = this.order;
    o.length = 0;
    const cp = cam.position;
    for (const p of this.puffs) {
      if (!p.live) continue;
      const a = p.age;
      const amp = 0.4 + a * 0.5;
      const ph = p.t0 * 0.85;
      p.px = p.x + amp * (Math.sin(ph + a * 0.21) + 0.5 * Math.sin(ph * 2.3 + a * 0.47 + 1.7));
      p.py = p.y + 3.2 * a + 26 * (1 - Math.exp(-a / 4.5));
      p.pz = p.z + amp * (Math.cos(ph * 0.8 + a * 0.19 + 2.1) + 0.5 * Math.sin(ph * 1.9 + a * 0.41));
      p.dist = (p.px - cp.x) ** 2 + (p.py - cp.y) ** 2 + (p.pz - cp.z) ** 2;
      o.push(p);
    }
    this.mesh.visible = o.length > 0;
    if (!o.length) return;
    o.sort((a, b) => b.dist - a.dist);
    const A = this.aPuff.array as Float32Array;
    const B = this.aInfo.array as Float32Array;
    o.forEach((p, i) => {
      const k = p.age / LIFE;
      A[i * 4] = p.px;
      A[i * 4 + 1] = p.py;
      A[i * 4 + 2] = p.pz;
      A[i * 4 + 3] = 1.3 + 0.95 * p.age ** 0.92 * (0.85 + 0.3 * p.seed);
      B[i * 4] = k;
      B[i * 4 + 1] = Math.min(1, p.age / 0.35) * (1 - k) ** 1.6 * 0.46;
      B[i * 4 + 2] = p.seed * 6.283 + p.age * (p.seed - 0.5) * 0.12;
      B[i * 4 + 3] = p.seed;
    });
    this.aPuff.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.geo.instanceCount = o.length;
    const e = cam.matrixWorld.elements;
    this.uRight.value.copy(_right.set(e[0], e[1], e[2]).normalize());
    this.uUp.value.copy(_up.set(e[4], e[5], e[6]).normalize());
    this.uBack.value.copy(_back.set(e[8], e[9], e[10]).normalize());
    this.uFlare.value = flare;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
