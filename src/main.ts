// 入口：先定语言、加载字典，再加载游戏。
// 顺序不能反：地图、课程、勋章这些文字是模块加载时就建好的表，字典要在它们之前到位（见 i18n/index.ts）。

import { initI18n } from './i18n';

await initI18n();
const { boot } = await import('./boot');
void boot();
