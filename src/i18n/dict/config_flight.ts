// 原文出自 src/config/flight.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  'RT-7 隼': ['RT-7 Falcon', 'RT-7 ハヤブサ'],
  '新手辅助': ['Beginner', '初心者'],
  '增稳最强：松开按键自动改平并缓慢减速，自动保持高度，近地自动限制下降速度。': ['Maximum stability: release the keys and the aircraft levels out and slows down gently, holds its altitude, and limits the descent rate near the ground.', '安定性を最優先：キーを離すと自動で水平に戻ってゆっくり減速し、高度を自動で保ち、地面の近くでは降下率を自動で抑えます。'],
  '标准辅助': ['Standard', '標準'],
  '默认模式：松开按键改平但保留惯性，保持垂直速度（高度会缓慢漂移），兼顾拟真与可玩性。': ['The default: release the keys and the aircraft levels out but keeps its momentum, and holds its vertical speed (altitude drifts slowly). A balance of realism and playability.', '標準モード：キーを離すと水平に戻りますが慣性は残り、垂直速度を保ちます（高度はゆっくり変化します）。リアルさと遊びやすさのバランスを取った設定です。'],
  '挑战辅助': ['Challenge', 'チャレンジ'],
  '减少辅助：姿态按角速度控制（松杆保持当前姿态），总距杆直接控制升力，反扭矩协调不完全。': ['Fewer assists: attitude is rate-controlled (the aircraft holds whatever attitude you leave it in), the collective controls lift directly, and anti-torque coordination is incomplete.', 'アシスト少なめ：姿勢は角速度で操作（スティックを離すとその姿勢を維持）、コレクティブが揚力を直接操作し、反トルクの補正は完全ではありません。'],
  '超仿真': ['Full Sim', 'フルシム'],
  '冷舱启动，按钮和仪表都要亲手操作。没有任何飞行辅助：旋翼转速要自己看，发动机停了只能自转下滑。鼠标不锁定，移到屏幕边转头；Shift 下降，C 动力增强。': ['Cold start, and every button and gauge is yours to operate. No flight assists at all: you watch the rotor RPM yourself, and if the engine quits, all you have is autorotation. The mouse is not locked: move it to the screen edge to look around. Shift descends, C is power boost.', 'コールドスタートから、ボタンも計器もすべて自分で操作します。飛行アシストは一切ありません。ローター回転数は自分で監視し、エンジンが止まればオートローテーションで降りるしかありません。マウスはロックされず、画面の端へ動かすと視線が動きます。Shift で降下、C でパワーブースト。'],
};

export default table;
