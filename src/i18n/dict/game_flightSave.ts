// 原文出自 src/game/flightSave.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '刚刚': ['just now', 'たった今'],
  '{0} 分钟前': ['{0} min ago', '{0} 分前'],
  '{0} 小时前': ['{0} h ago', '{0} 時間前'],
  '{0} 天前': [(n: unknown) => `${n} ${Number(n) === 1 ? 'day' : 'days'} ago`, '{0} 日前'],
  '休闲飞行': ['Free Flight', 'フリーフライト'],
  '任务 {0}/{1}': ['Objective {0}/{1}', '目標 {0}/{1}'],
  '任务 {0}/{1} · 耐久 {2}': ['Objective {0}/{1} · Airframe {2}', '目標 {0}/{1} · 耐久 {2}'],
};

export default table;
