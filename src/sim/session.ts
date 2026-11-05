// 一次关卡运行的完整仿真状态：固定步长推进物理、飞行、起落架、损伤、Buff、任务、导航、天气、检查点。
// 渲染层只读取这里的状态（并在两步之间插值），不会修改飞机的运动状态。

import { Quaternion, Vector3 } from 'three';
import { HELI, type AssistId } from '../config/flight';
import { DEG, G, clamp } from '../core/math';
import type { PadDef, V3 } from '../maps/types';
import type { WorldData } from '../world/worldgen';
import { TREE_SPECS, TREE_TYPES, forTreesNear } from '../world/vegetation';
import { BuffSystem, BUFFS, type BuffKind, type BuffSnapshot, type PickupResult } from './buffs';
import { CAUSE_LABEL, DamageModel, statusOf, type DamageCause, type DamageEvent, type DamageSnapshot, type DamageStatus } from './damage';
import { FlightModel, type BodyState, type PilotInput } from './flight';
import { Gear } from './gear';
import { MissionRuntime, gradeLanding, type LandingMetrics, type MissionEvent, type MissionSnapshot } from './mission';
import { Navigator, type NavSnapshot } from './nav';
import { PhysicsWorld, initPhysics, type ContactReport } from './physics';
import { WeatherState, type WeatherSnapshot } from './weather';
import { WindField, type WindInfo } from './wind';
import { obstacleTop } from './routeCheck';
import type RAPIER from '@dimforge/rapier3d-compat';

export const STEP = 1 / 60;

export type GameEvent =
  | { type: 'damage'; ev: DamageEvent }
  | { type: 'pickup'; kind: BuffKind; result: PickupResult; id: string }
  | { type: 'boost' }
  | { type: 'checkpoint'; label: string }
  | { type: 'mission'; ev: MissionEvent }
  | { type: 'touchdown'; metrics: LandingMetrics; padId: string | null; surface: string }
  | { type: 'crash'; cause: DamageCause; label: string }
  | { type: 'status'; status: DamageStatus; prev: DamageStatus }
  | { type: 'weather'; label: string }
  | { type: 'message'; text: string; level: 'info' | 'warn' | 'good' }
  | { type: 'repair'; amount: number; station: boolean }
  | { type: 'hover'; on: boolean; auto?: boolean }
  | { type: 'complete' };

export interface SessionSnapshot {
  t: number;
  body: { pos: V3; quat: [number, number, number, number]; vel: V3; angVel: V3 };
  collective: number;
  enginePower: number;
  hoverOn: boolean;
  damage: DamageSnapshot;
  buffs: BuffSnapshot;
  mission: MissionSnapshot;
  nav: NavSnapshot;
  weather: WeatherSnapshot;
  pickupsTaken: string[];
  repairUses: Record<string, number>;
  grounded: boolean;
}

export interface Checkpoint {
  id: number;
  label: string;
  t: number;
  durability: number;
  snap: SessionSnapshot;
}

export interface SessionStats {
  distance: number;
  maxSpeed: number;
  restores: number;
  safeRecoveries: number;
  flightTime: number;
}

function newBody(): BodyState {
  return { pos: new Vector3(), quat: new Quaternion(), vel: new Vector3(), angVel: new Vector3() };
}

function copyBody(dst: BodyState, src: BodyState): void {
  dst.pos.copy(src.pos);
  dst.quat.copy(src.quat);
  dst.vel.copy(src.vel);
  dst.angVel.copy(src.angVel);
}

const _f = new Vector3();
const _tq = new Vector3();
const _up = new Vector3();
const _hub = new Vector3();
const _tmp = new Vector3();

export class GameSession {
  readonly world: WorldData;
  readonly phys: PhysicsWorld;
  readonly flight = new FlightModel();
  readonly gear = new Gear();
  readonly damage = new DamageModel();
  readonly buffs = new BuffSystem();
  readonly mission: MissionRuntime;
  readonly nav: Navigator;
  readonly weather: WeatherState;
  readonly wind: WindField;
  readonly body = newBody();
  readonly prev = newBody();
  readonly input: PilotInput = { pitch: 0, turn: 0, lateral: 0, vertical: 0 };
  t = 0;
  steps = 0;
  state: 'running' | 'crashed' | 'complete' = 'running';
  crashCause: DamageCause | null = null;
  events: GameEvent[] = [];
  readonly windNow = new Vector3();
  windInfo: WindInfo;
  agl = 0;
  /** 离树冠/地面（含树木）高度 */
  aglCanopy = 0;
  surfaceBelow = 'terrain';
  skidY = 0;
  settledTime = 0;
  settledPad: string | null = null;
  repairProgress = 0;
  pickupsTaken = new Set<string>();
  repairUses: Record<string, number> = {};
  checkpoints: Checkpoint[] = [];
  stats: SessionStats = { distance: 0, maxSpeed: 0, restores: 0, safeRecoveries: 0, flightTime: 0 };
  /** 地形逼近警告（秒，null = 无） */
  terrainWarning: number | null = null;
  readonly contacts: ContactReport[] = [];
  lastTouchdown: { metrics: LandingMetrics; t: number; padId: string | null } | null = null;
  assistId: AssistId;
  private cpId = 0;
  private ditchT = 0;
  private invertT = 0;
  private bodyContactT = -10;
  private treeProxies = new Map<number, RAPIER.Collider[]>();
  private massApplied = 0;
  private lastStatus: DamageStatus = 'normal';
  private msgT: Record<string, number> = {};
  private boostEdge = false;
  private hoverEdge = false;
  private disposed = false;

  static async create(world: WorldData, weatherId: string, assist: AssistId): Promise<GameSession> {
    await initPhysics();
    return new GameSession(world, weatherId, assist);
  }

  private constructor(world: WorldData, weatherId: string, assist: AssistId) {
    this.world = world;
    const map = world.map;
    this.assistId = assist;
    this.flight.setAssist(assist);
    this.phys = new PhysicsWorld(STEP);
    const P = this.phys;
    try {
      P.addTerrain(world.terrain);
      if (map.waterLevel !== null) P.addWater(map.waterLevel, map.size);
      P.addBoundary(map.size / 2, world.terrain.maxH + 1500);
      for (const c of world.colliders) {
        if (c.kind === 'box') P.addBox(c.c[0], c.c[1], c.c[2], c.h[0], c.h[1], c.h[2], c.rotY, c.tag);
        else if (c.kind === 'boxq') P.addBoxQ(c.c[0], c.c[1], c.c[2], c.h[0], c.h[1], c.h[2], { x: c.q[0], y: c.q[1], z: c.q[2], w: c.q[3] }, c.tag);
        else if (c.kind === 'cyl') P.addCylinder(c.c[0], c.c[1], c.c[2], c.hh, c.r, c.tag);
        else if (c.kind === 'ball') P.addBall(c.c[0], c.c[1], c.c[2], c.r, c.tag);
        else P.addCapsule(c.c[0], c.c[1], c.c[2], c.hh, c.r, c.tag);
      }
      // 推进一步让静态碰撞体进入宽相位结构，保证第一帧的射线查询（离地高度、起落架）有效
      P.world.step();
      for (const p of map.pads) if (p.repair) this.repairUses[p.id] = p.repair.uses;
      this.mission = new MissionRuntime(map.mission);
      this.nav = new Navigator(map, world.terrain);
      this.weather = new WeatherState(map.weathers, weatherId);
      this.wind = new WindField(this.weather.windProfile(), map.windZones, world.ctx.ground, map.seed);
      const spawnPad = world.pads.get(map.spawn.padId);
      if (!spawnPad) throw new Error('出生停机坪不存在');
      const pos = new Vector3(spawnPad.pos[0], spawnPad.pos[1] + 1.32, spawnPad.pos[2]);
      const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -map.spawn.heading * DEG);
      this.massApplied = this.totalMass();
      P.createHeli(pos, quat, this.massApplied);
      P.readBody(this.body);
      copyBody(this.prev, this.body);
      this.flight.resetTo(this.body, this.massApplied, this.altitudeMSL(), true);
      this.gear.reset(true);
      this.nav.setLeg(0, [pos.x, pos.y, pos.z]);
      this.windInfo = this.wind.info(pos.x, pos.y, pos.z, 0);
      this.saveCheckpoint('起点');
    } catch (error) {
      P.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.phys.dispose();
    } finally {
      this.treeProxies.clear();
      this.contacts.length = 0;
      this.events.length = 0;
    }
  }

  totalMass(): number {
    return HELI.massBase + this.mission.cargo * HELI.crateMass;
  }

  altitudeMSL(): number {
    return this.body.pos.y + this.world.map.altitudeOffset;
  }

  pad(id: string): PadDef | undefined {
    return this.world.pads.get(id);
  }

  setAssist(id: AssistId): void {
    this.assistId = id;
    this.flight.setAssist(id);
  }

  toggleHover(): void {
    this.hoverEdge = true;
  }

  useBoost(): void {
    this.boostEdge = true;
  }

  cycleNav(): void {
    const msg = this.nav.cycle(this.mission.optional.filter((o) => o.status !== 'done').length);
    this.msg(msg, 'info', 'nav', 0);
  }

  private msg(text: string, level: 'info' | 'warn' | 'good', key: string, cooldown = 4): void {
    const last = this.msgT[key] ?? -100;
    if (this.t - last < cooldown) return;
    this.msgT[key] = this.t;
    this.events.push({ type: 'message', text, level });
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 推进一个固定步长。 */
  step(): void {
    if (this.disposed || this.state !== 'running') return;
    const dt = STEP;
    const b = this.body;
    copyBody(this.prev, b);
    const map = this.world.map;

    // ---------- 一次性操作 ----------
    if (this.hoverEdge) {
      this.hoverEdge = false;
      this.flight.setHover(!this.flight.hoverOn);
      this.events.push({ type: 'hover', on: this.flight.hoverOn });
    }
    if (this.boostEdge) {
      this.boostEdge = false;
      if (this.buffs.activateBoost()) this.events.push({ type: 'boost' });
      else if (this.buffs.boostActive) this.msg('动力增强正在生效', 'info', 'boost', 1);
      else this.msg('没有可用的动力增强（拾取黄色动力补给后可用）', 'warn', 'boost', 2);
    }

    // ---------- 天气与风 ----------
    this.weather.update(dt, this.mission.doneCount);
    if (this.weather.changed) {
      this.events.push({ type: 'weather', label: this.weather.changed });
      this.weather.changed = null;
    }
    this.wind.profile = this.weather.windProfile();
    this.wind.sample(b.pos.x, b.pos.y, b.pos.z, this.t, this.windNow);

    // ---------- 近地查询 ----------
    const skidOff = -(HELI.skid.attachY - HELI.skid.restLength);
    const down = this.phys.castDown(b.pos, 3000, false);
    this.agl = down ? Math.max(0, down.distance - skidOff) : 3000;
    this.surfaceBelow = down ? down.tag.kind : 'none';
    const downTree = this.phys.castDown(b.pos, 3000, true);
    this.aglCanopy = downTree ? Math.max(0, downTree.distance - skidOff) : this.agl;
    _up.set(0, 1, 0).applyQuaternion(b.quat);
    _hub.copy(b.pos).addScaledVector(_up, HELI.hubHeight);
    const hubHit = this.phys.castDown(_hub, 40, false);
    const rotorClearance = hubHit ? hubHit.distance : Infinity;
    this.skidY = b.pos.y - skidOff;

    // ---------- 起落架 ----------
    const tel = this.flight.telemetry;
    const mass = this.totalMass();
    const gearForces = this.gear.compute(this.phys, b, mass, dt, tel.pitch, tel.roll);

    // ---------- 飞行动力学 ----------
    this.buffs.update(dt);
    const env = {
      wind: this.windNow,
      altitudeMSL: this.altitudeMSL(),
      mass,
      perf: this.damage.perf,
      severity: this.damage.severity,
      boost: this.buffs.boostLevel,
      rotorClearance,
      agl: this.agl,
      weightOnSkids: this.gear.weightOnSkids,
      gearContacts: this.gear.contactCount,
      time: this.t,
    };
    this.flight.update(b, env, this.input, dt, _f, _tq);
    if (this.flight.hoverAutoOff) {
      this.flight.hoverAutoOff = false;
      this.events.push({ type: 'hover', on: false, auto: true });
    }

    // ---------- 物理推进（唯一的位置积分） ----------
    this.phys.step(_f, _tq, gearForces, this.contacts);
    this.phys.readBody(b);
    this.t += dt;
    this.steps++;
    const speed = b.vel.length();

    // ---------- 碰撞与损伤 ----------
    const dmg: DamageEvent[] = [];
    const shield = this.buffs.shieldActive;
    this.damage.processContacts(this.contacts, this.t, dt, speed, shield, dmg);
    for (const c of this.contacts) if (c.part !== 'skid' && c.tag.kind !== 'boundary') this.bodyContactT = this.t;
    if (this.contacts.some((c) => c.tag.kind === 'boundary')) this.msg('已到达任务区域边界，请返回', 'warn', 'boundary', 3);
    let touchdown: { padId: string | null; metrics: LandingMetrics } | null = null;
    const td = this.gear.touchdown;
    if (td) {
      const attDeg = Math.max(Math.abs(td.pitch), Math.abs(td.roll)) / DEG;
      const padId = td.tag.padId ?? null;
      const pad = padId ? this.pad(padId) : undefined;
      const offset = pad ? Math.hypot(b.pos.x - pad.pos[0], b.pos.z - pad.pos[2]) : 0;
      const metrics = gradeLanding(td.descent, td.horizontal, attDeg, offset, pad ? pad.size / 2 : 999);
      touchdown = { padId, metrics };
      this.lastTouchdown = { metrics, t: this.t, padId };
      this.damage.processTouchdown(td.descent, td.horizontal, attDeg, shield, dmg);
      this.events.push({ type: 'touchdown', metrics, padId, surface: td.tag.kind });
    }
    // 落水 / 侧翻：致命事件
    const onWater = (this.gear.surface?.kind === 'water' && this.gear.weightOnSkids > 0.25) || this.contacts.some((c) => c.tag.kind === 'water' && c.part !== 'rotor');
    if (onWater || (map.waterLevel !== null && b.pos.y < map.waterLevel + 0.3)) this.ditchT += dt;
    else this.ditchT = Math.max(0, this.ditchT - dt * 2);
    if (this.ditchT > 0.3 && this.ditchT < 0.32) this.msg('机体触水！立即拉升', 'warn', 'water', 2);
    if (this.ditchT > 1.6) this.damage.destroy('water', dmg);
    const touching = this.gear.contactCount > 0 || this.t - this.bodyContactT < 0.5;
    if (_up.set(0, 1, 0).applyQuaternion(b.quat).y < 0.4 && touching) this.invertT += dt;
    else this.invertT = 0;
    if (this.invertT > 1.0) this.damage.destroy('rollover', dmg);
    for (const e of dmg) this.events.push({ type: 'damage', ev: e });

    // ---------- 状态阈值 ----------
    const st = this.damage.status;
    if (st !== this.lastStatus) {
      this.events.push({ type: 'status', status: st, prev: this.lastStatus });
      this.lastStatus = st;
    }
    if (this.damage.durability <= 0) {
      const cause = this.damage.lastCause ?? 'impact';
      this.state = 'crashed';
      this.crashCause = cause;
      this.events.push({ type: 'crash', cause, label: CAUSE_LABEL[cause] });
      return;
    }

    // ---------- 停稳判定 ----------
    const settled = this.gear.contactCount >= 3 && this.gear.weightOnSkids > 0.72 && speed < 0.5 && b.angVel.length() < 0.15;
    this.settledTime = settled ? this.settledTime + dt : 0;
    this.settledPad = this.settledTime > 0.4 ? (this.gear.surface?.padId ?? null) : null;
    const airborne = this.gear.contactCount === 0 && this.agl > 0.8;

    // ---------- Buff 拾取 ----------
    for (const p of map.pickups) {
      if (this.pickupsTaken.has(p.id)) continue;
      const d = Math.hypot(b.pos.x - p.pos[0], b.pos.y - p.pos[1], b.pos.z - p.pos[2]);
      if (d > BUFFS.pickupRadius) continue;
      const res = this.buffs.pickup(p.kind, this.damage.durability);
      if (res === 'alreadyHolding') {
        this.msg('已持有一次动力增强，请先使用储备', 'info', 'hold', 3);
        continue;
      }
      if (res === 'full') {
        this.msg('耐久已满，维修补给保留在原处', 'info', 'full', 3);
        continue;
      }
      this.pickupsTaken.add(p.id);
      if (res === 'repaired') {
        const amt = this.damage.repair(BUFFS.repair.amount);
        this.events.push({ type: 'repair', amount: amt, station: false });
      }
      this.events.push({ type: 'pickup', kind: p.kind, result: res, id: p.id });
    }

    // ---------- 维修站 ----------
    const sp = this.settledPad ? this.pad(this.settledPad) : undefined;
    if (sp?.repair) {
      const uses = this.repairUses[sp.id] ?? 0;
      if (this.damage.durability >= 99.5) {
        this.repairProgress = 0;
      } else if (uses <= 0) {
        this.msg('该维修站的备件已用完', 'warn', 'repairEmpty', 6);
        this.repairProgress = 0;
      } else {
        this.repairProgress += dt / 4;
        if (this.repairProgress >= 1) {
          this.repairProgress = 0;
          this.repairUses[sp.id] = uses - 1;
          const amt = this.damage.repair(sp.repair.amount);
          this.events.push({ type: 'repair', amount: amt, station: true });
        }
      }
    } else this.repairProgress = 0;

    // ---------- 任务 ----------
    const mev: MissionEvent[] = [];
    const prevIndex = this.mission.index;
    this.mission.update(
      { t: this.t, dt, pos: b.pos, speed, skidY: this.skidY, settledPad: this.settledPad, touchdown, airborne },
      (id) => (this.pad(id)?.size ?? 20) / 2,
      (id) => this.pad(id)?.pos ?? [0, 0, 0],
      mev,
    );
    for (const e of mev) this.events.push({ type: 'mission', ev: e });
    if (this.mission.cargo * HELI.crateMass + HELI.massBase !== this.massApplied) {
      this.massApplied = this.totalMass();
      this.phys.setHeliMass(this.massApplied);
    }
    if (this.mission.index !== prevIndex) {
      const done = this.mission.main[prevIndex];
      this.nav.setLeg(this.mission.index, [b.pos.x, b.pos.y, b.pos.z]);
      if (this.mission.complete) {
        this.state = 'complete';
        this.events.push({ type: 'complete' });
        return;
      }
      this.saveCheckpoint(`完成：${done.def.title}`);
    }

    // ---------- 导航 ----------
    const cur = this.mission.current();
    const goal = cur ? this.mission.goalOf(cur, b.pos) : null;
    const opts = this.mission.optional.filter((o) => o.status !== 'done');
    const focusObj = this.nav.focus > 0 ? opts[this.nav.focus - 1] : undefined;
    if (this.nav.focus > opts.length) this.nav.focus = 0;
    this.nav.update(b.pos, speed, goal, cur?.def.title ?? '', focusObj ? { pos: this.mission.goalOf(focusObj, b.pos), label: focusObj.def.title } : null);
    if (this.nav.passedCheckpoint) this.saveCheckpoint(this.nav.passedCheckpoint.label ?? '检查点');

    // ---------- 地形逼近警告（按当前速度预测 6 秒） ----------
    this.terrainWarning = null;
    if (speed > 12 && this.agl > 6) {
      for (const tt of [2, 4, 6]) {
        _tmp.copy(b.pos).addScaledVector(b.vel, tt);
        const h = this.world.ctx.ground(_tmp.x, _tmp.z);
        if (_tmp.y < h + 8) {
          this.terrainWarning = tt;
          break;
        }
      }
    }

    // ---------- 其他 ----------
    if (this.steps % 8 === 0) this.updateTreeProxies();
    this.stats.distance += Math.hypot(b.vel.x, b.vel.z) * dt;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, speed);
    if (airborne) this.stats.flightTime += dt;
    if (this.steps % 6 === 0) this.windInfo = this.wind.info(b.pos.x, b.pos.y, b.pos.z, this.t);
  }

  /** 只为附近的树创建碰撞体（代理激活），保证大面积森林的物理开销可控。 */
  private updateTreeProxies(): void {
    const T = this.world.trees;
    if (T.count === 0) return;
    const p = this.body.pos;
    const want = new Set<number>();
    forTreesNear(T, p.x, p.z, 85, (i) => {
      const spec = TREE_SPECS[TREE_TYPES[T.type[i]]];
      if (!spec.collide) return;
      const top = T.y[i] + (spec.crownY + spec.crownRy) * T.s[i];
      if (p.y - top > 70) return;
      want.add(i);
    });
    for (const [i, cols] of this.treeProxies) {
      if (want.has(i)) continue;
      if (Math.hypot(T.x[i] - p.x, T.z[i] - p.z) < 110 && p.y - T.y[i] < 160) continue;
      for (const c of cols) this.phys.removeCollider(c);
      this.treeProxies.delete(i);
    }
    for (const i of want) {
      if (this.treeProxies.has(i)) continue;
      const spec = TREE_SPECS[TREE_TYPES[T.type[i]]];
      const s = T.s[i];
      const x = T.x[i];
      const y = T.y[i];
      const z = T.z[i];
      const tag = { kind: 'tree' as const };
      const cols: RAPIER.Collider[] = [];
      const cy = y + spec.crownY * s;
      const cr = spec.crownR * s * 0.85;
      const cry = spec.crownRy * s * 0.85;
      if (cr > cry * 1.3) cols.push(this.phys.addCylinder(x, cy, z, cry * 0.75, cr, tag));
      else if (cry > cr * 1.3) cols.push(this.phys.addCapsule(x, cy, z, Math.max(0.1, cry - cr * 0.8), cr * 0.85, tag));
      else cols.push(this.phys.addBall(x, cy, z, (cr + cry) / 2, tag));
      const trunkTop = cy - cry * 0.5;
      const th = Math.max(0.5, trunkTop - y);
      cols.push(this.phys.addCylinder(x, y + th / 2, z, th / 2, Math.max(0.15, spec.trunkR * s), tag));
      this.treeProxies.set(i, cols);
    }
  }

  get treeProxyCount(): number {
    return this.treeProxies.size;
  }

  /** 处于低云层中的程度 0..1（能见度骤降，需依靠仪表与导航）。 */
  get weatherInCloud(): number {
    const w = this.weather.current;
    if (w.lowCloud < 0.05) return 0;
    const y = this.body.pos.y;
    return clamp(Math.min(y - w.cloudBase + 30, w.cloudTop - y + 30) / 60, 0, 1) * w.lowCloud;
  }

  // ---------------- 检查点 ----------------

  snapshot(): SessionSnapshot {
    const b = this.body;
    return {
      t: this.t,
      body: { pos: [b.pos.x, b.pos.y, b.pos.z], quat: [b.quat.x, b.quat.y, b.quat.z, b.quat.w], vel: [b.vel.x, b.vel.y, b.vel.z], angVel: [b.angVel.x, b.angVel.y, b.angVel.z] },
      collective: this.flight.collective,
      enginePower: this.flight.enginePower,
      hoverOn: this.flight.hoverOn,
      damage: this.damage.snapshot(),
      buffs: this.buffs.snapshot(),
      mission: this.mission.snapshot(),
      nav: this.nav.snapshot(),
      weather: this.weather.snapshot(),
      pickupsTaken: [...this.pickupsTaken],
      repairUses: { ...this.repairUses },
      grounded: this.gear.weightOnSkids > 0.55,
    };
  }

  saveCheckpoint(label: string, quiet = false): void {
    const snap = this.snapshot();
    this.checkpoints.push({ id: ++this.cpId, label, t: this.t, durability: this.damage.durability, snap });
    if (this.checkpoints.length > 24) this.checkpoints.splice(1, 1);
    if (this.cpId > 1 && !quiet) this.events.push({ type: 'checkpoint', label });
  }

  /**
   * 恢复检查点。exact：完整恢复保存时的飞行状态；safe：在检查点位置以稳定悬停状态恢复，
   * 耐久至少 40（用于避免“最近检查点已严重受损”的死局，计入评分扣分）。
   */
  restoreCheckpoint(index: number, mode: 'exact' | 'safe'): void {
    if (this.disposed) return;
    const cp = this.checkpoints[index];
    if (!cp) return;
    const s = cp.snap;
    // 丢弃之后的检查点
    this.checkpoints = this.checkpoints.slice(0, index + 1);
    this.t = s.t;
    this.steps = Math.round(this.t / STEP);
    const b = this.body;
    b.pos.set(...s.body.pos);
    b.quat.set(...s.body.quat);
    b.vel.set(...s.body.vel);
    b.angVel.set(...s.body.angVel);
    this.damage.restore(s.damage);
    this.buffs.restore(s.buffs);
    this.mission.restore(s.mission);
    this.nav.restore(s.nav);
    this.weather.restore(s.weather);
    this.pickupsTaken = new Set(s.pickupsTaken);
    this.repairUses = { ...s.repairUses };
    const grounded = s.grounded;
    if (mode === 'safe') {
      const fwd = new Vector3(0, 0, -1).applyQuaternion(b.quat);
      const yaw = Math.atan2(fwd.x, -fwd.z);
      b.quat.setFromAxisAngle(new Vector3(0, 1, 0), -yaw);
      b.vel.set(0, 0, 0);
      b.angVel.set(0, 0, 0);
      if (!grounded) {
        // 只看地面会把拱下的合法检查点抬进上方结构，或抬到树冠内部。
        const gh = obstacleTop(this.world, b.pos.x, b.pos.z, HELI.rotorRadius);
        b.pos.y = Math.max(b.pos.y, gh + 25);
      }
      if (this.damage.durability < 40) this.damage.durability = 40;
      this.stats.safeRecoveries++;
    }
    this.stats.restores++;
    this.massApplied = this.totalMass();
    this.phys.setHeliMass(this.massApplied);
    this.phys.writeBody(b);
    copyBody(this.prev, b);
    // 检查点在地面上时两种恢复方式都放回地面：不产生一次虚假的“接地”
    this.gear.reset(grounded);
    this.flight.resetTo(b, this.massApplied, this.altitudeMSL(), grounded);
    if (mode === 'exact' && !grounded) {
      this.flight.collective = s.collective;
      this.flight.enginePower = s.enginePower;
    }
    this.flight.setHover(mode === 'safe' ? !grounded : s.hoverOn);
    this.state = 'running';
    this.crashCause = null;
    this.ditchT = 0;
    this.invertT = 0;
    this.bodyContactT = -10;
    this.msgT = {};
    this.hoverEdge = this.boostEdge = false;
    this.input.pitch = this.input.turn = this.input.lateral = this.input.vertical = 0;
    this.lastStatus = this.damage.status;
    this.settledTime = 0;
    this.settledPad = null;
    this.repairProgress = 0;
    this.lastTouchdown = null;
    this.terrainWarning = null;
    this.contacts.length = 0;
    this.events = [];
    this.wind.profile = this.weather.windProfile();
    this.wind.sample(b.pos.x, b.pos.y, b.pos.z, this.t, this.windNow);
    this.windInfo = this.wind.info(b.pos.x, b.pos.y, b.pos.z, this.t);
    for (const [, cols] of this.treeProxies) for (const c of cols) this.phys.removeCollider(c);
    this.treeProxies.clear();
    this.updateTreeProxies();
  }

  /** 调试/测试：把飞机放到指定位置，以给定航向（度）和前向速度飞行。 */
  teleport(x: number, y: number, z: number, headingDeg: number, speed = 0): void {
    if (this.disposed) return;
    const b = this.body;
    b.pos.set(x, y, z);
    b.quat.setFromAxisAngle(new Vector3(0, 1, 0), -headingDeg * DEG);
    const h = headingDeg * DEG;
    b.vel.set(Math.sin(h) * speed, 0, -Math.cos(h) * speed);
    b.angVel.set(0, 0, 0);
    this.phys.writeBody(b);
    copyBody(this.prev, b);
    this.gear.reset(false);
    this.flight.resetTo(b, this.totalMass(), this.altitudeMSL(), false);
    this.flight.altRef = y;
    this.state = 'running';
    for (const [, cols] of this.treeProxies) for (const c of cols) this.phys.removeCollider(c);
    this.treeProxies.clear();
    this.updateTreeProxies();
  }

  /** 当前关卡可用的“恢复选项”：最近检查点、较早的安全检查点（耐久 ≥ 30 且停在地面或低速）。 */
  restoreOptions(): Array<{ index: number; label: string; durability: number; safe: boolean; t: number }> {
    return this.checkpoints.map((c, i) => {
      const v = Math.hypot(...c.snap.body.vel);
      return { index: i, label: c.label, durability: c.durability, safe: c.durability >= 30 && (c.snap.grounded || v < 15), t: c.t };
    });
  }

  /** 着陆辅助所需的停机坪（当前任务或附近的停机坪）。 */
  landingTarget(): PadDef | null {
    const cur = this.mission.current();
    if (cur && cur.def.kind === 'land') {
      const p = this.pad(cur.def.padId);
      if (p && Math.hypot(this.body.pos.x - p.pos[0], this.body.pos.z - p.pos[2]) < 400) return p;
    }
    let best: PadDef | null = null;
    let bd = 160;
    for (const p of this.world.map.pads) {
      const d = Math.hypot(this.body.pos.x - p.pos[0], this.body.pos.z - p.pos[2]);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** 地速、空速、姿态等（供 HUD 使用的便捷量）。 */
  get groundSpeed(): number {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }

  get statusLabel(): DamageStatus {
    return statusOf(this.damage.durability);
  }

  get gravity(): number {
    return G;
  }

  clampAlt(v: number): number {
    return clamp(v, -1000, 20000);
  }
}
