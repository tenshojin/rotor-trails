// 开发服务器中打开 /tools/ui-regression.html。无需浏览器自动化依赖。
import '../src/ui/style.css';
import { UI } from '../src/ui/menus';
import { Hud } from '../src/ui/hud';
import { defaultSettings, type Settings } from '../src/game/settings';
import { LESSONS } from '../src/game/tutorial';
import { padNavigate } from '../src/ui/padNav';
import { PhotoPanel } from '../src/ui/photoPanel';
import { ReplayPanel } from '../src/ui/replayPanel';
import type { MapDef } from '../src/maps/types';
import type { GameSession } from '../src/sim/session';
import type { WorldView } from '../src/render/worldView';

const fixture = document.querySelector<HTMLElement>('#fixture')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
let passed = 0;
let failed = 0;
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const find = <T extends HTMLElement = HTMLButtonElement>(selector: string): T => {
  const node = fixture.querySelector<T>(selector);
  if (!node) throw new Error(`缺少元素：${selector}`);
  return node;
};
const click = (selector: string) => find(selector).click();
const press = (node: HTMLElement, key: string, shiftKey = false) => node.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
async function test(name: string, run: (ui: UI) => void | Promise<void>): Promise<void> {
  const ui = new UI(fixture);
  const row = document.createElement('li');
  try {
    await run(ui);
    passed++;
    row.textContent = `通过 · ${name}`;
    row.style.color = '#7fffb2';
  } catch (error) {
    failed++;
    row.textContent = `失败 · ${name}：${error instanceof Error ? error.message : String(error)}`;
    row.style.color = '#ff9d91';
  } finally {
    ui.clear();
    fixture.replaceChildren();
    results.append(row);
  }
}

const map = {
  id: 'training', name: '回归训练场', subtitle: '界面检查', description: '用于交互断言的地图。', region: '测试',
  difficulty: 1, recommendedAssist: 'novice', defaultWeather: 'clear',
  weathers: [{ id: 'clear', label: '晴', desc: '晴朗' }, { id: 'rain', label: '雨', desc: '降雨' }],
  mission: { main: [{ title: '起飞', detail: '离开停机坪' }], optional: [] },
  briefing: ['按自己的节奏飞行。'], legs: [], estMinutes: [5, 10],
} as unknown as MapDef;

const menu = (ui: UI) => ui.main({ warning: null, tutorialDone: false }, {
  play: () => {}, free: () => {}, tutorial: () => {}, settings: () => ui.settings(defaultSettings(), { change: () => {}, capture: () => {}, close: () => {} }),
  help: () => ui.help(defaultSettings().bindings), about: () => ui.about(),
});

function settingsHarness(ui: UI) {
  let current = defaultSettings();
  let callback: ((code: string) => void) | null = null;
  let cancellations = 0;
  let closes = 0;
  let changes = 0;
  ui.settings(current, {
    change: (value) => { current = value; changes++; },
    capture: (cb) => {
      callback = cb;
      return () => { callback = null; cancellations++; };
    },
    close: () => closes++,
  });
  return {
    get current() { return current; },
    get callback() { return callback; },
    get cancellations() { return cancellations; },
    get closes() { return closes; },
    get changes() { return changes; },
    key(code: string) {
      assert(callback, '没有待处理的改键捕获');
      const cb = callback!;
      callback = null;
      cb(code);
    },
  };
}

await test('地图卡片使用原生按钮，选择对应地图', (ui) => {
  let picked: MapDef | null = null;
  ui.mapSelect([map], {}, { pick: (value) => { picked = value; }, back: () => {} });
  const card = find('.map-card');
  assert(card.tagName === 'BUTTON' && card.tabIndex === 0, '地图卡片不可通过键盘聚焦');
  card.click();
  assert(picked === map, '选择结果错误');
  assert(find<HTMLElement>('.screen').scrollWidth <= find<HTMLElement>('.screen').clientWidth, '地图选择页横向溢出');
});

await test('课程表从第一节没学的课开始，也能直接选任何一课', (ui) => {
  const picked: number[] = [];
  ui.training(LESSONS, [0, 1], 'flight', { start: (lesson) => picked.push(lesson), course: () => {}, back: () => {} });
  assert(fixture.querySelectorAll('.lesson').length === LESSONS.length, '课程没有列全');
  assert(fixture.querySelectorAll('.lesson.done').length === 2, '学完的课没有打勾');
  click('[data-a="go"]');
  click('.lesson[data-i="5"]');
  assert(picked.join() === '2,5', `开始的课不对：${picked.join()}`);
  assert(find<HTMLElement>('.screen').scrollWidth <= find<HTMLElement>('.screen').clientWidth, '课程表横向溢出');
});

await test('休闲飞行选图不提难度和成绩，简报保留时段和天气', (ui) => {
  let chosen: MapDef | null = null;
  ui.mapSelect([map], {}, { pick: (value) => { chosen = value; }, back: () => {} }, true);
  assert(!fixture.querySelector('.mc-stars') && !fixture.querySelector('.mc-foot'), '休闲模式不该显示难度和成绩');
  click('.map-card');
  assert(chosen === map, '选图结果错误');
  let selection = '';
  ui.freeBrief(map, defaultSettings(), ['甲', '乙'], { back: () => {}, start: (w, t) => { selection = `${w}/${t}`; } });
  assert(fixture.querySelectorAll('.vistas span').length === 2, '景点没有列出来');
  click('[data-group="weather"] [data-v="rain"]');
  click('[data-group="time"] [data-v="night"]');
  click('[data-a="start"]');
  assert(selection === 'rain/night', `选择未保留：${selection}`);
});

await test('休闲飞行的暂停菜单换时段、天气、景点', (ui) => {
  const log: string[] = [];
  ui.freePause({ map, time: 'dusk', weather: 'clear', vistas: ['甲', '乙'], been: ['甲'], total: 3, unseen: ['丙 · 东北 1.2 公里'], canGo: true, cruise: false }, {
    go: (i) => log.push(`go:${i}`),
    resume: () => log.push('resume'), time: (t) => { log.push(`t:${t}`); }, weather: (w) => log.push(`w:${w}`), vista: (i) => log.push(`v:${i}`),
    cruise: () => log.push('cruise'), photo: () => {}, settings: () => {}, help: () => {}, quit: () => {},
  });
  assert(find('.chip[data-v="dusk"]').getAttribute('aria-pressed') === 'true', '当前时段没有选中');
  assert(find('.chip[data-a="vista"][data-v="0"]').textContent?.includes('✓') === true, '到过的地方没有打勾');
  assert(find('.free-pause').textContent?.includes('到过 1 / 3') === true, '没有写到过几个地方');
  click('.chip[data-v="night"]');
  assert(find('.chip[data-v="night"]').getAttribute('aria-pressed') === 'true' && find('.chip[data-v="dusk"]').getAttribute('aria-pressed') === 'false', '时段选中状态没有更新');
  click('.chip[data-a="weather"][data-v="rain"]');
  click('.chip[data-a="vista"][data-v="1"]');
  click('.chip[data-a="go"][data-v="0"]');
  click('[data-a="cruise"]');
  click('[data-a="resume"]');
  assert(log.join() === 't:night,w:rain,v:1,go:0,cruise,resume', `操作不对：${log.join()}`);
});

await test('手柄走菜单：方向找最近的控件，A 确认，B 退出弹窗', (ui) => {
  const log: string[] = [];
  ui.freePause({ map, time: 'dusk', weather: 'clear', vistas: ['甲', '乙'], been: ['甲'], total: 3, unseen: ['丙 · 东北 1.2 公里'], cruise: false }, {
    resume: () => log.push('resume'), time: (t) => { log.push(`t:${t}`); }, weather: (w) => log.push(`w:${w}`), vista: () => {},
    cruise: () => {}, photo: () => log.push('photo'), settings: () => {}, help: () => ui.help(defaultSettings().bindings), quit: () => {},
  });
  const first = document.activeElement;
  assert(first === find('[data-a="resume"]'), '一进来焦点要在主按钮上');
  padNavigate(fixture, 'up');
  const chip = document.activeElement as HTMLElement;
  assert(chip !== first && chip.classList.contains('chip'), '往上走到选项');
  padNavigate(fixture, 'down');
  const box = (e: Element | null) => { const r = e?.getBoundingClientRect(); return r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}` : ''; };
  assert(document.activeElement === first, `往下走回主按钮：从「${chip.textContent}」${box(chip)} 到了「${document.activeElement?.textContent}」${box(document.activeElement)}，主按钮在 ${box(first)}`);
  padNavigate(fixture, 'ok');
  assert(log.join() === 'resume', `A 没有按到：${log.join()}`);
  (find('[data-a="help"]') as HTMLElement).focus();
  padNavigate(fixture, 'ok');
  assert(ui.hasModal, '操作说明没打开');
  padNavigate(fixture, 'back');
  assert(!ui.hasModal, 'B 没有关掉弹窗');
});

await test('任务简介选择有读屏状态，开始时保留天气/时段/辅助', (ui) => {
  let selection = '';
  ui.briefing(map, undefined, defaultSettings(), { back: () => {}, start: (w, a, t) => { selection = `${w}/${a}/${t}`; } });
  click('[data-group="weather"] [data-v="rain"]');
  click('[data-group="time"] [data-v="dusk"]');
  click('[data-group="assist"] [data-v="novice"]');
  for (const group of ['weather', 'time', 'assist']) assert(fixture.querySelectorAll(`[data-group="${group}"] [aria-pressed="true"]`).length === 1, '选择状态不唯一');
  click('[data-a="start"]');
  assert(selection === 'rain/novice/dusk', `选择未保留：${selection}`);
});

await test('模态隔离背景、圈定焦点、Esc 关闭并恢复触发按钮', (ui) => {
  menu(ui);
  const opener = find('[data-a="help"]');
  opener.focus();
  opener.click();
  assert(find<HTMLElement>('.screen').inert, '背景没有隔离');
  const dialog = find<HTMLElement>('[role="dialog"]');
  assert(dialog.getAttribute('aria-modal') === 'true', '缺少模态语义');
  const close = find('[data-a="close"]');
  press(close, 'Tab');
  assert(document.activeElement === close, '焦点逸出模态');
  press(close, 'Tab', true);
  assert(document.activeElement === close, '反向焦点逸出模态');
  press(close, 'Escape');
  assert(!ui.hasModal && !find<HTMLElement>('.screen').inert, '关闭后背景仍不可操作');
  assert(document.activeElement === opener, '未恢复原按钮焦点');
});

await test('设置页签支持方向键，ARIA 与内容同步', (ui) => {
  settingsHarness(ui);
  const controls = find('[data-t="controls"]');
  controls.focus();
  press(controls, 'ArrowRight');
  const video = find('[data-t="video"]');
  assert(document.activeElement === video && video.getAttribute('aria-selected') === 'true', '方向键没有切换页签');
  assert(find('.tab-body').getAttribute('aria-labelledby') === 'settings-video', '内容标签未更新');
  press(video, 'End');
  assert(find('[data-t="assist"]').getAttribute('aria-selected') === 'true', 'End 没有跳到最后页签');
});

await test('冲突改键保留所有原绑定，并说明冲突动作', (ui) => {
  const state = settingsHarness(ui);
  const original = JSON.stringify(state.current.bindings);
  click('[data-act="forward"][data-i="0"]');
  state.key('KeyS');
  assert(JSON.stringify(state.current.bindings) === original && state.changes === 0, '冲突修改了绑定');
  assert(find('.binding-notice').textContent?.includes('后倾减速'), '冲突没有给出动作名称');
});

await test('合法改键保存，Esc 取消暂停键改绑，浏览器保留键不覆盖原键', (ui) => {
  const state = settingsHarness(ui);
  click('[data-act="forward"][data-i="0"]');
  state.key('KeyI');
  assert(state.current.bindings.forward[0] === 'KeyI', '合法按键未保存');
  click('[data-act="pause"][data-i="0"]');
  state.key('Escape');
  assert(state.current.bindings.pause[0] === 'Escape' && state.changes === 1, 'Esc 没有取消');
  click('[data-act="forward"][data-i="0"]');
  state.key('ControlLeft');
  assert(state.current.bindings.forward[0] === 'KeyI' && state.changes === 1, '保留键覆盖了原配置');
});

await test('切换页签取消待捕获按键，旧回调不能覆盖配置', (ui) => {
  const state = settingsHarness(ui);
  click('[data-act="forward"][data-i="0"]');
  const stale = state.callback;
  click('[data-t="video"]');
  assert(state.cancellations === 1 && state.callback === null, '切换标签未取消捕获');
  stale?.('KeyI');
  assert(state.changes === 0, '旧捕获回调仍修改设置');
});

await test('关闭设置仅清理一次，并取消待捕获按键', (ui) => {
  const state = settingsHarness(ui);
  click('[data-act="forward"][data-i="0"]');
  const stale = state.callback;
  click('[data-a="close"]');
  ui.closeModal();
  stale?.('KeyI');
  assert(state.closes === 1 && state.cancellations === 1 && state.changes === 0, '关闭清理次数或捕获取消异常');
});

await test('范围控件与辅助选择更新设置，并保留键盘焦点', (ui) => {
  const state = settingsHarness(ui);
  click('[data-t="audio"]');
  const volume = find<HTMLInputElement>('[data-k="volMaster"]');
  volume.value = '0.35';
  volume.dispatchEvent(new Event('input', { bubbles: true }));
  assert(state.current.volMaster === 0.35 && volume.parentElement?.textContent?.includes('35%'), '滑块值没有同步');
  click('[data-t="assist"]');
  const assist = find<HTMLSelectElement>('[data-k="assist"]');
  assist.focus();
  assist.value = 'novice';
  assist.dispatchEvent(new Event('input', { bubbles: true }));
  assert(state.current.assist === 'novice' && document.activeElement === find('[data-k="assist"]'), '辅助切换丢失焦点');
});

await test('加载进度范围合法；关于页面标明真实素材许可', (ui) => {
  ui.loading('测试加载', 1.4);
  assert(find('[role="progressbar"]').getAttribute('aria-valuenow') === '100', '进度越界');
  ui.loading('未知进度', NaN);
  assert(find('[role="progressbar"]').getAttribute('aria-valuenow') === '0', '非数字进度未归零');
  ui.about();
  assert(find('[role="dialog"]').textContent?.includes('Poly Haven'), '缺少实际材质来源');
  assert(find<HTMLAnchorElement>('a').getAttribute('href') === './licenses.md', '缺少许可链接');
});

await test('飞行记录：时间、次数、到过的地方都写对，能关掉', (ui) => {
  ui.logbook({ seconds: 3725, landings: 12, softest: 0.31, photos: 4, maps: [{ name: '甲', been: 2, total: 5, rating: 'A' }, { name: '乙', been: 0, total: 3, rating: '' }], medals: [{ name: '离地', how: '在空中待满一分钟', done: true, note: '' }, { name: '老手', how: '平安落地 25 次', done: false, note: '12 / 25' }] });
  const text = find('.modal').textContent ?? '';
  assert(text.includes('1 小时 2 分') && text.includes('12 次') && text.includes('0.31 m/s') && text.includes('4 张') && text.includes('到过的地方（2 / 8）'), `记录写错了：${text}`);
  assert(text.includes('勋章（1 / 2）') && text.includes('12 / 25') && document.querySelectorAll('.medal.on').length === 1, `勋章写错了：${text}`);
  assert(ui.hasModal, '记录没打开');
  click('.modal [data-a="close"]');
  assert(!ui.hasModal, '记录关不掉');
});

await test('拍照面板：换风格给出对应的调色参数，面板不出窗口', () => {
  const log: string[] = [];
  const panel = new PhotoPanel(fixture, 40, '按住鼠标转镜头', true, {
    fov: () => {}, exposure: () => {}, blur: () => {}, roll: () => {}, hideHeli: () => {}, blurRotor: () => {}, save: () => {}, back: () => {},
    look: (sat, warm, fade) => log.push(`${sat},${warm},${fade}`),
  });
  const select = find<HTMLSelectElement>('[data-k="look"]');
  assert(select.options.length === 5 && select.value === '0', '风格列表不对');
  select.value = '4';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert(log.join() === '0,0,0.015', `黑白的参数不对：${log.join()}`);
  const box = find('.photo-panel').getBoundingClientRect();
  assert(box.left >= 0 && box.right <= innerWidth + 1, '面板超出了窗口');
  panel.dispose();
});

await test('回放面板：进度条、暂停、慢放、换镜头、拍这一帧、结束', () => {
  const log: string[] = [];
  const panel = new ReplayPanel(fixture, 90, 'Esc 结束', {
    seek: (t) => log.push(`seek:${t}`), hold: (on) => log.push(`hold:${on}`), slow: (on) => log.push(`slow:${on}`),
    shot: () => log.push('shot'), photo: () => log.push('photo'), back: () => log.push('back'),
  });
  const bar = find<HTMLInputElement>('.replay-bar');
  bar.value = '30';
  bar.dispatchEvent(new Event('input', { bubbles: true }));
  click('[data-a="hold"]');
  assert(find('[data-a="hold"]').textContent === '继续' && find('[data-a="hold"]').getAttribute('aria-pressed') === 'true', '暂停之后按钮要写继续');
  click('[data-a="hold"]');
  click('[data-k="slow"]');
  click('[data-a="shot"]');
  click('[data-a="photo"]');
  click('[data-a="back"]');
  assert(log.join() === 'seek:30,hold:true,hold:false,slow:true,shot,photo,back', `操作不对：${log.join()}`);
  panel.update(65);
  assert(find('.replay-time').textContent === '1:05 / 1:30', `时间不对：${find('.replay-time').textContent}`);
  assert(bar.value === '65', '进度条要跟着走');
  const box = find('.replay-panel').getBoundingClientRect();
  assert(box.left >= 0 && box.right <= innerWidth + 1, '面板超出了窗口');
  panel.dispose();
  assert(!fixture.querySelector('.replay-panel'), '面板没有收走');
});

await test('地名字幕：新的换掉旧的，第一次来才有进度，隐藏 HUD 时不显示', () => {
  const hud = new Hud(fixture);
  hud.show(true);
  hud.place('海角灯塔', '夜里靠它认路。', '到过 1 / 5');
  hud.place('五重塔', '很少倒。');
  assert(fixture.querySelectorAll('.hud-place').length === 1, '字幕叠起来了');
  assert(find('.hud-place b').textContent === '五重塔' && !fixture.querySelector('.hud-place i'), '字幕内容不对');
  const box = find('.hud-place').getBoundingClientRect();
  assert(box.left >= 0 && box.right <= innerWidth + 1, '字幕超出了窗口');
  hud.cycleMode();
  hud.cycleMode();
  assert(getComputedStyle(find('.hud-place')).display === 'none', '隐藏 HUD 时字幕还在');
  hud.dispose();
});

await test('HUD 保留告警可见度，读取改键，不重复重建相同告警', async () => {
  const hud = new Hud(fixture);
  hud.show(true);
  hud.resize();
  hud.setOpacity(0.3);
  const settings: Settings = defaultSettings();
  settings.bindings.boost = ['KeyB'];
  const session = {
    state: 'paused', agl: 20, groundSpeed: 0, altitudeMSL: () => 20,
    body: { vel: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 20, z: 0 } },
    flight: { telemetry: { pitch: 0, roll: 0, heading: Math.PI * 2 - 0.0001, airspeed: 0, hoverPowerFrac: 0.6, powerFrac: 0.6, density: 1, torqueLimited: false, hover: 'off' }, assist: { label: '标准' } },
    damage: { durability: 100, status: 'normal' },
    windInfo: { dirFrom: 359.9, speed: 0, gust: 0, gustIn: null, vertical: 0 },
    buffs: { boostActive: false, boostCharges: 1, boostTime: 0, shieldActive: false, shieldTime: 0 },
    mission: { current: () => null, main: [], optional: [], optionalDone: 0, cargo: 0 },
    nav: { info: { mode: 'complete', distance: 0, bearing: 0 }, focus: 0 },
    landingTarget: () => null, terrainWarning: 3, weatherInCloud: 0,
  } as unknown as GameSession;
  hud.update(session, {} as WorldView, settings, 10);
  const warning = find<HTMLElement>('.hud-warn');
  const content = warning.firstElementChild;
  hud.update(session, {} as WorldView, settings, 11);
  assert(warning.firstElementChild === content, '相同告警被重复重建');
  assert(find('.hud-buffs').textContent?.includes('B 使用'), 'HUD 未读取自定义按键');
  assert(find('.hud-flight').textContent?.includes('000°'), '接近正北时航向显示为 360°');
  assert(getComputedStyle(warning).opacity === '1' && getComputedStyle(hud.root).opacity === '1', '低 HUD 不透明度使重要告警变淡');
  hud.update(session, {} as WorldView, settings, 0);
  assert(find('.hud-flight').textContent?.includes('000°'), '时钟重置后 HUD 不再更新');
});

await test('主菜单：没飞过的人第一个按钮是飞行训练；右上角能换语言', (ui) => {
  let lang = '';
  const on = { play: () => {}, free: () => {}, tutorial: () => {}, settings: () => {}, help: () => {}, about: () => {}, lang: (l: string) => { lang = l; } };
  ui.main({ warning: null, tutorialDone: false, newcomer: true, lang: 'zh' }, on);
  const first = fixture.querySelectorAll<HTMLElement>('.menu-col .btn')[0];
  assert(first.dataset.a === 'tutorial' && first.classList.contains('primary'), '新玩家的主按钮不是飞行训练');
  assert(document.activeElement === first, '焦点没落在飞行训练上');
  assert(find('.lang-pick [data-v="zh"]').getAttribute('aria-pressed') === 'true', '当前语言没有标出来');
  click('.lang-pick [data-v="ja"]');
  assert(lang === 'ja', '点语言没有回调');
  ui.main({ warning: null, tutorialDone: true, newcomer: false, lang: 'zh' }, on);
  const again = fixture.querySelectorAll<HTMLElement>('.menu-col .btn')[0];
  assert(again.dataset.a === 'play' && again.classList.contains('primary'), '飞过的人主按钮应该是开始游戏');
  assert(!fixture.querySelector('.menu-col .tag'), '学过教学还挂着“推荐先玩”');
});

await test('任务简介：主线任务只编一次号', (ui) => {
  ui.briefing(map, undefined, defaultSettings(), { start: () => {}, back: () => {} });
  assert(!/^\d/.test(find<HTMLElement>('ol.obj-list li b').textContent ?? ''), '任务标题前面又手写了一遍编号');
});

await test('设置：选语言、导出存档；导入先检查、确认了才换', async (ui) => {
  let exported = 0;
  let imported = '';
  let lang = 'auto';
  ui.settings(defaultSettings(), {
    change: (value) => { lang = value.lang; },
    capture: () => {},
    close: () => {},
    exportSave: () => exported++,
    checkSave: (text) => (text.includes('"ok"') ? 'ok' : text.includes('newer') ? 'newer' : 'invalid'),
    importSave: (text) => { imported = text; },
  });
  click('#settings-assist');
  const select = find<HTMLSelectElement>('select[data-k="lang"]');
  select.value = 'en';
  select.dispatchEvent(new Event('input', { bubbles: true }));
  assert(lang === 'en', '选语言没有写进设置');
  click('[data-a="exportSave"]');
  assert(exported === 1 && (find('.save-notice').textContent ?? '').length > 0, '导出没有回调或没有提示');
  const choose = async (text: string): Promise<void> => {
    const input = find<HTMLInputElement>('.save-file');
    const data = new DataTransfer();
    data.items.add(new File([text], 'save.json', { type: 'application/json' }));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  await choose('not a save');
  assert(!fixture.querySelector('[data-a="confirmImport"]') && (find('.save-notice').textContent ?? '').length > 0, '不是存档的文件没有被拦下');
  await choose('{"ok":true}');
  assert(imported === '' && !!fixture.querySelector('.save-confirm'), '还没确认就导入了，或者没有提示会覆盖');
  click('[data-a="cancelImport"]');
  assert(!fixture.querySelector('.save-confirm') && imported === '', '取消以后还留着确认条');
  await choose('{"ok":true}');
  click('[data-a="confirmImport"]');
  assert(imported === '{"ok":true}', '确认以后没有导入');
});

await test('关于页：版本号、反馈入口、制作人员名单', (ui) => {
  let credits = 0;
  ui.about({ credits: () => credits++ });
  assert(/版本 \d/.test(find<HTMLElement>('.modal').textContent ?? ''), '关于页没有版本号');
  assert(find<HTMLAnchorElement>('.modal a[href*="github.com"]').target === '_blank', '反馈入口没有在新窗口打开');
  click('.modal [data-a="credits"]');
  assert(credits === 1 && !fixture.querySelector('.modal'), '点制作人员名单没有回调，或者弹窗没关');
});

await test('制作人员名单：跳过后停在最后一张卡片，能接着飞或回主菜单', (ui) => {
  let fly = 0;
  let menu = 0;
  ui.credits({ seconds: 8040, landings: 37, places: 3 }, { fly: () => fly++, menu: () => menu++ });
  assert((find('.credits-stats').textContent ?? '').includes('37'), '名单最后没有写这位玩家的记录');
  assert(document.activeElement === find('.credits-skip'), '焦点不在“跳过”上');
  click('.credits-skip');
  assert(!fixture.querySelector('.credits-roll') && !find<HTMLElement>('.credits-end').classList.contains('hidden'), '跳过以后名单没有收起来');
  assert(document.activeElement === find('.credits-end [data-a="fly"]'), '最后一张卡片的焦点不在“接着飞”上');
  click('.credits-end [data-a="fly"]');
  click('.credits-end [data-a="menu"]');
  assert(fly === 1 && menu === 1, '最后一张卡片的按钮没有回调');
});

document.querySelector('#summary')!.textContent = `${passed} 项通过，${failed} 项失败 · 当前窗口 ${innerWidth} × ${innerHeight}`;
document.title = `${failed ? 'FAIL' : 'PASS'} ${passed}/${passed + failed} · Rotor Trails UI`;
