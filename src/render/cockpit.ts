// 三维驾驶舱：加载 Blender 建模导出的 models/cockpit.glb（参照 H125 实机照片，见 tools/blender/cockpit.py）。
// 指针、刻度盘按真实飞行数据转动；五块电子屏用 Canvas 实时绘制；周期变距杆/总距杆/脚蹬随操纵动画；
// 窗玻璃使用带雨滴/水流效果的材质。模型加载失败时座舱内部为空，游戏照常可玩。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { drawAnnunciator, drawAttitude, drawGps, drawVemdBottom, drawVemdTop, NEEDLE, type InstrumentData } from './instruments';
import { getNoiseTexture } from './textures';

/** 驾驶员眼点（机体坐标，右座），与 tools/blender/cockpit_layout.py 的 EYE 一致 */
export const EYE = new THREE.Vector3(0.45, 0.42, -1.0);

const MODEL_URL = 'models/cockpit.glb';
/** Blender 烘焙的环境光遮蔽（使用模型的第二套 UV） */
const AO_URL = 'models/cockpit_ao.jpg';
const DEG = Math.PI / 180;

interface Needle {
  obj: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
}

interface Screen {
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  kind: 'vemd1' | 'vemd2' | 'ai' | 'gps' | 'ann';
}

const SCREEN_SIZE: Record<Screen['kind'], [number, number]> = {
  vemd1: [512, 430],
  vemd2: [512, 430],
  ai: [400, 484],
  gps: [512, 342],
  ann: [768, 302],
};

const _q = new THREE.Quaternion();

export class Cockpit {
  readonly root = new THREE.Group();
  readonly glassUniforms = { uRain: { value: 0 }, uTime: { value: 0 }, uFlow: { value: 0 }, uNoise: { value: getNoiseTexture() }, uShield: { value: 0 } };
  /** 模型加载完成（失败也会 resolve，loaded 为 false） */
  readonly ready: Promise<void>;
  loaded = false;
  mapRange = 2000;
  minimap: HTMLCanvasElement | null = null;
  private needles = new Map<string, Needle>();
  private screens: Screen[] = [];
  private ctl: Partial<Record<'cyclic' | 'collective' | 'pedalL' | 'pedalR', { obj: THREE.Object3D; base: THREE.Quaternion }>> = {};
  private mats = new Set<THREE.Material>();
  private geos = new Set<THREE.BufferGeometry>();
  private textures: THREE.Texture[] = [];
  private lastDraw = -1;
  private lastSlow = -1;

  constructor() {
    // 舱内补光（模拟窗口进来的漫反射光照亮仪表板下方）
    const fill = new THREE.PointLight(0xf2efe8, 0.9, 3.2, 2);
    fill.position.set(0.0, 0.35, -0.9);
    this.root.add(fill);
    this.ready = this.load().catch((e) => {
      console.warn('驾驶舱模型加载失败：', e);
    });
  }

  private async load(): Promise<void> {
    const url = new URL(MODEL_URL, document.baseURI).href;
    const [gltf, ao] = await Promise.all([
      new GLTFLoader().loadAsync(url),
      new THREE.TextureLoader().loadAsync(new URL(AO_URL, document.baseURI).href).catch(() => null),
    ]);
    if (ao) {
      ao.flipY = false; // 与 glTF 的 UV 方向一致
      ao.channel = 1;
      ao.colorSpace = THREE.NoColorSpace;
      ao.anisotropy = 8;
      this.textures.push(ao);
    }
    const scene = gltf.scene;
    const glass = this.makeGlassMaterial(false);
    const roofGlass = this.makeGlassMaterial(true);
    const gaugeGlass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, depthWrite: false, envMapIntensity: 1.4 });
    this.mats.add(glass).add(roofGlass).add(gaugeGlass);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.geos.add(m.geometry);
        const name = m.name;
        if (name.startsWith('glass_')) {
          m.material = name.startsWith('glass_roof') ? roofGlass : glass;
          m.renderOrder = 20;
          m.castShadow = false;
          m.receiveShadow = false;
          return;
        }
        if (name.startsWith('gglass_')) {
          m.material = gaugeGlass;
          m.renderOrder = 10;
          m.castShadow = false;
          return;
        }
        if (name.startsWith('scr_')) {
          this.setupScreen(m, name.slice(4) as Screen['kind']);
          return;
        }
        m.castShadow = !name.startsWith('ndl_');
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const hasAoUv = !!m.geometry.getAttribute('uv1');
        for (const mat of mats) {
          this.mats.add(mat);
          const sm = mat as THREE.MeshStandardMaterial;
          if (ao && hasAoUv && 'aoMap' in sm) {
            sm.aoMap = ao;
            sm.aoMapIntensity = 1.0;
          }
          if (mat.name === 'cp_gauge_overlay') {
            // 透明背景的航向仪固定层：用 alpha 测试代替混合，避免排序问题
            sm.transparent = false;
            sm.alphaTest = 0.5;
          }
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
            const t = sm[k];
            if (t) {
              t.anisotropy = 8;
              this.textures.push(t);
            }
          }
        }
      }
    });
    scene.traverse((o) => {
      if (o.name.startsWith('ndl_')) {
        const axis = new THREE.Vector3().fromArray((o.userData.axis as number[] | undefined) ?? [0, 0.242, 0.97]).normalize();
        this.needles.set(o.name, { obj: o, base: o.quaternion.clone(), axis });
      } else if (o.name === 'ctl_cyclic') this.ctl.cyclic = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_collective') this.ctl.collective = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_pedal_l') this.ctl.pedalL = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_pedal_r') this.ctl.pedalR = { obj: o, base: o.quaternion.clone() };
    });
    this.root.add(scene);
    this.loaded = true;
  }

  private setupScreen(m: THREE.Mesh, kind: Screen['kind']): void {
    const [w, h] = SCREEN_SIZE[kind] ?? [512, 512];
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.flipY = false; // glTF 模型的 UV 原点在左上角
    // 屏幕自发光但不受色调映射压暗；乘 0.9 让白天看起来不过曝
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(0.9, 0.9, 0.9) });
    const old = m.material as THREE.Material;
    old.dispose();
    m.material = mat;
    m.castShadow = false;
    m.receiveShadow = false;
    this.mats.add(mat);
    this.textures.push(tex);
    this.screens.push({ tex, ctx, w, h, kind });
  }

  private makeGlassMaterial(roof: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: roof ? 0x3f8fbe : 0xb8c8d0,
      transparent: true,
      opacity: roof ? 0.42 : 0.07,
      roughness: 0.04,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 0.8,
    });
    const GU = this.glassUniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, GU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLPos;\nvarying vec3 vLNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLPos = position;\nvLNrm = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLPos;\nvarying vec3 vLNrm;\nuniform float uRain, uTime, uFlow, uShield;\nuniform sampler2D uNoise;')
        .replace(
          '#include <alphamap_fragment>',
          /* glsl */ `#include <alphamap_fragment>
{
  // 雨滴坐标：按玻璃朝向取机体坐标平面（风挡用 x/y，侧窗用 z/y，顶窗用 x/z）
  vec3 an = abs(normalize(vLNrm));
  vec2 p = an.z > max(an.x, an.y) ? vLPos.xy : (an.x > an.y ? vLPos.zy : vLPos.xz);
  vec2 uv = p * vec2(9.0, 9.0);
  float cells = texture2D(uNoise, uv * 0.25).b;
  float drops = smoothstep(0.16, 0.05, cells) * step(0.45, texture2D(uNoise, uv * 0.031).r);
  vec2 fuv = vec2(p.x * 14.0, p.y * 4.0 + uTime * (0.15 + uFlow * 1.6));
  float streak = smoothstep(0.82, 0.95, texture2D(uNoise, fuv * vec2(0.08, 0.02)).g) * smoothstep(0.2, 1.0, uFlow + 0.3);
  float w = clamp((drops * 0.85 + streak * 0.6) * uRain, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.95), w);
  diffuseColor.a = clamp(diffuseColor.a + w * 0.38, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.7, 1.0), uShield * 0.6);
  diffuseColor.a += uShield * 0.08;
}`,
        );
    };
    mat.customProgramCacheKey = () => (roof ? 'cockpit-glass-roof-v2' : 'cockpit-glass-v2');
    return mat;
  }

  private setNeedle(name: string, deg: number): void {
    const n = this.needles.get(name);
    if (!n) return;
    _q.setFromAxisAngle(n.axis, -deg * DEG);
    n.obj.quaternion.copy(n.base).premultiply(_q);
  }

  /** stick：周期变距（俯仰、滚转 -1..1），collective 0..1，pedal -1..1 */
  updateControls(stickPitch: number, stickRoll: number, collective: number, pedal: number): void {
    const c = this.ctl;
    if (c.cyclic) {
      _q.setFromEuler(new THREE.Euler(-stickPitch * 0.2, 0, -stickRoll * 0.2, 'XZY'));
      c.cyclic.obj.quaternion.copy(c.cyclic.base).premultiply(_q);
    }
    if (c.collective) {
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), collective * 0.3);
      c.collective.obj.quaternion.copy(c.collective.base).premultiply(_q);
    }
    if (c.pedalL && c.pedalR) {
      // 踩右舵：右脚蹬向前、左脚蹬向后
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pedal * 0.18);
      c.pedalL.obj.quaternion.copy(c.pedalL.base).premultiply(_q);
      _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pedal * 0.18);
      c.pedalR.obj.quaternion.copy(c.pedalR.base).premultiply(_q);
    }
  }

  updateGlass(t: number, rain: number, airspeed: number, shield: number): void {
    this.glassUniforms.uTime.value = t;
    this.glassUniforms.uRain.value = rain;
    this.glassUniforms.uFlow.value = Math.min(1, airspeed / 35);
    this.glassUniforms.uShield.value = shield;
  }

  /** 机械指针每帧更新；电子屏约 20 Hz 重绘（告警灯板 8 Hz）。 */
  drawInstruments(t: number, d: InstrumentData): void {
    if (!this.loaded) return;
    this.setNeedle('ndl_asi_main', NEEDLE.asi(d.airspeed));
    this.setNeedle('ndl_alt_100', NEEDLE.alt100(d.altitudeMSL));
    this.setNeedle('ndl_alt_1000', NEEDLE.alt1000(d.altitudeMSL));
    this.setNeedle('ndl_vsi_main', NEEDLE.vsi(d.vs));
    this.setNeedle('ndl_nr_main', NEEDLE.nr(d.rpm));
    this.setNeedle('ndl_turn_needle', NEEDLE.turn(d.yawRate));
    this.setNeedle('ndl_turn_ball', NEEDLE.ball(d.slip));
    // 航向刻度盘：当前航向转到正上方
    this.setNeedle('ndl_hsi_card', -d.heading);
    this.setNeedle('ndl_hdg2_card', -d.heading);
    const now = new Date();
    const sec = now.getSeconds() + now.getMilliseconds() / 1000;
    this.setNeedle('ndl_clock_sec', sec * 6);
    this.setNeedle('ndl_clock_min', (now.getMinutes() + sec / 60) * 6);
    this.setNeedle('ndl_clock_hour', ((now.getHours() % 12) + now.getMinutes() / 60) * 30);
    if (t - this.lastDraw < 0.05) return;
    this.lastDraw = t;
    const slow = t - this.lastSlow >= 0.12;
    if (slow) this.lastSlow = t;
    for (const s of this.screens) {
      if (s.kind === 'vemd1') drawVemdTop(s.ctx, d, s.w, s.h);
      else if (s.kind === 'vemd2') {
        if (!slow) continue;
        drawVemdBottom(s.ctx, d, s.w, s.h);
      } else if (s.kind === 'ai') drawAttitude(s.ctx, d, s.w, s.h);
      else if (s.kind === 'gps') drawGps(s.ctx, d, this.minimap, this.mapRange, s.w, s.h);
      else if (s.kind === 'ann') {
        if (!slow) continue;
        drawAnnunciator(s.ctx, d, s.w, s.h, t);
      }
      s.tex.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
