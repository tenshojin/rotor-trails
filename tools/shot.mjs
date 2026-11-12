// 自动化截图/测试：用无头 Chrome（GPU 加速）打开游戏，按步骤执行脚本并截图，同时收集控制台错误。
// 用法：node tools/shot.mjs <steps.json> <输出目录>
// steps.json：{ "url": "...", "width": 1920, "height": 1080, "steps": [ { "goto": "新地址" }, { "wait": 1000 }, { "eval": "js 表达式（可 await）" }, { "shot": "name" }, { "until": "js 条件", "timeout": 60000 } ] }
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [stepsFile, outDir = 'tmp/shots'] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('未找到 Chrome/Edge');
  process.exit(1);
}
const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rotor-shot-'));
const width = cfg.width || 1920;
const height = cfg.height || 1080;
const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    // 双显卡笔记本上强制用独立显卡（否则无头浏览器会跑在核显上，帧率和画面都不能代表实际情况）
    '--force_high_performance_gpu',
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    // 额外参数（例如兼容性测试：CHROME_EXTRA_ARGS="--disable-webgl --disable-webgl2"）
    ...(process.env.CHROME_EXTRA_ARGS ?? '').split(' ').filter(Boolean),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

// 关掉这个 Chrome（连同 GPU、渲染等子进程）并删掉它的临时配置目录。
// 以前只 proc.kill() 主进程就马上删目录：子进程还占着里面的文件，删除失败又被忽略，
// %TEMP% 里因此积了几百个 rotor-shot-*（每个约 200 MB）。中途出错退出时也靠 exit 钩子清理。
let chromeClosed = false;
function closeChrome() {
  if (chromeClosed) return;
  chromeClosed = true;
  if (proc.exitCode === null && proc.signalCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill();
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (e) {
    console.error(`临时浏览器配置没删掉：${profile}（${e.code || e.message}）`);
  }
}
process.on('exit', closeChrome);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* 等待浏览器启动 */
  }
}
if (!target) {
  console.error('chrome did not start');
  proc.kill();
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  } else if (msg.method === 'Log.entryAdded') {
    logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: cfg.mobile ? 2 : 1, mobile: !!cfg.mobile });
// 手机：{ "mobile": true } 打开触屏模拟，步骤里用 { "touch": [[x, y], ...], "phase": "start|move|end" } 按屏幕
if (cfg.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// preload：每次打开页面时最先执行的脚本（比如钩住 WebGPU 接口，抓取生成的着色器）
if (cfg.preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: cfg.preload });
await send('Page.navigate', { url: cfg.url });
const evaluate = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: `(async () => { return (${expr}); })()`, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    console.log('eval error:', res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
    return undefined;
  }
  return res.result?.result?.value;
};
let failed = false;
for (const s of cfg.steps) {
  if (s.goto) {
    await send('Page.navigate', { url: s.goto });
    console.log('goto', s.goto);
  }
  if (s.wait) await sleep(s.wait);
  if (s.profile) {
    // CPU 采样：{ "profile": 毫秒数, "label": "名字" } → 打印自身耗时最多的函数（按脚本位置归并）
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 200 });
    await send('Profiler.start');
    await sleep(s.profile);
    const res = await send('Profiler.stop');
    const prof = res.result.profile;
    const dt = new Map();
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const deltas = prof.timeDeltas;
    for (let i = 0; i < prof.samples.length; i++) {
      const n = byId.get(prof.samples[i]);
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
      dt.set(key, (dt.get(key) ?? 0) + (deltas[i] ?? 0));
    }
    const total = [...dt.values()].reduce((a, b) => a + b, 0);
    console.log(`profile ${s.label ?? ''}: ${(total / 1000).toFixed(0)} ms sampled`);
    for (const [k, v] of [...dt.entries()].sort((a, b) => b[1] - a[1]).slice(0, s.top ?? 25)) console.log(`  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
  }
  if (s.until) {
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < (s.timeout ?? 60000)) {
      if (await evaluate(s.until)) {
        ok = true;
        break;
      }
      await sleep(250);
    }
    console.log(`until ${ok ? 'ok' : 'TIMEOUT'}: ${s.until.slice(0, 80)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (!ok) failed = true;
  }
  if (s.click) {
    // 真实的鼠标点击（经浏览器输入管线，算作用户手势，可触发指针锁定）
    const [x, y] = s.click;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log('click', x, y);
  }
  if (s.touch) {
    const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' }[s.phase ?? 'start'];
    await send('Input.dispatchTouchEvent', { type, touchPoints: s.touch.map(([x, y], id) => ({ x, y, id })) });
  }
  if (s.key) {
    // 真实的按键（keyDown → 等待 → keyUp）
    const [code, ms] = s.key;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), windowsVirtualKeyCode: code === 'Space' ? 32 : code === 'Escape' ? 27 : code.startsWith('Key') ? code.charCodeAt(3) : 0 });
    await sleep(ms ?? 100);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), windowsVirtualKeyCode: code === 'Space' ? 32 : code === 'Escape' ? 27 : code.startsWith('Key') ? code.charCodeAt(3) : 0 });
    console.log('key', code, ms ?? 100);
  }
  if (s.eval) {
    const v = await evaluate(s.eval);
    if (v !== undefined) console.log(`${s.label ?? 'eval'}:`, JSON.stringify(v).slice(0, s.max ?? 1500));
  }
  if (s.shot) {
    const r = await send('Page.captureScreenshot', { format: s.shot.endsWith('.jpg') ? 'jpeg' : 'png', quality: 88 });
    const file = path.join(outDir, s.shot.includes('.') ? s.shot : `${s.shot}.png`);
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log('shot', file);
  }
}
const errors = logs.filter((l) => l.includes('[error]') || l.includes('[exception]') || l.includes('log:error'));
console.log(`console: ${logs.length} lines, ${errors.length} errors`);
for (const l of (process.env.ALL_LOGS ? logs : errors).slice(0, 40)) console.log('  ' + l.slice(0, 300));
ws.close();
closeChrome();
process.exit(failed ? 2 : 0);
