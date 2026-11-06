import { describe, expect, it } from 'vitest';
import { SIM_LESSONS } from '../src/game/simTutorial';
import { Tutorial, type TutorialCtx } from '../src/game/tutorial';
import { defaultSettings } from '../src/game/settings';
import { TRAINING } from '../src/maps/training';
import { CONTROLS } from '../src/sim/controls';
import type { GameSession } from '../src/sim/session';
import { sessionFor, setInput } from './helpers';

const diff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const key = (e: number, dead: number) => (e > dead ? 1 : e < -dead ? -1 : 0);

/** 键盘飞行员：和真人一样只能按键或不按（同 sim-flight.test.ts，这里一帧走一步） */
class Student {
  private lastP = 0;
  private lastR = 0;
  private lastH = 0;
  private lastNr = 1;
  /** 偏航角速度（弧度/秒，向右为正） */
  yawRate = 0;

  constructor(private readonly s: GameSession) {
    this.lastH = s.flight.telemetry.heading;
  }

  fly(want: { vs?: number; vF?: number; heading?: number; bank?: number; turn?: number; pitch?: number; vertical?: number }): void {
    const s = this.s;
    const t = s.flight.telemetry;
    const pRate = (t.pitch - this.lastP) * 60;
    const rRate = (t.roll - this.lastR) * 60;
    this.lastP = t.pitch;
    this.lastR = t.roll;
    this.yawRate += (diff(this.lastH, t.heading) * 60 - this.yawRate) * 0.1;
    this.lastH = t.heading;
    const vF = t.forwardAirspeed;
    const wantPitch = want.pitch ?? -Math.max(-0.2, Math.min(0.3, ((want.vF ?? 0) - vF) * 0.035)) - (want.vF ? 0.03 : 0);
    const pitchErr = t.pitch - wantPitch + pRate * 0.55;
    const vR = s.body.vel.x * Math.cos(t.heading) + s.body.vel.z * Math.sin(t.heading);
    const wantRoll = want.bank ?? Math.max(-0.2, Math.min(0.2, -vR * 0.05));
    const rollErr = wantRoll - t.roll - rRate * 0.55;
    const hdgErr = want.heading === undefined ? 0 : diff(t.heading, want.heading);
    setInput(s, {
      pitch: key(pitchErr, 0.012),
      lateral: key(rollErr, 0.012),
      turn: want.turn ?? key(hdgErr, 0.02),
      vertical: want.vertical ?? key((want.vs ?? 0) - s.body.vel.y, 0.25),
    });
  }

  /** 自转：放总距把转速守在绿区 */
  nrCollective(lo = 0.98, hi = 1.02): number {
    const nr = this.s.flight.nr;
    const lead = nr + (nr - this.lastNr) * 60 * 1.2;
    this.lastNr = nr;
    return lead < lo ? -1 : lead > hi ? 1 : 0;
  }
}

/** 一步一步照着教学做，每一帧都走真实的物理 */
function attend(s: GameSession, t: Tutorial, until: (id: string) => boolean = () => false): Record<string, number> {
  const c = s.sys!.c;
  const stu = new Student(s);
  const ctx: TutorialCtx = { yaw: 0, pitch: 0, held: () => false, dragLook: false, hover: null };
  const pad = () => s.pad('T-final')!.pos;
  const padGo = (): { d: number; heading: number } => {
    const dx = pad()[0] - s.body.pos.x;
    const dz = pad()[2] - s.body.pos.z;
    return { d: Math.hypot(dx, dz), heading: Math.atan2(dx, -dz) };
  };
  const spent: Record<string, number> = {};
  let last = '';
  let frames = 0;
  while (!t.done) {
    const step = t.step!;
    if (until(step.id)) break;
    if (step.id !== last) {
      if (last) spent[last] = frames / 60;
      last = step.id;
      frames = 0;
    }
    if (step.manual) {
      t.skip(s);
      continue;
    }
    if (++frames > 60 * 240) throw new Error(`卡在这一步：${step.id}（进度 ${t.progress.toFixed(2)}，离地 ${s.agl.toFixed(1)}，速度 ${s.groundSpeed.toFixed(1)}）`);
    setInput(s, {});
    switch (step.id) {
      case 'simLook':
        ctx.yaw = frames < 30 ? 0.6 : -0.6;
        break;
      case 'simCenter':
        ctx.yaw = 0;
        break;
      case 'simPoint':
        ctx.hover = 'rk_batt';
        break;
      case 'simBatt':
        c.batt = 1;
        break;
      case 'simAcol':
        c.acol = 1;
        break;
      case 'simFuelP':
        c.fuelP = 1;
        break;
      case 'simIdle':
        c.engMain = 1;
        break;
      case 'simGen':
        c.gen = 1;
        break;
      case 'simPitot':
        c.pitot = 1;
        break;
      case 'simSasOn0':
      case 'simSasBack':
        c.sas = 1;
        break;
      case 'simFlightPos':
        c.engMain = 2;
        break;
      case 'simLight':
      case 'simOffGround':
        stu.fly({ vertical: s.agl < 2.4 ? 1 : 0 });
        break;
      case 'simHold':
      case 'simHoverAgain':
        stu.fly({ vs: 0, vF: 0 });
        break;
      case 'simSasOff':
        c.sas = 0;
        break;
      case 'simFeel':
        stu.fly({ vs: 0, vF: 0 });
        break;
      case 'simStopYaw':
        // 和真人一样点按：点一下，等一等看反应
        stu.fly({ vs: 0, vF: 0, turn: frames % 45 < 6 ? key(-stu.yawRate, 0.05) : 0 });
        break;
      case 'simMoreTorque':
        stu.fly({ vF: 0, vertical: 1 });
        break;
      case 'simPush':
      case 'simEtl':
      case 'simLevel':
        stu.fly({ vs: 0, vF: 32 });
        break;
      case 'simBank':
        stu.fly({ vs: 0, vF: 30, bank: 0.35 });
        break;
      case 'simFlare':
        stu.fly({ vs: 0, vF: 0 });
        break;
      case 'simApproach': {
        const g = padGo();
        stu.fly({ vs: Math.max(-2, Math.min(2, (20 - s.agl) * 0.3)), vF: Math.max(4, Math.min(14, g.d * 0.08)), heading: g.heading });
        break;
      }
      case 'simOverPad': {
        const g = padGo();
        stu.fly({ vs: Math.max(-1.5, Math.min(1.5, (12 - s.agl) * 0.3)), vF: Math.min(5, g.d * 0.22), heading: g.d > 4 ? g.heading : undefined });
        break;
      }
      case 'simTouch': {
        const g = padGo();
        if (s.gear.contactCount > 0) stu.fly({ vertical: -1 });
        else stu.fly({ vs: g.d > 7 ? 0 : s.agl > 4 ? -1.4 : -0.7, vF: Math.min(4, g.d * 0.22), heading: g.d > 4 ? g.heading : undefined });
        break;
      }
      case 'simColDown':
        setInput(s, { vertical: -1 });
        break;
      case 'simBackIdle':
        c.engMain = 1;
        break;
      case 'simEngOff':
        c.engMain = 0;
        break;
      case 'simBrake':
        if (s.flight.nr < 0.4) c.rotorBrake = 0;
        break;
      case 'simPowerOff':
        c.gen = c.fuelP = c.acol = c.batt = 0;
        break;
      case 'simCut':
        c.engMain = 0;
        stu.fly({ vs: 0, vF: 34 });
        break;
      case 'simDump':
        stu.fly({ vF: 32, vertical: -1 });
        break;
      case 'simGlide':
        stu.fly({ vF: 32, vertical: stu.nrCollective() });
        break;
      case 'simFlareAuto':
        stu.fly({ pitch: 0.3, vertical: stu.nrCollective(1.0, 1.08) });
        break;
      case 'simCushion':
        stu.fly({ pitch: s.agl > 1.6 ? 0.12 : 0.03, vertical: s.gear.contactCount ? 0 : s.flight.collective < 0.8 ? 1 : 0 });
        break;
    }
    s.step();
    if (s.state !== 'running') throw new Error(`第 ${t.lesson + 1} 课 ${step.id} 坠毁：${s.crashCause}（离地 ${s.agl.toFixed(1)}，耐久 ${s.damage.durability}，接地 ${JSON.stringify(s.lastTouchdown?.metrics)}）`);
    t.update(s, 1 / 60, ctx);
  }
  return spent;
}

describe('超仿真教学：课程内容', () => {
  it('八课按顺序：鼠标、启动、悬停、反扭矩、前飞、降落、关车、空中停车', () => {
    expect(SIM_LESSONS.map((l) => l.title)).toEqual(['鼠标和座舱', '冷舱启动', '离地和悬停', '反扭矩', '前飞和转弯', '进近和降落', '关车', '空中停车']);
  });

  it('每一步都有动作：要么看完继续，要么有完成条件；点的控件真实存在', () => {
    const fake = { sys: { c: {} }, flight: {} } as unknown as GameSession;
    for (const l of SIM_LESSONS) {
      for (const step of l.steps) {
        expect(!!step.manual !== !!step.check, step.id).toBe(true);
        expect(step.text(() => 'X', { yaw: 0, pitch: 0, held: () => false, dragLook: false }).length, step.id).toBeGreaterThan(4);
        const id = typeof step.control === 'function' ? step.control(fake) : step.control;
        if (id) expect(CONTROLS.get(id), step.id).toBeTruthy();
      }
    }
  });

  it('飞起来以后的每一课都有撞了能回去的安全点', () => {
    for (const l of SIM_LESSONS.slice(2)) expect(l.steps.some((s) => s.anchor), l.title).toBe(true);
  });
});

describe('超仿真教学：一个只会按键的学生从头学到尾', () => {
  it('从冷舱学到安全关车，每一步都走得通', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const t = new Tutorial(defaultSettings(), SIM_LESSONS);
    t.start(s);
    s.mission.locked = true;
    attend(s, t, (id) => id === 'simAutoWhy');
    expect(t.step?.id).toBe('simAutoWhy');
    expect(s.damage.durability).toBeGreaterThan(80);
    s.dispose();
  }, 120000);

  it('反扭矩这一课：关掉增稳后机头真的右转，配平之后真的稳住', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const t = new Tutorial(defaultSettings(), SIM_LESSONS);
    t.start(s, 3);
    attend(s, t, (id) => id === 'simMoreTorque');
    expect(s.sys!.sasActive).toBe(false);
    // 松开按键以后脚蹬还留在左边
    expect(s.flight.trimPedal).toBeLessThan(-0.02);
    s.dispose();
  }, 60000);

  it('从中间某一课直接开始：飞机在这一课该在的地方，发动机已经在转', async () => {
    for (const [lesson, agl] of [[2, 0], [3, 45], [4, 130], [5, 55], [6, 0], [7, 320]] as const) {
      const s = await sessionFor(TRAINING, 'sim');
      const t = new Tutorial(defaultSettings(), SIM_LESSONS);
      t.start(s, lesson);
      s.step();
      expect(s.sys!.lit, String(lesson)).toBe(true);
      expect(s.flight.nr, String(lesson)).toBeGreaterThan(0.95);
      expect(Math.abs(s.agl - agl), String(lesson)).toBeLessThan(6);
      s.dispose();
    }
  }, 60000);

  it('空中停车：放总距自转、守住转速、拉平，到离地 5 米时还有转速和速度可以用', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const t = new Tutorial(defaultSettings(), SIM_LESSONS);
    t.start(s, 7);
    attend(s, t, (id) => id === 'simCushion');
    expect(t.step?.id).toBe('simCushion');
    expect(s.sys!.lit).toBe(false);
    expect(s.flight.nr).toBeGreaterThan(0.95);
    expect(s.agl).toBeLessThan(6);
    expect(-s.body.vel.y).toBeLessThan(12);
    s.dispose();
  }, 60000);

  it('教学里写的那组数字真的落得下来：35 米抬头 18°，5 米提总距', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    s.teleport(-72, s.world.ctx.ground(-72, 900) + 320, 900, 0, 34);
    s.sys!.c.engMain = 0;
    for (let i = 0; i < 60; i++) s.step();
    let lastP = s.flight.telemetry.pitch;
    let lastNr = s.flight.nr;
    let phase = 'glide';
    for (let i = 0; i < 60 * 120 && s.state === 'running'; i++) {
      const t = s.flight.telemetry;
      const pRate = (t.pitch - lastP) * 60;
      lastP = t.pitch;
      const nr = s.flight.nr;
      const lead = nr + (nr - lastNr) * 72;
      lastNr = nr;
      let want = Math.max(-0.2, Math.min(0.12, (t.forwardAirspeed - 32) * 0.02)) - 0.06;
      let v = lead < 0.98 ? -1 : lead > 1.02 ? 1 : 0;
      if (phase === 'glide' && s.agl < 34) phase = 'flare';
      if (phase === 'flare') {
        want = 0.32;
        v = lead < 1 ? -1 : lead > 1.08 ? 1 : 0;
        if (s.agl < 4.5) phase = 'cushion';
      }
      if (phase === 'cushion') {
        want = s.agl > 1.6 ? 0.12 : 0.03;
        v = t.collective < 0.8 ? 1 : 0;
      }
      setInput(s, { vertical: v, pitch: key(t.pitch - want + pRate * 0.55, 0.012) });
      s.step();
      if (s.gear.contactCount >= 2 && s.groundSpeed < 3) break;
    }
    expect(s.state).toBe('running');
    expect(s.lastTouchdown!.metrics.descent).toBeLessThan(3);
    s.dispose();
  }, 60000);
});
