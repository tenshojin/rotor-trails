import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeightBuilder } from '../src/sim/terrain';
import { Perlin2, Rng } from '../src/core/noise';

beforeAll(async () => {
  await RAPIER.init();
});

describe('地形高度场与 Rapier 碰撞面一致', () => {
  it('射线命中高度 == heightAt()（含悬崖和斜向陡坡）', () => {
    const b = new HeightBuilder(512, 129);
    const n = new Perlin2(7);
    b.fill((x, z) => 40 * n.fbm(x / 60, z / 60, 4) + x * 0.05 + z * 0.2 + (x + z > 40 ? 35 : 0));
    const hf = b.build();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const desc = RAPIER.ColliderDesc.heightfield(hf.res - 1, hf.res - 1, hf.toRapierHeights(), { x: hf.size, y: 1, z: hf.size });
    world.createCollider(desc);
    world.step();
    const rng = new Rng(1);
    let maxErr = 0;
    for (let i = 0; i < 400; i++) {
      const x = rng.range(-250, 250);
      const z = rng.range(-250, 250);
      const ray = new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 2000, true);
      expect(hit).not.toBeNull();
      const y = 500 - hit!.timeOfImpact;
      maxErr = Math.max(maxErr, Math.abs(y - hf.heightAt(x, z)));
    }
    world.free();
    expect(maxErr).toBeLessThan(0.02);
  });
});
