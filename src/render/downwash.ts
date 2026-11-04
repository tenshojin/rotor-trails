// 旋翼下洗：贴近地面、水面时，桨盘吹下来的气流碰到地面后向四周散开，
// 把水雾、尘土或雪沫卷成一圈向外翻滚的云环。水面上的那圈向外跑的波纹与水花在 water.ts 里（setWash）。
//
// 只影响画面。气流强弱按桨盘离地高度算（约三个桨盘半径以内才看得见），扬起多少看地面：
// 水面和沙土最明显，水泥停机坪几乎不起尘。

import * as THREE from 'three/webgpu';
import { HELI } from '../config/flight';
import { smoothstep } from '../core/math';
import type { MapDef } from '../maps/types';
import type { GameSession } from '../sim/session';
import { FOG, WASH } from './atmosphere';
import { getSmokeTexture } from './navView';
import { VFOG } from './volumetricFog';

const N = 72;
/** 每秒喷出多少团（满强度时） */
const RATE = 40;
/** 桨毂离地多高以内开始起雾 / 完全起雾（米） */
const H_START = 26;
const H_FULL = 6;
/** 桨毂离地多高以内树梢开始被吹动 / 吹得最厉害（树有十几米高，比草更早起效） */
const H_TREE_START = 46;
const H_TREE_FULL = 16;

/** 各地图的地表有多容易被吹起来（裸露的沙土 1，草地、苔原小一些） */
const LOOSE: Record<string, number> = { japan: 0.42, fjord: 0.3, canyon: 1, himalaya: 0.75, amazon: 0.3 };

interface Puff {
  sp: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  grow: number;
  alpha: number;
  seed: number;
  vel: THREE.Vector3;
  base: THREE.Color;
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

export class DownwashView {
  readonly group = new THREE.Group();
  /** 给水面用：下洗的中心与强度 */
  readonly state: WashState = { water: 0, x: 0, z: 0 };
  private readonly puffs: Puff[] = [];
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
    for (let i = 0; i < N; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, rotation: i * 2.399 });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = 7;
      this.group.add(sp);
      this.puffs.push({ sp, mat, age: 1e9, life: 1, size: 1, grow: 1, alpha: 0, seed: 0, vel: new THREE.Vector3(), base: new THREE.Color() });
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

  update(dt: number, s: GameSession): void {
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
    WASH.value.set(_hub.x, _hub.z, onWater ? 0 : (1 - smoothstep(H_FULL + 3, H_START + 8, h)) * smoothstep(0.5, 0.9, rpm), onWater ? 0 : (1 - smoothstep(H_TREE_FULL, H_TREE_START, h)) * smoothstep(0.5, 0.9, rpm));

    // 地面种类：水面 → 水雾；积雪线以上 → 雪沫；停机坪上 → 几乎没有；其他 → 尘土
    let loose = onWater ? 1 : this.loose;
    let col = onWater ? this.spray : this.dust;
    if (!onWater) {
      if (gy > this.map.biome.snowLine) {
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
    for (const p of this.puffs) {
      if (p.age >= p.life) {
        if (p.sp.visible) p.sp.visible = false;
        continue;
      }
      p.age += dt;
      const u = p.age / p.life;
      p.vel.x = p.vel.x * damp + (_wind.x - p.vel.x * damp) * follow;
      p.vel.z = p.vel.z * damp + (_wind.z - p.vel.z * damp) * follow;
      p.vel.y *= damp;
      const pos = p.sp.position;
      pos.addScaledVector(p.vel, dt);
      // 贴着地面翻滚，不钻到地下
      const g = this.surface(s, pos.x, pos.z) + p.size * 0.22;
      if (pos.y < g) pos.y = g;
      const size = p.size + p.grow * (1 - Math.exp(-p.age * 1.5));
      p.sp.scale.setScalar(size);
      p.mat.color.copy(p.base).multiply(_light);
      p.mat.opacity = p.alpha * Math.min(1, p.age / 0.22) * (1 - u) ** 1.2;
    }
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
    p.sp.position.set(x, this.surface(s, x, z) + 0.5, z);
    p.sp.scale.setScalar(p.size);
    p.mat.opacity = 0;
    p.sp.visible = true;
    void surf;
  }

  dispose(): void {
    WASH.value.set(0, 0, 0, 0);
    for (const p of this.puffs) p.mat.dispose();
  }
}
