// 后台线程：生成世界时最占主线程的纯计算（地形成形、水系、地形宏观图、云的三维噪声）放到这里算，
// 主线程这几秒只管刷新加载界面，不再卡住。调用方是 world/genWorker.ts；每个活开一个线程，算完就关。
// 只 import 不带 three.js 的模块（地图配方、地形成形），这个脚本因此很小。

import type { MapDef } from '../maps/types';
import { TRAINING } from '../maps/training';
import { JAPAN } from '../maps/japan';
import { CANYON } from '../maps/canyon';
import { AMAZON } from '../maps/amazon';
import { FJORD_MAP } from '../maps/fjord';
import { HIMALAYA } from '../maps/himalaya';
import { shapeJob, shapedBuffers } from '../world/genJobs';
import { cloudNoiseData } from '../render/cloudNoiseData';
import type { GenRequest, GenReply } from '../world/genWorker';

/** 和 maps/index.ts 的 MAPS 是同一批配方（真实地形不在这里做） */
const RECIPES: MapDef[] = [TRAINING, JAPAN, CANYON, AMAZON, FJORD_MAP, HIMALAYA];

const port = self as unknown as {
  onmessage: ((e: MessageEvent<GenRequest>) => void) | null;
  postMessage(msg: GenReply, transfer?: Transferable[]): void;
};

port.onmessage = (e) => {
  const req = e.data;
  void (async () => {
    try {
      if (req.kind === 'cloud') {
        const data = cloudNoiseData();
        port.postMessage({ kind: 'done', result: data }, [data.buffer as ArrayBuffer]);
        return;
      }
      const map = RECIPES.find((m) => m.id === req.mapId);
      if (!map) throw new Error(`后台线程里没有这张地图：${req.mapId}`);
      const shaped = await shapeJob(map, (stage) => port.postMessage({ kind: 'stage', stage }));
      port.postMessage({ kind: 'done', result: shaped }, shapedBuffers(shaped));
    } catch (error) {
      port.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
