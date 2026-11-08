// 太阳光与分层阴影（CSM，WebGPU 节点版）：近处一层只覆盖几米（驾驶舱里窗框、遮光罩的影子清晰到毫米级），
// 往外逐层覆盖几十米、几百米、几千米。阴影由一盏方向光的 CSMShadowNode 统一管理，
// 所有节点材质自动接收，不再需要逐个改写材质。

import * as THREE from 'three/webgpu';
import { positionWorld, shadow as shadowNode, uniform } from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { cloudShadow } from './cloudShadowMap';
import { terrainSun } from './sunMap';
import { SHADOW_PROXY_FAR, SHADOW_PROXY_NEAR } from './shadowProxy';

/** 能进入最近两层阴影的物体带的图层（默认物体由 markNearShadow 统一加上） */
export const NEAR_SHADOW_LAYER = 2;

/** 近处地形块带的图层：只进第三层阴影（40~320 m），不进最远一层 */
export const TERRAIN_SHADOW_LAYER = 3;

/** 给场景里还是默认图层（只有图层 0）的物体加上图层 2，让它们进入最近两层阴影。 */
export function markNearShadow(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o.layers.mask === 1) o.layers.enable(NEAR_SHADOW_LAYER);
  });
}

/**
 * 阴影贴图只留深度。three.js 的阴影节点给每层阴影建渲染目标时，除了深度贴图还带一张同样大小的 RGBA8 颜色贴图，
 * 只有打开“透光阴影”（renderer.shadowMap.transmitted）时才读它；这里只用深度比较（PCF），体积雾读的也是深度，
 * 颜色贴图白占显存（4 层 4096² 共 268 MB），每次画阴影还要把它整张清空、写一遍。
 * three.js r187 支持没有颜色附件的渲染目标（textures 为空，尺寸取深度贴图的），阴影节点建好渲染目标后把颜色贴图拿掉。
 * 只有深度时 three.js 不会在 setSize 时改深度贴图的尺寸（尺寸本来就从它取），改画质换阴影分辨率时一起改。
 * 点光源的阴影（立方体贴图）有自己的 setupRenderTarget，不受影响。
 */
let depthOnlyShadowMaps = false;
export function useDepthOnlyShadowMaps(): void {
  if (depthOnlyShadowMaps) return;
  depthOnlyShadowMaps = true;
  type Target = { shadowMap: THREE.RenderTarget; depthTexture: THREE.DepthTexture };
  type Builder = { renderer: THREE.WebGPURenderer };
  const proto = Object.getPrototypeOf(shadowNode(new THREE.DirectionalLight())) as { setupRenderTarget(s: THREE.LightShadow, b: Builder): Target };
  const base = proto.setupRenderTarget;
  proto.setupRenderTarget = function (this: unknown, s: THREE.LightShadow, builder: Builder): Target {
    const out = base.call(this, s, builder);
    const cfg = builder.renderer.shadowMap as { transmitted?: boolean; type: THREE.ShadowMapType };
    if (cfg.transmitted === true || cfg.type === THREE.VSMShadowMap) return out;
    const rt = out.shadowMap;
    // 颜色贴图还没传到显卡（第一次渲染时才建），去掉引用即可
    rt.textures.length = 0;
    const setSize = rt.setSize.bind(rt);
    const image = out.depthTexture.image as { width: number; height: number };
    rt.setSize = (w: number, h: number, d = 1) => {
      if (rt.width !== w || rt.height !== h) {
        image.width = w;
        image.height = h;
      }
      setSize(w, h, d);
    };
    return out;
  };
}

/** 各层阴影的远边界（米） */
export const SHADOW_SPLITS = [4, 40, 320, 2600];
/** 各层的法线偏移（约 1.5 个阴影纹素，避免自阴影条纹） */
const NORMAL_BIAS = [0.006, 0.05, 0.3, 2.2];
/**
 * 阴影要画的东西占一帧绘制调用的一半以上，而远处的影子在几帧之内几乎不变：
 * 最近一层（座舱）每帧画，往外隔 2、4、8 帧画一次，错开在不同的帧里。
 * 相机转过一定角度或者走出一段距离就立刻重画（阴影框是按视锥算的，转头时旧的框盖不到新转进来的地方）。
 */
const SHADOW_PERIOD = [1, 2, 4, 8];
const SHADOW_TURN = [0, 0.06, 0.04, 0.028];
const SHADOW_MOVE = [0, 3, 20, 90];

export class SunShadows {
  readonly light: THREE.DirectionalLight;
  readonly csm: CSMShadowNode;
  /** 阳光颜色 × 强度（光源的颜色节点用它再乘上云影） */
  readonly radiance = uniform(new THREE.Color(1, 1, 1));
  private dir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();
  private mapSize: number;
  private configured = 0;
  private enabled = true;
  private frame = 0;
  private readonly drawn = SHADOW_PERIOD.map(() => ({ frame: -99, pos: new THREE.Vector3(1e9, 0, 0), q: new THREE.Quaternion() }));

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, mapSize: number) {
    useDepthOnlyShadowMaps();
    this.mapSize = mapSize;
    const l = new THREE.DirectionalLight(0xffffff, 3);
    l.castShadow = true;
    l.shadow.mapSize.set(mapSize, mapSize);
    l.shadow.camera.near = 1;
    // 最外一层阴影框的斜对角有七八千米；太阳低时还要多留出山的距离。超过远平面的地面按反向深度比较会被判成“在影子里”，
    // 高空和黄昏时远处的地面整块变暗
    l.shadow.camera.far = 30000;
    l.shadow.bias = -0.00005;
    l.shadow.normalBias = NORMAL_BIAS[0];
    scene.add(l, l.target);
    this.light = l;
    this.csm = new CSMShadowNode(l, {
      cascades: SHADOW_SPLITS.length,
      maxFar: SHADOW_SPLITS[SHADOW_SPLITS.length - 1],
      mode: 'custom',
      customSplitsCallback: (n: number, _near: number, far: number, breaks: number[]) => {
        for (let i = 0; i < n; i++) breaks.push(Math.min(1, SHADOW_SPLITS[i] / far));
      },
      lightMargin: 400,
    });
    this.csm.fade = true;
    void camera; // CSM 在第一次渲染时自动取当前相机并创建各层阴影
    l.shadow.shadowNode = this.csm;
    // 云影：直射阳光再乘上头顶云层的透过率（与天空里看到的体积云是同一份密度，云影跟着云一起飘）
    // 山影：分层阴影范围之外（以及范围之内）山挡住太阳的地方，见 sunMap.ts
    (l as THREE.DirectionalLight & { colorNode?: THREE.Node }).colorNode = this.radiance.mul(cloudShadow(positionWorld)).mul(terrainSun(positionWorld));
  }

  /** 光的颜色与强度（每帧由天空/天气给出） */
  setLight(color: THREE.Color, intensity: number): void {
    this.light.color.copy(color);
    this.light.intensity = intensity;
    this.radiance.value.copy(color).multiplyScalar(intensity);
  }

  /** sunDir：指向太阳的单位向量 */
  setSunDirection(sunDir: THREE.Vector3): void {
    this.dir.copy(sunDir).normalize();
  }

  setShadows(enabled: boolean, mapSize: number): void {
    this.enabled = enabled;
    this.light.castShadow = enabled;
    for (const c of this.csm.lights) c.castShadow = enabled;
    if (mapSize !== this.mapSize) {
      this.mapSize = mapSize;
      this.light.shadow.mapSize.set(mapSize, mapSize);
      // 节点版的阴影每帧按 mapSize 自己调整阴影贴图大小；不能把 shadow.map 置空（那是阴影节点创建的渲染目标，
      // 置空后体积雾等需要读阴影贴图的效果就找不到它了）
      for (const c of this.csm.lights) c.shadow!.mapSize.set(mapSize, mapSize);
    }
  }

  /** 旧接口：WebGL 版需要逐个材质接入 CSM，节点版不需要 */
  setupObject(_root: THREE.Object3D): void {}

  /** 相机视野或宽高比变化后调用 */
  updateFrustums(): void {
    if (this.csm.lights.length) this.csm.updateFrustums();
  }

  /** 每帧：方向光跟随相机（CSM 只用方向；各层阴影框由 CSM 节点按纹素对齐放置） */
  update(cam: THREE.Camera): void {
    this.light.target.position.copy(cam.position);
    this.light.position.copy(cam.position).addScaledVector(this.dir, 3000);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    // CSM 在第一次渲染时才创建各层的阴影；之后补上每层的法线偏移与开关
    if (this.configured !== this.csm.lights.length) {
      this.configured = this.csm.lights.length;
      this.csm.lights.forEach((c, i) => {
        c.shadow!.normalBias = NORMAL_BIAS[i] ?? NORMAL_BIAS[NORMAL_BIAS.length - 1];
        c.castShadow = this.enabled;
        // 最近两层（4 m、40 m）只画图层 2（NEAR_SHADOW_LAYER，近处物体都带）；外面两层画图层 0 与 1。
        // 图层 1 上“只在远处”的物体（中景 / 远景模型、远处地形块）因此只进外面两层。
        // （阴影相机若只开图层 0，three.js 会让它继承主相机的全部图层，所以近处用单独的图层 2）
        // 图层 5 / 6：只投影的合并网格（多材质的组合成一个，见 shadowProxy.ts），主相机不画
        if (i < 2) {
          c.shadow!.camera.layers.set(NEAR_SHADOW_LAYER);
          c.shadow!.camera.layers.enable(SHADOW_PROXY_NEAR);
        } else {
          c.shadow!.camera.layers.set(0);
          c.shadow!.camera.layers.enable(1);
          c.shadow!.camera.layers.enable(SHADOW_PROXY_FAR);
          if (i === 2) c.shadow!.camera.layers.enable(TERRAIN_SHADOW_LAYER);
        }
        c.shadow!.autoUpdate = false;
        c.shadow!.needsUpdate = true;
      });
    }
    this.frame++;
    this.csm.lights.forEach((c, i) => {
      const d = this.drawn[i];
      const p = SHADOW_PERIOD[i];
      const due = this.frame - d.frame >= p && (p === 1 || this.frame % p === i % p);
      const moved = d.pos.distanceToSquared(cam.position) > SHADOW_MOVE[i] ** 2;
      const turned = d.q.angleTo(cam.quaternion) > SHADOW_TURN[i];
      if (due || (i > 0 && (moved || turned))) {
        c.shadow!.needsUpdate = true;
        d.frame = this.frame;
        d.pos.copy(cam.position);
        d.q.copy(cam.quaternion);
      }
    });
  }

  dispose(): void {
    this.csm.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
