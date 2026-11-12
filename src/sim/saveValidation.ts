// 读档前把读档要用到的每个字段都查一遍：有一个不对就整份不读，正在飞的这一局一点都不改（不会只恢复一半）。
import type { SessionSave, SessionSnapshot } from './session';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nums = (v: unknown, keys: string[]): v is Record<string, unknown> => obj(v) && keys.every((k) => num(v[k]));
const vec = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(num);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const integer = (v: unknown): v is number => Number.isInteger(v);
const landing = (v: unknown): boolean => v === null || (
  nums(v, ['descent', 'horizontal', 'attitudeDeg', 'offset', 'score']) &&
  ['perfect', 'good', 'ok', 'rough', 'unsafe'].includes(v.grade as string) &&
  typeof v.safe === 'boolean' && strings(v.reasons)
);
const objective = (v: unknown): boolean => obj(v) &&
  ['pending', 'active', 'done'].includes(v.status as string) && num(v.progress) &&
  Array.isArray(v.visited) && v.visited.every((x) => typeof x === 'boolean') &&
  landing(v.landing) && (v.routeIdx === undefined || integer(v.routeIdx));

const WEATHER_FIELDS = ['rain', 'snow', 'visibility', 'cloudCover', 'overcast', 'lowCloud', 'cloudBase', 'cloudTop',
  'lightning', 'wetness', 'windDirFrom', 'windSpeed', 'gustAmp', 'turbulence', 'zoneScale'];

export function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!obj(value)) return false;
  const { body, damage, buffs, mission, nav, weather } = value;
  if (!obj(body) || !vec(body.pos, 3) || !vec(body.vel, 3) || !vec(body.angVel, 3) || !vec(body.quat, 4)) return false;
  const q = body.quat.reduce((sum, x) => sum + x * x, 0);
  if (!Number.isFinite(q) || Math.abs(q - 1) > 0.05) return false;
  if (!num(value.t) || !num(value.collective) || !num(value.enginePower) || typeof value.hoverOn !== 'boolean' || typeof value.grounded !== 'boolean') return false;
  if (!nums(damage, ['durability', 'collisions']) || (damage.lastCause !== null &&
      !['impact', 'scrape', 'rotor', 'tailRotor', 'hardLanding', 'sideLoad', 'attitude', 'rollover', 'water'].includes(damage.lastCause as string))) return false;
  if (!nums(buffs, ['boostCharges', 'boostTime', 'boostLevel', 'shieldTime'])) return false;
  if (!obj(mission) || !integer(mission.index) || !num(mission.cargo) ||
      !Array.isArray(mission.main) || !mission.main.every(objective) ||
      !Array.isArray(mission.optional) || !mission.optional.every(objective) ||
      !landing(mission.finalLanding) || !Array.isArray(mission.landings) || !mission.landings.every((x) => x !== null && landing(x))) return false;
  if (!obj(nav) || !['leg', 'node', 'preferred', 'focus'].every((k) => integer(nav[k])) ||
      !(nav.path === null || integer(nav.path)) || !vec(nav.legStart, 3)) return false;
  if (!obj(weather) || typeof weather.presetId !== 'string' || typeof weather.activeLabel !== 'string' ||
      !nums(weather.from, WEATHER_FIELDS) || !nums(weather.to, WEATHER_FIELDS) ||
      !num(weather.t) || !num(weather.duration) || !integer(weather.scheduleIndex)) return false;
  return strings(value.pickupsTaken) && obj(value.repairUses) && Object.values(value.repairUses).every(num);
}

export function isSessionSaveShape(value: unknown): value is SessionSave {
  if (!obj(value) || !isSessionSnapshot(value.snap) || !Array.isArray(value.checkpoints)) return false;
  if (!value.checkpoints.every((c) => obj(c) && integer(c.id) && typeof c.label === 'string' &&
      num(c.t) && num(c.durability) && isSessionSnapshot(c.snap))) return false;
  // 这几项可有可无，读的时候各自逐项清理、兼容旧存档
  if (value.stats !== undefined && !obj(value.stats)) return false;
  if (value.sim !== undefined && !obj(value.sim)) return false;
  if (value.sys !== undefined) {
    const sys = value.sys;
    if (!obj(sys) || (sys.c !== undefined && !obj(sys.c)) || (sys.v !== undefined && !obj(sys.v)) ||
        (sys.lit !== undefined && !strings(sys.lit))) return false;
  }
  return true;
}
