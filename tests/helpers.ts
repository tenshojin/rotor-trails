// 测试辅助：生成世界、创建会话、按脚本驾驶。

import { GameSession } from '../src/sim/session';
import { generateWorld, type WorldData } from '../src/world/worldgen';
import type { MapDef } from '../src/maps/types';
import type { AssistId } from '../src/config/flight';
import type { PilotInput } from '../src/sim/flight';

const cache = new Map<string, WorldData>();

export async function worldFor(map: MapDef): Promise<WorldData> {
  let w = cache.get(map.id);
  if (!w) {
    w = await generateWorld(map, false);
    cache.set(map.id, w);
  }
  return w;
}

export async function sessionFor(map: MapDef, assist: AssistId = 'standard', weather?: string): Promise<GameSession> {
  const w = await worldFor(map);
  return GameSession.create(w, weather ?? map.defaultWeather, assist);
}

export function setInput(s: GameSession, i: Partial<PilotInput>): void {
  s.input.pitch = i.pitch ?? 0;
  s.input.turn = i.turn ?? 0;
  s.input.lateral = i.lateral ?? 0;
  s.input.vertical = i.vertical ?? 0;
}

export function run(s: GameSession, seconds: number, input?: Partial<PilotInput>): void {
  if (input) setInput(s, input);
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) s.step();
}
