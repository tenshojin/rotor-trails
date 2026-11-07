import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FlightTape } from '../src/game/replay';
import type { BodyState } from '../src/sim/flight';

const body = (): BodyState => ({ pos: new Vector3(), quat: new Quaternion(), vel: new Vector3(), angVel: new Vector3() });
const frame = { rpm: 1, thrust: 20000, airspeed: 30 };

/** 匀速飞 seconds 秒，60 帧每秒 */
function fly(tape: FlightTape, seconds: number, speed = 30): BodyState {
  const b = body();
  b.vel.set(speed, 0, 0);
  for (let i = 0; i < seconds * 60; i++) {
    b.pos.x += speed / 60;
    tape.record(1 / 60, b, frame, false);
  }
  return b;
}

describe('回放的磁带', () => {
  it('放出来的位置和飞的时候一样，帧之间也是顺的', () => {
    const tape = new FlightTape();
    fly(tape, 10);
    expect(tape.seconds).toBeGreaterThan(9.5);
    const b = body();
    let last = -1;
    for (let t = 2; t < 3; t += 0.01) {
      tape.pose(t, b);
      if (last >= 0) expect(b.pos.x - last).toBeCloseTo(0.3, 3);
      last = b.pos.x;
    }
    expect(b.vel.x).toBeCloseTo(30, 5);
  });

  it('转弯的姿态插值之后还是单位四元数，转速跟着放', () => {
    const tape = new FlightTape();
    const b = body();
    for (let i = 0; i < 600; i++) {
      b.quat.setFromAxisAngle(new Vector3(0, 1, 0), i * 0.01);
      tape.record(1 / 60, b, { rpm: i / 600, thrust: 0, airspeed: 0 }, false);
    }
    const o = body();
    const f = tape.pose(tape.seconds / 2, o);
    expect(o.quat.length()).toBeCloseTo(1, 6);
    expect(f.rpm).toBeGreaterThan(0.4);
    expect(f.rpm).toBeLessThan(0.6);
  });

  it('录满了只留最近四分钟，最早的挤出去', () => {
    const tape = new FlightTape();
    const b = fly(tape, 300);
    expect(tape.seconds).toBeGreaterThan(235);
    expect(tape.seconds).toBeLessThan(241);
    const o = body();
    tape.pose(tape.seconds, o);
    expect(o.pos.x).toBeCloseTo(b.pos.x, 0);
    tape.pose(0, o);
    expect(o.pos.x).toBeGreaterThan(b.pos.x - 30 * 241);
  });

  it('传送是一个剪辑点：两段都留着，中间不会放出一段穿山而过的直线', () => {
    const tape = new FlightTape();
    const b = fly(tape, 10);
    const end = b.pos.x;
    b.vel.set(0, 0, 0);
    b.pos.set(5000, 200, 5000);
    for (let i = 0; i < 120; i++) tape.record(1 / 60, b, frame, false);
    expect(tape.seconds).toBeGreaterThan(11.5);
    const o = body();
    let seg = 0;
    let cuts = 0;
    for (let t = 0; t < tape.seconds; t += 0.005) {
      const f = tape.pose(t, o);
      // 只有两个地方：不是第一段的航线上，就是传送到的那一点
      expect(o.pos.x <= end + 1 || Math.abs(o.pos.x - 5000) < 1e-6).toBe(true);
      if (f.seg !== seg) {
        seg = f.seg ?? 0;
        cuts++;
      }
    }
    expect(cuts).toBe(1);
    expect(seg).toBe(1);
  });

  it('停在地上干等的时间不录，起飞接着放', () => {
    const tape = new FlightTape();
    const b = fly(tape, 5);
    const before = tape.seconds;
    for (let i = 0; i < 3000; i++) tape.record(1 / 60, b, frame, true);
    expect(tape.seconds).toBe(before);
    for (let i = 0; i < 120; i++) {
      b.pos.x += 0.5;
      tape.record(1 / 60, b, frame, false);
    }
    expect(tape.seconds).toBeLessThan(before + 2.2);
  });

  it('空磁带和只有一帧的时候不出错', () => {
    const tape = new FlightTape();
    const b = body();
    expect(tape.seconds).toBe(0);
    tape.pose(3, b);
    expect(b.pos.x).toBe(0);
    tape.record(1, b, frame, false);
    expect(tape.seconds).toBe(0);
    tape.pose(3, b);
    expect(Number.isFinite(b.pos.x)).toBe(true);
    expect(b.quat.length()).toBeCloseTo(1, 6);
  });
});
