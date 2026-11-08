// 停机坪上的货：货送到了堆在坪边，重来之后就没了。
// 地勤（人物模型）2026-11-08 按用户要求先全部撤下，坪上不能再出现人。
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { getMap } from '../src/maps/index';
import { PadLife } from '../src/render/padLife';
import type { GameSession } from '../src/sim/session';

const map = getMap('japan');
const pad = map.pads[1];

function fake(x: number, y: number, z: number, targetId: string | null, done: string[] = []): GameSession {
  const land = (id: string, status: string) => ({ status, def: { kind: 'land', cargo: 'unload', padId: id } });
  return {
    body: { pos: { x, y, z } },
    mission: {
      current: () => (targetId ? { def: { kind: 'land', padId: targetId } } : null),
      main: done.map((id) => land(id, 'done')),
      optional: [],
    },
  } as unknown as GameSession;
}

describe('停机坪上的货', () => {
  it('坪上没有人：只有货箱这一组实例', () => {
    const life = new PadLife(map);
    const meshes: THREE.Object3D[] = [];
    life.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect((life as unknown as { crew?: unknown }).crew).toBeUndefined();
    life.dispose();
  });

  it('卸了货堆在坪上，重来之后就没了', () => {
    const life = new PadLife(map);
    const crates = (life as unknown as { crates: { count: number } }).crates;
    expect(crates.count).toBe(0);
    life.update(fake(0, 100, 0, null, [pad.id]), 0, 1 / 30);
    expect(crates.count).toBe(3);
    life.update(fake(0, 100, 0, null, []), 0, 1 / 30);
    expect(crates.count).toBe(0);
    life.dispose();
  });
});
