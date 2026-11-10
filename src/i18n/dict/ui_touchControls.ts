// 原文出自 src/ui/touchControls.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '升降 · 转向': ['Climb · Turn', '上下 · 旋回'],
  '升降 · 左右': ['Up/down · Sideways', '上下 · 左右'],
  '前后 · 平移': ['Forward · Slide', '前後 · 平行移動'],
  '前后 · 左右': ['Forward/back · Sideways', '前後 · 左右'],
  '切换视角': ['Switch camera', '視点切り替え'],
  '切换导航目标或推荐路线': ['Switch navigation target or suggested route', 'ナビの目標またはおすすめルートを切り替え'],
  '自动巡航': ['Auto-cruise', 'オートクルーズ'],
};

export default table;
