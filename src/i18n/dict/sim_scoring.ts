// 原文出自 src/sim/scoring.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '主线任务': ['Main objectives', 'メイン目標'],
  '完成': ['Completed', '完了'],
  '未完成': ['Not completed', '未完了'],
  '可选任务': ['Optional objectives', 'サブ目標'],
  '剩余耐久': ['Airframe remaining', '残りの耐久'],
  '碰撞': ['Collisions', '衝突'],
  '{0} 次': ['{0}', '{0} 回'],
  '最终降落质量': ['Final landing quality', '最終着陸の質'],
  '{0} 分': ['{0} pts', '{0} 点'],
  '安全恢复': ['Safe recoveries', 'セーフリカバリー'],
};

export default table;
