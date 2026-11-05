// Repair the three existing pagoda plaster batches without recompressing any
// geometry or image. Future full builds use the corrected jlandmarks.ob3 helper.
// node tools/fix_pagoda_uv.mjs public/models/props_japan.glb tmp/props_japan_uv.glb
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/fix_pagoda_uv.mjs input.glb output.glb');
const file = fs.readFileSync(input);
if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2) throw new Error('Expected a GLB 2.0 asset');
const jsonLength = file.readUInt32LE(12);
const data = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
const binHeader = 20 + jsonLength;
if (file.readUInt32LE(binHeader + 4) !== 0x004e4942 || data.buffers.length !== 1) throw new Error('Expected one embedded binary buffer');
const binary = file.subarray(binHeader + 8, binHeader + 8 + file.readUInt32LE(binHeader));
const decoderPath = path.resolve('public/draco/draco_wasm_wrapper.js');
const factory = new Function('module', 'exports', 'require', '__dirname', `${fs.readFileSync(decoderPath, 'utf8')}\nreturn DracoDecoderModule;`);
const module = { exports: {} };
const draco = await factory(module, module.exports, createRequire(import.meta.url), path.dirname(decoderPath))({ wasmBinary: fs.readFileSync('public/draco/draco_decoder.wasm') });
const parts = [binary];
let byteLength = binary.length;
const repaired = [];

function readAttribute(decoder, mesh, id, components) {
  const attribute = decoder.GetAttributeByUniqueId(mesh, id);
  const values = new draco.DracoFloat32Array();
  try {
    if (!decoder.GetAttributeFloatForAllPoints(mesh, attribute, values)) throw new Error('Failed to decode vertex attribute');
    return Float32Array.from({ length: mesh.num_points() * components }, (_, i) => values.GetValue(i));
  } finally {
    draco.destroy(values);
  }
}

function fixTextureChannels(value) {
  for (const [key, item] of Object.entries(value ?? {})) {
    if (!item || typeof item !== 'object') continue;
    if (key.endsWith('Texture') && item.texCoord === -1) item.texCoord = 0;
    fixTextureChannels(item);
  }
}

for (const meshDef of data.meshes) {
  if (!/^pagoda(?:@[12])?__b_plaster$/.test(meshDef.name)) continue;
  for (const primitive of meshDef.primitives) {
    if (primitive.attributes.TEXCOORD_0 !== undefined) continue;
    const compressed = primitive.extensions?.KHR_draco_mesh_compression;
    if (!compressed) throw new Error('Expected the original Draco-compressed pagoda');
    const view = data.bufferViews[compressed.bufferView];
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const decoder = new draco.Decoder();
    const buffer = new draco.DecoderBuffer();
    const mesh = new draco.Mesh();
    try {
      buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
      const status = decoder.DecodeBufferToMesh(buffer, mesh);
      if (!status.ok()) throw new Error(status.error_msg());
      const positions = readAttribute(decoder, mesh, compressed.attributes.POSITION, 3);
      const normals = readAttribute(decoder, mesh, compressed.attributes.NORMAL, 3);
      const coords = new Float32Array(mesh.num_points() * 2);
      for (let i = 0; i < mesh.num_points(); i++) {
        const j = i * 3;
        // glTF is Y-up; bkit.uv_box works in Blender Z-up coordinates.
        const p = [positions[j], -positions[j + 2], positions[j + 1]];
        const n = [Math.abs(normals[j]), Math.abs(normals[j + 2]), Math.abs(normals[j + 1])];
        const axis = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
        const u = axis === 0 ? p[1] : p[0];
        const v = axis === 2 ? p[1] : p[2];
        coords[i * 2] = u / 1.5;
        coords[i * 2 + 1] = 1 - v / 1.5; // Blender's exporter flips V for glTF.
      }
      const uvBytes = Buffer.from(coords.buffer);
      const bufferView = data.bufferViews.length;
      data.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: uvBytes.length, target: 34962 });
      primitive.attributes.TEXCOORD_0 = data.accessors.length;
      data.accessors.push({ bufferView, componentType: 5126, count: mesh.num_points(), type: 'VEC2' });
      // Draco permits additional uncompressed attributes: the loader combines
      // this new UV accessor with the original decoded positions and normals.
      parts.push(uvBytes);
      byteLength += uvBytes.length;
      fixTextureChannels(data.materials[primitive.material]);
      repaired.push({ mesh: meshDef.name, vertices: mesh.num_points() });
    } finally {
      draco.destroy(mesh);
      draco.destroy(buffer);
      draco.destroy(decoder);
    }
  }
}
if (repaired.length !== 3) throw new Error(`Expected exactly three missing-UV meshes, found ${repaired.length}; input left unchanged`);
data.buffers[0].byteLength = byteLength;
let json = Buffer.from(JSON.stringify(data));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(parts);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const newBinHeader = Buffer.alloc(8);
newBinHeader.writeUInt32LE(bin.length, 0);
newBinHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jsonHeader, json, newBinHeader, bin]));
console.log(JSON.stringify({ output, repaired, originalBinaryBytesPreserved: binary.length, addedUvBytes: bin.length - binary.length }, null, 2));
