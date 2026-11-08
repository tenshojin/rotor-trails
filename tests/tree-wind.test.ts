// 树的风参数：相对高度、枝的相位、离树干多远、树高。三级细节用同一套（换级时摆法接得上），相位在绕树干一圈的接缝处连续。
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { addWindAttributes } from '../src/render/treeView';

function geo(pts: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  return g;
}

describe('树的风参数', () => {
  it('相对高度 0..1、树高取最细一级的最高点，三级细节同一个树高', () => {
    const lod0 = geo([[0, 0, 0], [0, 12, 0], [3, 8, 0], [-4, 9, 1]]);
    const lod1 = geo([[0, 0, 0], [0, 11.5, 0], [2, 7, 2]]);
    addWindAttributes([[lod0], [lod1]]);
    const a0 = lod0.getAttribute('aWind');
    const a1 = lod1.getAttribute('aWind');
    expect(a0.getX(0)).toBe(0);
    expect(a0.getX(1)).toBe(1);
    for (const a of [a0, a1])
      for (let i = 0; i < a.count; i++) {
        expect(a.getX(i)).toBeGreaterThanOrEqual(0);
        expect(a.getX(i)).toBeLessThanOrEqual(1);
        expect(a.getZ(i)).toBeGreaterThanOrEqual(0);
        expect(a.getZ(i)).toBeLessThanOrEqual(1);
        expect(a.getW(i)).toBe(12);
      }
    // 树干上（离轴 0）不跟着枝条摆，树冠最外面是 1
    expect(a0.getZ(1)).toBe(0);
    expect(a0.getZ(3)).toBeCloseTo(1, 5);
  });

  it('枝的相位绕树干一圈接得上（一张叶卡跨过接缝不会被扯开）', () => {
    const g = geo([[0, 10, 0], [-3, 6, 0.001], [-3, 6, -0.001]]);
    addWindAttributes([[g]]);
    const a = g.getAttribute('aWind');
    expect(Math.sin(a.getY(1))).toBeCloseTo(Math.sin(a.getY(2)), 2);
    expect(Math.cos(a.getY(1))).toBeCloseTo(Math.cos(a.getY(2)), 2);
  });

  it('已经算过的不再算（几张地图共用同一份模型）', () => {
    const g = geo([[0, 0, 0], [0, 5, 0]]);
    addWindAttributes([[g]]);
    const first = g.getAttribute('aWind');
    addWindAttributes([[g]]);
    expect(g.getAttribute('aWind')).toBe(first);
  });
});
