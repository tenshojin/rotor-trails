// 天气特效：三维雨线（方向 = 雨滴相对飞机的速度，能直观看出风向与飞行速度）、低云层、闪电。

import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, cos, cross, distance, float, length, max, mix, mod, normalize, positionGeometry, positionWorld, sin, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { FOG } from './atmosphere';
import { getNoiseTexture } from './textures';

/** 一种下落的东西：雨线细长、飞快；雪片短、宽、慢，飞快的时候才拉成一道一道 */
export interface FallStyle {
  /** 下落速度（米 / 秒） */
  fall: number;
  /** 线的半宽（米） */
  width: number;
  /** 长度 = 相对速度 × lenK，夹在 lenMin 和 lenMax 之间 */
  lenK: number;
  lenMin: number;
  lenMax: number;
  /** 多远开始看得见、多远看不见 */
  near: [number, number];
  far: [number, number];
  color: [number, number, number];
  /** 最浓的时候的不透明度 */
  opacity: number;
  /** 左右飘的幅度（米） */
  sway: number;
  /** 镜头周围循环下落的盒子（米）：小一点就密一点，远处的本来也看不见 */
  box: [number, number, number];
  /** 雪片是圆的，雨线是一条 */
  round: boolean;
}

export const RAIN: FallStyle = { fall: 8.5, width: 0.018, lenK: 0.045, lenMin: 0.35, lenMax: 3.2, near: [2.6, 4.5], far: [18, 30], color: [0.72, 0.76, 0.8], opacity: 0.55, sway: 0, box: [60, 40, 60], round: false };
export const SNOW: FallStyle = { fall: 1.5, width: 0.055, lenK: 0.018, lenMin: 0.07, lenMax: 1.2, near: [1.0, 2.2], far: [13, 19], color: [0.97, 0.98, 1.0], opacity: 0.95, sway: 0.5, box: [38, 26, 38], round: true };

export class RainFx {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.MeshBasicNodeMaterial;
  private count: number;
  private disposed = false;
  private u = {
    cam: uniform(new THREE.Vector3()),
    vel: uniform(new THREE.Vector3(0, -9, 0)),
    rel: uniform(new THREE.Vector3(0, -9, 0)),
    time: uniform(0),
    box: uniform(new THREE.Vector3(60, 40, 60)),
    opacity: uniform(0),
  };

  constructor(maxCount: number, private readonly style: FallStyle = RAIN) {
    this.count = maxCount;
    // 普通几何体 + 逐实例属性（实例数由 InstancedMesh.count 控制；InstancedBufferGeometry 的实例数默认是无穷大）
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      off[i * 4] = Math.random() * 60;
      off[i * 4 + 1] = Math.random() * 40;
      off[i * 4 + 2] = Math.random() * 60;
      off[i * 4 + 3] = Math.random();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    const U = this.u;
    U.box.value.set(style.box[0], style.box[1], style.box[2]);
    // （面片是在顶点着色器里转向镜头的，绕向算下来是背面：只画正面就一条都看不见）
    this.mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    // 每条雨线：在相机周围的盒子里循环下落；朝向 = 雨滴相对飞机的速度，宽度随距离略增（远处不至于断线）
    const aOff = attribute('aOff', 'vec4');
    const P0 = aOff.xyz.add(U.vel.mul(U.time).mul(aOff.w.mul(0.3).add(0.85)));
    const P1 = mod(P0.sub(U.cam).add(U.box.mul(0.5)), U.box).sub(U.box.mul(0.5)).add(U.cam);
    const phase = aOff.w.mul(40.0);
    const P = style.sway ? P1.add(vec3(sin(U.time.mul(1.3).add(phase)), 0, cos(U.time.mul(1.1).add(phase))).mul(style.sway)) : P1;
    const d = distance(P, cameraPosition);
    const D = normalize(U.rel);
    const toCam = normalize(cameraPosition.sub(P));
    const S = normalize(cross(D, toCam).add(vec3(1e-4)));
    const len = clamp(length(U.rel).mul(style.lenK), style.lenMin, style.lenMax);
    this.mat.positionNode = P.sub(D.mul(positionGeometry.y).mul(len)).add(S.mul(positionGeometry.x).mul(d.mul(0.02).add(1.0).mul(style.width)));
    const dist = distance(positionWorld, cameraPosition);
    const vA = smoothstep(style.near[0], style.near[1], dist).mul(float(1).sub(smoothstep(style.far[0], style.far[1], dist)));
    // （这个材质不受光：亮度跟着天色走，不然夜里满天白线）
    this.mat.colorNode = vec3(style.color[0], style.color[1], style.color[2]).mul(max(FOG.color.mul(1.6), vec3(0.05)));
    const shape = style.round ? float(1).sub(smoothstep(0.5, 1.0, length(vec2(positionGeometry.x.mul(2.0), positionGeometry.y.mul(2.0).sub(1.0))))) : positionGeometry.y.mul(0.65).add(0.35);
    this.mat.opacityNode = U.opacity.mul(vA).mul(shape);
    this.mat.alphaTest = 0.003;
    this.mesh = new THREE.InstancedMesh(g, this.mat, maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.count = 0;
  }

  /** rain 0..1；wind：空气速度；camVel：相机（飞机）速度 */
  update(t: number, cam: THREE.Vector3, rain: number, wind: THREE.Vector3, camVel: THREE.Vector3, density: number): void {
    const u = this.u;
    u.cam.value.copy(cam);
    const fall = this.style.fall * (1 + rain * 0.23);
    u.vel.value.set(wind.x, -fall + wind.y, wind.z);
    u.rel.value.set(wind.x - camVel.x, -fall + wind.y - camVel.y, wind.z - camVel.z);
    u.time.value = t;
    u.opacity.value = Math.min(this.style.opacity, rain * this.style.opacity * 1.1);
    this.mesh.count = rain > 0.02 ? Math.floor(this.count * Math.min(1, rain * 1.2) * density) : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private mats: THREE.MeshBasicNodeMaterial[] = [];
  private layers: Array<{ off: ReturnType<typeof makeCloudU>['off']; density: ReturnType<typeof makeCloudU>['density']; dark: ReturnType<typeof makeCloudU>['dark'] }> = [];
  private geo: THREE.PlaneGeometry;
  private offset = new THREE.Vector2();

  constructor(size: number) {
    this.geo = new THREE.PlaneGeometry(size * 1.8, size * 1.8, 1, 1);
    this.geo.rotateX(-Math.PI / 2);
    const noise = getNoiseTexture();
    for (let i = 0; i < 7; i++) {
      const U = makeCloudU(i);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false });
      const W = positionWorld;
      const p = W.xz.mul(0.00045).add(U.off);
      const n = texture(noise, p).r.mul(0.6).add(texture(noise, p.mul(3.1).add(0.3)).g.mul(0.3)).add(texture(noise, p.mul(9.0)).a.mul(0.1));
      const layer = i / 6;
      const edge = 1 - Math.abs(layer - 0.5) * 2;
      const c = smoothstep(float(0.62 - edge * 0.12).sub(U.density.mul(0.35)), float(0.85).sub(U.density.mul(0.2)), n);
      const d = distance(W, cameraPosition);
      const a = c.mul(U.density).mul(0.35 + 0.25 * edge).mul(float(1).sub(smoothstep(1500.0, 3000.0, d)));
      m.colorNode = mix(U.dark, vec3(0.92, 0.93, 0.95), clamp(n.mul(0.5).add(layer * 0.8), 0.0, 1.0));
      m.opacityNode = a;
      m.alphaTest = 0.004;
      this.mats.push(m);
      this.layers.push(U);
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.renderOrder = 15;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  update(dt: number, base: number, top: number, density: number, windX: number, windZ: number, overcast: number, camPos: THREE.Vector3): void {
    this.group.visible = density > 0.02;
    if (!this.group.visible) return;
    this.offset.x += windX * dt * 0.00045;
    this.offset.y += windZ * dt * 0.00045;
    this.group.children.forEach((m, i) => {
      m.position.set(camPos.x, base + ((top - base) * i) / 6, camPos.z);
      const u = this.layers[i];
      u.off.value.set(i * 0.137 - this.offset.x, i * 0.071 - this.offset.y);
      u.density.value = density;
      u.dark.value.setRGB(0.6 - overcast * 0.2, 0.62 - overcast * 0.2, 0.66 - overcast * 0.2);
    });
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function makeCloudU(i: number) {
  return { off: uniform(new THREE.Vector2(i * 0.137, i * 0.071)), density: uniform(0), dark: uniform(new THREE.Color(0.55, 0.58, 0.62)) };
}

type P3 = [number, number, number];

/** 中点位移：把一段直线抖成闪电那样一折一折的 */
function jag(a: P3, b: P3, depth: number, amp: number, out: P3[]): void {
  if (depth === 0) {
    out.push(b);
    return;
  }
  const m: P3 = [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * amp, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * amp * 0.25, (a[2] + b[2]) / 2 + (Math.random() - 0.5) * amp];
  jag(a, m, depth - 1, amp * 0.55, out);
  jag(m, b, depth - 1, amp * 0.55, out);
}

const BOLT_QUADS = 192;

/** 闪电的形状：云底到地面一条折线，带几根分叉。每次打雷在 CPU 上生成一次，面片朝着镜头，亮到能带出泛光 */
export class LightningBolt {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly pos = new Float32Array(BOLT_QUADS * 12);
  private readonly glow = uniform(0);
  private quads = 0;
  private gain = 0;

  constructor() {
    const idx: number[] = [];
    for (let i = 0; i < BOLT_QUADS; i++) {
      const o = i * 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mat.colorNode = vec3(0.8, 0.86, 1.0).mul(this.glow);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
  }

  private ribbon(pts: P3[], width: number, cam: THREE.Vector3): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const side = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (let i = 0; i + 1 < pts.length && this.quads < BOLT_QUADS; i++) {
      a.fromArray(pts[i]);
      b.fromArray(pts[i + 1]);
      toCam.copy(cam).sub(a);
      side.copy(b).sub(a).cross(toCam).normalize();
      // 往下越来越细
      const w0 = (width / 2) * (1 - (0.6 * i) / pts.length);
      const w1 = (width / 2) * (1 - (0.6 * (i + 1)) / pts.length);
      const o = this.quads++ * 12;
      this.pos.set([a.x - side.x * w0, a.y - side.y * w0, a.z - side.z * w0, a.x + side.x * w0, a.y + side.y * w0, a.z + side.z * w0, b.x + side.x * w1, b.y + side.y * w1, b.z + side.z * w1, b.x - side.x * w1, b.y - side.y * w1, b.z - side.z * w1], o);
    }
  }

  /** 打一道。大多打在镜头前方，转头才看得见的闪电等于没打 */
  strike(cam: THREE.Vector3, forward: THREE.Vector3, distance: number, base: number, visibility: number, ground: (x: number, z: number) => number): void {
    const a = Math.atan2(forward.x, forward.z) + (Math.random() - 0.5) * 2.2;
    const x = cam.x + Math.sin(a) * distance;
    const z = cam.z + Math.cos(a) * distance;
    const y0 = ground(x, z);
    const top: P3 = [x, Math.max(base, y0 + 320), z];
    const trunk: P3[] = [top];
    const rnd = (k: number): number => (Math.random() - 0.5) * k;
    jag(top, [x + rnd(260), y0, z + rnd(260)], 6, 170, trunk);
    this.quads = 0;
    this.ribbon(trunk, 6, cam);
    for (let i = 0; i < 5; i++) {
      const p = trunk[4 + Math.floor(Math.random() * 30)];
      const len = 90 + Math.random() * 240;
      const branch: P3[] = [p];
      jag(p, [p[0] + rnd(len * 1.6), p[1] - len * (0.5 + Math.random() * 0.5), p[2] + rnd(len * 1.6)], 4, len * 0.4, branch);
      this.ribbon(branch, 2.4, cam);
    }
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.setDrawRange(0, this.quads * 6);
    this.gain = 14 * Math.exp(-distance / (Math.max(800, visibility) * 1.8));
  }

  /** flash：现在的闪光亮度 */
  update(flash: number): void {
    this.glow.value = this.gain * Math.min(1, flash * 1.8);
    this.mesh.visible = flash > 0.03 && this.quads > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 闪电：根据天气强度随机触发，返回当前闪光亮度；thunder 回调用于延迟雷声。 */
export class Lightning {
  private next = 6;
  private flash = 0;
  private flicker = 0;
  enabled = true;

  update(t: number, dt: number, intensity: number, onStrike: (distance: number) => void): number {
    if (!this.enabled || intensity <= 0.01) {
      this.flash = Math.max(0, this.flash - dt * 4);
      return this.flash;
    }
    if (t > this.next) {
      this.flash = 0.6 + Math.random() * 0.4;
      this.flicker = 0.35;
      this.next = t + (6 + Math.random() * 14) / Math.max(0.2, intensity);
      onStrike(800 + Math.random() * 3500);
    }
    if (this.flicker > 0) {
      this.flicker -= dt;
      if (Math.random() < 0.15) this.flash = Math.max(this.flash, 0.4 + Math.random() * 0.5);
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    return this.flash * 0.7;
  }
}
