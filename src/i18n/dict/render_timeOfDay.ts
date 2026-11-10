// 原文出自 src/render/timeOfDay.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '白天': ['Day', '昼'],
  '地图默认的日照。': ['The map\'s default daylight.', 'マップ標準の日差し。'],
  '清晨': ['Dawn', '早朝'],
  '日出后不久：低角度的阳光，谷地与林间有晨雾，光束最明显。': ['Just after sunrise: low-angle light, morning mist in the valleys and forests, and the strongest light shafts.', '日の出の直後：低い角度の日差し、谷や森にかかる朝霧。光芒が最もよく見える時間帯です。'],
  '黄昏': ['Dusk', '夕暮れ'],
  '日落前：暖色斜阳、长长的影子，云底被染成橙红。': ['Before sunset: warm slanting light, long shadows, and cloud bases glowing orange.', '日没前：暖かい色の斜めの光、長く伸びる影、オレンジに染まる雲の底。'],
  '夜晚': ['Night', '夜'],
  '月光下飞行：星空、水面上的月光、城镇灯火，靠仪表和着陆灯。': ['Flying by moonlight: stars, moonlight on the water and town lights. Rely on your instruments and the landing light.', '月明かりの下の飛行：星空、水面に映る月、街の灯り。計器と着陸灯が頼りです。'],
};

export default table;
