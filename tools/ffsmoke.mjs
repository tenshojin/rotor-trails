// Firefox 冒烟测试：无头 Firefox（临时配置目录，不碰自己平时用的 Firefox），用 WebDriver BiDi 打开游戏，
// 一步一步执行步骤文件里的动作，截图，收集控制台的报错和警告。只支持 Windows（进程按 taskkill 结束）。
//
// 用法：node tools/ffsmoke.mjs <输出目录> <步骤.json>
//   例：node tools/ffsmoke.mjs tmp/ff tools/steps/firefox_smoke.json   （先起 4176 的构建快照，见 docs/development.md）
// 步骤文件：{ "size": "1280,720", "prefs": { 额外的 about:config 项 }, "preload": "页面脚本之前执行的函数源码（可选）", "steps": [
//   { "goto": "http://..." } | { "until": "表达式", "max": 秒 } | { "eval": "表达式（可以是 Promise）", "label": "名字" } | { "wait": 秒 } | { "shot": "名字" } ] }
//
// 默认用软件渲染，不占显卡：WebGL 走 WARP（Microsoft Basic Render Driver），合成走软件 WebRender。
// 环境变量 FF_GPU=1：不加那几项软件渲染的设置，WebGL 用真显卡（tools/steps/firefox_gpu.json，显卡空着的时候再跑）。
//
// 测不了的：Firefox 的 WebGPU。无头模式下 navigator.gpu 在，但 requestAdapter() 拿到的是 null
// （软件适配器、强制开 GPU 进程都试过），游戏在无头 Firefox 里总是退到 WebGL2。
// 所以这个工具测的是“Firefox 的脚本引擎和排版 + WebGL2 这条路”；WebGPU 那条路要在真的 Firefox 窗口里打开看。
// 步骤文件里的 "prefs": { "dom.webgpu.enabled": false } 是把这一点写明白（没有 WebGPU 的浏览器）。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [outDir, stepsFile] = process.argv.slice(2);
const FF = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';
if (!outDir || !stepsFile || !fs.existsSync(FF)) {
  console.error(fs.existsSync(FF) ? '用法：node tools/ffsmoke.mjs <输出目录> <步骤.json>' : '没找到 Firefox：' + FF + '（可用环境变量 FIREFOX 指定）');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const port = 9500 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rotor-ff-'));
const software = process.env.FF_GPU === '1' ? {} : { 'webgl.angle.force-warp': true, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'layers.acceleration.disabled': true };
const prefs = {
  ...software,
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'app.update.auto': false,
  'app.update.enabled': false,
  'browser.aboutwelcome.enabled': false,
  'media.autoplay.default': 0,
  'remote.active-protocols': 1,
  ...(plan.prefs || {}),
};
fs.writeFileSync(
  path.join(profile, 'user.js'),
  Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('\n'),
);
fs.mkdirSync(outDir, { recursive: true });
const proc = spawn(FF, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--window-size', plan.size || '1280,720', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// firefox.exe 会再起一串子进程，proc.kill() 只杀得掉第一个：按进程树杀
const killTree = () => {
  try {
    execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* 已经退出 */
  }
};
let ws = null;
for (let i = 0; i < 360 && !ws; i++) {
  await sleep(500);
  try {
    const w = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await new Promise((res, rej) => {
      w.onopen = res;
      w.onerror = rej;
    });
    ws = w;
  } catch {
    /* 还没起来 */
  }
}
if (!ws) {
  console.log('firefox did not start');
  killTree();
  process.exit(1);
}
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'log.entryAdded') {
    const e = m.params;
    if (e.level === 'error' || e.level === 'warn') logs.push(`[${e.level}] ${String(e.text).slice(0, 400)}`);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ok = (r, what) => {
  if (r.type === 'error') throw new Error(`${what}: ${r.error} ${r.message}`);
  return r.result;
};
let code = 0;
try {
  ok(await send('session.new', { capabilities: {} }), 'session.new');
  ok(await send('session.subscribe', { events: ['log.entryAdded'] }), 'subscribe');
  const tree = ok(await send('browsingContext.getTree', {}), 'getTree');
  const context = tree.contexts[0].context;
  if (plan.preload) ok(await send('script.addPreloadScript', { functionDeclaration: plan.preload }), 'preload');
  const evalJs = async (expression) => {
    const r = ok(await send('script.evaluate', { expression, target: { context }, awaitPromise: true, resultOwnership: 'none' }), 'evaluate');
    if (r.type === 'exception') return `EXC ${r.exceptionDetails?.text}`;
    return r.result?.value ?? r.result?.type;
  };
  for (const st of plan.steps) {
    if (st.goto) {
      ok(await send('browsingContext.navigate', { context, url: st.goto, wait: 'none' }), 'navigate');
    } else if (st.until) {
      const t0 = Date.now();
      let reached = false;
      let last = null;
      while (Date.now() - t0 < (st.max || 300) * 1000) {
        await sleep(1500);
        last = await evalJs(`(() => { try { return !!(${st.until}); } catch (e) { return 'ERR ' + e.message; } })()`);
        if (last === true) {
          reached = true;
          break;
        }
      }
      console.log(`until ${reached ? 'ok' : 'TIMEOUT'} (${((Date.now() - t0) / 1000).toFixed(0)} s): ${st.until.slice(0, 90)}${reached ? '' : ' last=' + last}`);
      if (!reached) code = 2;
    } else if (st.eval) {
      const v = await evalJs(`(async () => { try { return await (${st.eval}); } catch (e) { return 'ERR ' + e.message; } })()`);
      console.log(`${st.label || 'eval'}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    } else if (st.wait) {
      await sleep(st.wait * 1000);
    } else if (st.shot) {
      const shot = ok(await send('browsingContext.captureScreenshot', { context }), 'screenshot');
      fs.writeFileSync(path.join(outDir, `${st.shot}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`shot ${st.shot}`);
    }
  }
} catch (e) {
  console.log(`FAILED ${e.message}`);
  code = 1;
}
console.log(`console: ${logs.length} warn/error`);
for (const l of logs.slice(0, 20)) console.log('  ' + l);
try {
  await Promise.race([send('browser.close', {}), sleep(3000)]);
} catch {
  /* 已经关了 */
}
await sleep(800);
killTree();
await sleep(800);
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {
  /* 配置目录还被占着：留给系统清理 */
}
process.exit(code);
