// 原文出自 src/boot.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '当前浏览器或显卡不支持 WebGL2，或者硬件加速已被关闭。': ['This browser or graphics card does not support WebGL2, or hardware acceleration is turned off.', 'このブラウザまたはグラフィックカードは WebGL2 に対応していないか、ハードウェアアクセラレーションがオフになっています。'],
  '当前浏览器不支持 WebAssembly，无法运行物理引擎。': ['This browser does not support WebAssembly, which the physics engine needs.', 'このブラウザは WebAssembly に対応していないため、物理エンジンを動かせません。'],
  '物理引擎初始化失败：': ['The physics engine failed to start: ', '物理エンジンの初期化に失敗しました：'],
  '启动失败：': ['Startup failed: ', '起動に失敗しました：'],
};

export default table;
