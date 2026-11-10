// 原文出自 src/sim/nav.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '推荐路线：{0}': ['Suggested route: {0}', 'おすすめルート：{0}'],
  '导航：主线任务': ['Navigation: main objective', 'ナビ：メイン目標'],
  '导航：可选任务 {0}': ['Navigation: optional objective {0}', 'ナビ：サブ目標 {0}'],
  '可选任务@@导航目标': ['Optional objective', 'サブ目標'],
  '任务完成': ['Mission complete', 'ミッション完了'],
  '共用航段': ['Shared leg', '共通区間'],
  '路线选择': ['Route choice', 'ルート選択'],
  '主航线': ['Main route', 'メインルート'],
  '已偏离航线：先爬升至 {0} m 以上，再飞向「{1}」': ['Off course: climb above {0} m first, then head for “{1}”', 'コースを外れました：まず {0} m 以上に上昇してから「{1}」へ向かってください'],
  '已偏离航线：转向「{0}」重新加入航线': ['Off course: turn toward “{0}” to rejoin the route', 'コースを外れました：「{0}」へ向きを変えてルートに戻ってください'],
  '直飞前建议先爬升至 {0} m 以上': ['Climb above {0} m before flying direct', '直行する前に {0} m 以上へ上昇することをおすすめします'],
};

export default table;
