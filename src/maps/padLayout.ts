import type { PadDef, V3 } from './types';

/** Same transform as PropBuilder: every visual on a pad follows its heading. */
export function padWorld(pad: Pick<PadDef, 'pos' | 'rotY'>, x: number, y: number, z: number): V3 {
  const c = Math.cos(pad.rotY ?? 0);
  const s = Math.sin(pad.rotY ?? 0);
  return [pad.pos[0] + x * c + z * s, pad.pos[1] + y, pad.pos[2] - x * s + z * c];
}

/** Low-profile lights sit on the deck, with each corner represented exactly once. */
export function padLightOffsets(size: number): Array<[number, number]> {
  const edge = size / 2 - 0.2;
  const segments = Math.max(3, Math.ceil((edge * 2) / 6));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const t = -edge + (2 * edge * i) / segments;
    out.push([t, -edge], [edge, t], [-t, edge], [-edge, -t]);
  }
  return out;
}
