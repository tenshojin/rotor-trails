// 原文出自 src/sim/mission.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '完美': ['Perfect', 'パーフェクト'],
  '良好': ['Good', '良好'],
  '合格': ['Fair', '合格'],
  '粗糙': ['Rough', '荒い'],
  '不合格': ['Unsafe', '不合格'],
  '着陆数据无效，请重新进近': ['Landing data invalid. Please make another approach', '着陸データが無効です。もう一度進入してください'],
  '下降速度过大（{0} m/s）': ['descent rate too high ({0} m/s)', '降下率が大きすぎる（{0} m/s）'],
  '水平漂移过大（{0} m/s）': ['too much drift ({0} m/s)', '横流れが大きすぎる（{0} m/s）'],
  '机身姿态过大（{0}°）': ['attitude too steep ({0}°)', '機体の傾きが大きすぎる（{0}°）'],
  '未落在停机坪范围内': ['not on the pad', 'パッドの外に降りた'],
  '这里是后续任务的降落点，请先完成：{0}': ['This pad belongs to a later objective. First complete: {0}', 'ここは後の目標の着陸地点です。先にこちらを完了してください：{0}'],
  '装载物资中…保持停稳': ['Loading cargo… hold still', '物資を積み込み中… そのまま静止'],
  '卸载物资中…保持停稳': ['Unloading cargo… hold still', '物資を降ろしています… そのまま静止'],
  '保持停稳…': ['Hold still…', 'そのまま静止…'],
  '平稳降落：下降 < 2.5 m/s，水平漂移 < 2.5 m/s，姿态 < 12°': ['Land gently: descent < 2.5 m/s, drift < 2.5 m/s, attitude < 12°', '穏やかに着陸：降下 < 2.5 m/s、横流れ < 2.5 m/s、姿勢 < 12°'],
  '升高 {0} m': ['Climb {0} m', '{0} m 上昇'],
  '降低 {0} m': ['Descend {0} m', '{0} m 降下'],
  '靠近目标 {0} m': ['Move {0} m closer to the target', '目標まであと {0} m 近づく'],
  '减速至 {0} m/s 以下': ['Slow down below {0} m/s', '{0} m/s 以下に減速'],
  '保持悬停… {0}%': ['Hold the hover… {0}%', 'ホバリングを維持… {0}%'],
  '速度过快：低于 {0} 才能看清': ['Too fast: fly below {0} to inspect it', '速すぎます：{0} 未満でないと確認できません'],
  '减速至 {0} 以下': ['Slow down below {0}', '{0} 以下に減速'],
  '{0}：{1}': ['{0}: {1}', '{0}：{1}'],
  '剩余 {0} 个巡查点': [(n: unknown) => `${n} inspection ${Number(n) === 1 ? 'point' : 'points'} left`, '巡回ポイント 残り {0}'],
};

export default table;
