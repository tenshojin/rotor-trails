// 只投影的合并网格：GLTFLoader 拆出来的一组子网格（单位变换）在阴影里合成一个；
// 镂空、透明、自己有变换、只有一个的都不合；合并网格进原网格所在的那几层阴影
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mergeShadowCasters, proxyLayers, SHADOW_PROXY_FAR, SHADOW_PROXY_NEAR } from '../src/render/shadowProxy';

function part(name: string, mat: THREE.Material, layers = 1 << 2, size = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
  m.name = name;
  m.castShadow = true;
  m.layers.mask = layers;
  return m;
}

describe('只投影的合并网格', () => {
  it('图层：原网格进哪几层阴影，合并网格就进哪几层', () => {
    expect(proxyLayers(1 << 2)).toBe(1 << SHADOW_PROXY_NEAR);
    // 还是默认图层：之后 markNearShadow 会加上图层 2，所以近处两层也要
    expect(proxyLayers(1)).toBe((1 << SHADOW_PROXY_NEAR) | (1 << SHADOW_PROXY_FAR));
    expect(proxyLayers(1 | (1 << 2))).toBe((1 << SHADOW_PROXY_NEAR) | (1 << SHADOW_PROXY_FAR));
    expect(proxyLayers(1 << 1)).toBe(1 << SHADOW_PROXY_FAR);
    expect(proxyLayers(1 << 3)).toBe(0);
  });

  it('一组子网格合成一个：顶点和索引都在，原网格不再投影，合并网格是组的子物体', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.name = 'cockpit_static';
    const parts = [part('cockpit_static_1', a), part('cockpit_static_2', b), part('cockpit_static_3', a)];
    group.add(...parts);
    const root = new THREE.Group().add(group);
    const out = mergeShadowCasters(root);
    expect(out.meshes).toHaveLength(1);
    const proxy = out.meshes[0];
    expect(proxy.parent).toBe(group);
    expect(proxy.name).toBe('cockpit_static_shadow');
    expect(proxy.castShadow).toBe(true);
    expect(proxy.receiveShadow).toBe(false);
    expect(proxy.layers.mask).toBe(1 << SHADOW_PROXY_NEAR);
    const box = parts[0].geometry;
    expect(proxy.geometry.getAttribute('position').count).toBe(box.getAttribute('position').count * 3);
    expect(proxy.geometry.index!.count).toBe(box.index!.count * 3);
    for (const p of parts) expect(p.castShadow).toBe(false);
    // 主相机看不到合并网格（图层 0～4）
    const cam = new THREE.PerspectiveCamera();
    for (let l = 0; l <= 4; l++) cam.layers.enable(l);
    expect(cam.layers.test(proxy.layers)).toBe(false);
  });

  it('镂空、透明、自己有变换的不合；同一组里能合的只剩一个也不合', () => {
    const solid = new THREE.MeshStandardMaterial();
    const cut = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const group = new THREE.Group();
    const moved = part('moved', solid);
    moved.position.set(0.1, 0, 0);
    const parts = [part('solid', solid), part('cut', cut), part('glass', glass), moved];
    group.add(...parts);
    const out = mergeShadowCasters(new THREE.Group().add(group));
    expect(out.meshes).toHaveLength(0);
    for (const p of parts) expect(p.castShadow).toBe(true);
  });

  it('正反面不同的分开合，材质按正反面共用', () => {
    const front = new THREE.MeshStandardMaterial();
    const both = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    const group = new THREE.Group();
    group.add(part('f1', front), part('f2', front), part('d1', both), part('d2', both));
    const out = mergeShadowCasters(new THREE.Group().add(group));
    expect(out.meshes).toHaveLength(2);
    expect(out.materials).toHaveLength(2);
    const sides = out.meshes.map((m) => (m.material as THREE.Material).side).sort();
    expect(sides).toEqual([THREE.FrontSide, THREE.DoubleSide].sort());
  });

  it('近处图层和默认图层的分开合', () => {
    const mat = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(part('n1', mat, 1 << 2), part('n2', mat, 1 << 2), part('e1', mat, 1), part('e2', mat, 1));
    const out = mergeShadowCasters(new THREE.Group().add(group));
    expect(out.meshes.map((m) => m.layers.mask).sort()).toEqual([1 << SHADOW_PROXY_NEAR, (1 << SHADOW_PROXY_NEAR) | (1 << SHADOW_PROXY_FAR)].sort());
  });

  it('合并后的顶点位置就是原来的位置', () => {
    const mat = new THREE.MeshStandardMaterial();
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute([5, 5, 5, 6, 5, 5, 5, 6, 5], 3));
    g2.setIndex([0, 2, 1]);
    const m1 = new THREE.Mesh(g1, mat);
    const m2 = new THREE.Mesh(g2, mat);
    for (const m of [m1, m2]) {
      m.castShadow = true;
      m.layers.mask = 1 << 2;
    }
    const group = new THREE.Group().add(m1, m2);
    const out = mergeShadowCasters(new THREE.Group().add(group));
    const geo = out.geometries[0];
    expect(Array.from(geo.getAttribute('position').array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 5, 6, 5]);
    expect(Array.from(geo.index!.array)).toEqual([0, 1, 2, 3, 5, 4]);
  });
});
