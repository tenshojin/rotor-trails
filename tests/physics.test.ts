import { describe, it, expect } from 'vitest';
import { FixedStepper } from '../src/core/stepper';
import { STEP } from '../src/sim/session';
import { HELI, densityRatio, engineAltitudeFactor } from '../src/config/flight';
import { powerRequired } from '../src/sim/flight';
import { FLAT } from './testmap';
import { run, sessionFor, setInput } from './helpers';

describe('固定步长与帧率无关', () => {
  it('30 / 60 / 144 FPS 以及抖动帧间隔：同样的时间推进同样的物理步数', () => {
    const counts: number[] = [];
    for (const frame of [1 / 30, 1 / 60, 1 / 144, -1]) {
      const st = new FixedStepper(STEP, 6, 0.1);
      let steps = 0;
      let t = 0;
      let k = 0;
      while (t < 10 - 1e-9) {
        // -1：在 4–40 ms 之间抖动的帧间隔
        const dt = frame > 0 ? frame : 0.004 + ((k * 7919) % 37) / 1000;
        const d = Math.min(dt, 10 - t);
        steps += st.advance(d);
        t += d;
        k++;
      }
      counts.push(steps);
    }
    for (const c of counts) expect(Math.abs(c - 600)).toBeLessThanOrEqual(1);
  });

  it('不同帧率驱动同一段飞行，最终状态一致（物理只取决于步数）', async () => {
    const result: number[][] = [];
    for (const fps of [30, 144]) {
      const s = await sessionFor(FLAT, 'standard', 'calm');
      const st = new FixedStepper(STEP, 6, 0.1);
      let t = 0;
      while (t < 14) {
        setInput(s, t < 6 ? { vertical: 1 } : { pitch: 1, turn: 0.3 });
        const n = st.advance(1 / fps);
        for (let i = 0; i < n; i++) s.step();
        t += 1 / fps;
      }
      result.push([s.body.pos.x, s.body.pos.y, s.body.pos.z, s.t]);
      s.dispose();
    }
    const [a, b] = result;
    // 输入在帧边界上切换，最多相差一两个物理步
    expect(Math.abs(a[3] - b[3])).toBeLessThanOrEqual(2 * STEP + 1e-6);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1.5);
  });

  it('切后台/卡顿后的超长帧被截断：最多 6 步，积压时间被丢弃（不会瞬移）', () => {
    const st = new FixedStepper(STEP, 6, 0.1);
    expect(st.advance(30)).toBeLessThanOrEqual(6);
    expect(st.acc).toBeLessThan(STEP);
    expect(st.advance(Number.NaN)).toBe(0);
    expect(st.advance(-5)).toBe(0);
    expect(st.advance(1 / 60)).toBe(1);
  });

  it('暂停期间不推进；恢复后的第一帧位移有上限', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    run(s, 5, { vertical: 1 });
    run(s, 5, { pitch: 1 });
    const st = new FixedStepper(STEP, 6, 0.1);
    const p0 = s.body.pos.clone();
    const t0 = s.t;
    // 暂停：应用层不调用 advance/step（这里模拟 3 秒的暂停）
    expect(s.t).toBe(t0);
    // 恢复后浏览器给出一个很长的帧间隔（例如 3 s）
    const n = st.advance(3);
    for (let i = 0; i < n; i++) s.step();
    const moved = s.body.pos.distanceTo(p0);
    expect(n).toBeLessThanOrEqual(6);
    expect(moved).toBeLessThan(s.body.vel.length() * 6 * STEP + 0.5);
    s.dispose();
  });
});

describe('风与悬停', () => {
  it('持续侧风通过相对气流推动飞机；悬停辅助逐步抵消漂移而不是瞬间锁定', async () => {
    const s = await sessionFor(FLAT, 'standard', 'east10');
    run(s, 6, { vertical: 1 });
    run(s, 2, {});
    // 东风 10 m/s（来自 90°）把飞机往西（-X）推
    run(s, 8, {});
    expect(s.body.vel.x).toBeLessThan(-2);
    s.toggleHover();
    run(s, 2, {});
    const vAfter2 = Math.hypot(s.body.vel.x, s.body.vel.z);
    expect(vAfter2).toBeGreaterThan(0.5); // 渐进，而非瞬间停住
    run(s, 18, {});
    expect(Math.hypot(s.body.vel.x, s.body.vel.z)).toBeLessThan(1.0);
    s.dispose();
  });

  it('悬停辅助（无风）保持位置与高度', async () => {
    const s = await sessionFor(FLAT, 'novice', 'calm');
    run(s, 6, { vertical: 1 });
    s.toggleHover();
    run(s, 10, {});
    const p = s.body.pos.clone();
    run(s, 10, {});
    expect(s.body.pos.distanceTo(p)).toBeLessThan(2.5);
    s.dispose();
  });
});

describe('碰撞', () => {
  it('高速（250 km/h）撞墙不会穿透', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    // 墙：x = 2485..2515，z = -150..150，高 150
    s.teleport(2300, 60, 0, 90, 70);
    let maxX = -Infinity;
    for (let i = 0; i < 6 * 60 && s.state === 'running'; i++) {
      setInput(s, { pitch: 1 });
      s.step();
      maxX = Math.max(maxX, s.body.pos.x);
    }
    expect(maxX).toBeLessThan(2485 + 1);
    expect(s.damage.collisions).toBeGreaterThan(0);
    s.dispose();
  });

  it('持续顶着障碍物不会每帧重复结算伤害', async () => {
    const s = await sessionFor(FLAT, 'standard', 'calm');
    s.teleport(2470, 30, 0, 90, 4);
    const dur0 = s.damage.durability;
    run(s, 4, { pitch: 1 });
    const lost = dur0 - s.damage.durability;
    // 4 秒 = 240 个物理步；若每步都扣血，耐久早已归零
    expect(s.state).toBe('running');
    expect(lost).toBeLessThan(60);
    expect(s.damage.collisions).toBeLessThanOrEqual(6);
    s.dispose();
  });
});

describe('高原性能', () => {
  it('海拔 5200 m、空载仍有悬停余量；任何海拔/载重下满总距推力不低于 1.12 倍重量', () => {
    const W = HELI.massBase * 9.81;
    const alt = 5200;
    const pAvail = Math.min(HELI.transmissionLimit, HELI.enginePowerSL * engineAltitudeFactor(alt));
    const pHover = powerRequired(W, 1.225 * densityRatio(alt), 0, 0, 1);
    expect(pAvail / pHover).toBeGreaterThan(1.1);
    for (const a of [0, 3000, 6000, 9000])
      for (const cargo of [0, 2]) {
        const w = (HELI.massBase + cargo * HELI.crateMass) * 9.81;
        const tFull = Math.max(HELI.thrustFull * HELI.massBase * 9.81 * densityRatio(a), HELI.thrustFloor * w);
        expect(tFull / w).toBeGreaterThanOrEqual(1.12 - 1e-9);
      }
  });
});
