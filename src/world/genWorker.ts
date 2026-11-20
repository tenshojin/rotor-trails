// 把生成世界的纯计算交给后台线程（workers/gen.worker.ts）。主线程这几秒只管刷新加载界面，页面不再卡住。
// 后台线程开不了（老浏览器、页面不让开）或者脚本加载失败，就返回失败，调用方改在主线程上照常算（结果一样，只是会卡）。

import { getMap } from '../maps';
import type { MapDef } from '../maps/types';
import type { ShapedTerrain } from './genJobs';
import type { ShapeStage } from './shape';

export type GenRequest = { kind: 'shape'; mapId: string } | { kind: 'cloud' };
export type GenReply = { kind: 'stage'; stage: ShapeStage } | { kind: 'done'; result: unknown } | { kind: 'error'; message: string };

/** 开过一次失败（脚本加载不了、页面不让开），以后都不再试 */
let unavailable = false;

/** 后台线程这么久没有回音（不报错、也不出结果）就不等了，调用方改在主线程上算：加载不能永远停在那里 */
const SILENCE_MS = 90000;

function run<T>(req: GenRequest, onStage?: (s: ShapeStage) => void, silenceMs = SILENCE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (unavailable || typeof Worker === 'undefined') {
      reject(new Error('后台线程不可用'));
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/gen.worker.ts', import.meta.url), { type: 'module', name: 'rotor-gen' });
    } catch (error) {
      unavailable = true;
      reject(error);
      return;
    }
    let silence: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(silence);
      worker.terminate();
    };
    const listen = (): void => {
      clearTimeout(silence);
      silence = setTimeout(() => {
        finish();
        reject(new Error('后台线程没有回音'));
      }, silenceMs);
    };
    worker.onmessage = (e: MessageEvent<GenReply>) => {
      const msg = e.data;
      if (msg.kind === 'stage') {
        listen();
        onStage?.(msg.stage);
        return;
      }
      finish();
      if (msg.kind === 'done') resolve(msg.result as T);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      finish();
      unavailable = true;
      reject(new Error(e.message || '后台线程脚本加载失败'));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error('后台线程的结果读不出来'));
    };
    listen();
    worker.postMessage(req);
  });
}

/**
 * 在后台线程里给这张地图成形（world/genJobs.ts 的 shapeJob）。只接受注册表里的原配方：
 * 后台线程按地图名字找配方，传进来的若是改过的副本（测试、工具），两边就对不上了
 */
export function shapeOffThread(map: MapDef, onStage?: (s: ShapeStage) => void): Promise<ShapedTerrain> {
  let recipe: MapDef | null = null;
  try {
    recipe = getMap(map.id);
  } catch {
    recipe = null;
  }
  if (recipe !== map || map.real) return Promise.reject(new Error('这张地图不在后台线程里成形'));
  return run<ShapedTerrain>({ kind: 'shape', mapId: map.id }, onStage);
}

/** 体积云的三维噪声（render/cloudNoiseData.ts） */
export function cloudNoiseOffThread(): Promise<Uint8Array> {
  // 一般一秒内算完；等太久还不如主线程自己算（加载到预热时会等它）
  return run<Uint8Array>({ kind: 'cloud' }, undefined, 20000);
}
