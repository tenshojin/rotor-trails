// 渲染总控：three.js WebGPU 渲染器（不支持 WebGPU 的浏览器自动退回 WebGL2 后端）、场景、光照、分层阴影、
// 天空/环境贴图、地形、水、道具、植被、导航标记、天气特效、直升机与座舱，以及按画质分档的后期管线（post.ts，
// 含“光线追踪”开关）。每次只加载一张地图的资源，切换地图时完整释放（避免内存泄漏）。

import * as THREE from 'three/webgpu';
import type { GameSession } from '../sim/session';
import type { WorldData } from '../world/worldgen';
import type { WeatherParams } from '../sim/weather';
import { QUALITY, type Settings } from '../game/settings';
import { CameraRig } from './cameraRig';
import { CABIN_FILL, CABIN_NIGHT, Cockpit, EYE } from './cockpit';
import { HeliModel } from './heliModel';
import { loadModelLib, MODEL_FILES, type ModelLib } from './modelLib';
import { loadDetailTextures } from './detailTextures';
import { NavView } from './navView';
import { PropsView } from './propsView';
import { SkyDome } from './sky';
import { FOG, sceneFog } from './atmosphere';
import { buildPost, protectTransparent, SCOTOPIC, type Post } from './post';
import { markNearShadow, SunShadows } from './sunShadows';
import type { MapDef } from '../maps/types';
import { loadTerrainLayers, type TerrainLayers } from './terrainLayers';
import { makeTerrainUniforms, TerrainView, type TerrainUniforms } from './terrainView';
import { makeForestTexture, makeGroundHeightTexture, makeMinimapCanvas, makeSurfaceTexture, makeWaterDepthTexture } from './textures';
import { fogMaps, VFOG } from './volumetricFog';
import { DownwashView } from './downwash';
import { NightLights } from './nightLights';
import { PadDetails } from './padDetails';
import { makeReflectField } from './reflectMap';
import { GroundCover } from './groundCover';
import { RiverView } from './riverView';
import { EYE_DEFAULT, EyeAdapt } from './eyeAdapt';
import { clearSunMap, setSunMap } from './sunMap';
import { bakeGi, clearGiMap, disposeGi, GI, giGroundLight, setGiMap } from './giField';
import { sunFor, type TimeOfDay } from './timeOfDay';
import { WET, WINDOW_LIGHT } from './wetness';
import { updateCloudShadowMap } from './cloudShadowMap';
import { loadRockRelief, makeTerrainMacroTexture } from './terrainMacro';
import { TreeView, loadTreeLib } from './treeView';
import { WaterView } from './water';
import { CloudLayer, Lightning, RainFx } from './weatherFx';
import type { InstrumentData } from './instruments';

export interface FrameInfo {
  dt: number;
  t: number;
  alpha: number;
}

const _cabinGlow = new THREE.Color(0.018, 0.0132, 0.0102);
const _cloudGrey = new THREE.Color(0.86, 0.88, 0.9);
const _ground = new THREE.Color();
const _groundLit = new THREE.Color();
const _cabinBounce = new THREE.Color();
const _cabinWarm = new THREE.Color(1.0, 0.9, 0.76);
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _w = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _project = new THREE.Vector3();

export class WorldView {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  /** 太阳光（分层阴影） */
  readonly sun: SunShadows;
  readonly hemi: THREE.HemisphereLight;
  private csmFov = 0;
  private csmAspect = 0;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.CubeRenderTarget | null = null;
  private envKey = '';
  private envT = -10;
  private post: Post | null = null;
  /** 当前后期管线的配置（变化时重建） */
  private postKey = '';
  private warm = false;
  private envSize = 0;
  /** 已经画了多少帧 */
  frames = 0;
  /** renderer.init() 完成后才能渲染 */
  private ready = false;
  private gbT = -10;
  private trackGpu = false;
  private gpuBusy = false;
  /** GPU 每帧耗时的滑动平均（毫秒），只在 ?gputime=1 时有值 */
  gpuMs = 0;
  /** 上一帧的绘制次数与三角形数（含阴影与后期） */
  readonly frameStats = { calls: 0, tris: 0 };
  private settings: Settings;
  /** Snapshot values, since the caller may mutate its Settings object in place. */
  private appliedSettings: Pick<Settings, 'quality' | 'renderScale' | 'rayTracing' | 'motionBlur' | 'volumetric' | 'navGuides' | 'lightning'> | null = null;
  private renderWidth = 0;
  private renderHeight = 0;
  private pixelRatio = 0;
  // 地图相关
  world: WorldData | null = null;
  sky: SkyDome | null = null;
  terrain: TerrainView | null = null;
  terrainUniforms: TerrainUniforms | null = null;
  private terrainTexSize = 0;
  private terrainRequestedSize: number | null = null;
  private terrainVersion = 0;
  private terrainRefresh: Promise<void> | null = null;
  water: WaterView | null = null;
  props: PropsView | null = null;
  private modelLib: ModelLib | null = null;
  /** 生成世界期间就开始下载的地图资源（见 prefetch） */
  private early: { id: string; texSize: number; layers: Promise<TerrainLayers | null>; lib: Promise<ModelLib | null> } | null = null;
  trees: TreeView | null = null;
  nav: NavView | null = null;
  rain: RainFx;
  clouds: CloudLayer | null = null;
  readonly lightning = new Lightning();
  readonly heli: HeliModel;
  readonly cockpit: Cockpit;
  minimap: HTMLCanvasElement | null = null;
  private mapTextures: THREE.Texture[] = [];
  /** 雾最浓的基准高度（地图最低处） */
  private fogBaseY = 0;
  /** 时段（白天 / 清晨 / 黄昏），只影响画面 */
  private tod: TimeOfDay = 'day';
  /** 人眼适应（自动曝光） */
  readonly eye = new EyeAdapt();
  private wash: DownwashView | null = null;
  private lamps: NightLights | null = null;
  private padDetails: PadDetails | null = null;
  /** 着陆灯（夜晚才放进场景：多一盏灯所有材质都要重新编译） */
  private landing: THREE.SpotLight | null = null;
  private rivers: RiverView | null = null;
  private grass: GroundCover | null = null;
  /** 光线追踪的全局光照：探针图要不要重算；算的时候太阳多亮（天气变了按比例调）；正在并行编译（那时什么都画不出来） */
  private giDirty = true;
  private giSun = 1;
  private compiling = false;
  flash = 0;
  /** 雷声回调（音频层） */
  onThunder: ((delay: number, strength: number) => void) | null = null;
  inCloud = 0;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    // 反向深度缓冲：近裁剪面几厘米（座舱）到远处几千米都有足够的深度精度
    // ?backend=webgl：强制使用 WebGL2 后端（测试不支持 WebGPU 的浏览器时的表现）
    const params = new URLSearchParams(location.search);
    const forceWebGL = params.get('backend') === 'webgl';
    // ?gputime=1：用 GPU 时间戳测每帧渲染耗时（window.__gpuMs，毫秒；调画质档位用）
    this.trackGpu = params.get('gputime') === '1';
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true, forceWebGL, trackTimestamp: this.trackGpu });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral：高光柔和滚降，中间调颜色基本不偏（天空、海水、植被都接近照片），对比度和饱和度在 post.ts 的调色里补
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // 绘制统计按整帧累计（后期管线一帧里有多次 render，自动清零只会留下最后一次）
    r.info.autoReset = false;
    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.scene.add(this.rig.camera);
    this.scene.fogNode = sceneFog();
    this.sun = new SunShadows(this.scene, this.rig.camera, QUALITY[settings.quality].shadowSize);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 0.6);
    this.scene.add(this.hemi);
    this.rain = new RainFx(9000);
    this.scene.add(this.rain.mesh);
    this.heli = new HeliModel();
    this.cockpit = new Cockpit();
    this.heli.root.add(this.cockpit.root);
    this.scene.add(this.heli.root);
  }

  /** 初始化 GPU（WebGPU 不可用时退回 WebGL2），必须在第一次渲染前 await。 */
  async init(): Promise<void> {
    await this.renderer.init();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.ready = true;
    this.applySettings(this.settings);
  }

  /** 实际使用的后端与显卡名称 */
  gpuInfo(): { backend: 'WebGPU' | 'WebGL2'; name: string } {
    type AdapterInfo = { vendor?: string; architecture?: string; description?: string; device?: string };
    const b = this.renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { adapterInfo?: AdapterInfo }; gl?: WebGL2RenderingContext };
    if (b.isWebGPUBackend) {
      // three.js 不保存适配器对象；GPUDevice.adapterInfo（Chrome 128+）里有厂商与架构
      const i = b.device?.adapterInfo ?? {};
      return { backend: 'WebGPU', name: [i.vendor, i.architecture, i.description || i.device].filter(Boolean).join(' ') };
    }
    let name = '';
    try {
      const gl = b.gl!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      /* 拿不到显卡名：留空 */
    }
    return { backend: 'WebGL2', name };
  }

  applySettings(s: Settings, force = false): void {
    const previous = this.appliedSettings;
    const qualityChanged = force || !previous || previous.quality !== s.quality;
    this.settings = s;
    this.rig.camera.fov = s.fov;
    if (this.nav && (force || !previous || previous.navGuides !== s.navGuides)) this.nav.guides = s.navGuides;
    const q = QUALITY[s.quality];
    if (qualityChanged) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.sun.setShadows(q.shadows, q.shadowSize);
      if (this.terrain) {
        this.terrain.lodScale = q.terrainLod;
        this.terrain.shadowRange = q.shadowRange;
      }
      if (this.trees) this.trees.quality = { near: q.treeNear, far: q.treeFar, shadows: q.shadows, aa: q.msaa > 0 };
      if (this.props) this.props.lodScale = q.terrainLod;
      // 高画质起用光线步进的体积积云（低、中用二维云层）
      this.sky?.setVolumetric(s.quality === 'ultra' ? 56 : s.quality === 'high' ? 40 : 0);
      this.envKey = '';
    }
    // Usually a no-op; also permits a failed texture request to be retried without
    // rebuilding any already-working render resources.
    this.syncTerrainQuality(q.terrainTex);
    // 水面倒影：低画质没有后期管线，省掉（开了光线追踪就有后期，倒影也要留着）
    if (qualityChanged || previous?.rayTracing !== s.rayTracing) {
      const mirror = s.quality === 'low' && !s.rayTracing ? 0 : 1;
      if (this.water) this.water.ssr.value = mirror;
      if (this.rivers) this.rivers.ssr.value = mirror;
    }
    if (force || previous?.lightning !== s.lightning) this.lightning.enabled = s.lightning;
    if (qualityChanged || previous?.rayTracing !== s.rayTracing || previous?.motionBlur !== s.motionBlur || previous?.volumetric !== s.volumetric) this.buildPost();
    if (qualityChanged || previous?.renderScale !== s.renderScale) this.resize();
    else this.syncCameraProjection();
    this.appliedSettings = { quality: s.quality, renderScale: s.renderScale, rayTracing: s.rayTracing, motionBlur: s.motionBlur, volumetric: s.volumetric, navGuides: s.navGuides, lightning: s.lightning };
  }

  /** Change texture quality without rebuilding the map or interrupting a flight. */
  private syncTerrainQuality(size: number): void {
    const world = this.world;
    const terrain = this.terrain;
    const uniforms = this.terrainUniforms;
    if (!world || !terrain || !uniforms) return;
    if (this.terrainRefresh && this.terrainRequestedSize === size) return;
    if (size === this.terrainTexSize && !this.terrainRefresh) return;
    const version = ++this.terrainVersion;
    this.terrainRefresh = null;
    this.terrainRequestedSize = null;
    // Returning to the current material cancels a pending upgrade without
    // recreating that material. Its late result is released by the version guard.
    if (size === this.terrainTexSize) return;
    const replace = (layers: TerrainLayers | null): void => {
      const previous = uniforms.layers;
      terrain.setLayers(layers);
      if (previous) {
        this.mapTextures = this.mapTextures.filter((t) => t !== previous.color && t !== previous.normal);
        previous.color.dispose();
        previous.normal.dispose();
      }
      if (layers) this.mapTextures.push(layers.color, layers.normal);
    };
    if (size === 0) {
      replace(null);
      this.terrainTexSize = 0;
      return;
    }
    this.terrainRequestedSize = size;
    this.terrainRefresh = loadTerrainLayers(world.map.id, world.map.biome, size)
      .then((layers) => {
        if (!layers) return;
        // A newer quality selection or a map unload can overtake the download.
        if (version !== this.terrainVersion || this.world !== world || this.terrain !== terrain) {
          layers.color.dispose();
          layers.normal.dispose();
          return;
        }
        try {
          replace(layers);
          this.terrainTexSize = size;
        } catch (error) {
          layers.color.dispose();
          layers.normal.dispose();
          throw error;
        }
      })
      .catch((error) => console.warn('地形材质切换失败，保留现有画面：', error))
      .finally(() => {
        if (version === this.terrainVersion) {
          this.terrainRefresh = null;
          this.terrainRequestedSize = null;
        }
      });
  }

  /** 时段：换太阳位置（地图已加载时立刻生效），环境贴图随后重新烘焙 */
  setTimeOfDay(tod: TimeOfDay): void {
    const changed = this.tod !== tod;
    this.tod = tod;
    if (this.sky && this.world) {
      const [az, el] = sunFor(this.world.map, tod);
      this.eye.snap();
      this.sky.setSun(az, el);
      this.sky.setNight(tod === 'night');
      this.eye.setMax(tod === 'night' ? 3.6 : EYE_DEFAULT.max);
      this.updateLandingLight();
      if (changed) {
        setSunMap(this.world.terrain, this.sky.sunDir);
        this.sky.clouds.reset();
        this.giDirty = true;
      }
    }
    // 太阳很低时远处的山也会把影子投进谷里：阴影框往太阳方向多留一些距离
    this.sun.csm.lightMargin = this.sky ? 400 + 1800 * (1 - this.sky.dayK) : 400;
    this.envKey = '';
  }

  /** The same map can be restarted at a different time without reloading it. */
  private updateLandingLight(): void {
    if (this.tod === 'night' && !this.landing) {
      const light = new THREE.SpotLight(0xfff0dc, 0, 900, 0.24, 1, 1.7);
      light.castShadow = false;
      this.scene.add(light, light.target);
      this.landing = light;
    } else if (this.tod !== 'night' && this.landing) {
      this.scene.remove(this.landing, this.landing.target);
      this.landing.dispose();
      this.landing = null;
    }
  }

  /** 后期管线（见 post.ts）：画质或光线追踪开关变化时重建。 */
  private buildPost(): void {
    if (!this.ready) return;
    const s = this.settings;
    const key = `${s.quality}_${s.rayTracing}_${s.motionBlur}_${s.volumetric}`;
    if (key === this.postKey && this.post) return;
    const next = buildPost(this.renderer, this.scene, this.rig.camera, this.sun, { quality: s.quality, rayTracing: s.rayTracing, motionBlur: s.motionBlur, volumetric: s.volumetric });
    const previous = this.post;
    this.post = next;
    this.postKey = key;
    previous?.dispose();
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = Math.max(1, c.clientWidth || window.innerWidth);
    const h = Math.max(1, c.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.settings.quality].pixelRatio) * this.settings.renderScale;
    if (w !== this.renderWidth || h !== this.renderHeight || dpr !== this.pixelRatio) {
      // One resize notification, even when both viewport and display DPR change.
      this.renderer.setDrawingBufferSize(w, h, dpr);
      this.renderWidth = w;
      this.renderHeight = h;
      this.pixelRatio = dpr;
    }
    this.rig.camera.aspect = w / h;
    this.syncCameraProjection();
  }

  private syncCameraProjection(): void {
    const cam = this.rig.camera;
    if (cam.fov === this.csmFov && cam.aspect === this.csmAspect) return;
    cam.updateProjectionMatrix();
    this.sun.updateFrustums();
    this.csmFov = cam.fov;
    this.csmAspect = cam.aspect;
  }

  /** 生成世界要占主线程好几秒：这段时间网络和解码线程闲着，先把这张图要的模型和贴图下载起来。 */
  prefetch(map: MapDef): void {
    const texSize = QUALITY[this.settings.quality].terrainTex;
    if (this.early?.id === map.id && this.early.texSize === texSize) return;
    this.discardPrefetch();
    const file = MODEL_FILES[map.id];
    void loadRockRelief();
    void loadDetailTextures();
    void loadTreeLib();
    this.early = { id: map.id, texSize, layers: texSize > 0 ? loadTerrainLayers(map.id, map.biome, texSize) : Promise.resolve(null), lib: file ? loadModelLib(file) : Promise.resolve(null) };
  }

  private discardPrefetch(): void {
    const early = this.early;
    this.early = null;
    if (!early) return;
    void early.layers.then((layers) => {
      layers?.color.dispose();
      layers?.normal.dispose();
    });
    void early.lib.then((lib) => lib?.dispose());
  }

  /** 构建地图视觉资源。 */
  async load(world: WorldData, progress?: (p: number, label: string) => void): Promise<void> {
    const texSize = QUALITY[this.settings.quality].terrainTex;
    const early = this.early?.id === world.map.id && this.early.texSize === texSize ? this.early : null;
    if (early) this.early = null;
    this.unload();
    let layersTaken = false;
    let libTaken = false;
    try {
      this.world = world;
      const map = world.map;
      const tick = () => new Promise<void>((r) => setTimeout(r, 0));
      progress?.(0.82, '构建地形网格');
      await tick();
      const surfaceTex = makeSurfaceTexture(world.surface, world.terrain.res);
      const forestTex = makeForestTexture(world.trees, map.size, world.flow);
      // 体积雾：贴地薄雾按离地高度变淡、林区更浓
      const groundTex = makeGroundHeightTexture(world.terrain, map.waterLevel);
      const macroTex = makeTerrainMacroTexture(world.terrain);
      this.mapTextures.push(surfaceTex, forestTex, groundTex, macroTex);
      await loadRockRelief();
      // 水面倒影飞出画面后接着走的地形图
      const field = makeReflectField(map, world.terrain, world.trees, world.surface, macroTex.image.data as Uint8Array, forestTex.image.data as Uint8Array);
      this.mapTextures.push(field.height, field.color);
      setGiMap(field, map.waterLevel);
      this.giDirty = true;
      fogMaps.height = groundTex;
      fogMaps.forest = forestTex;
      VFOG.mapSize.value = map.size;
      progress?.(0.84, '加载地形材质');
      const layers = early ? await early.layers : texSize > 0 ? await loadTerrainLayers(map.id, map.biome, texSize) : null;
      if (layers) this.mapTextures.push(layers.color, layers.normal);
      layersTaken = true;
      this.terrainTexSize = layers ? texSize : 0;
      this.terrainUniforms = makeTerrainUniforms(map, surfaceTex, forestTex, macroTex, layers);
      if (this.terrainUniforms.strataLUT) this.mapTextures.push(this.terrainUniforms.strataLUT);
      this.terrain = new TerrainView(map, world.terrain, this.terrainUniforms);
      this.scene.add(this.terrain.group);
      const [sunAz, sunEl] = sunFor(map, this.tod);
      this.sky = new SkyDome(sunAz, sunEl, map.biome.fogTint, map.biome.grass, this.tod === 'night');
      this.eye.setMax(this.tod === 'night' ? 3.6 : EYE_DEFAULT.max);
      this.updateLandingLight();
      this.sun.csm.lightMargin = 400 + 1800 * (1 - this.sky.dayK);
      setSunMap(world.terrain, this.sky.sunDir);
      this.eye.snap();
      this.scene.add(this.sky.mesh);
      // 雾的基准高度：地图最低处（有水面时取水面）
      const hf = world.terrain;
      let minH = Infinity;
      for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32; j++) minH = Math.min(minH, hf.heightAt(-hf.half + (i * hf.size) / 32, -hf.half + (j * hf.size) / 32));
      this.fogBaseY = map.waterLevel !== null ? Math.max(minH, map.waterLevel) : minH;
      // 积云层：一般在雾的基准高度之上 1300 m（夏季海边的晴天积云底约 1000~1500 m），且高于最高的山顶
      let maxH = -Infinity;
      for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32; j++) maxH = Math.max(maxH, hf.heightAt(-hf.half + (i * hf.size) / 32, -hf.half + (j * hf.size) / 32));
      const cloudBase = Math.max(this.fogBaseY + 1300, maxH + 250);
      this.sky.setVolumetric(0, cloudBase, cloudBase + 1300);
      if (map.waterLevel !== null) {
        const depth = makeWaterDepthTexture(world.terrain, map.waterLevel);
        this.mapTextures.push(depth);
        this.water = new WaterView(map, depth, (this.renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true, field, this.sky);
        this.scene.add(this.water.mesh);
      }
      progress?.(0.88, '构建建筑与植被');
      await tick();
      const modelFile = MODEL_FILES[map.id];
      const [lib, detail, treeLib] = await Promise.all([early ? early.lib : modelFile ? loadModelLib(modelFile) : Promise.resolve(null), loadDetailTextures(), loadTreeLib()]);
      this.modelLib = lib;
      libTaken = true;
      this.props = new PropsView(world, this.modelLib, detail);
      this.props.lodScale = QUALITY[this.settings.quality].terrainLod;
      this.scene.add(this.props.group);
      this.trees = new TreeView(world.trees, treeLib, map.biome.rock);
      this.scene.add(this.trees.group);
      this.nav = new NavView(map, (this.renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true);
      this.nav.guides = this.settings.navGuides;
      this.scene.add(this.nav.group);
      this.wash = new DownwashView(map);
      this.scene.add(this.wash.group);
      this.lamps = new NightLights(world);
      this.scene.add(this.lamps.group);
      this.padDetails = new PadDetails(map);
      this.scene.add(this.padDetails.group);
      this.grass = new GroundCover(world, forestTex);
      this.scene.add(this.grass.group);
      if (map.rivers) {
        this.rivers = new RiverView(map.rivers, (this.renderer as unknown as { reversedDepthBuffer?: boolean }).reversedDepthBuffer === true, field, this.sky);
        this.scene.add(this.rivers.group);
      }
      this.clouds = new CloudLayer(map.size);
      this.scene.add(this.clouds.group);
      this.minimap = makeMinimapCanvas(map, world.terrain, world.trees);
      this.cockpit.minimap = this.minimap;
      if (!this.cockpit.loaded || !this.heli.extLoaded) {
        progress?.(0.92, '加载直升机模型');
        await Promise.all([this.cockpit.ready, this.heli.ready]);
      }
      await this.padDetails.ready;
      this.applySettings(this.settings, true);
      await this.terrainRefresh;
      protectTransparent(this.scene);
      markNearShadow(this.scene);
      progress?.(0.96, '编译着色器');
      await tick();
    } catch (error) {
      this.unload();
      throw error;
    } finally {
      // The model may still be decoding if an earlier construction step failed.
      if (early && !layersTaken) void early.layers.then((layers) => {
        layers?.color.dispose();
        layers?.normal.dispose();
      });
      if (early && !libTaken) void early.lib.then((lib) => lib?.dispose());
    }
  }

  unload(): void {
    this.terrainVersion++;
    this.terrainTexSize = 0;
    this.terrainRequestedSize = null;
    this.terrainRefresh = null;
    this.discardPrefetch();
    const rm = (o: THREE.Object3D | undefined) => o && this.scene.remove(o);
    rm(this.terrain?.group);
    rm(this.sky?.mesh);
    rm(this.water?.mesh);
    rm(this.props?.group);
    rm(this.trees?.group);
    rm(this.nav?.group);
    rm(this.wash?.group);
    rm(this.lamps?.group);
    rm(this.padDetails?.group);
    rm(this.landing?.target);
    rm(this.landing ?? undefined);
    rm(this.rivers?.group);
    rm(this.grass?.group);
    rm(this.clouds?.group);
    this.terrain?.dispose();
    this.sky?.clouds.dispose();
    this.sky?.material.dispose();
    this.sky?.mesh.geometry.dispose();
    this.water?.dispose();
    this.props?.dispose();
    this.modelLib?.dispose();
    this.modelLib = null;
    this.trees?.dispose();
    this.nav?.dispose();
    this.wash?.dispose();
    this.wash = null;
    this.lamps?.dispose();
    this.lamps = null;
    this.padDetails?.dispose();
    this.padDetails = null;
    this.landing?.dispose();
    this.landing = null;
    this.rivers?.dispose();
    this.rivers = null;
    this.grass?.dispose();
    this.grass = null;
    clearSunMap();
    clearGiMap();
    this.clouds?.dispose();
    for (const t of this.mapTextures) t.dispose();
    this.mapTextures = [];
    fogMaps.height = fogMaps.forest = null;
    this.terrain = this.water = this.props = this.trees = this.nav = this.clouds = this.sky = null;
    this.world = null;
    this.terrainUniforms = null;
    this.minimap = null;
    this.cockpit.minimap = null;
    this.scene.environment = null;
    this.envRT?.dispose();
    this.envRT = null;
    this.envKey = '';
  }

  /** 天气变化时重新烘焙环境贴图（限频）。 */
  /** 下一帧重烘环境贴图（并行编译期间不画，那时烘出来的是空的） */
  refreshEnv(): void {
    this.giDirty = true;
    this.envKey = '';
    this.envT = -10;
  }

  private updateEnv(w: WeatherParams, t: number): void {
    if (!this.sky) return;
    const key = `${w.overcast.toFixed(1)}_${w.rain.toFixed(1)}_${Math.round(Math.log(w.visibility) * 2)}_${this.settings.quality}_${this.tod}`;
    // 第一张环境贴图不等：从“没有环境贴图”变成“有”时所有材质都要重新编译，越早越好
    if (key === this.envKey || (this.envRT && t - this.envT < 2)) return;
    const envScene = new THREE.Scene();
    const m = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envScene.add(m);
    if (!this.pmrem) return;
    // 环境贴图里不画太阳圆盘（阳光的高光由方向光负责，否则光滑表面上会出现两个太阳）
    const endBake = this.sky.beginEnvBake();
    // 大小不变时写回同一张贴图：换一张新贴图的话，场景里所有材质都要重新编译（天气变化时会卡好几秒）
    const size = QUALITY[this.settings.quality].envSize;
    const old = this.envRT;
    const keep = old && this.envSize === size ? old : null;
    try {
      this.envRT = this.pmrem.fromScene(envScene, 0, 1, 10000, { size, renderTarget: keep });
    } finally {
      endBake();
    }
    this.envKey = key;
    this.envT = t;
    this.envSize = size;
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    if (old !== this.envRT) old?.dispose();
  }

  /**
   * 预热：打开时每帧把场景里所有物体都画一遍（隐藏的也画、不做视锥剔除），把渲染管线全部编译好。
   * 否则第一次转头、第一次飞近某种树、第一次下雨时都要现场编译，画面会卡住一两秒。
   */
  setWarm(on: boolean): void {
    this.warm = on;
  }

  /**
   * 并行编译：之后新建的渲染管线都走异步接口，没编译好的物体先不画。
   * 渲染时 three.js 用的是同步接口，显卡进程只能一个接一个地编译（实测一百多条管线排队 20 多秒，主线程全程空等）；
   * 异步接口能同时编译。返回的函数等全部编译完，并恢复原来的做法。
   * cancel() 同步恢复绘制接口（例如预热超时）；已提交的 GPU 编译仍由返回函数收尾。
   */
  parallelCompile(): (() => Promise<void>) & { cancel(): void } {
    interface Ro {
      pipeline: unknown;
    }
    interface PipelineData {
      pipeline?: unknown;
      error?: boolean;
    }
    const r = this.renderer as unknown as {
      _pipelines: { getForRender(ro: Ro, promises?: Array<Promise<void>> | null): unknown };
      backend: { isWebGPUBackend?: boolean; get(o: unknown): PipelineData; draw(ro: Ro, info: unknown): void };
    };
    const P = r._pipelines;
    const B = r.backend;
    if (!B.isWebGPUBackend) return Object.assign(() => Promise.resolve(), { cancel() {} });
    const list: Array<Promise<void>> = [];
    const pipelineData = new Set<PipelineData>();
    const get = P.getForRender;
    const draw = B.draw;
    this.compiling = true;
    P.getForRender = function (ro, promises = null) {
      const offset = list.length;
      const result = get.call(P, ro, promises ?? list);
      // Three reports WebGPU validation failures on the data object while its
      // compilation promise still resolves. Capture it now: completion must not
      // query a backend that may already have been disposed after cancellation.
      if (result) pipelineData.add(B.get(result));
      // Warm-up renders several frames before awaiting completion. Mark failures
      // as observed immediately; allSettled below still reports the original error.
      for (let i = offset; i < list.length; i++) void list[i].catch(() => {});
      return result;
    };
    B.draw = function (ro, info) {
      if (B.get(ro.pipeline).pipeline) draw.call(B, ro, info);
    };
    let restored = false;
    const cancel = () => {
      if (restored) return;
      restored = true;
      P.getForRender = get;
      B.draw = draw;
      this.compiling = false;
    };
    let completion: Promise<void> | null = null;
    const complete = () => completion ??= (async () => {
      try {
        // 等的时候还在画帧，可能又添了新的管线。先等所有编译收尾，
        // 再报告失败；无论成功与否都恢复正常渲染函数。
        const failures: PromiseRejectedResult[] = [];
        for (let done = 0; done < list.length; ) {
          const n = list.length;
          const results = await Promise.allSettled(list.slice(done));
          for (const result of results) if (result.status === 'rejected') failures.push(result);
          done = n;
        }
        if (failures.length) throw failures[0].reason;
        for (const data of pipelineData) if (data.error) throw new Error('着色器编译失败，请重试或降低画质');
      } finally {
        cancel();
      }
    })();
    return Object.assign(complete, { cancel });
  }

  /** 等显卡把已提交的工作（包括着色器编译）都做完；WebGL2 后端没有这个接口，直接返回 */
  async gpuIdle(): Promise<void> {
    await (this.renderer.backend as unknown as { device?: GPUDevice }).device?.queue.onSubmittedWorkDone();
  }

  private forceAllVisible(): () => void {
    const undo: Array<[THREE.Object3D, boolean, boolean]> = [];
    this.scene.traverse((o) => {
      undo.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    return () => {
      for (const [o, v, c] of undo) {
        o.visible = v;
        o.frustumCulled = c;
      }
    };
  }

  /** 每帧渲染。session 为空时（主菜单）使用 idlePose。 */
  render(s: GameSession | null, f: FrameInfo, idle?: { pos: THREE.Vector3; target: THREE.Vector3; fov?: number }): void {
    const world = this.world;
    const cam = this.rig.camera;
    const set = this.settings;
    let weather: WeatherParams | null = null;
    if (s) {
      _pos.lerpVectors(s.prev.pos, s.body.pos, f.alpha);
      _quat.slerpQuaternions(s.prev.quat, s.body.quat, f.alpha);
      _vel.copy(s.body.vel);
      weather = s.weather.current;
      this.heli.root.position.copy(_pos);
      this.heli.root.quaternion.copy(_quat);
      this.heli.root.visible = true;
      const tel = s.flight.telemetry;
      const load = Math.min(1.5, tel.thrust / (s.totalMass() * 9.81));
      this.heli.update(f.t, f.dt, s.state === 'crashed' ? Math.max(0, tel.rotorRpm * 0.3) : tel.rotorRpm);
      const eyeX = EYE.x * (1 - set.viewCenter);
      this.cockpit.setPilotOffset(eyeX - EYE.x);
      this.rig.update(f.dt, f.t, _pos, _quat, _vel, load, { fov: set.fov, eyeX, shake: set.shake, headMotion: set.headMotion });
      const cockpitView = this.rig.mode === 'cockpit';
      this.heli.rimDim = this.tod === 'night' ? 0 : 1;
      this.heli.setCockpitView(cockpitView);
      // 有 Blender 外观时座舱模型（含机身外壳）在追尾视角也显示：从外面能透过玻璃看到舱内
      this.cockpit.root.visible = cockpitView || this.heli.extLoaded;
      this.cockpit.updateControls(tel.stickPitch, tel.stickRoll, tel.collective, tel.pedal);
      this.cockpit.updateGlass(f.t, weather.rain, tel.airspeed, s.buffs.shieldActive ? 0.25 + 0.15 * Math.sin(f.t * 6) : 0, this.renderer.toneMappingExposure);
      if (this.landing) {
        // 机头下面的着陆灯：朝前下方，离地面越近越亮堂
        this.landing.position.set(0, -0.9, -2.2).applyQuaternion(_quat).add(_pos);
        this.landing.target.position.set(0, -0.3, -1).applyQuaternion(_quat).multiplyScalar(30).add(this.landing.position);
        this.landing.target.updateMatrixWorld();
        this.landing.intensity = 1100;
      }
    } else if (idle) {
      if (idle.fov && cam.fov !== idle.fov) {
        cam.fov = idle.fov;
        cam.updateProjectionMatrix();
        this.sun.updateFrustums();
      }
      cam.position.copy(idle.pos);
      cam.lookAt(idle.target);
      this.heli.root.visible = true;
      this.heli.setCockpitView(false);
      this.cockpit.root.visible = this.heli.extLoaded && this.cockpit.loaded;
      this.heli.update(f.t, f.dt, 1);
    }
    cam.updateMatrixWorld();
    const cp = cam.position;
    if (world && this.sky) {
      const w = weather ?? world.map.weathers[0].params;
      // 风（相机附近）
      if (s) s.wind.sample(cp.x, cp.y, cp.z, s.t, _w);
      else _w.set(2, 0, 0);
      this.flash = this.lightning.update(f.t, f.dt, w.lightning, (d) => this.onThunder?.(d / 340, Math.max(0.2, 1 - d / 4500)));
      this.sky.update(w, _w.x, _w.z, f.dt, this.flash);
      this.sky.follow(cp);
      const C = this.sky.colors;
      this.sun.setLight(C.sun, C.sunIntensity);
      this.sun.setSunDirection(this.sky.sunDir);
      this.hemi.color.copy(C.hemiSky);
      this.hemi.groundColor.copy(C.hemiGround);
      // 月光照不到的山谷不能是一片死黑：夜空的散射光要够看清地形的轮廓
      this.hemi.intensity = C.hemiIntensity * 0.65 * (this.tod === 'night' ? 24 : 1);
      // 雾：能见度 → 指数平方雾密度（随高度变稀，见 atmosphere.ts）；进入低云层时另加均匀浓雾
      this.inCloud = 0;
      if (w.lowCloud > 0.05) {
        const inside = Math.min(1, Math.max(0, Math.min(cp.y - w.cloudBase + 30, w.cloudTop - cp.y + 30) / 60));
        this.inCloud = inside * w.lowCloud;
      }
      FOG.density.value = 1.65 / Math.max(60, w.visibility);
      FOG.color.value.copy(C.fog).lerp(_cloudGrey, this.inCloud);
      FOG.sunColor.value.copy(C.fogSun).lerp(_cloudGrey, this.inCloud);
      FOG.sunDir.value.copy(this.sky.sunDir);
      FOG.sunFlat.value.copy(this.sky.sunFlat);
      C.ring.forEach((k, i) => (FOG.ring[i].value as THREE.Color).copy(k).lerp(_cloudGrey, this.inCloud));
      FOG.cloud.value = (1.65 / 90) * this.inCloud;
      FOG.heightK.value = 1 / 1100;
      FOG.baseY.value = this.fogBaseY;
      // 体积雾（光束）：贴地薄雾的浓度随能见度与降雨变化，湿润的地图更浓；雾团随风飘动
      VFOG.sun.value.copy(C.sun).multiplyScalar(C.sunIntensity);
      // 月光照得亮地面（曝光开得大），但照不出光柱：夜里按太阳那样算，云底下全是一道道亮条
      VFOG.beam.value = this.tod === 'night' ? 0.08 : 1;
      VFOG.amb.value.copy(FOG.color.value).multiplyScalar(0.9);
      // 舱内补光：地平线一带的天光，混一半内饰反射出来的暖色（否则座舱背光处全是天空的蓝）
      CABIN_FILL.value.copy(FOG.color.value).lerp(_cabinWarm, 0.55).multiplyScalar(0.62 * (1 - 0.35 * w.overcast));
      // 夜里舱内只有仪表的一点余光
      if (this.tod === 'night') CABIN_FILL.value.multiplyScalar(0.02).add(_cabinGlow);
      FOG.glint.value = this.tod === 'night' ? 0.42 : 1;
      // 清晨：谷地与林间的晨雾（更浓、更厚）；清晨与黄昏的低空霾也更重（逆光时的光束最明显）
      const todMist = this.tod === 'dawn' ? 1.9 : this.tod === 'dusk' ? 1.3 : this.tod === 'night' ? 1.25 : 1;
      VFOG.mist.value = Math.min(0.012, Math.max(0.0005, 8 / Math.max(300, w.visibility)) * (world.map.biome.mist ?? 1) * (1 + 0.6 * w.rain) * todMist);
      VFOG.mistH.value = (40 + 30 * w.rain) * (this.tod === 'dawn' ? 1.3 : 1);
      VFOG.haze.value = Math.min(1e-4, 0.25 / Math.max(300, w.visibility)) * (0.6 + 0.4 * (world.map.biome.mist ?? 1)) * (this.tod === 'day' ? 1 : this.tod === 'night' ? 0.6 : 1.7);
      VFOG.shade.value = 1 - Math.min(1, w.overcast * 1.4);
      WINDOW_LIGHT.value = Math.max(this.tod === 'dusk' || this.tod === 'night' ? 1 : this.tod === 'dawn' ? 0.35 : 0, Math.max(0, (w.overcast - 0.6) / 0.4) * 0.45);
      const lampK = this.tod === 'night' ? 1 : this.tod === 'dusk' ? 0.42 : this.tod === 'dawn' ? 0.2 : 0;
      if (this.nav) this.nav.flare = lampK;
      SCOTOPIC.value = this.tod === 'night' ? 1 : 0;
      // 光线追踪的全局光照：上面的太阳、天空都更新过了才能算；天气变暗时反弹光跟着变弱，天光反上来的那部分还在
      if (set.rayTracing && this.giDirty && !this.compiling) {
        bakeGi(this.renderer);
        this.giDirty = false;
        this.giSun = Math.max(C.sunIntensity, 1e-3);
      }
      GI.on.value = set.rayTracing && !this.giDirty ? 1 : 0;
      GI.gain.value = 0.3 + 0.7 * Math.min(1.4, C.sunIntensity / this.giSun);
      // 舱内的光也跟着脚下的地：飞过雪坡整个座舱亮起来，飞过红岩泛暖，飞过深水暗下去
      if (set.rayTracing && giGroundLight(cp.x, cp.z, world.map.size, _ground)) {
        _ground.multiplyScalar(GI.gain.value);
        _groundLit.lerp(_ground, 1 - Math.exp(-2.5 * f.dt));
        CABIN_FILL.value.add(_cabinBounce.copy(_groundLit).multiplyScalar(0.5));
      }
      const nightLight = Math.max(lampK, Math.max(0, (w.overcast - 0.7) / 0.3) * 0.35);
      this.lamps?.update(nightLight);
      this.padDetails?.update(nightLight);
      // 仪表背光：天越暗开得越亮
      CABIN_NIGHT.value = this.tod === 'night' ? 1 : this.tod === 'dusk' ? 0.32 : this.tod === 'dawn' ? 0.2 : Math.max(0, (w.overcast - 0.75) / 0.25) * 0.15;
      VFOG.wind.value.x -= _w.x * f.dt;
      VFOG.wind.value.z -= _w.z * f.dt;
      // 清晨、黄昏整体更暗：曝光只补回一部分（像相机那样稍微提亮，但保留低光的气氛）
      const adapted = this.eye.update(f.dt);
      const fixed = this.tod === 'night' ? 2.8 : 1 + 0.32 * (1 - this.sky.dayK);
      this.renderer.toneMappingExposure = (1.0 - w.overcast * 0.12) * (this.settings.eyeAdapt ? adapted : fixed) + this.flash * 0.6;
      const q = QUALITY[set.quality];
      // 分层阴影：视野或宽高比变了要重新划分；每帧把各层阴影框跟随相机（内部按纹素对齐，避免闪烁）
      this.syncCameraProjection();
      this.sun.update(cam);
      // 兜底：定期给新出现的透明材质套上“只写最终颜色”（见 post.ts keepGBuffer）
      if (f.t - this.gbT > 2 || f.t < this.gbT) {
        this.gbT = f.t;
        protectTransparent(this.scene);
        markNearShadow(this.scene);
      }
      this.updateEnv(w, f.t);
      this.terrain?.update(cp);
      if (this.terrainUniforms) this.terrainUniforms.uWet.value = w.wetness;
      WET.value = w.wetness;
      this.water?.update(f.t, _w.x, _w.z, Math.hypot(_w.x, _w.z), w.rain, cp);
      const windAt = s ? (p: THREE.Vector3, out: THREE.Vector3) => s.wind.sample(p.x, p.y, p.z, s.t, out) : (_p: THREE.Vector3, out: THREE.Vector3) => out.set(3, 0, 1);
      this.props?.update(f.t, cp, windAt);
      const gust = s ? Math.min(1, s.windInfo.gust / 8) : 0.2;
      this.trees?.update(f.t, cam, _w.x, _w.z, gust);
      if (s) this.nav?.update(s, f.t, cp, cam);
      this.rivers?.update(f.t);
      this.grass?.update(f.t, cp);
      if (s && this.wash) {
        this.wash.update(f.dt, s, cam);
        this.water?.setWash(this.wash.state.x, this.wash.state.z, this.wash.state.water);
      }
      this.rain.update(f.t, cp, w.rain, _w, s ? _vel : _zero, q.rainDensity);
      // 低云层：开着体积雾时由它画（按深度积分，和地形没有硬边），否则退回半透明的面片
      const volLow = !!this.post?.fog;
      VFOG.lowK.value = volLow ? w.lowCloud : 0;
      VFOG.lowBase.value = w.cloudBase;
      VFOG.lowTop.value = w.cloudTop;
      this.clouds?.update(f.dt, w.cloudBase, w.cloudTop, volLow ? 0 : w.lowCloud, _w.x, _w.z, w.overcast, cp);
    }
    if (!this.ready) return;
    this.renderer.info.reset();
    // 云影贴图（地面、建筑与体积雾里的云影都从这里查）
    updateCloudShadowMap(this.renderer, cp);
    if (this.sky && this.sky.u.steps.value > 0) this.sky.clouds.render(this.renderer, cam);
    const undoWarm = this.warm ? this.forceAllVisible() : null;
    try {
      if (this.post) this.post.pipeline.render();
      else this.renderer.render(this.scene, cam);
    } finally {
      undoWarm?.();
    }
    if (set.eyeAdapt) this.eye.sample(this.renderer, this.post?.hdr() ?? null);
    this.frames++;
    this.frameStats.calls = this.renderer.info.render.drawCalls;
    this.frameStats.tris = this.renderer.info.render.triangles;
    if (this.trackGpu && !this.gpuBusy) {
      this.gpuBusy = true;
      this.renderer
        .resolveTimestampsAsync('render')
        .then(() => {
          const ms = this.renderer.info.render.timestamp;
          if (ms > 0) this.gpuMs = this.gpuMs > 0 ? this.gpuMs * 0.9 + ms * 0.1 : ms;
          (window as unknown as { __gpuMs: number }).__gpuMs = this.gpuMs;
        })
        .catch(() => { this.trackGpu = false; })
        .finally(() => (this.gpuBusy = false));
    }
  }

  drawInstruments(t: number, d: InstrumentData): void {
    this.cockpit.drawInstruments(t, d);
  }

  /** 投影世界坐标到屏幕（像素），在相机后方时返回 null。 */
  project(p: THREE.Vector3, out: { x: number; y: number; behind: boolean }): { x: number; y: number; behind: boolean } {
    const cam = this.rig.camera;
    const v = _project.copy(p).applyMatrix4(cam.matrixWorldInverse);
    out.behind = v.z > 0;
    v.applyMatrix4(cam.projectionMatrix);
    const c = this.renderer.domElement;
    out.x = (v.x * 0.5 + 0.5) * c.clientWidth;
    out.y = (-v.y * 0.5 + 0.5) * c.clientHeight;
    if (out.behind) {
      out.x = c.clientWidth - out.x;
      out.y = c.clientHeight - out.y;
    }
    return out;
  }

  info(): string {
    const i = this.renderer.info;
    return `${this.gpuInfo().backend} · draw ${this.frameStats.calls} · tris ${(this.frameStats.tris / 1000).toFixed(0)}k · geo ${i.memory.geometries} · tex ${i.memory.textures}`;
  }

  dispose(): void {
    this.unload();
    this.heli.dispose();
    this.cockpit.dispose();
    this.rain.dispose();
    this.eye.dispose();
    this.post?.dispose();
    disposeGi();
    this.sun.dispose();
    this.pmrem?.dispose();
    // Renderer.dispose() is asynchronous and can reject if initialization itself
    // failed. Observe that cleanup failure rather than creating an unhandled one.
    void Promise.resolve(this.renderer.dispose()).catch((error) => console.warn('渲染器资源释放失败：', error));
  }
}
