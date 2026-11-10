// 原文出自 src/game/places.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '北': ['N', '北'],
  '东北': ['NE', '北東'],
  '东': ['E', '東'],
  '东南': ['SE', '南東'],
  '南': ['S', '南'],
  '西南': ['SW', '南西'],
  '西': ['W', '西'],
  '西北': ['NW', '北西'],
  '{0} 米': ['{0} m', '{0} m'],
  '{0} 公里': ['{0} km', '{0} km'],
};

export default table;
