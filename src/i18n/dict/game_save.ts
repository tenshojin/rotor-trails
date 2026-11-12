// 原文出自 src/game/save.ts。键是中文原文，值是 [英文, 日文]。

import type { Table } from '../index.ts';

const table: Table = {
  '别的标签页导入了存档：这里不再保存，刷新页面后再玩。': ['A save was imported in another tab. This tab won\'t save anymore; reload to keep playing.', '別のタブでセーブデータが読み込まれました。このタブでは保存しません。再読み込みしてから遊んでください。'],
  '浏览器本地存储不可用：本次游戏的设置与进度不会被保存。': ['Browser storage is unavailable: settings and progress from this session will not be saved.', 'ブラウザのローカルストレージが使えません。今回の設定と進行状況は保存されません。'],
  '浏览器本地存储不可用：无法读取进度，本次游戏不会覆盖原存档。': ['Browser storage is unavailable: your progress could not be read, and this session will not overwrite the existing save.', 'ブラウザのローカルストレージが使えません。進行状況を読み込めなかったため、今回のプレイでは既存のセーブデータを上書きしません。'],
  '存档来自更新版本：已读取兼容的设置与进度，本次游戏不会覆盖原存档。': ['This save comes from a newer version: compatible settings and progress were loaded, and this session will not overwrite the existing save.', 'このセーブデータは新しいバージョンのものです。互換性のある設定と進行状況だけを読み込み、今回のプレイでは既存のセーブデータを上書きしません。'],
  '检测到损坏的存档，已恢复为默认设置（原数据已备份）。': ['A damaged save was found and reset to defaults (the original data was backed up).', '壊れたセーブデータが見つかったため、初期設定に戻しました（元のデータはバックアップ済みです）。'],
  '检测到损坏的存档，已恢复为默认设置；原数据备份失败，暂不覆盖原存档。': ['A damaged save was found and reset to defaults. The original data could not be backed up, so the existing save will not be overwritten for now.', '壊れたセーブデータが見つかったため、初期設定に戻しました。元のデータをバックアップできなかったので、当面は既存のセーブデータを上書きしません。'],
  '保存失败（存储空间已满或被禁止）。': ['Saving failed (storage is full or blocked).', '保存に失敗しました（ストレージがいっぱいか、禁止されています）。'],
};

export default table;
