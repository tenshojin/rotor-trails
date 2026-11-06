// 三维驾驶舱：加载 Blender 建模导出的 models/cockpit.glb（参照 H125 实机照片，见 tools/blender/cockpit.py）。
// 指针、刻度盘按真实飞行数据转动；五块电子屏用 Canvas 实时绘制；周期变距杆/总距杆/脚蹬随操纵动画；
// 窗玻璃使用带雨滴/水流效果的材质。模型加载失败时座舱内部为空，游戏照常可玩。

import * as THREE from 'three/webgpu';
import { abs, atan, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, float, materialColor, max, mix, modelWorldMatrix, modelWorldMatrixInverse, normalGeometry, normalize, positionGeometry, positionWorld, pow, reflect, select, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4, vertexColor, viewportSharedTexture } from 'three/tsl';
import { FOG } from './atmosphere';
import { VFOG } from './volumetricFog';
import { loadGltf } from './gltf';
import { STD_KEYS } from './modelLib';
import { drawAnnunciator, drawAttitude, drawEfb, drawGps, drawHobbs, drawOff, drawRadio, drawTrack, drawVemdBottom, drawVemdTop, drawXpdr, NEEDLE, type InstrumentData } from './instruments';
import { CockpitControls } from './cockpitControls';
import { Systems } from '../sim/systems';
import { getNoiseTexture } from './textures';
import { modelResources } from './modelResources';
import { disposeTextures } from './disposeTextures';

/** 驾驶员眼点（机体坐标，右侧机长座位），与 tools/blender/cockpit_layout.py 的 EYE 一致；实际视点的左右位置由设置“座舱视点居中”调整 */
export const EYE = new THREE.Vector3(0.45, 0.42, -1.0);

const MODEL_URL = 'models/cockpit.glb';
/** Blender 烘焙的环境光遮蔽（使用模型的第二套 UV） */
const AO_URL = 'models/cockpit_ao.jpg';
const DEG = Math.PI / 180;
/** 遮光罩顶面（机体坐标）：高度、范围。风挡里映出来的主要就是它 */
const GLARE_Y = 0.17;
const GLARE_X = 0.62;
const GLARE_Z: [number, number] = [-2.05, -1.5];
/** 雨刷：转轴（机体坐标里风挡下沿附近的目标点，从眼点打一条射线落到玻璃上）、臂长、摆动范围（弧度，0 = 竖直） */
const WIPER_AIM: Array<[number, number, number]> = [[0.5, 0.0, -2.1], [-0.34, 0.0, -2.1]];
const WIPER_LEN = 0.56;
const WIPER_REST = 1.95;
const WIPER_SWEEP = 2.1;

/** 舱内补光：四面是窗的机舱里，天空和地面的光在内饰之间来回反射，背光的角落也不会全黑。
 * 环境贴图只算得到“这一点看得见多少天空”，算不到这部分反射，所以另加一项（颜色和亮度由 WorldView 按天空每帧设置）。 */
export const CABIN_FILL = uniform(new THREE.Color(0, 0, 0));
/** 仪表背光 0..1：天黑以后表盘刻度、面板字样从里面亮起来，屏幕调暗 */
export const CABIN_NIGHT = uniform(0);

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
  kind: 'vemd1' | 'vemd2' | 'ai' | 'gps' | 'ann' | 'efb' | 'radio' | 'xpdr' | 'hobbs' | 'track';
  mat: THREE.MeshBasicMaterial;
  /** 断电后画过一次黑屏，不用每次重画 */
  dark: boolean;
}

const SCREEN_SIZE: Record<Screen['kind'], [number, number]> = {
  vemd1: [512, 430],
  vemd2: [512, 430],
  ai: [400, 484],
  gps: [512, 342],
  ann: [768, 302],
  efb: [1024, 742],
  radio: [400, 140],
  xpdr: [530, 130],
  hobbs: [280, 130],
  track: [500, 100],
};

const _q = new THREE.Quaternion();
const _controlEuler = new THREE.Euler(0, 0, 0, 'XZY');
const _controlAxis = new THREE.Vector3(1, 0, 0);

export class Cockpit {
  readonly root = new THREE.Group();
  readonly glassUniforms = { uRain: uniform(0), uTime: uniform(0), uFlow: uniform(0), uShield: uniform(0), uWipe: uniform(new THREE.Vector3(0, 0, 0)), uWipeOn: uniform(0), uFog: uniform(0) };
  /** 两支雨刷（转轴绕玻璃法线转） */
  private wipers: Array<{ pivot: THREE.Group; x: number; y: number; side: number }> = [];
  private wipeT = 0;
  private lastGlassT = 0;
  /** 模型加载完成（失败也会 resolve，loaded 为 false） */
  readonly ready: Promise<void>;
  loaded = false;
  mapRange = 2000;
  minimap: HTMLCanvasElement | null = null;
  private needles = new Map<string, Needle>();
  private screens: Screen[] = [];
  private ctl: Partial<Record<'cyclic' | 'collective' | 'pedalL' | 'pedalR', { obj: THREE.Object3D; base: THREE.Quaternion }>> = {};
  /** 机长座椅与这一侧的操纵杆、脚蹬：随“座舱视点居中”左右移动（视点在哪，座椅和操纵杆就在哪） */
  private pilotParts: Array<{ obj: THREE.Object3D; x: number }> = [];
  private pilotDx = 0;
  private mats = new Set<THREE.Material>();
  private geos = new Set<THREE.BufferGeometry>();
  private textures: THREE.Texture[] = [];
  private lastDraw = -1;
  private lastSlow = -1;
  private disposed = false;
  /** 能点的按钮和开关（超仿真里才响应，其他模式只是摆在对应位置上） */
  controls: CockpitControls | null = null;
  /** 不是超仿真时：所有开关停在“飞机运转中”的位置 */
  private readonly idleSystems = (() => {
    const s = new Systems();
    s.setRunning();
    s.update({ dt: 0.02, nr: 1, powerDemand: 200e3, shaftPower: 200e3, altitudeMSL: 0, oat: 15, rain: 0, airspeed: 0, onGround: false, powerMax: 400e3 });
    return s;
  })();
  /** 雨刷：-1 = 跟着雨自动（其他模式），0/1/2 = 开关位置 */
  wiperMode = -1;
  private sourceResources: ReturnType<typeof modelResources> | null = null;

  constructor() {
    this.ready = this.load().catch((e) => {
      this.dispose();
      console.warn('驾驶舱模型加载失败：', e);
    });
  }

  private async load(): Promise<void> {
    const [modelResult, aoResult] = await Promise.allSettled([
      loadGltf(MODEL_URL),
      new THREE.TextureLoader().loadAsync(new URL(AO_URL, document.baseURI).href).catch((error) => {
        console.warn('驾驶舱 AO 贴图加载失败，使用未烘焙遮蔽的材质：', error);
        return null;
      }),
    ]);
    const ao = aoResult.status === 'fulfilled' ? aoResult.value : null;
    if (modelResult.status === 'rejected') {
      if (ao) disposeTextures([ao]);
      throw modelResult.reason;
    }
    const gltf = modelResult.value;
    const resources = modelResources(gltf.scene);
    if (this.disposed) {
      resources.dispose();
      if (ao) disposeTextures([ao]);
      return;
    }
    this.sourceResources = resources;
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
    const gaugeGlass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, roughness: 0.04, metalness: 0, depthWrite: false, envMapIntensity: 0.5 });
    this.mats.add(glass).add(roofGlass).add(gaugeGlass);
    // 模型里的标准材质换成节点材质（接上舱内补光）。有第二套 UV 的网格用烘焙的遮蔽，所以同一材质按有无 UV 各一份
    const interior = new Map<string, THREE.MeshStandardNodeMaterial>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const name = m.name;
        // 座舱内部只进最近两层阴影（图层 2，见 sunShadows.ts）：远处地面上的机影由直升机外观模型负责，
        // 上百个座舱零件不必在外面两层阴影里各画一遍
        m.layers.mask = 1 << 2;
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
        // 几十个小按钮不进阴影：它们投的影子只有几毫米，看不出来，白白多画几十次
        m.castShadow = !name.startsWith('ndl_') && !name.startsWith('hs_') && !name.startsWith('led_');
        m.receiveShadow = true;
        const src = m.material as THREE.MeshStandardMaterial;
        const hasAoUv = !!ao && !!m.geometry.getAttribute('uv1');
        const key = `${src.uuid}:${hasAoUv ? 1 : 0}`;
        let sm = interior.get(key);
        if (!sm) {
          sm = this.interiorMaterial(src, hasAoUv ? ao : null);
          interior.set(key, sm);
          this.mats.add(sm);
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
            const t = sm[k];
            if (t) {
              t.anisotropy = 8;
            }
          }
        }
        m.material = sm;
      }
    });
    // Replaced glTF materials are no longer used; their maps remain owned by
    // sourceResources and may be shared across several converted materials.
    for (const material of resources.materials) material.dispose();
    resources.materials.clear();
    scene.traverse((o) => {
      if (o.name.startsWith('ndl_')) {
        const axis = new THREE.Vector3().fromArray((o.userData.axis as number[] | undefined) ?? [0, 0.242, 0.97]).normalize();
        this.needles.set(o.name, { obj: o, base: o.quaternion.clone(), axis });
      } else if (o.name === 'ctl_cyclic') this.ctl.cyclic = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_collective') this.ctl.collective = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_pedal_l') this.ctl.pedalL = { obj: o, base: o.quaternion.clone() };
      else if (o.name === 'ctl_pedal_r') this.ctl.pedalR = { obj: o, base: o.quaternion.clone() };
      if (['seat_pilot', 'ctl_cyclic', 'ctl_collective', 'ctl_pedal_l', 'ctl_pedal_r'].includes(o.name)) this.pilotParts.push({ obj: o, x: o.position.x });
    });
    this.setPilotOffset(this.pilotDx);
    this.root.add(scene);
    this.buildWipers(scene);
    this.controls = new CockpitControls(scene, this.root);
    this.controls.animate(this.idleSystems, 1, 0);
    this.loaded = true;
  }

  /** 风挡外面的雨刷：转轴落在玻璃上（射线找交点），臂和刮片贴着玻璃转 */
  private buildWipers(scene: THREE.Object3D): void {
    scene.updateMatrixWorld(true);
    const glass: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name.startsWith('glass_') && !m.name.startsWith('glass_roof')) glass.push(m);
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.4 });
    this.mats.add(dark);
    const armG = new THREE.BoxGeometry(0.011, WIPER_LEN * 0.92, 0.008);
    armG.translate(0, (WIPER_LEN * 0.92) / 2, 0.012);
    const bladeG = new THREE.BoxGeometry(0.009, WIPER_LEN * 0.82, 0.016);
    bladeG.translate(0, WIPER_LEN * 0.56, 0.006);
    const hubG = new THREE.CylinderGeometry(0.016, 0.018, 0.02, 12);
    hubG.rotateX(Math.PI / 2);
    this.geos.add(armG).add(bladeG).add(hubG);
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();
    const eye = EYE.clone();
    WIPER_AIM.forEach(([x, y, z], i) => {
      const dir = new THREE.Vector3(x, y, z).sub(eye).normalize();
      ray.set(eye, dir);
      const hit = ray.intersectObjects(glass, false)[0];
      if (!hit) return;
      const n = (hit.normal ?? dir.clone().negate()).clone();
      if (n.dot(dir) < 0) n.negate(); // 朝外
      const pivot = new THREE.Group();
      pivot.position.copy(hit.point).addScaledVector(n, 0.006);
      // 局部 y 大致朝上、z 朝外（玻璃的法线）
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
      const right = new THREE.Vector3().crossVectors(up, n).normalize();
      pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
      const spin = new THREE.Group();
      for (const g of [armG, bladeG, hubG]) {
        const m = new THREE.Mesh(g, dark);
        m.layers.mask = 1 << 2;
        m.castShadow = true;
        spin.add(m);
      }
      pivot.add(spin);
      this.root.add(pivot);
      this.wipers.push({ pivot: spin, x: hit.point.x, y: hit.point.y, side: i === 0 ? 1 : 1 });
    });
    const u = this.glassUniforms.uWipe.value as THREE.Vector3;
    u.x = this.wipers[0]?.x ?? 0;
    u.y = this.wipers[1]?.x ?? 0;
    u.z = this.wipers[0]?.y ?? 0;
    this.setWiperAngle(WIPER_REST);
  }

  /** a：刮片离竖直方向的角度，正 = 往左舷一侧 */
  private setWiperAngle(a: number): void {
    for (const w of this.wipers) w.pivot.rotation.z = a;
  }

  /** 周期变距杆、总距杆的节点（超仿真的手跟着它们走） */
  stick(name: 'cyclic' | 'collective'): { obj: THREE.Object3D; base: THREE.Quaternion } | undefined {
    return this.ctl[name];
  }

  /** 飞行员身上的材质：和舱内其他东西一样接上舱内补光 */
  bodyMaterial(src: THREE.MeshStandardMaterial): THREE.MeshStandardNodeMaterial {
    const m = this.interiorMaterial(src, null);
    m.vertexColors = src.vertexColors;
    // 手套的颜色在顶点色里：补光也要乘上它，不然白得发亮
    if (src.vertexColors) m.emissiveNode = vertexColor().rgb.mul(CABIN_FILL).mul(0.65);
    this.mats.add(m);
    return m;
  }

  private interiorMaterial(src: THREE.MeshStandardMaterial, ao: THREE.Texture | null): THREE.MeshStandardNodeMaterial {
    const nm = new THREE.MeshStandardNodeMaterial();
    for (const k of STD_KEYS) (nm as unknown as Record<string, unknown>)[k] = (src as unknown as Record<string, unknown>)[k];
    if (ao) {
      nm.aoMap = ao;
      nm.aoMapIntensity = 1.0;
    }
    if (src.name === 'cp_gauge_overlay') {
      // 透明背景的航向仪固定层：用 alpha 测试代替混合，避免排序问题
      nm.transparent = false;
      nm.alphaTest = 0.5;
    }
    // 外表面的漆、本身发光的灯、金属（没有漫反射）都不加补光
    const dark = src.emissive.r + src.emissive.g + src.emissive.b === 0;
    if (dark && !src.name.startsWith('cp_paint') && src.metalness < 0.9) {
      const occl = ao ? texture(ao, uv(1)).r : float(0.65);
      const col = (materialColor as unknown as THREE.Node<'vec4'>).rgb;
      let glow: THREE.Node<'vec3'> = col.mul(CABIN_FILL).mul(occl).mul(1 - src.metalness);
      // 表盘刻度、面板字样（贴图里亮的部分）：夜里从里面亮起来，略带暖色
      if (src.name === 'cp_gauges' || src.name === 'cp_gauge_overlay' || src.name === 'cp_panelfront') {
        const tex = texture(src.map!, uv()).rgb;
        const lit = smoothstep(0.3, 0.75, dot(tex, vec3(0.3, 0.55, 0.15)));
        glow = glow.add(tex.mul(vec3(1.0, 0.8, 0.56)).mul(lit).mul(CABIN_NIGHT).mul(src.name === 'cp_panelfront' ? 0.34 : 2.4));
      }
      nm.emissiveNode = glow;
    }
    return nm;
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
    m.material = mat;
    m.castShadow = false;
    m.receiveShadow = false;
    this.mats.add(mat);
    this.textures.push(tex);
    this.screens.push({ tex, ctx, w, h, kind, mat, dark: false });
  }

  private makeGlassMaterial(roof: boolean): THREE.MeshStandardNodeMaterial {
    const base = new THREE.Color(roof ? 0x3f8fbe : 0xb8c8d0);
    const opacity = roof ? 0.42 : 0.07;
    const mat = new THREE.MeshStandardNodeMaterial({
      color: base,
      transparent: true,
      opacity,
      roughness: 0.04,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 0.8,
    });
    const GU = this.glassUniforms;
    const noise = getNoiseTexture();
    // 雨滴坐标：按玻璃朝向取机体坐标平面（风挡用 x/y，侧窗用 z/y，顶窗用 x/z）
    const an = abs(normalize(normalGeometry));
    const lp = positionGeometry;
    const p = select(an.z.greaterThan(max(an.x, an.y)), lp.xy, select(an.x.greaterThan(an.y), lp.zy, lp.xz));
    const ruv = p.mul(9.0);
    const cells = texture(noise, ruv.mul(0.25)).b;
    const drops = float(1).sub(smoothstep(0.05, 0.16, cells)).mul(step(0.45, texture(noise, ruv.mul(0.031)).r));
    const fuv = vec2(p.x.mul(14.0), p.y.mul(4.0).add(GU.uTime.mul(GU.uFlow.mul(1.6).add(0.15))));
    const streak = smoothstep(0.82, 0.95, texture(noise, fuv.mul(vec2(0.08, 0.02))).g).mul(smoothstep(0.2, 1.0, GU.uFlow.add(0.3)));
    // 雨刷刮过的扇形：水膜一直很薄，两次刮之间只来得及长出一点点水珠
    const wipeArea = (px: THREE.Node<'float'>) => {
      const dx = lp.x.sub(px);
      const dy = lp.y.sub(GU.uWipe.z).mul(1.3); // 风挡是斜的：高度差比沿玻璃的距离小
      const r = dx.mul(dx).add(dy.mul(dy)).sqrt();
      const a = atan(dx, dy);
      return smoothstep(0.09, 0.14, r).mul(float(1).sub(smoothstep(WIPER_LEN * 0.96, WIPER_LEN * 1.02, r))).mul(smoothstep(WIPER_REST - WIPER_SWEEP - 0.04, WIPER_REST - WIPER_SWEEP + 0.03, a)).mul(float(1).sub(smoothstep(WIPER_REST - 0.03, WIPER_REST + 0.04, a)));
    };
    const wiped = max(wipeArea(GU.uWipe.x), wipeArea(GU.uWipe.y)).mul(GU.uWipeOn).mul(0.82);
    const w = clamp(drops.mul(0.85).add(streak.mul(0.6)).mul(GU.uRain).mul(float(1).sub(wiped)), 0.0, 1.0);
    // 舱内起雾：一层白，边角先起（中间是从暖风口吹干的）
    const fogPatch = GU.uFog.mul(smoothstep(0.2, 0.75, texture(noise, p.mul(0.9)).r.mul(0.5).add(0.25).add(abs(lp.x).mul(0.5))));
    const c = mix(mix(mix(vec3(base.r, base.g, base.b), vec3(0.85, 0.9, 0.95), w), vec3(0.3, 0.7, 1.0), GU.uShield.mul(0.6)), vec3(0.82, 0.85, 0.87), fogPatch);
    mat.colorNode = vec4(c, 1.0);
    // 玻璃上的灰尘与擦拭痕：平时几乎看不见，迎着太阳时被照亮成一片眩光（清晨、黄昏最明显）
    const dust = smoothstep(0.45, 0.85, texture(noise, p.mul(1.7)).r).mul(0.55).add(smoothstep(0.62, 0.95, texture(noise, p.mul(6.0).add(0.3)).g).mul(0.35));
    const vdir = normalize(positionWorld.sub(cameraPosition));
    const sunK = pow(max(dot(vdir, FOG.sunDir), 0.0), 10.0);
    const glare = VFOG.sun.mul(dust.mul(sunK.mul(0.12).add(0.004)));
    const alpha = clamp(w.mul(0.38).add(opacity).add(dust.mul(0.03)).add(fogPatch.mul(0.62)), 0.0, 1.0).add(GU.uShield.mul(0.08)).toVar();
    mat.opacityNode = alpha;
    if (roof) {
      mat.emissiveNode = glare;
      return mat;
    }
    // 风挡内侧的倒影：坐在舱里透过玻璃往外看，下半截总叠着一层遮光罩顶面的影子，天暗、外面是深色的山时最明显。
    // 反射光线落在遮光罩这个平面上，到画面里取那一点的颜色（平面是已知的，一次采样就够）
    const camL = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const vL = normalize(positionGeometry.sub(camL)).toVar();
    const nG = normalize(normalGeometry).toVar();
    const nF = select(dot(nG, vL).greaterThan(0.0), nG.negate(), nG);
    const rL = reflect(vL, nF).toVar();
    const tq = float(GLARE_Y).sub(positionGeometry.y).div(rL.y.min(-0.02));
    const q = positionGeometry.add(rL.mul(tq)).toVar();
    const cq = cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(q, 1.0)))).toVar();
    const uvq = vec2(cq.x.div(cq.w).mul(0.5).add(0.5), float(0.5).sub(cq.y.div(cq.w).mul(0.5)));
    const inside = step(rL.y, -0.02)
      .mul(float(1).sub(smoothstep(GLARE_X - 0.14, GLARE_X, abs(q.x))))
      .mul(smoothstep(GLARE_Z[0], GLARE_Z[0] + 0.1, q.z))
      .mul(float(1).sub(smoothstep(GLARE_Z[1] - 0.08, GLARE_Z[1], q.z)))
      // 只有风挡下半截看得出：再往上是斜着看到遮光罩的边，映出来是天上一块硬边的影子
      .mul(float(1).sub(smoothstep(0.3, 0.52, positionGeometry.y)));
    const ndv = clamp(dot(nF, vL).negate(), 0.0, 1.0);
    const fres = float(0.05).add(float(0.95).mul(pow(float(1).sub(ndv), 5.0)));
    const seen = viewportSharedTexture(clamp(uvq, 0.002, 0.998)).rgb;
    // 玻璃按 alpha 混合：想叠加上 seen × 菲涅尔，发光项要除以 alpha
    mat.emissiveNode = glare.add(seen.mul(fres).mul(inside).div(alpha));
    return mat;
  }

  private setNeedle(name: string, deg: number): void {
    const n = this.needles.get(name);
    if (!n) return;
    _q.setFromAxisAngle(n.axis, -deg * DEG);
    n.obj.quaternion.copy(n.base).premultiply(_q);
  }

  /** 机长座椅、操纵杆、脚蹬相对真实位置的左右偏移（米，负 = 向机身中线） */
  setPilotOffset(dx: number): void {
    this.pilotDx = dx;
    for (const p of this.pilotParts) p.obj.position.x = p.x + dx;
  }

  /** stick：周期变距（俯仰、滚转 -1..1），collective 0..1，pedal -1..1 */
  updateControls(stickPitch: number, stickRoll: number, collective: number, pedal: number): void {
    const c = this.ctl;
    if (c.cyclic) {
      _q.setFromEuler(_controlEuler.set(-stickPitch * 0.2, 0, -stickRoll * 0.2));
      c.cyclic.obj.quaternion.copy(c.cyclic.base).premultiply(_q);
    }
    if (c.collective) {
      _q.setFromAxisAngle(_controlAxis, collective * 0.3);
      c.collective.obj.quaternion.copy(c.collective.base).premultiply(_q);
    }
    if (c.pedalL && c.pedalR) {
      // 踩右舵：右脚蹬向前、左脚蹬向后
      _q.setFromAxisAngle(_controlAxis, pedal * 0.18);
      c.pedalL.obj.quaternion.copy(c.pedalL.base).premultiply(_q);
      _q.setFromAxisAngle(_controlAxis, -pedal * 0.18);
      c.pedalR.obj.quaternion.copy(c.pedalR.base).premultiply(_q);
    }
  }

  updateGlass(t: number, rain: number, airspeed: number, shield: number, exposure = 1): void {
    // 天黑以后屏幕调暗（白天要盖过阳光，夜里那个亮度会把眼睛晃花）。屏幕也经过曝光，夜里曝光开得大，要除回来
    const k = CABIN_NIGHT.value as number;
    const b = 0.9 + (0.5 / Math.max(1, exposure) - 0.9) * k;
    for (const s of this.screens) s.mat.color.setScalar(b);
    this.glassUniforms.uTime.value = t;
    this.glassUniforms.uRain.value = rain;
    // 雨大开快档，小雨慢档；不下雨时停回原位。超仿真里由开关决定
    const auto = this.wiperMode < 0;
    const on = auto ? rain > 0.04 : this.wiperMode > 0;
    const fast = auto ? rain > 0.5 : this.wiperMode > 1;
    const dt = Math.min(0.1, Math.max(0, t - this.lastGlassT));
    this.lastGlassT = t;
    if (on || this.wipeT > 0.02) {
      this.wipeT = (this.wipeT + dt * (fast ? 1.15 : 0.7)) % 1;
      if (!on && this.wipeT < 0.03) this.wipeT = 0;
    }
    const s = 0.5 - 0.5 * Math.cos(this.wipeT * Math.PI * 2);
    this.setWiperAngle(WIPER_REST - WIPER_SWEEP * s);
    // 停着的时候收在风挡下沿外面，从舱里看不到
    for (const w of this.wipers) w.pivot.visible = on || this.wipeT > 0;
    this.glassUniforms.uWipeOn.value = on ? 1 : 0;
    this.glassUniforms.uFlow.value = Math.min(1, airspeed / 35);
    this.glassUniforms.uShield.value = shield;
  }

  /** 机械指针每帧更新；电子屏约 20 Hz 重绘（告警灯板 8 Hz）。 */
  drawInstruments(t: number, d: InstrumentData): void {
    if (!this.loaded) return;
    const y = d.sys;
    // 气压式仪表不用电：空速看皮托管（结冰就读低），高度看气压设定。电动陀螺断电后慢慢停下，这里直接停在最后的位置
    this.setNeedle('ndl_asi_main', NEEDLE.asi(d.airspeed * (y?.pitotFactor ?? 1)));
    const alt = d.altitudeMSL + (y ? (y.c.baro - 1013) * 8.2 : 0);
    this.setNeedle('ndl_alt_100', NEEDLE.alt100(alt));
    this.setNeedle('ndl_alt_1000', NEEDLE.alt1000(alt));
    this.setNeedle('ndl_vsi_main', NEEDLE.vsi(d.vs));
    this.setNeedle('ndl_nr_main', NEEDLE.nr(d.rpm));
    const gyro = !y || y.powered;
    if (gyro) {
      this.setNeedle('ndl_turn_needle', NEEDLE.turn(d.yawRate));
      // 航向刻度盘：当前航向转到正上方
      this.setNeedle('ndl_hsi_card', -d.heading);
      this.setNeedle('ndl_hdg2_card', -d.heading);
    }
    this.setNeedle('ndl_turn_ball', NEEDLE.ball(d.slip));
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
      if (!this.screenOn(s.kind, d)) {
        if (!s.dark) {
          drawOff(s.ctx, s.w, s.h);
          s.tex.needsUpdate = true;
          s.dark = true;
        }
        continue;
      }
      s.dark = false;
      if (s.kind === 'vemd1') drawVemdTop(s.ctx, d, s.w, s.h);
      else if (s.kind === 'vemd2') {
        if (!slow) continue;
        drawVemdBottom(s.ctx, d, s.w, s.h);
      } else if (s.kind === 'ai') drawAttitude(s.ctx, d, s.w, s.h);
      else if (s.kind === 'gps') drawGps(s.ctx, d, this.minimap, this.mapRange, s.w, s.h);
      else if (s.kind === 'ann') {
        if (!slow) continue;
        drawAnnunciator(s.ctx, d, s.w, s.h, t);
      } else if (s.kind === 'efb') {
        if (!slow) continue;
        drawEfb(s.ctx, d, this.minimap, this.mapRange, s.w, s.h);
      } else {
        if (!slow) continue;
        if (s.kind === 'radio') drawRadio(s.ctx, d, s.w, s.h);
        else if (s.kind === 'xpdr') drawXpdr(s.ctx, d, s.w, s.h, t);
        else if (s.kind === 'hobbs') drawHobbs(s.ctx, d, s.w, s.h);
        else drawTrack(s.ctx, d, s.w, s.h);
      }
      s.tex.needsUpdate = true;
    }
  }

  /** 这块屏现在有没有电 */
  private screenOn(kind: Screen['kind'], d: InstrumentData): boolean {
    const y = d.sys;
    if (!y || kind === 'efb' || kind === 'hobbs') return true;
    const c = y.c;
    if (kind === 'vemd1') return y.vemdOn && c.vemdOff1 < 0.5;
    if (kind === 'vemd2') return y.vemdOn && c.vemdOff2 < 0.5;
    if (kind === 'ai') return y.powered && c.cb_stby > 0.5;
    if (kind === 'ann') return y.powered;
    if (kind === 'gps') return y.avionics && y.feeds('cb_gps') && c.gpsPower > 0.5;
    if (kind === 'radio') return y.avionics && y.feeds('cb_com');
    if (kind === 'xpdr') return y.avionics && y.feeds('cb_xpdr') && c.xpdrMode > 0;
    return y.avionics;
  }

  /** 每帧：控件的位置和指示灯 */
  updateSwitches(sys: Systems | null, dt: number, t: number): void {
    this.controls?.animate(sys ?? this.idleSystems, dt, t);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    disposeTextures(this.textures);
    this.controls?.dispose();
    this.controls = null;
    this.sourceResources?.dispose();
    this.geos.clear();
    this.mats.clear();
    this.textures.length = this.screens.length = this.wipers.length = this.pilotParts.length = 0;
    this.needles.clear();
    this.ctl = {};
    this.root.clear();
    this.minimap = null;
    this.loaded = false;
  }
}
