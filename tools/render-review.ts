// 本地人工/CUA 验收入口：/tools/render-review.html。只调用游戏的公开接口。
import '../src/ui/style.css';
import { App } from '../src/game/app';
import { SAVE_KEY, SAVE_VERSION, type StorageLike } from '../src/game/save';
import { defaultSettings, QUALITY, type QualityId } from '../src/game/settings';
import { MAPS, getMap } from '../src/maps/index';
import type { MapId } from '../src/maps/types';
import { TIME_OF_DAY, type TimeOfDay } from '../src/render/timeOfDay';
import { initPhysics } from '../src/sim/physics';
import { ReviewLog, captureCanvasPng, reviewStatus, type ReviewLogEntry } from './renderReviewState';

type Pose = 'pad' | 'dust' | 'cruise';
type Scenario = { label: string; map: MapId; weather: string; time: TimeOfDay; quality: QualityId; ray: boolean; pose: Pose };
type LogEntry = ReviewLogEntry;
type RecordEntry = { scenario: Scenario; status: 'ok' | 'error' | 'cancelled'; afterLogSequence: number; loadSeconds: number; sampleSeconds?: number; renderedFrames?: number; measuredFps?: number; snapshot?: Record<string, unknown>; errors: LogEntry[]; warnings: LogEntry[]; note?: string };

const $ = <T extends HTMLElement = HTMLButtonElement>(id: string) => document.getElementById(id) as T;
const mapSelect = $<HTMLSelectElement>('map');
const weatherSelect = $<HTMLSelectElement>('weather');
const timeSelect = $<HTMLSelectElement>('time');
const qualitySelect = $<HTMLSelectElement>('quality');
const rayInput = $<HTMLInputElement>('ray');
const hudInput = $<HTMLInputElement>('hud');
const progress = $<HTMLProgressElement>('progress');
const logbook = new ReviewLog(300);
const logs = logbook.recent;
// 资源失败会使本次验收失效，直到刷新页面重试；不能把回退几何误判为完整模型。
const resourceFailures: LogEntry[] = [];
const resourceFailurePattern = /加载失败|(?:加载|载入|下载).*(?:失败|错误)|failed to (?:load|fetch)|(?:load|fetch).*(?:failed|error)|fallback|built-in geometry|使用程序|missing|not found/i;
const records: RecordEntry[] = [];
const startedAt = new Date().toISOString();
let app: App | null = null;
let booting: Promise<App> | null = null;
let busy = false;
let capturing = false;
let stopRequested = false;
let pose: Pose = 'pad';
let poseSurface = '停机坪';
let latestScenario: Scenario | null = null;
const artifactUrls = new Map<string, string>();
let lastCapture: Record<string, unknown> | null = null;

const describe = (value: unknown): string => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};
function log(level: LogEntry['level'], text: string): void {
  const entry = logbook.append(level, text);
  if (resourceFailurePattern.test(text)) resourceFailures.push(entry);
  $('review-log').textContent = logs.map((item) => `[${item.level}] ${item.text}`).join('\n');
}
for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => { log(level, args.map(describe).join(' ')); original(...args); };
}
window.addEventListener('error', (event: Event) => {
  if (event instanceof ErrorEvent) log('error', event.error ? describe(event.error) : event.message);
  else if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLImageElement) log('error', `资源加载失败：${event.target.src}`);
}, true);
window.addEventListener('unhandledrejection', (event) => log('error', describe(event.reason)));

for (const map of MAPS) mapSelect.add(new Option(map.name, map.id));
mapSelect.value = 'training';
for (const [id, time] of Object.entries(TIME_OF_DAY)) timeSelect.add(new Option(time.label, id));
for (const [id, quality] of Object.entries(QUALITY)) qualitySelect.add(new Option(quality.label, id));
qualitySelect.value = 'medium';
function updateWeathers(): void {
  const map = getMap(mapSelect.value as MapId);
  weatherSelect.replaceChildren(...map.weathers.map((weather) => new Option(weather.label, weather.id)));
  weatherSelect.value = map.defaultWeather;
}
mapSelect.addEventListener('change', updateWeathers);
updateWeathers();

function configuration(): Scenario {
  return { label: '手动场景', map: mapSelect.value as MapId, weather: weatherSelect.value, time: timeSelect.value as TimeOfDay, quality: qualitySelect.value as QualityId, ray: rayInput.checked, pose };
}
function selectScenario(scenario: Scenario): void {
  mapSelect.value = scenario.map;
  updateWeathers();
  weatherSelect.value = scenario.weather;
  timeSelect.value = scenario.time;
  qualitySelect.value = scenario.quality;
  rayInput.checked = scenario.ray;
  pose = scenario.pose;
}
function setBusy(value: boolean): void {
  busy = value;
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('#review button, #review select, #review input')) {
    if (['collapse', 'export', 'hud'].includes(control.id)) continue;
    if (control.id === 'stop') control.disabled = !value || capturing;
    else if (control.dataset.pose || control.dataset.view || control.dataset.look || control.id === 'capture') control.disabled = value || !app?.session;
    else control.disabled = value;
  }
}

async function ensureApp(): Promise<App> {
  if (app) return app;
  if (booting) return booting;
  booting = (async () => {
    $('stage').textContent = '初始化物理与渲染器…';
    await initPhysics();
    const settings = defaultSettings();
    Object.assign(settings, { quality: qualitySelect.value, volMaster: 0, volEngine: 0, volAmbience: 0, volAlerts: 0, shake: 0, headMotion: false, rayTracing: false });
    const memory = new Map<string, string>([[SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, settings, maps: {}, tutorialDone: true })]]);
    const storage: StorageLike = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } };
    const instance = new App($<HTMLElement>('app'), storage);
    instance.ui.root.style.display = 'none';
    instance.hud.show(false);
    instance.input.active = false;
    instance.view.renderer.domElement.addEventListener('webglcontextlost', () => log('error', 'WebGL 上下文丢失'));
    try {
      await instance.start();
    } catch (error) {
      instance.dispose();
      throw error;
    }
    app = instance;
    return instance;
  })();
  try { return await booting; } finally { booting = null; }
}

function positionCamera(nextPose: Pose): void {
  if (!app?.world || !app.session) return;
  pose = nextPose;
  const world = app.world;
  const map = world.map;
  const pad = world.pads.get(map.spawn.padId)!;
  let [x, y, z] = pad.pos;
  let heading = map.spawn.heading;
  if (pose === 'cruise') {
    poseSurface = '巡航';
    const id = map.legs[0]?.paths[0]?.nodes[1] ?? map.legs[0]?.paths[0]?.nodes[0];
    const node = map.nodes.find((item) => item.id === id) ?? map.nodes[0];
    if (node) [x, y, z] = node.pos;
    y = Math.max(y + 60, world.terrain.heightAt(x, z) + 160);
    const next = map.mission.main[0]?.approach;
    if (next) heading = Math.atan2(next[0] - x, -(next[2] - z)) * 180 / Math.PI;
  } else if (pose === 'dust') {
    // 离开坪面后才验证真实土壤/雪尘或水雾，避免硬化坪面的抑尘规则遮蔽效果。
    const radians = heading * Math.PI / 180;
    const offset = pad.size * 1.4;
    x += Math.cos(radians) * offset;
    z += Math.sin(radians) * offset;
    const ground = world.terrain.heightAt(x, z);
    const water = map.waterLevel ?? -Infinity;
    poseSurface = water > ground ? '水面旋翼水雾' : '真实地形扬尘';
    y = Math.max(ground, water) + 6;
    heading = Math.atan2(pad.pos[0] - x, -(pad.pos[2] - z)) * 180 / Math.PI;
  } else {
    poseSurface = '停机坪';
    y += 1.6;
  }
  app.debugTeleport(x, y, z, heading);
  // 一个固定物理步更新离地高度与旋翼负载，然后停在 ready；时间仍推进天气与粒子。
  app.session.step();
  app.session.drainEvents();
  app.debugLook(0, pose === 'cruise' ? -0.17 : -0.09);
  app.view.rig.setMode(pose === 'pad' || pose === 'dust' ? 'chase' : 'cockpit');
  app.input.active = false;
  app.input.clear();
  app.hud.show(hudInput.checked);
  $('stage').textContent = `已定位：${{ pad: '停机坪近景', dust: '低空扬尘', cruise: '巡航机位' }[pose]} · ${poseSurface}`;
}

async function loadScenario(scenario: Scenario): Promise<number> {
  selectScenario(scenario);
  const start = performance.now();
  const instance = await ensureApp();
  $('stage').textContent = `加载：${getMap(scenario.map).name} · ${TIME_OF_DAY[scenario.time].label} · ${QUALITY[scenario.quality].label}`;
  instance.applySettings({ ...instance.settings, quality: scenario.quality, rayTracing: scenario.ray, volMaster: 0, volEngine: 0, volAmbience: 0, volAlerts: 0, shake: 0, headMotion: false });
  await instance.startRun({ map: getMap(scenario.map), weather: scenario.weather, assist: 'novice', tutorial: false, time: scenario.time });
  if (instance.state !== 'ready' || !instance.session) throw new Error(`加载未完成：${instance.state}，请检查错误日志`);
  instance.ui.clear();
  instance.input.active = false;
  positionCamera(scenario.pose);
  latestScenario = scenario;
  return (performance.now() - start) / 1000;
}

function snapshot(): Record<string, unknown> {
  if (!app) return { state: 'uninitialized' };
  const renderer = app.view.renderer;
  const canvas = renderer.domElement;
  let spotLights = 0;
  app.view.scene.traverse((node) => { if (node.type === 'SpotLight') spotLights++; });
  const fixtures = app.view.scene.getObjectByName('Helipad fixtures');
  const resources = {
    cockpit: { loaded: app.view.cockpit.loaded },
    heli: { extLoaded: app.view.heli.extLoaded },
    helipadFixtures: { present: !!fixtures, children: fixtures?.children.length ?? 0, modelLoaded: fixtures?.userData.modelLoaded === true },
    resourceLoadFailures: resourceFailures.length,
  };
  const assetsComplete = resources.cockpit.loaded && resources.heli.extLoaded && resources.helipadFixtures.modelLoaded && resources.helipadFixtures.children >= 3 && resourceFailures.length === 0;
  return {
    ...app.debugState(), gpu: app.view.gpuInfo(), quality: app.settings.quality, rayTracing: app.settings.rayTracing,
    viewport: [innerWidth, innerHeight], canvas: [canvas.width, canvas.height], devicePixelRatio,
    memory: { ...renderer.info.memory }, spotLights, camera: app.view.rig.mode, pose, poseSurface, frames: app.view.frames,
    baseURI: document.baseURI, resources, assetsComplete,
    localStorage: 'isolated-memory-only', audio: 'muted', pointerLocked: document.pointerLockElement !== null,
  };
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function wait(ms: number): Promise<void> {
  const until = performance.now() + ms;
  while (performance.now() < until && !stopRequested) await sleep(Math.min(100, until - performance.now()));
}
async function recordScenario(scenario: Scenario): Promise<void> {
  const capture = logbook.capture();
  const start = performance.now();
  let loadSeconds = 0;
  let sampleSeconds = 0;
  let renderedFrames = 0;
  try {
    loadSeconds = await loadScenario(scenario);
    await wait(2000);
    if (!stopRequested) {
      const frames = app!.view.frames;
      const sampleStart = performance.now();
      await wait(3000);
      sampleSeconds = (performance.now() - sampleStart) / 1000;
      renderedFrames = app!.view.frames - frames;
    }
    const state = snapshot();
    if (!state.assetsComplete && !stopRequested) log('error', `资源完整性检查失败：${JSON.stringify(state.resources)}。资源失败后请刷新页面再验收。`);
    const errors = capture.entries.filter((entry) => entry.level === 'error' || resourceFailurePattern.test(entry.text));
    records.push({ scenario, status: reviewStatus(stopRequested, errors.length, renderedFrames, state.assetsComplete === true), afterLogSequence: capture.afterSequence, loadSeconds, sampleSeconds, renderedFrames, measuredFps: sampleSeconds > 0 ? +(renderedFrames / sampleSeconds).toFixed(1) : undefined, snapshot: state, errors, warnings: capture.entries.filter((entry) => entry.level === 'warn'), note: stopRequested ? '用户中止，数据为部分结果，不计为通过' : '自动结果验证模型完整性和持续渲染；画面质量仍需人工检查' });
  } catch (error) {
    log('error', describe(error));
    records.push({ scenario, status: stopRequested ? 'cancelled' : 'error', afterLogSequence: capture.afterSequence, loadSeconds: loadSeconds || (performance.now() - start) / 1000, snapshot: snapshot(), errors: capture.entries.filter((entry) => entry.level === 'error'), warnings: capture.entries.filter((entry) => entry.level === 'warn') });
  } finally {
    capture.close();
  }
  renderRecords();
}
function report(): Record<string, unknown> {
  return { title: 'Rotor Trails 本地渲染验收', startedAt, updatedAt: new Date().toISOString(), userAgent: navigator.userAgent, current: snapshot(), records, logs, logTotals: logbook.totals, resourceFailures, lastCapture };
}
function renderRecords(): void {
  $('review-results').replaceChildren(...records.map((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.status === 'ok' ? '已渲染' : entry.status === 'cancelled' ? '已中止（未通过）' : '异常'} · ${entry.scenario.label} · ${entry.measuredFps ?? '—'} FPS · 加载 ${entry.loadSeconds.toFixed(1)} 秒 · ${entry.errors.length} 错误`;
    li.style.color = entry.status === 'ok' ? '#89edb9' : entry.status === 'cancelled' ? '#ffd38c' : '#ff998a';
    return li;
  }));
  const json = JSON.stringify(report(), null, 2);
  $<HTMLTextAreaElement>('review-json').value = json;
  artifactLink('report-download', new Blob([json], { type: 'application/json' }), 'rotor-trails-render-review.json');
}
function artifactLink(id: string, blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = $<HTMLAnchorElement>(id);
  const previous = artifactUrls.get(id);
  anchor.href = url;
  anchor.download = filename;
  anchor.textContent = filename;
  anchor.hidden = false;
  artifactUrls.set(id, url);
  if (previous) URL.revokeObjectURL(previous);
  return url;
}

$('load').addEventListener('click', async () => {
  if (busy) return;
  stopRequested = false;
  setBusy(true);
  progress.max = 1;
  progress.value = 0;
  try {
    await recordScenario(configuration());
    progress.value = 1;
    $('stage').textContent = records.at(-1)?.status === 'ok' ? '场景与模型资源就绪，可切换机位或保存画面' : records.at(-1)?.status === 'cancelled' ? '已中止，本次未计为通过。' : '验收未通过，请检查资源完整性与错误日志。';
  }
  finally { setBusy(false); }
});
$('auto').addEventListener('click', async () => {
  if (busy) return;
  stopRequested = false;
  setBusy(true);
  const includeRay = rayInput.checked;
  const scenarios: Scenario[] = MAPS.map((map) => ({ label: `六地图 / ${map.name}`, map: map.id, weather: map.defaultWeather, time: 'day', quality: 'medium', ray: false, pose: 'cruise' }));
  for (const time of ['day', 'night', 'day'] as const) scenarios.push({ label: `同图时段切换 / ${time}`, map: 'japan', weather: getMap('japan').defaultWeather, time, quality: 'medium', ray: false, pose: 'pad' });
  for (const quality of ['low', 'medium', 'high', 'ultra', 'low'] as const) scenarios.push({ label: `同图画质切换 / ${quality}`, map: 'japan', weather: getMap('japan').defaultWeather, time: 'day', quality, ray: false, pose: 'cruise' });
  if (includeRay) for (const ray of [true, false]) scenarios.push({ label: `光追切换 / ${ray ? '开启' : '关闭'}`, map: 'japan', weather: getMap('japan').defaultWeather, time: 'day', quality: 'high', ray, pose: 'cruise' });
  progress.max = scenarios.length;
  progress.value = 0;
  try {
    for (const [index, scenario] of scenarios.entries()) {
      if (stopRequested) break;
      $('stage').textContent = `自动巡检 ${index + 1}/${scenarios.length}：${scenario.label}`;
      await recordScenario(scenario);
      progress.value = index + 1;
    }
    $('stage').textContent = stopRequested ? '已停止巡检。已有结果可下载。' : `巡检完成：${scenarios.length} 个场景。请人工核对画面，下载记录留档。`;
  } finally { setBusy(false); renderRecords(); }
});
$('stop').addEventListener('click', () => { stopRequested = true; $('stage').textContent = '正在停止；若地图仍在加载，会在当前加载结束后停止。'; });
$('export').addEventListener('click', () => { renderRecords(); $('stage').textContent = 'JSON 链接已更新，可在下方下载；链接保留到下一次更新或关闭页面。'; });
$('capture').addEventListener('click', async () => {
  if (!app?.session || busy) return;
  const instance = app;
  const scenario = structuredClone(latestScenario ?? configuration());
  const capturePose = pose;
  const camera = instance.view.rig.mode;
  const captureState = snapshot();
  const capturedAt = new Date().toISOString();
  const filename = `rotor-${scenario.map}-${scenario.time}-${camera}-${capturePose}-${scenario.quality}.png`;
  capturing = true;
  setBusy(true);
  $('stage').textContent = '正在生成 PNG，已暂时锁定场景与机位，最多等待 15 秒…';
  try {
    const blob = await captureCanvasPng(instance.view.renderer.domElement);
    const url = artifactLink('capture-download', blob, filename);
    const preview = $<HTMLImageElement>('capture-preview');
    preview.alt = `${getMap(scenario.map).name} · ${TIME_OF_DAY[scenario.time].label} · ${camera} · ${capturePose} · ${QUALITY[scenario.quality].label}`;
    preview.src = url;
    preview.dataset.filename = filename;
    $('capture-caption').textContent = `${filename} · ${(blob.size / 1024).toFixed(0)} KB · ${capturedAt}`;
    $('capture-output').hidden = false;
    lastCapture = { capturedAt, filename, bytes: blob.size, scenario, pose: capturePose, camera, snapshot: captureState };
    renderRecords();
    $('stage').textContent = 'PNG 已生成。下方可查看预览或使用固定下载链接；请检查实际画面。';
  } catch (error) {
    const message = describe(error);
    log('error', `PNG 生成失败：${message}`);
    $('stage').textContent = `PNG 生成失败：${message}`;
  } finally {
    capturing = false;
    setBusy(false);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => { app?.view.rig.setMode(button.dataset.view as 'cockpit' | 'chase'); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pose]')) button.addEventListener('click', () => positionCamera(button.dataset.pose as Pose));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-look]')) button.addEventListener('click', () => app?.debugLook(button.dataset.look === 'left' ? 1.2 : button.dataset.look === 'right' ? -1.2 : 0, -0.09));
hudInput.addEventListener('change', () => app?.hud.show(hudInput.checked));
$('collapse').addEventListener('click', () => {
  const collapsed = $('review').classList.toggle('collapsed');
  $('collapse').textContent = collapsed ? '展开工具' : '收起工具';
});
setInterval(() => {
  if (!app) return;
  const state = snapshot();
  const fixtures = app.view.scene.getObjectByName('Helipad fixtures');
  $('review-status').textContent = `${app.state} · ${Math.round(app.fps)} FPS\n${app.view.info()}\n${app.gpu}\n画布 ${app.view.renderer.domElement.width} × ${app.view.renderer.domElement.height} · 机位 ${pose} / ${poseSurface}\n光追 ${app.settings.rayTracing ? '开' : '关'} · 聚光灯 ${state.spotLights} · 错误 ${logbook.totals.error}\n模型完整性：${state.assetsComplete ? '通过' : '未通过'} · 资源失败 ${resourceFailures.length}\n座舱 ${app.view.cockpit.loaded ? '已载入' : '未载入'} · 机身 ${app.view.heli.extLoaded ? '已载入' : '未载入'} · 坪灯 ${fixtures?.userData.modelLoaded ? '模型' : '回退'}/${fixtures?.children.length ?? 0}`;
  if (app.state === 'loading') {
    const label = app.ui.root.querySelector('.llabel')?.textContent;
    if (label) $('stage').textContent = label;
  }
}, 500);
renderRecords();
