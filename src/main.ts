// 入口：兼容性检查（WebGL2 / WebAssembly）→ 初始化物理引擎 → 启动游戏。

import './ui/style.css';
import { App } from './game/app';
import { initPhysics } from './sim/physics';
import { UI } from './ui/menus';

function webgl2Supported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** index.html 里的静态加载画面（脚本下载期间显示） */
function hideSplash(): void {
  document.getElementById('boot-splash')?.remove();
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  if (!webgl2Supported()) {
    hideSplash();
    new UI(root).compatError('当前浏览器或显卡不支持 WebGL2，或者硬件加速已被关闭。');
    return;
  }
  if (typeof WebAssembly !== 'object') {
    hideSplash();
    new UI(root).compatError('当前浏览器不支持 WebAssembly，无法运行物理引擎。');
    return;
  }
  try {
    await initPhysics();
  } catch (e) {
    hideSplash();
    new UI(root).compatError('物理引擎初始化失败：' + String(e));
    return;
  }
  hideSplash();
  const app = new App(root);
  (window as unknown as { __app: App }).__app = app;
  // 巡检工具用：自动驾驶按需加载，不进主包
  (window as unknown as { __loadAutopilot: () => Promise<unknown> }).__loadAutopilot = () => import('./sim/autopilot');
  try {
    await app.start();
  } catch (e) {
    console.error(e);
    hideSplash();
    new UI(root).compatError('启动失败：' + String(e));
  }
}

void boot();
