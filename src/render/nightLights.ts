// 夜里地面上的灯：路灯、高杆灯、停机坪边灯。灯头是一个朝着镜头的光点，地上是一圈暖色的光斑。
// 真的点光源太贵（上百盏），这里全是加法混合的面片，两次绘制画完，白天整组隐藏。

import * as THREE from 'three/webgpu';
import { attribute, cameraProjectionMatrix, cameraViewMatrix, float, length, positionGeometry, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { WorldData } from '../world/worldgen';
import { padLightOffsets, padWorld } from '../maps/padLayout';

interface Lamp {
  /** 灯头位置 */
  pos: [number, number, number];
  /** 光点的大小（米）与颜色 */
  size: number;
  color: [number, number, number];
  /** 地面光斑的半径（0 = 没有） */
  pool: number;
}

const WARM: [number, number, number] = [1, 0.78, 0.5];
const COOL: [number, number, number] = [0.86, 0.92, 1];
const PAD: [number, number, number] = [0.5, 1, 0.68];

function gather(world: WorldData): Lamp[] {
  const out: Lamp[] = [];
  for (const m of world.builder.models) {
    const c = Math.cos(m.rotY);
    const s = Math.sin(m.rotY);
    if (m.name === 'street_lamp') {
      const x = m.pos[0] + 1.6 * c;
      const z = m.pos[2] - 1.6 * s;
      out.push({ pos: [x, m.pos[1] + 9.4, z], size: 2.4, color: WARM, pool: 13 });
    } else if (m.name === 'light_mast') {
      out.push({ pos: [m.pos[0], m.pos[1] + 24.3, m.pos[2]], size: 5, color: COOL, pool: 46 });
    } else if (m.name === 'denchu_b') {
      out.push({ pos: [m.pos[0], m.pos[1] + 6.4, m.pos[2]], size: 1.6, color: WARM, pool: 8 });
    }
  }
  for (const l of world.map.lights ?? []) out.push({ ...l, pool: 0 });
  // 停机坪四周一圈边灯
  for (const p of world.map.pads) {
    for (const [x, z] of padLightOffsets(p.size)) out.push({ pos: padWorld(p, x, 0.15, z), size: 0.55, color: PAD, pool: 0 });
  }
  return out;
}

export class NightLights {
  readonly group = new THREE.Group();
  private readonly strength = uniform(0);
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];

  constructor(world: WorldData) {
    const lamps = gather(world);
    if (lamps.length === 0) return;
    const T = world.terrain;
    const wl = world.map.waterLevel ?? -Infinity;
    // 灯头
    {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(lamps.flatMap((l) => l.pos)), 3));
      g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(lamps.map((l) => l.size)), 1));
      g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(lamps.flatMap((l) => l.color)), 3));
      g.instanceCount = lamps.length;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const aPos = attribute<'vec3'>('aPos', 'vec3');
      const aSize = attribute<'float'>('aSize', 'float');
      const aCol = attribute<'vec3'>('aCol', 'vec3');
      const view = cameraViewMatrix.mul(vec4(aPos, 1.0));
      // 越远光点在画面上不要缩得太小：远处的灯是一个亮点，不是看不见
      const dist = view.z.negate().max(1.0);
      const size = aSize.mul(dist.mul(0.0016).add(1.0));
      m.vertexNode = cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(positionGeometry.xy.mul(size), 0.0)), 1.0));
      const r = length(uv().sub(0.5)).mul(2.0);
      const core = float(1).sub(smoothstep(0.0, 0.16, r)).mul(2.6);
      const halo = float(1).sub(smoothstep(0.0, 1.0, r));
      m.colorNode = vec4(aCol.mul(core.add(halo.mul(halo).mul(halo).mul(0.22))).mul(this.strength), 1.0);
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.group.add(mesh);
      this.mats.push(m);
      this.geos.push(g);
    }
    // 地上的光斑
    const pools = lamps.filter((l) => l.pool > 0);
    if (pools.length) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const at = pools.map((l) => [l.pos[0], Math.max(T.heightAt(l.pos[0], l.pos[2]), wl) + 0.12, l.pos[2]]);
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(at.flat()), 3));
      g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(pools.map((l) => l.pool)), 1));
      g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(pools.flatMap((l) => l.color)), 3));
      g.instanceCount = pools.length;
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const aPos = attribute<'vec3'>('aPos', 'vec3');
      const aSize = attribute<'float'>('aSize', 'float');
      const aCol = attribute<'vec3'>('aCol', 'vec3');
      const world0 = aPos.add(vec3(positionGeometry.x.mul(aSize), 0.0, positionGeometry.z.mul(aSize)));
      m.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world0, 1.0)));
      const r = length(uv().sub(vec2(0.5))).mul(2.0);
      const k = float(1).sub(smoothstep(0.0, 1.0, r));
      m.colorNode = vec4(aCol.mul(k.mul(k).mul(0.026)).mul(this.strength), 1.0);
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.mats.push(m);
      this.geos.push(g);
    }
    this.group.visible = false;
  }

  /** k：0 = 关（白天），1 = 全开 */
  update(k: number): void {
    this.strength.value = k;
    this.group.visible = k > 0.01;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}
