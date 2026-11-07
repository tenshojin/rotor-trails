// 天上的鸟：不钻地、躲直升机、夜里收起来、资源还回去
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { Birds } from '../src/render/birds';

const flat = (): number => 100;
const hill = (x: number): number => (x > 0 ? 400 : 100);

function positions(b: Birds): THREE.Vector3[] {
  const mesh = b.group.children[0] as THREE.InstancedMesh;
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

describe('天上的鸟', () => {
  it('只数得对，都在地面以上', () => {
    const b = new Birds({ condor: 4, gull: 6 }, [[0, 0]], flat, 3);
    const p = positions(b);
    expect(p.length).toBe(10);
    for (const q of p) expect(q.y).toBeGreaterThan(110);
  });

  it('盘旋的圈跨过山脊，也飞在山脊上面', () => {
    const b = new Birds({ raven: 30 }, [[0, 0]], hill, 5);
    for (const q of positions(b)) expect(q.y).toBeGreaterThan(hill(q.x));
  });

  it('同样的种子，鸟在同样的地方', () => {
    const a = positions(new Birds({ kite: 5 }, [[10, 20]], flat, 9));
    const b = positions(new Birds({ kite: 5 }, [[10, 20]], flat, 9));
    a.forEach((q, i) => expect(q.distanceTo(b[i])).toBeLessThan(1e-6));
  });

  it('过一会儿真的在动', () => {
    const b = new Birds({ gull: 3 }, [[0, 0]], flat, 1);
    const a = positions(b);
    for (let t = 0; t < 2; t += 0.1) b.update(0.1, t, null, true);
    positions(b).forEach((q, i) => expect(q.distanceTo(a[i])).toBeGreaterThan(5));
  });

  it('直升机靠近就让开', () => {
    const b = new Birds({ gull: 1 }, [[0, 0]], flat, 2);
    const heli = positions(b)[0].clone();
    let t = 0;
    for (; t < 6; t += 0.05) b.update(0.05, t, heli, true);
    expect(positions(b)[0].distanceTo(heli)).toBeGreaterThan(40);
  });

  it('暂停的时候定住；夜里收起来', () => {
    const b = new Birds({ gull: 2 }, [[0, 0]], flat, 4);
    const a = positions(b);
    b.update(0, 5, null, true);
    positions(b).forEach((q, i) => expect(q.distanceTo(a[i])).toBe(0));
    b.update(0.1, 5, null, false);
    expect(b.group.visible).toBe(false);
  });

  it('没有鸟的图也不出错；用完把显卡资源还回去', () => {
    const none = new Birds({}, [[0, 0]], flat, 1);
    none.update(0.1, 1, null, true);
    expect(none.group.visible).toBe(false);
    const b = new Birds({ gull: 1 }, [[0, 0]], flat, 1);
    const mesh = b.group.children[0] as THREE.InstancedMesh;
    const geo = vi.spyOn(mesh.geometry, 'dispose');
    const mat = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    b.dispose();
    expect(geo).toHaveBeenCalled();
    expect(mat).toHaveBeenCalled();
  });
});
