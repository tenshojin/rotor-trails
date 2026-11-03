// 太阳光与分层阴影（CSM，WebGPU 节点版）：近处一层只覆盖几米（驾驶舱里窗框、遮光罩的影子清晰到毫米级），
// 往外逐层覆盖几十米、几百米、几千米。阴影由一盏方向光的 CSMShadowNode 统一管理，
// 所有节点材质自动接收，不再需要逐个改写材质。

import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';

/** 各层阴影的远边界（米） */
const SPLITS = [4, 40, 320, 2600];
/** 各层的法线偏移（约 1.5 个阴影纹素，避免自阴影条纹） */
const NORMAL_BIAS = [0.006, 0.05, 0.3, 2.2];

export class SunShadows {
  readonly light: THREE.DirectionalLight;
  readonly csm: CSMShadowNode;
  private dir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();
  private mapSize: number;
  private configured = 0;
  private enabled = true;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, mapSize: number) {
    this.mapSize = mapSize;
    const l = new THREE.DirectionalLight(0xffffff, 3);
    l.castShadow = true;
    l.shadow.mapSize.set(mapSize, mapSize);
    l.shadow.camera.near = 1;
    l.shadow.camera.far = 6000;
    l.shadow.bias = -0.00005;
    l.shadow.normalBias = NORMAL_BIAS[0];
    scene.add(l, l.target);
    this.light = l;
    this.csm = new CSMShadowNode(l, {
      cascades: SPLITS.length,
      maxFar: SPLITS[SPLITS.length - 1],
      mode: 'custom',
      customSplitsCallback: (n: number, _near: number, far: number, breaks: number[]) => {
        for (let i = 0; i < n; i++) breaks.push(Math.min(1, SPLITS[i] / far));
      },
      lightMargin: 400,
    });
    this.csm.fade = true;
    void camera; // CSM 在第一次渲染时自动取当前相机并创建各层阴影
    l.shadow.shadowNode = this.csm;
  }

  /** 光的颜色与强度（每帧由天空/天气给出） */
  setLight(color: THREE.Color, intensity: number): void {
    this.light.color.copy(color);
    this.light.intensity = intensity;
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
      for (const c of this.csm.lights) {
        const sh = c.shadow!;
        sh.mapSize.set(mapSize, mapSize);
        sh.map?.dispose();
        sh.map = null;
      }
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
      });
    }
  }

  dispose(): void {
    this.csm.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
