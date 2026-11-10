// 原文出自 src/sim/session.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '起点': ['Start', 'スタート地点'],
  '动力增强正在生效': ['Power boost is already active', 'パワーブーストはすでに発動中です'],
  '没有可用的动力增强（拾取黄色动力补给后可用）': ['No power boost available (pick up a yellow boost first)', '使えるパワーブーストがありません（黄色のブーストを拾うと使えます）'],
  '已经飞到地图的边上了，掉头吧': ['You\'ve reached the edge of the map. Time to turn around', 'マップの端まで来ました。引き返しましょう'],
  '已到达任务区域边界，请返回': ['You\'ve reached the edge of the mission area. Please turn back', 'ミッションエリアの境界です。引き返してください'],
  '机体触水！立即拉升': ['Touching water! Climb now', '機体が水に触れています！すぐに上昇を'],
  '机头在往右转：这是主旋翼的反扭矩。点按左脚蹬抵消，或者打开增稳': ['The nose is swinging right: that\'s the main rotor\'s torque. Tap left pedal to cancel it, or turn on the SAS', '機首が右へ回っています。メインローターの反トルクです。左ペダルを軽く踏んで打ち消すか、SAS をオンにしてください'],
  '已持有一次动力增强，请先使用储备': ['You already hold a power boost. Use it first', 'パワーブーストはすでに 1 つ持っています。先にそれを使ってください'],
  '耐久已满，维修补给保留在原处': ['Airframe is full. The repair kit stays where it is', '耐久は満タンです。修理キットはその場に残ります'],
  '该维修站的备件已用完': ['This repair pad is out of spare parts', 'この修理ステーションの部品は使い切りました'],
  '完成：{0}': ['Done: {0}', '完了：{0}'],
  '检查点': ['Checkpoint', 'チェックポイント'],
};

export default table;
