import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface TextureSlot { path: string; channel: number }
interface Primitive { attributes: Record<string, number>; material?: number }
interface Asset {
  meshes: Array<{ name?: string; primitives: Primitive[] }>;
  materials?: Record<string, unknown>[];
  accessors: Array<{ count: number; type: string; componentType: number; bufferView?: number; byteOffset?: number }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
}

function readAsset(file: string): { asset: Asset; binary: Buffer } {
  const bytes = fs.readFileSync(path.join(process.cwd(), 'public/models', file));
  const jsonLength = bytes.readUInt32LE(12);
  const asset: Asset = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binary = bytes.subarray(20 + jsonLength + 8);
  return { asset, binary };
}

function textureSlots(value: Record<string, unknown>, prefix = ''): TextureSlot[] {
  const slots: TextureSlot[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { texCoord?: number; extensions?: { KHR_texture_transform?: { texCoord?: number } } };
    if (key.endsWith('Texture')) slots.push({ path: prefix + key, channel: record.extensions?.KHR_texture_transform?.texCoord ?? record.texCoord ?? 0 });
    else slots.push(...textureSlots(item as Record<string, unknown>, `${prefix}${key}.`));
  }
  return slots;
}

const files = fs.readdirSync(path.join(process.cwd(), 'public/models')).filter((name) => name.endsWith('.glb'));
describe('shipped model texture coordinates', () => {
  for (const file of files) it(`${file}: every textured primitive has valid matching UV coordinates`, () => {
    const { asset } = readAsset(file);
    for (const mesh of asset.meshes) for (const primitive of mesh.primitives) {
      const material = asset.materials?.[primitive.material ?? -1];
      if (!material) continue;
      for (const slot of textureSlots(material)) {
        const label = `${file} / ${mesh.name} / ${slot.path}`;
        expect(Number.isInteger(slot.channel) && slot.channel >= 0, label).toBe(true);
        const accessorId = primitive.attributes[`TEXCOORD_${slot.channel}`];
        expect(accessorId, label).toBeDefined();
        const accessor = asset.accessors[accessorId];
        expect(accessor.type, label).toBe('VEC2');
        expect(accessor.count, label).toBe(asset.accessors[primitive.attributes.POSITION].count);
      }
    }
  });

  it('all three pagoda plaster detail levels have finite, nonconstant surface UVs', () => {
    const { asset, binary } = readAsset('props_japan.glb');
    const meshes = asset.meshes.filter((mesh) => /^pagoda(?:@[12])?__b_plaster$/.test(mesh.name ?? ''));
    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) for (const primitive of mesh.primitives) {
      const accessor = asset.accessors[primitive.attributes.TEXCOORD_0];
      const view = asset.bufferViews[accessor.bufferView!];
      expect(accessor.componentType).toBe(5126);
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (let i = 0; i < accessor.count; i++) {
        const u = binary.readFloatLE(offset + i * 8);
        const v = binary.readFloatLE(offset + i * 8 + 4);
        expect(Number.isFinite(u) && Number.isFinite(v)).toBe(true);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      expect(maxU - minU).toBeGreaterThan(1);
      expect(maxV - minV).toBeGreaterThan(1);
    }
  });
});
