// 地形块合批：三批（近景 LOD0 / 中景 LOD1 / 远景 LOD2、3），每块地形任何时候只在一批里有一个可见实例；
// 换级时写进新一批的空槽位、旧的槽位放回去；三批各自的投影和阴影图层与以前按块设置时一样
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { TerrainView, type TerrainUniforms } from '../src/render/terrainView';
import { TRAINING } from '../src/maps/training';
import { Heightfield } from '../src/sim/terrain';
import { TERRAIN_SHADOW_LAYER } from '../src/render/sunShadows';

function uniforms(): TerrainUniforms {
  const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const color = new THREE.Color(0.2, 0.3, 0.1);
  return {
    noise: tex, surface: tex, forest: tex, wash: null, macro: tex, relief: tex, layers: null, mapSize: 1024,
    sand: color, grass: color, grass2: color, dirt: color, rock: color, rock2: color, snow: color, forestFloor: color,
    forestFar: 0, strataA: color, strataB: color, strataC: color, strataD: color, strata: 0, paved: false,
    fringe: 0,
    beachTop: 2, snowLine: 4000, rockSlope: 0.4, waterLevel: 0, grassy: 1, uWet: uniform(0), rockForm: null, strataLUT: null,
  };
}

/** 4 × 4 块、每格 4 m（一块 256 m）的地图 */
function fixture() {
  const res = 4 * 64 + 1;
  const h = new Float32Array(res * res);
  for (let i = 0; i < h.length; i++) h[i] = 10 + 5 * Math.sin(i * 0.013);
  const hf = new Heightfield(1024, res, h);
  const terrain = new TerrainView({ ...TRAINING, size: 1024, farExtent: 1, farTerrain: undefined }, hf, uniforms());
  const batches = terrain.group.children.filter((o) => (o as THREE.BatchedMesh).isBatchedMesh) as THREE.BatchedMesh[];
  const visible = (b: THREE.BatchedMesh) => {
    let n = 0;
    for (let i = 0; i < b.instanceCount; i++) if (b.getVisibleAt(i)) n++;
    return n;
  };
  const settle = (cam: THREE.Vector3) => {
    // 每帧最多新建三块几何：多走几帧
    for (let k = 0; k < 20; k++) terrain.update(cam);
  };
  return { terrain, batches, visible, settle };
}

describe('地形块合批', () => {
  it('三批：近景投影进最近两层和第三层阴影，中景只进第三层，远景不投影', () => {
    const { terrain, batches } = fixture();
    expect(batches).toHaveLength(3);
    const [b0, b1, b2] = batches;
    expect(b0.castShadow).toBe(true);
    expect(b0.layers.mask).toBe((1 << 2) | (1 << TERRAIN_SHADOW_LAYER));
    expect(b1.castShadow).toBe(true);
    expect(b1.layers.mask).toBe(1 << TERRAIN_SHADOW_LAYER);
    expect(b2.castShadow).toBe(false);
    expect(b2.layers.mask).toBe(1 << 1);
    for (const b of batches) {
      expect(b.perObjectFrustumCulled).toBe(true);
      expect(b.receiveShadow).toBe(true);
      expect(b.material).toBe(terrain.material);
    }
    terrain.dispose();
  });

  it('一开始全在远景批；镜头靠近换到近景，走远了槽位放回去，每块只有一个可见实例', () => {
    const { terrain, batches, visible, settle } = fixture();
    const [b0, b1, b2] = batches;
    expect(visible(b2)).toBe(16);
    expect(visible(b0) + visible(b1)).toBe(0);
    // 镜头在地图中间、贴着地面：整张图 1 km 见方，都在 360 m × 细节系数以内
    terrain.lodScale = 2.6;
    settle(new THREE.Vector3(0, 20, 0));
    expect(visible(b0)).toBe(16);
    expect(visible(b1) + visible(b2)).toBe(0);
    // 镜头移到 4 km 外：近的几块中景，远的远景
    terrain.lodScale = 1;
    settle(new THREE.Vector3(4000, 20, 0));
    expect(visible(b0)).toBe(0);
    expect(visible(b0) + visible(b1) + visible(b2)).toBe(16);
    expect(visible(b2)).toBeGreaterThan(0);
    terrain.dispose();
  });

  it('释放时三批各自的顶点缓冲都释放', () => {
    const { terrain, batches } = fixture();
    const geos = batches.map((b) => b.geometry);
    let n = 0;
    for (const g of geos) g.addEventListener('dispose', () => n++);
    terrain.dispose();
    expect(n).toBe(3);
  });
});
