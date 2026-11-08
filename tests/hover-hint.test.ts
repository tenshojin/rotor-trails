// 悬停辅助默认关闭；新手辅助下看起来停不稳时提示一句（被风推着走、前后左右来回修正）。
import { describe, expect, it } from 'vitest';
import { getMap } from '../src/maps/index';
import { GameSession, STEP, type GameEvent } from '../src/sim/session';
import type { AssistId } from '../src/config/flight';
import { worldFor } from './helpers';

const map = getMap('training');
const base = map.pads.find((p) => p.id === map.spawn.padId)!.pos;

async function airborne(assist: AssistId = 'novice'): Promise<GameSession> {
  const s = await GameSession.create(await worldFor(map), map.defaultWeather, assist, true);
  s.hoverAt(base[0] + 120, 30, base[2] - 160, 0);
  return s;
}

/** 跑若干秒，返回期间提示了几次；每一步之前可以改输入 */
function fly(s: GameSession, seconds: number, each?: (t: number) => void): number {
  let hints = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    each?.(i * STEP);
    s.step();
    hints += s.drainEvents().filter((e: GameEvent) => e.type === 'hoverHint').length;
  }
  return hints;
}

/** 一直从西边吹来的风 */
function steadyWind(s: GameSession, speed: number): void {
  s.wind.sample = (_x, _y, _z, _t, out) => out.set(speed, 0, 0);
}

/** 前后键来回点：每 0.8 秒换一次方向 */
const fuss = (s: GameSession) => (t: number) => {
  s.input.pitch = Math.floor(t / 0.8) % 2 === 0 ? 0.6 : -0.6;
};

describe('悬停辅助的默认和提示', () => {
  it('休闲飞行起飞和跳景点都不替玩家打开悬停辅助；玩家开着的会接着开', async () => {
    const s = await airborne();
    try {
      expect(s.flight.hoverOn).toBe(false);
      s.toggleHover();
      s.step();
      expect(s.flight.hoverOn).toBe(true);
      s.hoverAt(base[0] - 200, 40, base[2] + 100, 90);
      expect(s.flight.hoverOn).toBe(true);
    } finally {
      s.dispose();
    }
  });

  it('安全恢复不替玩家打开悬停辅助', async () => {
    const s = await airborne();
    try {
      fly(s, 1);
      s.saveCheckpoint('测试', true);
      const opts = s.restoreOptions();
      expect(opts.length).toBeGreaterThan(0);
      s.restoreCheckpoint(opts.length - 1, 'safe');
      expect(s.flight.hoverOn).toBe(false);
    } finally {
      s.dispose();
    }
  });

  it('松手后被风推着走：新手辅助提示一次', async () => {
    const s = await airborne();
    try {
      steadyWind(s, 9);
      const hints = fly(s, 30);
      expect(hints).toBe(1);
    } finally {
      s.dispose();
    }
  });

  it('前后来回修正个不停：新手辅助提示', async () => {
    const s = await airborne();
    try {
      expect(fly(s, 14, fuss(s))).toBe(1);
    } finally {
      s.dispose();
    }
  });

  it('稳稳停着、开着悬停辅助、或者不是新手辅助：不提示', async () => {
    const calm = await airborne();
    try {
      expect(fly(calm, 20)).toBe(0);
    } finally {
      calm.dispose();
    }
    const on = await airborne();
    try {
      steadyWind(on, 9);
      on.toggleHover();
      expect(fly(on, 20, fuss(on))).toBe(0);
    } finally {
      on.dispose();
    }
    const std = await airborne('standard');
    try {
      expect(fly(std, 14, fuss(std))).toBe(0);
    } finally {
      std.dispose();
    }
  });

  it('提示过一次，90 秒内不再提示；玩家自己开过一次就再也不提示', async () => {
    const s = await airborne();
    try {
      expect(fly(s, 14, fuss(s))).toBe(1);
      expect(fly(s, 40, fuss(s))).toBe(0);
      s.input.pitch = 0;
      s.toggleHover();
      fly(s, 1);
      s.toggleHover();
      fly(s, 1);
      expect(s.flight.hoverOn).toBe(false);
      expect(fly(s, 120, fuss(s))).toBe(0);
    } finally {
      s.dispose();
    }
  });
});
