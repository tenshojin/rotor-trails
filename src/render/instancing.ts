// 实例网格的运动向量。three.js 为了算运动向量，给每个实例网格留一份“上一帧的矩阵”：
// 每帧把整张矩阵表复制一遍，矩阵一变就把这份副本整块重传。我们的实例网格是树、石块、房子、草，
// 位置根本不动（列表只是随镜头重排），于是每帧白白复制几十 MB，每飞 25 米还要往显卡写 19 MB，
// 一帧卡 200 多毫秒。
//
// 这里让实例网格不走这条路：上一帧的位置直接取当前位置，运动向量里只剩相机的运动，这也正是它们的真实情况
// （顺带，风吹动的树叶不再被算成“物体在动”，时间抗锯齿不会把树冠抹糊）。

import * as THREE from 'three/webgpu';
import { positionLocal, positionPrevious } from 'three/tsl';

type Builder = { object?: { isInstancedMesh?: boolean }; needsPreviousData(): boolean };

let done = false;

export function fixInstancedVelocity(): void {
  if (done) return;
  done = true;
  const NB = (THREE as unknown as { NodeBuilder: { prototype: Builder } }).NodeBuilder.prototype;
  const NM = (THREE.NodeMaterial as unknown as { prototype: { setupPosition(b: Builder): unknown } }).prototype;
  const needs = NB.needsPreviousData;
  const setup = NM.setupPosition;
  NB.needsPreviousData = function (this: Builder) {
    return this.object?.isInstancedMesh !== true && needs.call(this);
  };
  NM.setupPosition = function (this: { setupPosition(b: Builder): unknown }, b: Builder) {
    const r = setup.call(this, b);
    if (b.object?.isInstancedMesh === true && needs.call(b)) (positionPrevious as unknown as { assign(n: unknown): void }).assign(positionLocal);
    return r;
  };
}
