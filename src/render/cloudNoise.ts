// 体积云用的三维噪声贴图。数据（cloudNoiseData.ts）在 CPU 上算一次要将近一秒：
// 启动时交给后台线程先算（prepareCloudNoise），主线程照常走；后台线程用不了就在第一次用到时当场算。

import * as THREE from 'three/webgpu';
import { CLOUD_NOISE_N as N, cloudNoiseData } from './cloudNoiseData';

let cache: THREE.Data3DTexture | null = null;
let ready: Uint8Array | null = null;
let pending: Promise<Uint8Array> | null = null;
let settled: Promise<void> = Promise.resolve();

function fill(data: Uint8Array): void {
  if (ready) return;
  ready = data;
  if (cache) {
    (cache.image.data as Uint8Array).set(data);
    cache.needsUpdate = true;
  }
}

/** 启动时调用一次：job 是后台线程里算的数据（world/genWorker.ts）。失败了等用到时在主线程上算 */
export function prepareCloudNoise(job: Promise<Uint8Array>): void {
  if (ready || pending) return;
  pending = job;
  settled = job.then(fill, () => {
    pending = null;
    if (cache) fill(cloudNoiseData());
  });
}

/** 噪声数据到位（预热完、第一帧给玩家看之前等一下，云不会突然冒出来） */
export function cloudNoiseSettled(): Promise<void> {
  return settled;
}

export function getCloudNoise3D(): THREE.Data3DTexture {
  if (cache) return cache;
  const t = new THREE.Data3DTexture(ready ?? new Uint8Array(N * N * N * 4), N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cache = t;
  // 后台线程还没算完：先用全 0（没有云），算完再填进去
  if (!ready && !pending) fill(cloudNoiseData());
  return t;
}
