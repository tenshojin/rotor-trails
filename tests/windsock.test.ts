// 风向袋：软布按风速鼓起来，没风耷拉；五节颜色分明（不能在节与节之间糊成渐变）。
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { inflated, SOCK, SOCK_FULL, Windsock, windsockHardware } from '../src/render/windsock';

const cloth = new THREE.MeshStandardMaterial();
const hw = new THREE.MeshStandardMaterial();
const hwGeo = windsockHardware();

describe('风向袋', () => {
  it('没风时尾巴垂下去，15 节以上吹平', () => {
    const ws = new Windsock(cloth, hw, hwGeo);
    ws.shape(0, 0, 0);
    const [, calmY] = ws.tip();
    expect(calmY).toBeLessThan(-1.5);
    ws.shape(10, 0, 0);
    const [x, y] = ws.tip();
    expect(Math.abs(y)).toBeLessThan(0.3);
    expect(x).toBeGreaterThan(SOCK.ARM + SOCK.L * 0.95);
    ws.dispose();
  });

  it('风越大鼓起来的越多，尾巴越高', () => {
    const ws = new Windsock(cloth, hw, hwGeo);
    let last = -Infinity;
    for (const v of [0, 1.5, 3, 4.5, 6, SOCK_FULL]) {
      ws.shape(v, 0, 0);
      const [, y] = ws.tip();
      expect(y).toBeGreaterThan(last);
      last = y;
    }
    expect(inflated(0)).toBeGreaterThan(0);
    expect(inflated(SOCK_FULL)).toBe(1);
    ws.dispose();
  });

  it('五节颜色分明，形状里没有坏数', () => {
    const ws = new Windsock(cloth, hw, hwGeo);
    ws.shape(5, 3.7, 1.2);
    const g = ws.cloth.geometry;
    const col = g.getAttribute('color');
    const per = SOCK.PER * SOCK.RAD;
    const bands: string[] = [];
    for (let k = 0; k < SOCK.BANDS; k++) {
      const seen = new Set<string>();
      for (let i = k * per; i < (k + 1) * per; i++) seen.add([col.getX(i), col.getY(i), col.getZ(i)].map((c) => c.toFixed(3)).join());
      expect(seen.size).toBe(1);
      bands.push([...seen][0]);
    }
    for (let k = 1; k < SOCK.BANDS; k++) expect(bands[k]).not.toBe(bands[k - 1]);
    // 喉口那一节是橙色（红色分量大、蓝色分量小）
    expect(col.getX(0)).toBeGreaterThan(col.getZ(0) * 5);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 4);
    }
    ws.dispose();
  });
});
