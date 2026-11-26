import { describe, expect, it } from 'vitest';
import { compareUniforms, sortSharedGroup, stableUniformOrder } from '../src/render/stableShaders';

// 一个共用参数组里的成员：three.js 的 NodeUniform 包着节点，节点有编号（按创建先后发）和可选的名字
const u = (id: number, name = '') => ({ nodeUniform: { node: { id, name } } });
const names = (list: Array<ReturnType<typeof u>>) => list.map((x) => x.nodeUniform.node.name || `#${x.nodeUniform.node.id}`);

describe('共用参数组的成员顺序（着色器代码每次一字不差）', () => {
  it('有名字的在前、按名字排；没名字的在后、按编号排', () => {
    const list = [u(90), u(7, 'cameraWorldMatrix'), u(12), u(3, 'cameraViewMatrix'), u(40, 'shadowFar'), u(5)];
    list.sort(compareUniforms);
    expect(names(list)).toEqual(['cameraViewMatrix', 'cameraWorldMatrix', 'shadowFar', '#5', '#12', '#90']);
  });

  it('摄像机矩阵哪次先建（编号大小）都排在同一个位置', () => {
    // 两次加载：摄像机矩阵一次比阴影的参数先建，一次后建（编号一小一大），排出来一样
    const first = [u(36), u(49), u(2, 'cameraWorldMatrix'), u(61)];
    const second = [u(36), u(49), u(70, 'cameraWorldMatrix'), u(61)];
    first.sort(compareUniforms);
    second.sort(compareUniforms);
    expect(names(first)).toEqual(names(second));
  });

  it('只排参数块，贴图这些单独的绑定不动', () => {
    const block = { isNodeUniformsGroup: true, uniforms: [u(9), u(1, 'b'), u(4, 'a')] };
    const texture = { isNodeUniformsGroup: false, uniforms: [u(9), u(1, 'b')] };
    sortSharedGroup({ bindings: [texture, block] });
    expect(names(block.uniforms)).toEqual(['a', 'b', '#9']);
    expect(names(texture.uniforms)).toEqual(['#9', 'b']);
  });

  it('装到渲染器上：新建的组、缓存里拿出来的组都排好，装两次也只套一层', () => {
    const cached = { bindings: [{ isNodeUniformsGroup: true, uniforms: [u(8), u(2, 'z')] }] };
    let calls = 0;
    const bindings = {
      // three.js 原来的做法：按编号排、查缓存；这里第二次起返回缓存里的那组
      getSharedBindGroup(group: { bindings: Array<{ uniforms: Array<ReturnType<typeof u>> }> }) {
        calls++;
        for (const b of group.bindings) b.uniforms.sort((a, c) => a.nodeUniform.node.id - c.nodeUniform.node.id);
        return calls === 1 ? group : cached;
      },
    };
    const renderer = { _bindings: bindings };
    expect(stableUniformOrder(renderer)).toBe(true);
    expect(stableUniformOrder(renderer)).toBe(true);
    const fresh = { bindings: [{ isNodeUniformsGroup: true, uniforms: [u(30), u(20, 'cameraPosition'), u(10)] }] };
    expect(bindings.getSharedBindGroup(fresh)).toBe(fresh);
    expect(names(fresh.bindings[0].uniforms)).toEqual(['cameraPosition', '#10', '#30']);
    const another = { bindings: [{ isNodeUniformsGroup: true, uniforms: [u(8), u(2, 'z')] }] };
    expect(bindings.getSharedBindGroup(another)).toBe(cached);
    expect(names(cached.bindings[0].uniforms)).toEqual(['z', '#8']);
    expect(names(another.bindings[0].uniforms)).toEqual(['z', '#8']);
    expect(calls).toBe(2);
  });

  it('不是 three.js 的渲染器（单元测试里的替身）就不装', () => {
    expect(stableUniformOrder({})).toBe(false);
    expect(stableUniformOrder({ _bindings: {} })).toBe(false);
  });
});
