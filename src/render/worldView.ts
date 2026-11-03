// 渲染总控：WebGL2 渲染器、场景、光照、阴影、天空/环境贴图、地形、水、道具、植被、导航标记、天气特效、
// 直升机与座舱。每次只加载一张地图的资源，切换地图时完整释放（避免内存泄漏）。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { GameSession } from '../sim/session';
import type { WorldData } from '../world/worldgen';
import type { WeatherParams } from '../sim/weather';
import { QUALITY, type Settings } from '../game/settings';
import { CameraRig } from './cameraRig';
import { Cockpit, EYE } from './cockpit';
import { HeliModel } from './heliModel';
import { loadModelLib, MODEL_FILES, type ModelLib } from './modelLib';
import { loadDetailTextures } from './detailTextures';
import { NavView } from './navView';
import { PropsView } from './propsView';
import { SkyDome } from './sky';
import { FOG, installFogChunks } from './atmosphere';
import { SunShadows } from './sunShadows';
import { loadTerrainLayers } from './terrainLayers';
import { makeTerrainUniforms, TerrainView, type TerrainUniforms } from './terrainView';
import { makeForestTexture, makeMinimapCanvas, makeSurfaceTexture, makeWaterDepthTexture } from './textures';
import { TreeView, loadTreeLib } from './treeView';
import { WaterView } from './water';
import { CloudLayer, Lightning, RainFx } from './weatherFx';
import type { InstrumentData } from './instruments';

export interface FrameInfo {
  dt: number;
  t: number;
  alpha: number;
}

const _cloudGrey = new THREE.Color(0.86, 0.88, 0.9);
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const _w = new THREE.Vector3();

export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  /** 太阳光（分层阴影） */
  readonly sun: SunShadows;
  readonly hemi: THREE.HemisphereLight;
  private csmT = 0;
  private csmFov = 0;
  private csmAspect = 0;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envT = -10;
  private composer: EffectComposer | null = null;
  private afterimage: AfterimagePass | null = null;
  /** 当前后期管线的配置（变化时重建） */
  private postKey = '';
  private settings: Settings;
  // 地图相关
  world: WorldData | null = null;
  sky: SkyDome | null = null;
  terrain: TerrainView | null = null;
  terrainUniforms: TerrainUniforms | null = null;
  water: WaterView | null = null;
  props: PropsView | null = null;
  private modelLib: ModelLib | null = null;
  trees: TreeView | null = null;
  nav: NavView | null = null;
  rain: RainFx;
  clouds: CloudLayer | null = null;
  readonly lightning = new Lightning();
  readonly heli: HeliModel;
  readonly cockpit: Cockpit;
  minimap: HTMLCanvasElement | null = null;
  private mapTextures: THREE.Texture[] = [];
  private fog = new THREE.FogExp2(0xb0c0d0, 0.0002);
  /** 雾最浓的基准高度（地图最低处） */
  private fogBaseY = 0;
  flash = 0;
  /** 雷声回调（音频层） */
  onThunder: ((delay: number, strength: number) => void) | null = null;
  inCloud = 0;

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    installFogChunks();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance', reversedDepthBuffer: true, stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.scene.add(this.rig.camera);
    this.scene.fog = this.fog;
    this.sun = new SunShadows(this.scene, this.rig.camera, QUALITY[settings.quality].shadowSize);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 0.6);
    this.scene.add(this.hemi);
    this.rain = new RainFx(9000);
    this.scene.add(this.rain.mesh);
    this.heli = new HeliModel();
    this.cockpit = new Cockpit();
    this.heli.root.add(this.cockpit.root);
    this.scene.add(this.heli.root);
    this.applySettings(settings);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    const q = QUALITY[s.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * s.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.setShadows(q.shadows, q.shadowSize);
    if (this.terrain) {
      this.terrain.lodScale = q.terrainLod;
      this.terrain.shadowRange = q.shadowRange;
    }
    if (this.trees) this.trees.quality = { near: q.treeNear, far: q.treeFar, shadows: q.shadows, aa: q.msaa > 0 };
    this.lightning.enabled = s.lightning;
    this.envKey = '';
    this.buildPost(dpr);
    this.resize();
  }

  /**
   * 后期管线：半浮点渲染目标（保留高光）+ 多重采样抗锯齿 → [环境光遮蔽] → [泛光] → [动态模糊] → 色调映射输出。
   * 低画质且不开动态模糊时直接渲染到屏幕。
   */
  private buildPost(dpr: number): void {
    const s = this.settings;
    const q = QUALITY[s.quality];
    const key = `${q.msaa}_${q.bloom}_${q.ao}_${s.motionBlur}`;
    if (key === this.postKey && this.composer) {
      this.composer.setPixelRatio(dpr);
      return;
    }
    this.postKey = key;
    this.composer?.dispose();
    this.composer = null;
    this.afterimage = null;
    if (q.msaa === 0 && !s.motionBlur) return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa });
    const c = new EffectComposer(this.renderer, rt);
    c.setPixelRatio(dpr);
    c.addPass(new RenderPass(this.scene, this.rig.camera));
    if (q.ao) {
      const ao = new GTAOPass(this.scene, this.rig.camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1, samples: 12 });
      ao.blendIntensity = 0.75;
      c.addPass(ao);
    }
    // 阈值较高：只有太阳、强镜面反光、灯光会晕开（阳光下的白色表面本身也有约 3 的亮度）
    if (q.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.6, 6.0));
    if (s.motionBlur) {
      this.afterimage = new AfterimagePass(0.55);
      c.addPass(this.afterimage);
    }
    c.addPass(new OutputPass());
    this.composer = c;
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / Math.max(1, h);
    this.rig.camera.updateProjectionMatrix();
    this.sun.updateFrustums();
    this.composer?.setSize(w, h);
  }

  /** 构建地图视觉资源。 */
  async load(world: WorldData, progress?: (p: number, label: string) => void): Promise<void> {
    this.unload();
    this.world = world;
    const map = world.map;
    const tick = () => new Promise<void>((r) => setTimeout(r, 0));
    progress?.(0.82, '构建地形网格');
    await tick();
    const surfaceTex = makeSurfaceTexture(world.surface, world.terrain.res);
    const forestTex = makeForestTexture(world.trees, map.size);
    this.mapTextures.push(surfaceTex, forestTex);
    progress?.(0.84, '加载地形材质');
    const texSize = QUALITY[this.settings.quality].terrainTex;
    const layers = texSize > 0 ? await loadTerrainLayers(map.id, map.biome, texSize) : null;
    if (layers) this.mapTextures.push(layers.color, layers.normal);
    this.terrainUniforms = makeTerrainUniforms(map, surfaceTex, forestTex, layers);
    this.terrain = new TerrainView(map, world.terrain, this.terrainUniforms);
    this.scene.add(this.terrain.group);
    this.sky = new SkyDome(map.sun[0], map.sun[1], map.biome.fogTint, map.biome.grass);
    this.scene.add(this.sky.mesh);
    // 雾的基准高度：地图最低处（有水面时取水面）
    const hf = world.terrain;
    let minH = Infinity;
    for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32; j++) minH = Math.min(minH, hf.heightAt(-hf.half + (i * hf.size) / 32, -hf.half + (j * hf.size) / 32));
    this.fogBaseY = map.waterLevel !== null ? Math.max(minH, map.waterLevel) : minH;
    if (map.waterLevel !== null) {
      const depth = makeWaterDepthTexture(world.terrain, map.waterLevel);
      this.mapTextures.push(depth);
      this.water = new WaterView(map, depth);
      this.scene.add(this.water.mesh);
    }
    progress?.(0.88, '构建建筑与植被');
    await tick();
    const modelFile = MODEL_FILES[map.id];
    const [lib, detail, treeLib] = await Promise.all([modelFile ? loadModelLib(modelFile) : Promise.resolve(null), loadDetailTextures(), loadTreeLib()]);
    this.modelLib = lib;
    this.props = new PropsView(world, this.modelLib, detail);
    this.scene.add(this.props.group);
    this.trees = new TreeView(world.trees, treeLib);
    this.scene.add(this.trees.group);
    this.nav = new NavView(map);
    this.scene.add(this.nav.group);
    this.clouds = new CloudLayer(map.size);
    this.scene.add(this.clouds.group);
    this.minimap = makeMinimapCanvas(map, world.terrain, world.trees);
    this.cockpit.minimap = this.minimap;
    if (!this.cockpit.loaded || !this.heli.extLoaded) {
      progress?.(0.92, '加载直升机模型');
      await Promise.all([this.cockpit.ready, this.heli.ready]);
    }
    this.sun.setupObject(this.scene);
    this.applySettings(this.settings);
    progress?.(0.96, '编译着色器');
    await tick();
  }

  unload(): void {
    const rm = (o: THREE.Object3D | undefined) => o && this.scene.remove(o);
    rm(this.terrain?.group);
    rm(this.sky?.mesh);
    rm(this.water?.mesh);
    rm(this.props?.group);
    rm(this.trees?.group);
    rm(this.nav?.group);
    rm(this.clouds?.group);
    this.terrain?.dispose();
    this.sky?.material.dispose();
    this.sky?.mesh.geometry.dispose();
    this.water?.dispose();
    this.props?.dispose();
    this.modelLib?.dispose();
    this.modelLib = null;
    this.trees?.dispose();
    this.nav?.dispose();
    this.clouds?.dispose();
    for (const t of this.mapTextures) t.dispose();
    this.mapTextures = [];
    this.terrain = this.water = this.props = this.trees = this.nav = this.clouds = this.sky = null;
    this.world = null;
    this.envRT?.dispose();
    this.envRT = null;
    this.envKey = '';
  }

  /** 天气变化时重新烘焙环境贴图（限频）。 */
  private updateEnv(w: WeatherParams, t: number): void {
    if (!this.sky) return;
    const key = `${w.overcast.toFixed(1)}_${w.rain.toFixed(1)}_${Math.round(Math.log(w.visibility) * 2)}_${this.settings.quality}`;
    if (key === this.envKey || t - this.envT < 2) return;
    this.envKey = key;
    this.envT = t;
    const envScene = new THREE.Scene();
    const m = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envScene.add(m);
    const old = this.envRT;
    // 环境贴图里不画太阳圆盘（阳光的高光由方向光负责，否则光滑表面上会出现两个太阳）
    this.sky.material.uniforms.uDisc.value = 0;
    this.envRT = this.pmrem.fromScene(envScene, 0, 1, 10000, { size: QUALITY[this.settings.quality].envSize });
    this.sky.material.uniforms.uDisc.value = 1;
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    old?.dispose();
  }

  /** 每帧渲染。session 为空时（主菜单）使用 idlePose。 */
  render(s: GameSession | null, f: FrameInfo, idle?: { pos: THREE.Vector3; target: THREE.Vector3 }): void {
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
      this.rig.update(f.dt, f.t, _pos, _quat, _vel, load, { fov: set.fov, eyeX: EYE.x * (1 - set.viewCenter), shake: set.shake, headMotion: set.headMotion });
      const cockpitView = this.rig.mode === 'cockpit';
      this.heli.setCockpitView(cockpitView);
      // 有 Blender 外观时座舱模型（含机身外壳）在追尾视角也显示：从外面能透过玻璃看到舱内
      this.cockpit.root.visible = cockpitView || this.heli.extLoaded;
      this.cockpit.updateControls(tel.stickPitch, tel.stickRoll, tel.collective, tel.pedal);
      this.cockpit.updateGlass(f.t, weather.rain, tel.airspeed, s.buffs.shieldActive ? 0.25 + 0.15 * Math.sin(f.t * 6) : 0);
    } else if (idle) {
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
      this.hemi.intensity = C.hemiIntensity * 0.65;
      // 雾：能见度 → 指数平方雾密度（随高度变稀，见 atmosphere.ts）；进入低云层时另加均匀浓雾
      this.inCloud = 0;
      if (w.lowCloud > 0.05) {
        const inside = Math.min(1, Math.max(0, Math.min(cp.y - w.cloudBase + 30, w.cloudTop - cp.y + 30) / 60));
        this.inCloud = inside * w.lowCloud;
      }
      this.fog.density = 1.65 / Math.max(60, w.visibility);
      this.fog.color.copy(C.fog).lerp(_cloudGrey, this.inCloud);
      FOG.fogSunColor.value.copy(C.fogSun).lerp(_cloudGrey, this.inCloud);
      FOG.fogSunDir.value.copy(this.sky.sunDir);
      FOG.fogCloud.value = (1.65 / 90) * this.inCloud;
      FOG.fogHeightK.value = 1 / 1100;
      FOG.fogBaseY.value = this.fogBaseY;
      this.renderer.toneMappingExposure = 1.0 - w.overcast * 0.12 + this.flash * 0.6;
      const q = QUALITY[set.quality];
      // 分层阴影：视野或宽高比变了要重新划分；每帧把各层阴影框跟随相机（内部按纹素对齐，避免闪烁）
      if (cam.fov !== this.csmFov || cam.aspect !== this.csmAspect) {
        this.csmFov = cam.fov;
        this.csmAspect = cam.aspect;
        this.sun.updateFrustums();
      }
      this.sun.update();
      // 兜底：定期检查新出现的受光材质是否已接入分层阴影（未接入会叠加多份阳光）
      if (f.t - this.csmT > 1.5 || f.t < this.csmT) {
        this.csmT = f.t;
        this.sun.setupObject(this.scene);
      }
      this.updateEnv(w, f.t);
      this.terrain?.update(cp);
      if (this.terrainUniforms) this.terrainUniforms.uWet.value = w.wetness;
      this.water?.update(f.t, _w.x, _w.z, Math.hypot(_w.x, _w.z), w.rain);
      const windAt = s ? (p: THREE.Vector3, out: THREE.Vector3) => s.wind.sample(p.x, p.y, p.z, s.t, out) : (_p: THREE.Vector3, out: THREE.Vector3) => out.set(3, 0, 1);
      this.props?.update(f.t, cp, windAt);
      const gust = s ? Math.min(1, s.windInfo.gust / 8) : 0.2;
      this.trees?.update(f.t, cam, _w.x, _w.z, gust);
      if (s) this.nav?.update(s, f.t, cp);
      this.rain.update(f.t, cp, w.rain, _w, s ? _vel : new THREE.Vector3(), q.rainDensity);
      this.clouds?.update(f.dt, w.cloudBase, w.cloudTop, w.lowCloud, _w.x, _w.z, w.overcast, cp);
    }
    if (this.composer) {
      if (this.afterimage) {
        // 动态模糊只随视角/机体角速度增强
        const spin = s ? s.body.angVel.length() : 0;
        this.afterimage.uniforms.damp.value = Math.min(0.82, 0.35 + spin * 0.5);
      }
      this.composer.render(f.dt);
    } else this.renderer.render(this.scene, cam);
  }

  drawInstruments(t: number, d: InstrumentData): void {
    this.cockpit.drawInstruments(t, d);
  }

  /** 投影世界坐标到屏幕（像素），在相机后方时返回 null。 */
  project(p: THREE.Vector3, out: { x: number; y: number; behind: boolean }): { x: number; y: number; behind: boolean } {
    const cam = this.rig.camera;
    const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
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
    return `draw ${i.render.calls} · tris ${(i.render.triangles / 1000).toFixed(0)}k · geo ${i.memory.geometries} · tex ${i.memory.textures}`;
  }

  dispose(): void {
    this.unload();
    this.heli.dispose();
    this.cockpit.dispose();
    this.rain.dispose();
    this.composer?.dispose();
    this.sun.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
