// 静态模型合批：同一种材质的子网格不管属于哪个模型都进同一批；三级细节按距离切换（10% 滞后）；
// 投影和阴影图层的规则与以前按模型分开画时一样
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { PropBatches } from '../src/render/modelLib';
import type { ModelInstance } from '../src/world/propBuilder';

function model(name: string, parts: Array<[string, THREE.Material]>): THREE.Object3D {
  const root = new THREE.Group();
  root.name = name;
  parts.forEach(([part, mat], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 3 + i, 2), mat);
    m.name = `${name}__${part}`;
    m.position.set(i, 1.5, 0);
    root.add(m);
  });
  root.updateMatrixWorld(true);
  return root;
}

function fixture() {
  const plaster = new THREE.MeshStandardMaterial({ name: 'b_plaster' });
  const gravel = new THREE.MeshStandardMaterial({ name: 'b_gravel' });
  const templates = new Map<string, THREE.Object3D>();
  // 三级细节的民居：墙（灰泥，近景、中景投影）+ 碎石地面（不投影）
  for (const n of ['house', 'house@1', 'house@2']) templates.set(n, model(n, [['b_plaster', plaster], ['b_gravel', gravel]]));
  // 没有细节分级的车：同一种灰泥材质
  templates.set('car', model('car', [['b_plaster', plaster]]));
  const at = (name: string, x: number): ModelInstance => ({ name, pos: [x, 0, 0], rotY: 0, scale: [1, 1, 1] });
  const byName = new Map<string, ModelInstance[]>([
    ['house', [at('house', 50), at('house', 200), at('house', 1000)]],
    ['car', [at('car', 30), at('car', 3000)]],
  ]);
  const batches = new PropBatches(templates, byName, [110, 420]);
  return { batches, plaster, gravel };
}

function visibleCount(bm: THREE.BatchedMesh): number {
  let n = 0;
  for (let i = 0; i < bm.instanceCount; i++) if (bm.getVisibleAt(i)) n++;
  return n;
}

const find = (b: PropBatches, mat: THREE.Material, cast: boolean, far: boolean) =>
  b.meshes.find((m) => m.material === mat && m.castShadow === cast && (m.layers.mask === 2) === far);

describe('静态模型合批', () => {
  it('同一种材质、同样的投影和阴影图层合成一批，不分模型', () => {
    const { batches, plaster, gravel } = fixture();
    // 灰泥：近景投影（民居近景 + 车）、中景投影、远景不投影；碎石：近景、中景远景都不投影
    expect(batches.meshes).toHaveLength(5);
    const near = find(batches, plaster, true, false)!;
    expect(near).toBeDefined();
    // 3 栋民居的近景墙 + 2 辆车
    expect(near.instanceCount).toBe(5);
    expect(find(batches, gravel, false, false)).toBeDefined();
    expect(find(batches, plaster, true, true)).toBeDefined();
    expect(find(batches, plaster, false, true)).toBeDefined();
    expect(find(batches, gravel, false, true)!.instanceCount).toBe(6);
    for (const m of batches.meshes) {
      expect(m.perObjectFrustumCulled).toBe(false);
      expect(m.sortObjects).toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
    batches.dispose();
  });

  it('按距离只显示一级细节；没有细节分级的模型一直可见', () => {
    const { batches, plaster, gravel } = fixture();
    // 还没更新时只有车可见
    expect(visibleCount(find(batches, plaster, true, false)!)).toBe(2);
    batches.update(new THREE.Vector3(0, 0, 0));
    // 50 m 近景、200 m 中景、1000 m 远景；两辆车（30 m、3000 m）都是唯一一级
    expect(batches.levelCounts()).toEqual([3, 1, 1]);
    expect(visibleCount(find(batches, plaster, true, false)!)).toBe(3);
    expect(visibleCount(find(batches, gravel, false, false)!)).toBe(1);
    expect(visibleCount(find(batches, plaster, true, true)!)).toBe(1);
    expect(visibleCount(find(batches, plaster, false, true)!)).toBe(1);
    // 碎石的中景和远景在同一批里：各一个
    expect(visibleCount(find(batches, gravel, false, true)!)).toBe(2);
    // 画质系数越大越晚换级：系数 2.5 时近景到 275 m，200 m 的那栋回到近景；1000 m 的离新阈值 1050 m 不到一成，保持远景
    batches.update(new THREE.Vector3(0, 0, 0), 2.5);
    expect(batches.levelCounts()).toEqual([4, 0, 1]);
    batches.dispose();
  });

  it('切换带 10% 滞后，跨过以后才换级', () => {
    const { batches } = fixture();
    batches.update(new THREE.Vector3(0, 0, 0));
    // 第一栋离相机 50 m → 115 m：还在 110 m 的 10% 以内，保持近景
    batches.update(new THREE.Vector3(-65, 0, 0));
    expect(batches.levelCounts()[0]).toBe(3);
    // 125 m：换到中景
    batches.update(new THREE.Vector3(-75, 0, 0));
    expect(batches.levelCounts()).toEqual([2, 2, 1]);
    batches.dispose();
  });

  it('中景、远景只进外面两层阴影（图层 1），近景用默认图层', () => {
    const { batches } = fixture();
    const far = batches.meshes.filter((m) => m.layers.mask === 2);
    const near = batches.meshes.filter((m) => m.layers.mask === 1);
    expect(far).toHaveLength(3);
    expect(near).toHaveLength(2);
    batches.dispose();
  });

  it('释放时只释放合批自己的顶点缓冲，不碰模型库的材质', () => {
    const { batches, plaster } = fixture();
    const geos = batches.meshes.map((m) => m.geometry);
    let geoDisposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => geoDisposed++);
    let matDisposed = 0;
    plaster.addEventListener('dispose', () => matDisposed++);
    batches.dispose();
    expect(geoDisposed).toBe(5);
    expect(matDisposed).toBe(0);
    expect(batches.meshes).toHaveLength(0);
  });
});
