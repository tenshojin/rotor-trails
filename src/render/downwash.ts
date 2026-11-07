// 旋翼下洗：贴近地面、水面时，桨盘吹下来的气流碰到地面后向四周散开，
// 把水雾、尘土或雪沫卷成一圈向外翻滚的云环。水面上的那圈向外跑的波纹与水花在 water.ts 里（setWash）。
//
// 只影响画面。气流强弱按桨盘离地高度算（约三个桨盘半径以内才看得见），扬起多少看地面：
// 水面和沙土最明显，水泥停机坪几乎不起尘。

import * as THREE from 'three/webgpu';
import { attribute, cos, positionGeometry, sin, texture, uniform, uv, vec2 } from 'three/tsl';
import { COVER } from './wetness';
import { HELI } from '../config/flight';
import { smoothstep } from '../core/math';
import type { MapDef } from '../maps/types';
import type { GameSession } from '../sim/session';
import { FOG, WASH, WASH_Y } from './atmosphere';
import { getSmokeTexture } from './navView';
import { VFOG } from './volumetricFog';

const N = 72;
/** 每秒喷出多少团（满强度时） */
const RATE = 40;
/** 桨毂离地多高以内开始起雾 / 完全起雾（米） */
const H_START = 26;
const H_FULL = 6;
/** 桨毂离地多高以内气流贴着地面散开 / 散得最猛（气柱大约能冲下来五个旋翼直径） */
const H_SHEET_START = 56;
const H_SHEET_FULL = 14;

/** 各地图的地表有多容易被吹起来（裸露的沙土 1，草地、苔原小一些） */
const LOOSE: Record<string, number> = { japan: 0.42, fjord: 0.3, canyon: 1, grandcanyon: 1, himalaya: 0.75, amazon: 0.3 };

interface Puff {
  pos: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  alpha: number;
  seed: number;
  vel: THREE.Vector3;
  base: THREE.Color;
  rotation: number;
  dist: number;
}

const _hub = new THREE.Vector3();
const _wind = new THREE.Vector3();
const _light = new THREE.Color();
const _sun = new THREE.Color();
const _c = new THREE.Color();

export interface WashState {
  /** 水面上的强度 0..1（不在水面上时为 0） */
  water: number;
  x: number;
  z: number;
}

/** 把旋翼气流叠到这一点的风上（m/s）：风向袋和旗子也要被吹起来 */
export function addWashWind(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const w = WASH.value;
  const dx = p.x - w.x;
  const dz = p.z - w.y;
  const r = Math.hypot(dx, dz) || 1;
  const k = (1 - smoothstep(HELI.rotorRadius * 2, HELI.rotorRadius * 7.5, r)) * w.z * w.w;
  if (k > 0) {
    out.x += (dx / r) * 16 * k;
    out.z += (dz / r) * 16 * k;
  }
  return out;
}

export class DownwashView {
  readonly group = new THREE.Group();
  /** 给水面用：下洗的中心与强度 */
  readonly state: WashState = { water: 0, x: 0, z: 0 };
  private readonly puffs: Puff[] = [];
  private readonly order: Puff[] = [];
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.MeshBasicNodeMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly aPuff = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private readonly aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private readonly aAngle = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
  private readonly right = uniform(new THREE.Vector3(1, 0, 0));
  private readonly up = uniform(new THREE.Vector3(0, 1, 0));
  private next = 0;
  private acc = 0;
  private seed = 12345;
  private readonly dust = new THREE.Color();
  private readonly snow = new THREE.Color();
  private readonly spray = new THREE.Color(0.9, 0.93, 0.96);
  private readonly loose: number;
  private readonly map: MapDef;

  constructor(map: MapDef) {
    this.map = map;
    this.loose = LOOSE[map.id] ?? 0.5;
    this.dust.setHex(map.biome.dirt).lerp(_c.setHex(map.biome.sand), 0.55);
    this.snow.setHex(map.biome.snow);
    const tex = getSmokeTexture();
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('uv', plane.getAttribute('uv'));
    this.geo.setIndex(plane.getIndex());
    this.geo.setAttribute('washPuff', this.aPuff);
    this.geo.setAttribute('washColor', this.aColor);
    this.geo.setAttribute('washAngle', this.aAngle);
    // One transparent batch replaces up to 72 separate sprites/materials.
    // Keep one invisible instance for loading-screen shader prewarming.
    this.geo.instanceCount = 1;
    const P = attribute('washPuff', 'vec4');
    const C = attribute('washColor', 'vec4');
    const A = attribute('washAngle', 'float');
    this.mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    this.mat.positionNode = P.xyz.add(this.right.mul(positionGeometry.x.mul(P.w))).add(this.up.mul(positionGeometry.y.mul(P.w)));
    const q = uv().sub(0.5);
    const cs = cos(A), sn = sin(A);
    const sample = texture(tex, vec2(q.x.mul(cs).sub(q.y.mul(sn)), q.x.mul(sn).add(q.y.mul(cs))).add(0.5));
    this.mat.colorNode = C.rgb.mul(sample.rgb);
    this.mat.opacityNode = C.a.mul(sample.a);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    for (let i = 0; i < N; i++) {
      this.puffs.push({ pos: new THREE.Vector3(), age: 1e9, life: 1, size: 1, grow: 1, alpha: 0, seed: 0, vel: new THREE.Vector3(), base: new THREE.Color(), rotation: i * 2.399, dist: 0 });
    }
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private surface(s: GameSession, x: number, z: number): number {
    const gy = s.world.terrain.heightAt(x, z);
    return Math.max(gy, this.map.waterLevel ?? -1e9);
  }

  update(dt: number, s: GameSession, camera: THREE.Camera): void {
    dt = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const b = s.body;
    _hub.set(b.pos.x, b.pos.y + HELI.hubHeight, b.pos.z);
    const gy = s.world.terrain.heightAt(_hub.x, _hub.z);
    const wl = this.map.waterLevel ?? -1e9;
    const onWater = wl > gy;
    const surf = onWater ? wl : gy;
    const h = _hub.y - surf;
    const rpm = s.flight.telemetry.rotorRpm;
    const k = (1 - smoothstep(H_FULL, H_START, h)) * smoothstep(0.5, 0.9, rpm);
    this.state.water = onWater ? k : 0;
    this.state.x = _hub.x;
    this.state.z = _hub.z;
    // 气流的强度：转速够不够、桨盘在不在使劲。前飞时气流被甩在身后，飞得越快吹到下面的越少
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const power = (smoothstep(0.5, 0.9, rpm) * (0.6 + 0.4 * Math.min(1, s.flight.telemetry.torque || 0))) / Math.sqrt(1 + (speed / 22) ** 2);
    // 气柱冲到地面要一点时间，落点落在飞机后面
    const lag = Math.min(1.5, h / 16);
    WASH.value.set(_hub.x - b.vel.x * lag, _hub.z - b.vel.z * lag, onWater ? 0 : 1 - smoothstep(H_SHEET_FULL, H_SHEET_START, h), power);
    WASH_Y.value = _hub.y;

    // 地面种类：水面 → 水雾；积雪线以上 → 雪沫；停机坪上 → 几乎没有；其他 → 尘土
    let loose = onWater ? 1 : this.loose;
    let col = onWater ? this.spray : this.dust;
    if (!onWater) {
      if (gy > this.map.biome.snowLine || COVER.value > 0.4) {
        loose = 1;
        col = this.snow;
      }
      for (const p of this.map.pads) {
        const d = Math.hypot(p.pos[0] - _hub.x, p.pos[2] - _hub.z);
        if (d < p.size * 1.1 && Math.abs(p.pos[1] - surf) < 12) loose = Math.min(loose, 0.14);
      }
    }
    this.acc += k * loose * RATE * dt;
    s.wind.sample(_hub.x, surf + 4, _hub.z, s.t, _wind);
    while (this.acc >= 1) {
      this.acc -= 1;
      this.emit(s, surf, k, col, onWater);
    }
    if (this.acc > 4) this.acc = 0;

    // 打在云雾上的光：天光 + 一部分阳光
    _sun.copy(VFOG.sun.value as THREE.Color);
    _light.copy(FOG.color.value).multiplyScalar(0.72);
    _light.r += _sun.r * 0.1;
    _light.g += _sun.g * 0.1;
    _light.b += _sun.b * 0.1;
    const damp = Math.exp(-dt * 1.25);
    const follow = 1 - Math.exp(-dt * 0.7);
    this.order.length = 0;
    for (const p of this.puffs) {
      if (p.age >= p.life) continue;
      p.age += dt;
      // Expire before raising (1-age/life) to a fractional power: a late frame
      // used to upload NaN opacity for every particle crossing its lifetime.
      if (p.age >= p.life) continue;
      p.vel.x = p.vel.x * damp + (_wind.x - p.vel.x * damp) * follow;
      p.vel.z = p.vel.z * damp + (_wind.z - p.vel.z * damp) * follow;
      p.vel.y *= damp;
      const pos = p.pos;
      pos.addScaledVector(p.vel, dt);
      // 贴着地面翻滚，不钻到地下
      const g = this.surface(s, pos.x, pos.z) + p.size * 0.22;
      if (pos.y < g) pos.y = g;
      p.dist = pos.distanceToSquared(camera.position);
      this.order.push(p);
    }
    this.order.sort((a, b) => b.dist - a.dist);
    const positions = this.aPuff.array, colors = this.aColor.array, angles = this.aAngle.array;
    this.order.forEach((p, i) => {
      const j = i * 4;
      positions[j] = p.pos.x; positions[j + 1] = p.pos.y; positions[j + 2] = p.pos.z;
      positions[j + 3] = p.size + p.grow * (1 - Math.exp(-p.age * 1.5));
      colors[j] = p.base.r * _light.r; colors[j + 1] = p.base.g * _light.g; colors[j + 2] = p.base.b * _light.b;
      colors[j + 3] = p.alpha * Math.min(1, p.age / 0.22) * (1 - p.age / p.life) ** 1.2;
      angles[i] = p.rotation;
    });
    this.mesh.visible = this.order.length > 0;
    this.geo.instanceCount = Math.max(1, this.order.length);
    if (!this.order.length) { positions[3] = 0; colors[3] = 0; }
    this.aPuff.needsUpdate = this.aColor.needsUpdate = this.aAngle.needsUpdate = true;
    const e = camera.matrixWorld.elements;
    this.right.value.set(e[0], e[1], e[2]).normalize();
    this.up.value.set(e[4], e[5], e[6]).normalize();
  }

  private emit(s: GameSession, surf: number, k: number, col: THREE.Color, water: boolean): void {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % N;
    const R = HELI.rotorRadius;
    const a = this.rnd() * Math.PI * 2;
    const r = R * (0.72 + 0.34 * this.rnd());
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = _hub.x + ca * r;
    const z = _hub.z + sa * r;
    p.age = 0;
    p.life = (water ? 1.9 : 2.8) * (0.75 + 0.5 * this.rnd());
    p.size = 1.3 + 1.1 * this.rnd();
    p.grow = (water ? 4.5 : 6.5) * (0.7 + 0.6 * this.rnd());
    p.alpha = (water ? 0.5 : 0.62) * (0.5 + 0.5 * k);
    p.seed = this.rnd();
    const out = (8 + 7 * this.rnd()) * (0.6 + 0.4 * k);
    p.vel.set(ca * out, 1.2 + 2.6 * this.rnd(), sa * out);
    p.base.copy(col);
    p.pos.set(x, this.surface(s, x, z) + 0.5, z);
    void surf;
  }

  dispose(): void {
    WASH.value.set(0, 0, 0, 0);
    this.geo.dispose();
    this.mat.dispose();
  }
}
