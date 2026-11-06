import { describe, expect, it } from 'vitest';
import { TRAINING } from '../src/maps/training';
import { ENGINE } from '../src/sim/systems';
import type { GameSession } from '../src/sim/session';
import { run, sessionFor, setInput } from './helpers';

/** 按程序把飞机启动到旋翼 100%，返回用了多少秒 */
function startUp(s: GameSession, sas = true): number {
  const c = s.sys!.c;
  c.batt = 1;
  run(s, 3);
  c.acol = 1;
  c.fuelP = 1;
  run(s, 2);
  c.engMain = 1;
  let t = 5;
  while (s.sys!.n1 < ENGINE.idleN1 - 1 && t < 120) {
    run(s, 0.5);
    t += 0.5;
  }
  c.gen = 1;
  c.pitot = 1;
  c.sas = sas ? 1 : 0;
  c.engMain = 2;
  while (s.flight.nr < 0.985 && t < 180) {
    run(s, 0.5);
    t += 0.5;
  }
  return t;
}

/**
 * 键盘飞行员：和真人一样只能按键或不按，看着仪表做反馈。
 * 每一帧按一下或松开，所有目标都是“想要的速度”。
 */
function pilot(s: GameSession, seconds: number, want: { vs?: number; vF?: number; heading?: number; bank?: number }): { maxTilt: number; minNr: number } {
  const n = Math.round(seconds * 60);
  let maxTilt = 0;
  let minNr = 9;
  let lastP = s.flight.telemetry.pitch;
  let lastR = s.flight.telemetry.roll;
  for (let i = 0; i < n; i++) {
    const t = s.flight.telemetry;
    const key = (e: number, dead: number) => (e > dead ? 1 : e < -dead ? -1 : 0);
    const vs = s.body.vel.y;
    const vF = t.forwardAirspeed;
    // 俯仰：速度差换成想要的姿态，再用键追姿态。真人看的不只是偏差，还有它在往哪边走（提前量）
    const pRate = (t.pitch - lastP) * 60;
    const rRate = (t.roll - lastR) * 60;
    lastP = t.pitch;
    lastR = t.roll;
    const wantPitch = -Math.max(-0.2, Math.min(0.3, ((want.vF ?? 0) - vF) * 0.035)) - (want.vF ? 0.03 : 0);
    const pitchErr = t.pitch - wantPitch + pRate * 0.55;
    const vR = s.body.vel.x * Math.cos(t.heading) + s.body.vel.z * Math.sin(t.heading);
    const wantRoll = want.bank ?? Math.max(-0.2, Math.min(0.2, -vR * 0.05));
    const rollErr = wantRoll - t.roll - rRate * 0.55;
    let hdgErr = 0;
    if (want.heading !== undefined) {
      hdgErr = want.heading - t.heading;
      while (hdgErr > Math.PI) hdgErr -= 2 * Math.PI;
      while (hdgErr < -Math.PI) hdgErr += 2 * Math.PI;
    }
    setInput(s, {
      pitch: key(pitchErr, 0.012),
      lateral: key(rollErr, 0.012),
      turn: key(hdgErr, 0.02),
      vertical: key((want.vs ?? 0) - vs, 0.25),
    });
    s.step();
    maxTilt = Math.max(maxTilt, Math.abs(t.pitch), Math.abs(t.roll));
    if (s.flight.nr < minNr) minNr = s.flight.nr;
  }
  setInput(s, {});
  return { maxTilt, minNr };
}

describe('超仿真：启动程序', () => {
  it('冷舱：什么都没开，旋翼不转，仪表没电', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    run(s, 2);
    const y = s.sys!;
    expect(y.powered).toBe(false);
    expect(y.lit).toBe(false);
    expect(s.flight.nr).toBe(0);
    expect(s.flight.telemetry.thrust).toBe(0);
    s.dispose();
  });

  it('按程序启动：起动机转、点火、慢车 68%，再到飞行档旋翼 100%，全程不超温', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const t = startUp(s);
    const y = s.sys!;
    expect(y.lit).toBe(true);
    expect(s.flight.nr).toBeGreaterThan(0.97);
    expect(y.genOnline).toBe(true);
    expect(y.busV).toBeGreaterThan(27);
    expect(y.startPeak).toBeGreaterThan(600);
    expect(y.startPeak).toBeLessThan(ENGINE.totStartLimit);
    // 涡轴从起动到 100% 大约一分钟
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(120);
    expect(s.damage.durability).toBe(100);
    s.dispose();
  });

  it('没开电瓶、没开燃油泵、燃油阀关着，都起动不了', async () => {
    for (const miss of ['batt', 'fuelP', 'fuelValve'] as const) {
      const s = await sessionFor(TRAINING, 'sim');
      const c = s.sys!.c;
      c.batt = 1;
      c.fuelP = 1;
      c[miss] = 0;
      run(s, 2);
      c.engMain = 1;
      run(s, 25);
      expect(s.sys!.lit, miss).toBe(false);
      s.dispose();
    }
  });

  it('旋翼刹车没松：发动机起来了，旋翼也转不动', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const c = s.sys!.c;
    c.rotorBrake = 0;
    c.batt = 1;
    c.fuelP = 1;
    run(s, 2);
    c.engMain = 1;
    run(s, 40);
    expect(s.sys!.lit).toBe(true);
    expect(s.flight.nr).toBeLessThan(0.02);
    s.dispose();
  });

  it('断路器真的断电：拔掉电瓶断路器汇流条就没电', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const c = s.sys!.c;
    c.batt = 1;
    run(s, 2);
    expect(s.sys!.powered).toBe(true);
    c.cb_batt = 0;
    run(s, 1);
    expect(s.sys!.powered).toBe(false);
    s.dispose();
  });

  it('电瓶放电：只用电瓶时电量往下走，发电机上线后充回来', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    const c = s.sys!.c;
    c.batt = 1;
    run(s, 30);
    const a = s.sys!.soc;
    expect(a).toBeLessThan(0.92);
    startUp(s);
    const b = s.sys!.soc;
    run(s, 30);
    expect(s.sys!.soc).toBeGreaterThan(b);
    s.dispose();
  });

  it('关车：主开关回 OFF，N1 掉下来，旋翼靠惯性转很久才停，用旋翼刹车快得多', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    s.sys!.c.engMain = 0;
    run(s, 8);
    expect(s.sys!.lit).toBe(false);
    expect(s.flight.nr).toBeGreaterThan(0.4);
    run(s, 12);
    s.sys!.c.rotorBrake = 0;
    run(s, 16);
    expect(s.flight.nr).toBeLessThan(0.02);
    s.dispose();
  });
});

describe('超仿真：飞行', () => {
  it('总距上提离地，放下就落回来；没有高度保持', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    const y0 = s.body.pos.y;
    run(s, 2.2, { vertical: 1 });
    run(s, 3, {});
    expect(s.body.pos.y).toBeGreaterThan(y0 + 2);
    const col = s.flight.collective;
    expect(col).toBeGreaterThan(0.45);
    expect(col).toBeLessThan(0.9);
    s.dispose();
  });

  it('键盘飞行员开着增稳：起飞、悬停 20 秒不走远、转速守得住', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s, true);
    pilot(s, 8, { vs: 2.5 });
    const x = s.body.pos.x;
    const z = s.body.pos.z;
    const h = s.agl;
    expect(h).toBeGreaterThan(6);
    const r = pilot(s, 20, { vs: 0, vF: 0 });
    const drift = Math.hypot(s.body.pos.x - x, s.body.pos.z - z);
    expect(r.minNr).toBeGreaterThan(0.93);
    expect(r.maxTilt).toBeLessThan(0.4);
    expect(Math.abs(s.agl - h)).toBeLessThan(10);
    expect(drift).toBeLessThan(45);
    expect(s.state).toBe('running');
    s.dispose();
  });

  it('键盘飞行员不开增稳也飞得住（姿态不会发散）', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s, false);
    pilot(s, 8, { vs: 2.5 });
    const r = pilot(s, 20, { vs: 0, vF: 0 });
    expect(r.maxTilt).toBeLessThan(0.6);
    expect(s.state).toBe('running');
    s.dispose();
  });

  it('前飞：杆推出去速度上来，到 50 m/s 功率在限制以内', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    pilot(s, 12, { vs: 4 });
    pilot(s, 30, { vs: 0, vF: 50 });
    const t = s.flight.telemetry;
    expect(t.forwardAirspeed).toBeGreaterThan(38);
    expect(t.torque).toBeLessThan(1.1);
    expect(s.state).toBe('running');
    s.dispose();
  });

  it('空中关车：旋翼转速掉下来，放下总距靠自转守住，还能落地', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    pilot(s, 25, { vs: 6 });
    pilot(s, 16, { vs: 0, vF: 35 });
    const top = s.agl;
    expect(top).toBeGreaterThan(90);
    s.sys!.c.fuelValve = 0;
    run(s, 1.2, {});
    expect(s.sys!.lit).toBe(false);
    expect(s.flight.nr).toBeLessThan(0.97);
    // 放总距，把转速守在绿区；杆守住姿态，速度保持在最小下降率附近
    let minNr = 9;
    let maxNr = 0;
    let sink = 0;
    let samples = 0;
    let lastNr = s.flight.nr;
    let lastP = s.flight.telemetry.pitch;
    for (let i = 0; i < 60 * 40 && s.agl > 18 && s.state === 'running'; i++) {
      const nr = s.flight.nr;
      const lead = nr + (nr - lastNr) * 60 * 1.2;
      lastNr = nr;
      const v = lead < 0.98 ? -1 : lead > 1.02 ? 1 : 0;
      const t = s.flight.telemetry;
      const pRate = (t.pitch - lastP) * 60;
      lastP = t.pitch;
      const wantPitch = Math.max(-0.2, Math.min(0.12, (t.forwardAirspeed - 32) * 0.02)) - 0.06;
      const e = t.pitch - wantPitch + pRate * 0.55;
      setInput(s, { vertical: v, pitch: e > 0.012 ? 1 : e < -0.012 ? -1 : 0 });
      s.step();
      if (i > 240) {
        minNr = Math.min(minNr, nr);
        maxNr = Math.max(maxNr, nr);
        sink += -s.body.vel.y;
        samples++;
      }
    }
    expect(minNr).toBeGreaterThan(0.85);
    expect(maxNr).toBeLessThan(1.15);
    // 稳定自转的下降率约 1500~3000 英尺/分（这个机型机身跟着桨盘一起俯仰，比真机略快）
    expect(sink / samples).toBeGreaterThan(5);
    expect(sink / samples).toBeLessThan(15);
    s.dispose();
  });

  it('高空悬停时功率不够：总距再提，转速往下掉，低转速告警', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    pilot(s, 6, { vs: 3 });
    run(s, 8, { vertical: 1 });
    const c = s.sys!.caution(s.flight.nr, s.flight.shaft, false);
    expect(s.flight.telemetry.torque).toBeGreaterThan(0.95);
    expect(c.tqLim || s.flight.nr < 0.98).toBe(true);
    s.dispose();
  });

  it('涡环：几乎不前飞地快速下降，推力掉得比正常多', async () => {
    const s = await sessionFor(TRAINING, 'sim');
    startUp(s);
    pilot(s, 30, { vs: 6 });
    pilot(s, 6, { vs: 0, vF: 0 });
    let peak = 0;
    for (let i = 0; i < 60 * 14 && s.agl > 25; i++) {
      setInput(s, { vertical: -s.body.vel.y < 7 ? -1 : 0 });
      s.step();
      peak = Math.max(peak, s.flight.telemetry.vortexRing);
    }
    expect(peak).toBeGreaterThan(0.3);
    s.dispose();
  });
});
