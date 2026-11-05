import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { padLightOffsets, padWorld } from '../src/maps/padLayout';
import { PropBuilder } from '../src/world/propBuilder';

describe('helipad visual alignment', () => {
  it('uses exactly the same rotation and origin as physical pad geometry', () => {
    for (const rotY of [0, Math.PI / 4, -1.27, Math.PI / 2, Math.PI]) {
      const pad = { pos: [42, 120, -75] as [number, number, number], rotY };
      const builder = new PropBuilder(false).at(...pad.pos, rotY);
      for (const [x, z] of padLightOffsets(27)) expect(padWorld(pad, x, 0.15, z)).toEqual(builder.w(x, 0.15, z));
    }
  });

  it('keeps fixtures on the slab, spaces lights evenly, and never doubles a corner', () => {
    for (const size of [12, 20, 24, 27, 32, 50]) {
      const lights = padLightOffsets(size);
      expect(new Set(lights.map((p) => p.map((v) => v.toFixed(6)).join(','))).size).toBe(lights.length);
      const edge = size / 2 - 0.2;
      for (const [x, z] of lights) expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(edge);
      const bottom = lights.filter(([, z]) => Math.abs(z + edge) < 1e-8).map(([x]) => x).sort((a, b) => a - b);
      for (let i = 1; i < bottom.length; i++) expect(bottom[i] - bottom[i - 1]).toBeLessThanOrEqual(6.001);
    }
  });
});

describe('Blender helipad fixtures contract', () => {
  it('ships all named, compressed, texture-free batches within the geometry budget', () => {
    const bytes = readFileSync(new URL('../public/models/pad_fixtures.glb', import.meta.url));
    expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
    expect(bytes.length).toBeLessThan(64 * 1024);
    const length = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + length));
    expect(gltf.nodes.map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(['lamp_housing', 'lamp_lens', 'tie_ring']));
    expect(gltf.images ?? []).toHaveLength(0);
    expect(gltf.materials).toHaveLength(3);
    let triangles = 0;
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      expect(primitive.extensions.KHR_draco_mesh_compression).toBeDefined();
      triangles += gltf.accessors[primitive.indices].count / 3;
    }
    expect(triangles).toBeLessThan(5000);
  });
});
