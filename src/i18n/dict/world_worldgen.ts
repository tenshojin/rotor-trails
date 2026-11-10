// 原文出自 src/world/worldgen.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '下载真实地形': ['Downloading real terrain', '実際の地形をダウンロード中'],
  '河流下切': ['Carving rivers', '川の浸食を計算中'],
  '雨水侵蚀': ['Eroding with rain', '雨による浸食を計算中'],
  '布置建筑与停机坪': ['Placing buildings and pads', '建物とヘリパッドを配置中'],
  '种植植被': ['Planting vegetation', '植生を配置中'],
};

export default table;
