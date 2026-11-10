// 原文出自 src/game/medals.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '{0} / {1} 分钟': ['{0} / {1} min', '{0} / {1} 分'],
  '离地': ['Liftoff', '離陸'],
  '在空中待满一分钟': ['Spend one minute in the air', '空中で 1 分過ごす'],
  '结业': ['Graduate', '卒業'],
  '学完飞行训练的每一课': ['Finish every Flight School lesson', 'フライトスクールの全レッスンを修了'],
  '亲手飞': ['Hands On', '自分の手で'],
  '学完超仿真的每一课': ['Finish every Full Sim lesson', 'フルシムの全レッスンを修了'],
  '老手': ['Old Hand', 'ベテラン'],
  '平安落地 25 次': ['Land safely 25 times', '安全な着陸 25 回'],
  '机长': ['Captain', '機長'],
  '平安落地 100 次': ['Land safely 100 times', '安全な着陸 100 回'],
  '羽毛': ['Feather', '羽根'],
  '接地时下降速度不到 0.2 m/s': ['Touch down at less than 0.2 m/s', '降下率 0.2 m/s 未満で接地'],
  '一小时': ['One Hour', '1 時間'],
  '飞满一小时': ['Fly for one hour', '1 時間飛ぶ'],
  '十小时': ['Ten Hours', '10 時間'],
  '飞满十小时': ['Fly for ten hours', '10 時間飛ぶ'],
  '航拍': ['Aerial Photographer', '空撮'],
  '存下 20 张照片': ['Save 20 photos', '写真を 20 枚保存'],
  '全线': ['All Missions', '全線制覇'],
  '完成每张地图的任务': ['Complete the mission on every map', 'すべてのマップのミッションを完了'],
  '一个不落': ['Nothing Missed', '取りこぼしなし'],
  '做完所有的可选任务': ['Complete every optional objective', 'すべてのサブ目標を達成'],
  '全 S': ['Straight S', 'オール S'],
  '每张地图都拿到 S 评价': ['Earn an S rating on every map', 'すべてのマップで S 評価'],
  '走遍': ['Explorer', '踏破'],
  '到过每张地图上的每个地方': ['Visit every place on every map', 'すべてのマップのすべての場所を訪れる'],
};

export default table;
