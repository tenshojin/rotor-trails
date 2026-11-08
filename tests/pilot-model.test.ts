// 飞行员模型（tools/blender/pilot_sdf.py + pilot_gear.py + pilot.py 导出）：游戏里 pilot.ts 依赖的约定
//   1. 骨头名字：手臂反向动力学、手指姿势、探身和转头都按名字找骨头
//   2. 头上的零件材质名以 plh_ 开头：第一人称时摄像机在头里面，pilot.ts 按这个前缀把它们藏起来
//   3. 第一人称看得到的零件（手套、袖子、腿、护膝板、背心的扣子）绝不能用 plh_ 材质，否则会跟着头一起消失
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Gltf {
  nodes: Array<{ name?: string; mesh?: number }>;
  meshes: Array<{ name?: string; primitives: Array<{ material?: number }> }>;
  materials: Array<{ name?: string }>;
  skins?: Array<{ joints: number[] }>;
}

const FILE = path.join(process.cwd(), 'public/models/pilot.glb');
const bytes = fs.readFileSync(FILE);
const gltf: Gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));

function materialsOf(nodeName: string): string[] {
  const n = gltf.nodes.find((x) => x.name === nodeName);
  if (!n || n.mesh === undefined) return [];
  return gltf.meshes[n.mesh].primitives.map((p) => gltf.materials[p.material ?? -1]?.name ?? '');
}

describe('飞行员模型', () => {
  it('pilot.ts 要用的骨头都在，包括新加的头', () => {
    const joints = new Set((gltf.skins ?? []).flatMap((s) => s.joints.map((j) => gltf.nodes[j].name)));
    const need = ['pelvis', 'spine', 'head'];
    for (const s of ['R', 'L']) {
      need.push(`upper_${s}`, `fore_${s}`, `hand_${s}`, `thigh_${s}`, `shin_${s}`, `foot_${s}`);
      for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (const i of [1, 2, 3]) need.push(`${f}${i}_${s}`);
    }
    for (const n of need) expect(joints.has(n), n).toBe(true);
  });

  it('头盔、面罩、脸都用 plh_ 材质；第一人称看得到的零件一个都不用', () => {
    const names = gltf.nodes.map((n) => n.name ?? '').filter((n) => n && materialsOf(n).length);
    const head = names.filter((n) => n.startsWith('helmet') || n === 'head');
    expect(head.length).toBeGreaterThan(10);
    for (const n of head) for (const m of materialsOf(n)) expect(m.startsWith('plh_'), `${n}: ${m}`).toBe(true);
    const body = names.filter((n) => /^(hand|arm|torso|leg|boot|knee|vest|belt|sh_|lap_|watch|buckle|adj_)/.test(n));
    expect(body.length).toBeGreaterThan(15);
    for (const n of body) for (const m of materialsOf(n)) expect(m.startsWith('plh_'), `${n}: ${m}`).toBe(false);
    const mats = new Set(gltf.materials.map((m) => m.name));
    for (const m of ['plh_shell', 'plh_visor', 'plh_skin', 'pl_suit', 'pl_glove', 'pl_vest', 'pl_paper']) expect(mats.has(m), m).toBe(true);
  });

  it('文件不超过 5 MB（只有一个，但第一次进图就要下载）', () => {
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  });
});
