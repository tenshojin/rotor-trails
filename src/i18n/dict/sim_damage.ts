// 原文出自 src/sim/damage.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '机身撞击': ['fuselage impact', '機体の衝突'],
  '机身擦碰': ['fuselage scrape', '機体の接触'],
  '旋翼撞击': ['rotor strike', 'ローターの接触'],
  '尾桨撞击': ['tail rotor strike', 'テールローターの接触'],
  '过重着陆': ['hard landing', 'ハードランディング'],
  '带侧滑着陆': ['landing with sideways speed', '横滑りしたままの着陸'],
  '姿态不当着陆': ['landing at a bad attitude', '姿勢が乱れたままの着陸'],
  '侧翻': ['rollover', '横転'],
  '落水': ['water impact', '着水'],
};

export default table;
