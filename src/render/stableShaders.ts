// 让同一个材质每次生成的着色器代码一字不差。
// 浏览器把编好的着色器存起来，下次按代码原文找：代码一样就直接拿来用，差一个字就得从头编。
//
// 为什么会不一样：几个材质共用的那块参数（three.js 的 render 组：摄像机矩阵、各层阴影的矩阵……）里，
// 成员按节点的编号排（Bindings.getSharedBindGroup）。编号是按节点创建的先后发的，而摄像机矩阵这些是第一次用到时才建，
// 谁先建要看这次加载里哪个材质先编、模型先下载完哪个。实测 WebGL2 进日本地图的 119 条着色器里有 59 条每次都不一样：
// 刷新、再进同一张图，还是要把它们从头编一遍（四十来秒）。
//
// 这里在 three.js 排完以后再排一次：有名字的（cameraWorldMatrix 这种）按名字、放前面，没名字的照旧按编号。
// 排序只看节点本身，几个材质共用的同一组参数排出来一样，共用的那份缓冲区和各自的代码对得上；
// 内存布局（UniformsGroup.byteLength）每次都按当时的顺序重算，在生成代码、建缓冲区之前排好就不影响画面。

interface UniformLike {
  nodeUniform?: { node?: { id?: number; name?: string } | null } | null;
}

interface BindingLike {
  isNodeUniformsGroup?: boolean;
  uniforms?: UniformLike[];
}

interface BindGroupLike {
  bindings?: BindingLike[];
}

type GetShared = (this: unknown, group: BindGroupLike, ...rest: unknown[]) => BindGroupLike;

const PATCHED = Symbol('stableUniformOrder');

const nameOf = (u: UniformLike): string => {
  const n = u.nodeUniform?.node?.name;
  return typeof n === 'string' ? n : '';
};
const idOf = (u: UniformLike): number => u.nodeUniform?.node?.id ?? 0;

/** 有名字的在前、按名字（不看语言环境）；没名字的在后、按编号；同名的也按编号 */
export function compareUniforms(a: UniformLike, b: UniformLike): number {
  const na = nameOf(a);
  const nb = nameOf(b);
  if (!na !== !nb) return na ? -1 : 1;
  if (na !== nb) return na < nb ? -1 : 1;
  return idOf(a) - idOf(b);
}

/** 一个绑定组里每块参数的成员重新排好 */
export function sortSharedGroup(group: BindGroupLike | null | undefined): void {
  for (const b of group?.bindings ?? []) if (b?.isNodeUniformsGroup && Array.isArray(b.uniforms) && b.uniforms.length > 1) b.uniforms.sort(compareUniforms);
}

/**
 * 装到渲染器上：以后每次取共用的参数组，three.js 排完、查完缓存，再按上面的规则排一次
 * （新建的这组、缓存里拿出来的那组都排：同一组成员排出来一样，已经在用的那组顺序不会变）。
 * 要在 renderer.init() 之后调用（那时才有 _bindings）。装过的不再装。
 */
export function stableUniformOrder(renderer: unknown): boolean {
  const bindings = (renderer as { _bindings?: { getSharedBindGroup?: GetShared } & { [PATCHED]?: true } })._bindings;
  const original = bindings?.getSharedBindGroup;
  if (!bindings || typeof original !== 'function') return false;
  if (bindings[PATCHED]) return true;
  bindings.getSharedBindGroup = function (this: unknown, group: BindGroupLike, ...rest: unknown[]): BindGroupLike {
    const out = original.call(this, group, ...rest);
    sortSharedGroup(group);
    if (out !== group) sortSharedGroup(out);
    return out;
  };
  bindings[PATCHED] = true;
  return true;
}
