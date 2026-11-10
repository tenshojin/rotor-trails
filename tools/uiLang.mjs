// 界面走查：在一种窗口大小、一种语言下把每个界面打开一遍，查超出窗口、互相压住、被截断的字，
// 记下没有译文的句子和控制台报错，并截图。一次只开一个无头 Chrome。
//
// 用法：node tools/uiLang.mjs <名字> <宽> <高> <zh|en|ja> <页面,页面…> [mobile]
//   页面：menu（主菜单、选图、简报、训练、设置四页、操作说明、飞行记录、关于）
//         fly（任务里的 HUD、暂停、拍照、失败、结算）
//         free（休闲飞行的 HUD、自动巡航、暂停、回放）
//         tut（教学：开始卡片和几步有代表性的）
//         sim（超仿真教学，只有电脑）
//         credits（制作人员名单）
//   mobile：触屏模拟（手机 844 390、平板 1180 820）
//   例：node tools/uiLang.mjs en1280 1280 720 en menu,fly,free,tut,credits,sim
//       node tools/uiLang.mjs jaPhone 844 390 ja tut,fly mobile
//
// 环境变量：
//   UIL_BASE  打开的地址，默认 http://localhost:4176/（先 vite build --outDir tmp/snapshot，再 vite preview --outDir tmp/snapshot --port 4176：
//             查的是一份不会变的构建，跑的时候改 src 不会把页面刷新掉）
//   UIL_OUT   截图和 log.txt 放哪儿，默认 tmp/uilang
//   CHROME_EXTRA_ARGS  传给 tools/shot.mjs。显卡被占时用软件渲染：--disable-gpu --use-angle=swiftshader
//
// 结果一行一条：R 是排版（ok，或 OUT 超出窗口 / OVER 互相压住 / CLIP 被截断），M 是缺译文的句子数，E 是页面报错数。
// OVER 不一定是毛病：暂停菜单后面本来就垫着 HUD、贴底的开始按钮本来就盖在选项上，要对着截图看。
// 回放要有录像才打得开，停在坪上不动是不录的，所以放在休闲飞行里开自动巡航飞一段再查。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [name, w, h, lang, pageList = '', ...flags] = process.argv.slice(2);
if (!name || !+w || !+h || !['zh', 'en', 'ja'].includes(lang) || !pageList) {
  console.error('用法：node tools/uiLang.mjs <名字> <宽> <高> <zh|en|ja> <页面,页面…> [mobile]');
  process.exit(1);
}
const mobile = flags.includes('mobile');
const out = process.env.UIL_OUT || 'tmp/uilang';
fs.mkdirSync(out, { recursive: true });
const pre = fs.readFileSync(path.join(here, 'uicheck-preload.js'), 'utf8');
const A = 'window.__app';
const B = process.env.UIL_BASE || 'http://localhost:4176/';
// backend=webgl：软件渲染下 WebGPU 不可用；有显卡时去掉这一项也行
const q = (s) => `${B}?backend=webgl&lang=${lang}${s ? '&' + s : ''}`;
const chk = (tag, sel = '.ui') => ({ label: 'R', eval: `'${tag} :: ' + window.__uicheck(document.querySelector('.ui [role=dialog]') && '${sel}' === '.ui' ? '.ui [role=dialog]' : '${sel}')`, max: 2500 });
const shot = (tag) => ({ shot: `${name}_${tag}.jpg` });
const miss = { label: 'M', eval: `'missing ' + window.__i18nMissing.size + ' ' + [...window.__i18nMissing].slice(0, 10).join(' ## ')`, max: 1200 };
const errs = { label: 'E', eval: `'errs ' + window.__errs.length + ' ' + window.__errs.slice(0, 4).join(' ## ')` };
const tabs = (i) => ({ eval: `(() => { const t = [...document.querySelectorAll('.ui [role=tab], .ui .tab, .ui .tabs button')]; if (t[${i}]) t[${i}].click(); return t.length; })()` });
const jump = (id) => ({ label: 'J', eval: `(() => { const t = ${A}.tutorial, s = ${A}.session; let n = 0; while (t.step && t.step.id !== '${id}' && n++ < 80) t.skip(s); return 'step ' + (t.step && t.step.id); })()` });
const pages = {
  menu: [
    { goto: q('') },
    { until: `${A} && ${A}.state === 'menu'`, timeout: 300000 },
    { wait: 1500 },
    chk('main'), shot('main'),
    { eval: `(${A}.mapSelect(), 1)` }, { wait: 400 }, chk('maps'), shot('maps'),
    { eval: `(document.querySelectorAll('.map-card:not([disabled])')[1].click(), 1)` }, { wait: 400 }, chk('brief'), shot('brief'),
    { eval: `(${A}.mapSelect(), document.querySelectorAll('.map-card:not([disabled])')[4].click(), 1)` }, { wait: 400 }, chk('brief5'), shot('brief5'),
    { eval: `(${A}.freeSelect(), 1)` }, { wait: 400 }, chk('free'), shot('free'),
    { eval: `(document.querySelectorAll('.map-card:not([disabled])')[0].click(), 1)` }, { wait: 400 }, chk('freebrief'), shot('freebrief'),
    { eval: `(${A}.trainingMenu('flight'), 1)` }, { wait: 400 }, chk('train'), shot('train'),
    { eval: `(${A}.trainingMenu('sim'), 1)` }, { wait: 400 }, chk('simtrain'), shot('simtrain'),
    { eval: `(${A}.mainMenu(), ${A}.openSettings(), 1)` }, { wait: 400 }, chk('settings'), shot('settings'),
    tabs(1), { wait: 300 }, chk('settings2'), shot('settings2'),
    tabs(2), { wait: 300 }, chk('settings3'), shot('settings3'),
    tabs(3), { wait: 300 }, chk('settings4'), shot('settings4'),
    { eval: `(${A}.ui.closeModal && ${A}.ui.closeModal(), ${A}.mainMenu(), ${A}.ui.help(${A}.settings.bindings), 1)` }, { wait: 400 }, chk('help'), shot('help'),
    { eval: `(${A}.ui.closeModal && ${A}.ui.closeModal(), ${A}.mainMenu(), ${A}.openLog(), 1)` }, { wait: 400 }, chk('log'), shot('log'),
    { eval: `(${A}.ui.closeModal && ${A}.ui.closeModal(), ${A}.mainMenu(), ${A}.ui.about(), 1)` }, { wait: 400 }, chk('about'), shot('about'),
    { eval: `(${A}.ui.closeModal && ${A}.ui.closeModal(), 1)` },
    miss, errs,
  ],
  fly: [
    { goto: q('map=japan&autostart=1&assist=novice&weather=clear&time=day') },
    { until: `${A} && ${A}.state === 'playing' && ${A}.view.cockpit.loaded`, timeout: 400000 },
    { wait: 2500 },
    chk('hud', '.hud'), shot('hud'),
    { eval: `(${A}.pause(), 1)` }, { wait: 500 }, chk('pause'), shot('pause'),
    { eval: `(${A}.openPhoto(), 1)` }, { wait: 800 }, chk('photo', 'body'), shot('photo'),
    { eval: `(${A}.closePhoto(), 1)` }, { wait: 400 },
    { eval: `(${A}.resume(), 1)` }, { wait: 300 },
    { eval: `(${A}.showFailure(), 1)` }, { wait: 500 }, chk('failed'), shot('failed'),
    { eval: `(${A}.showResult(), 1)` }, { wait: 500 }, chk('result'), shot('result'),
    miss, errs,
  ],
  free: [
    { goto: q('map=fjord&free=1&autostart=1&weather=clear&time=dusk') },
    { until: `${A} && ${A}.state === 'playing' && ${A}.view.cockpit.loaded`, timeout: 400000 },
    { wait: 4000 },
    chk('freehud', '.hud'), shot('freehud'),
    { eval: `(${A}.toggleCruise(), 1)` },
    { until: `${A}.tape.seconds > 12`, timeout: 420000 },
    chk('cruisehud', '.hud'), shot('cruisehud'),
    { eval: `(${A}.pause(), 1)` }, { wait: 600 }, chk('freepause'), shot('freepause'),
    { eval: `(${A}.replayFromPause(), 1)` }, { wait: 2500 },
    { label: 'S', eval: `'replay open ' + !!${A}.replay + ' panel ' + !!document.querySelector('.replay-panel')` },
    chk('replay', 'body'), shot('replay'),
    { eval: `(${A}.closeReplay(), 1)` }, { wait: 400 },
    miss, errs,
  ],
  tut: [
    { goto: q('map=training&lesson=0') },
    // state 在预热着色器之前就是 ready 了：等开始卡片出来再点，不然卡片会盖在已经开始的飞行上
    { until: `${A} && ${A}.state === 'ready' && !!document.querySelector('.click-start')`, timeout: 400000 },
    { wait: 800 },
    chk('ready'), shot('ready'),
    { eval: `(${A}.beginFlight(), 1)` },
    { wait: 2500 },
    chk('tut1', 'body'), shot('tut1'),
    { eval: `(${A}.tutorial && ${A}.session && ${A}.tutorial.click(${A}.session), 1)` }, { wait: 1200 },
    chk('tut2', 'body'), shot('tut2'),
    jump('panel'), { wait: 1500 }, chk('tutnum', 'body'), shot('tutnum'),
    jump('liftoff'), { wait: 1500 }, chk('tutlift', 'body'), shot('tutlift'),
    jump('forward'), { wait: 2500 }, chk('tutfwd', 'body'), shot('tutfwd'),
    jump('turnL'), { wait: 2500 }, chk('tutturn', 'body'), shot('tutturn'),
    jump('curve'), { wait: 2500 }, chk('tutcurve', 'body'), shot('tutcurve'),
    miss, errs,
  ],
  sim: [
    { goto: q('map=training&assist=sim&lesson=1') },
    { until: `${A} && ${A}.state === 'ready' && !!document.querySelector('.click-start')`, timeout: 400000 },
    { eval: `(${A}.beginFlight(), 1)` },
    { wait: 3500 },
    chk('sim', 'body'), shot('sim'),
    miss, errs,
  ],
  credits: [
    { goto: q('') },
    { until: `${A} && ${A}.state === 'menu'`, timeout: 300000 },
    { wait: 800 },
    { eval: `(${A}.save.data.log.seconds = 8040, ${A}.save.data.log.landings = 37, 1)` },
    { eval: `(${A}.startCredits(), 1)` },
    { until: `!!document.querySelector('.credits-roll')`, timeout: 400000 },
    { wait: 9000 },
    chk('credits', '.credits-screen'), shot('credits'),
    { wait: 12000 },
    shot('credits2'),
    { eval: `(document.querySelector('.credits-skip').click(), 1)` }, { wait: 700 },
    chk('creditsend', '.credits-screen'), shot('creditsend'),
    { label: 'S', eval: `JSON.stringify({ state: ${A}.state, credits: ${A}.creditsOn, end: !document.querySelector('.credits-end').classList.contains('hidden') })` },
    miss, errs,
  ],
};

const list = pageList.split(',').filter((p) => pages[p]);
const log = path.join(out, 'log.txt');
const keep = /^R:|^E:|^M:|^S:|^J:|TIMEOUT|eval error|exception|console:/;
for (const p of list) {
  const file = path.join(out, `steps_${name}_${p}.json`);
  const cfg = { url: 'about:blank', width: +w, height: +h, preload: pre, steps: pages[p] };
  if (mobile) cfg.mobile = true;
  fs.writeFileSync(file, JSON.stringify(cfg));
  const r = spawnSync(process.execPath, [path.join(here, 'shot.mjs'), file, out], { encoding: 'utf8', timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout || ''}\n${r.stderr || ''}`
    .split('\n')
    .filter((l) => keep.test(l))
    .map((l) => l.slice(0, 1400));
  if (r.error) lines.push(`runner: ${r.error.message}`);
  const text = `=== ${name} ${p} ${new Date().toTimeString().slice(0, 8)}\n${lines.join('\n')}\n`;
  fs.appendFileSync(log, text);
  process.stdout.write(text);
}
