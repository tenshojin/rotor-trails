// 开发服务器中打开 /tools/ui-regression.html。无需浏览器自动化依赖。
import '../src/ui/style.css';
import { UI } from '../src/ui/menus';
import { Hud } from '../src/ui/hud';
import { defaultSettings, type Settings } from '../src/game/settings';
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
  play: () => {}, tutorial: () => {}, settings: () => ui.settings(defaultSettings(), { change: () => {}, capture: () => {}, close: () => {} }),
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

document.querySelector('#summary')!.textContent = `${passed} 项通过，${failed} 项失败 · 当前窗口 ${innerWidth} × ${innerHeight}`;
document.title = `${failed ? 'FAIL' : 'PASS'} ${passed}/${passed + failed} · Rotor Trails UI`;
