// 原文出自 src/sim/systems.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '旋翼刹车 松开': ['Rotor brake — release', 'ローターブレーキ 解除'],
  '燃油阀 打开': ['Fuel valve — open', '燃料バルブ 開'],
  '电瓶 BATT 开': ['Battery BATT — on', 'バッテリー BATT オン'],
  '防撞灯 A-COL 开': ['Anti-collision light A-COL — on', '衝突防止灯 A-COL オン'],
  '燃油泵 FUEL P 开': ['Fuel pump FUEL P — on', '燃料ポンプ FUEL P オン'],
  '发动机主开关 → IDLE（等 N1 稳在 68%）': ['Engine master → IDLE (wait for N1 to settle at 68%)', 'エンジン主スイッチ → IDLE（N1 が 68% で安定するまで待つ）'],
  '发电机 GEN 开': ['Generator GEN — on', '発電機 GEN オン'],
  '皮托加温 PITOT 开': ['Pitot heat PITOT — on', 'ピトー管ヒーター PITOT オン'],
  '增稳 SAS 开（键盘飞行建议打开）': ['Stability SAS — on (recommended for keyboard flying)', '安定増強 SAS オン（キーボード操縦では推奨）'],
  '发动机主开关 → FLIGHT（等旋翼 100%）': ['Engine master → FLIGHT (wait for rotor 100%)', 'エンジン主スイッチ → FLIGHT（ローター 100% まで待つ）'],
};

export default table;
