// 太阳光与分层阴影（CSM）：近处一层只覆盖几米（驾驶舱里窗框、遮光罩的影子清晰到毫米级），
// 往外逐层覆盖几十米、几百米、几千米。three.js 的 CSM 会改写全局光照着色器片段，
// 所以场景里每个受光材质都必须接入（否则会叠加多份阳光）——setupObject 负责接入并保留材质原有的着色器修改。

import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { injectFog } from './atmosphere';

/** 各层阴影的远边界（米） */
const SPLITS = [4, 40, 320, 2600];
/** 各层的法线偏移（约 1.5 个阴影纹素，避免自阴影条纹） */
const NORMAL_BIAS = [0.006, 0.05, 0.3, 2.2];

type Lit = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;

function isLit(m: THREE.Material): m is Lit {
  return (
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
    (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
    (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true
  );
}

export class SunShadows {
  readonly csm: CSM;
  private done = new WeakSet<THREE.Material>();
  private mapSize: number;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, mapSize: number) {
    this.mapSize = mapSize;
    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: SPLITS.length,
      maxFar: SPLITS[SPLITS.length - 1],
      mode: 'custom',
      customSplitsCallback: (n: number, _near: number, far: number, breaks: number[]) => {
        for (let i = 0; i < n; i++) breaks.push(Math.min(1, SPLITS[i] / far));
      },
      shadowMapSize: mapSize,
      lightDirection: new THREE.Vector3(-0.4, -0.8, -0.4).normalize(),
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 6000,
      lightMargin: 400,
    });
    this.csm.fade = true;
    this.csm.lights.forEach((l, i) => {
      l.shadow.bias = -0.00005;
      l.shadow.normalBias = NORMAL_BIAS[i];
    });
  }

  /** 光的颜色与强度（每帧由天空/天气给出） */
  setLight(color: THREE.Color, intensity: number): void {
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  /** sunDir：指向太阳的单位向量 */
  setSunDirection(sunDir: THREE.Vector3): void {
    this.csm.lightDirection.copy(sunDir).negate().normalize();
  }

  setShadows(enabled: boolean, mapSize: number): void {
    for (const l of this.csm.lights) l.castShadow = enabled;
    if (mapSize !== this.mapSize) {
      this.mapSize = mapSize;
      this.csm.shadowMapSize = mapSize;
      for (const l of this.csm.lights) {
        l.shadow.mapSize.set(mapSize, mapSize);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
  }

  /** 让一棵对象树里的所有受光材质接入 CSM（保留原有 onBeforeCompile 与缓存键）。 */
  setupObject(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) this.setupMaterial(m);
    });
  }

  setupMaterial(m: THREE.Material): void {
    if (this.done.has(m) || !isLit(m)) return;
    this.done.add(m);
    // 先记下原来的缓存键（默认缓存键是 onBeforeCompile 的源码，替换后会变成同一份，必须提前取）
    const prevKey = m.customProgramCacheKey();
    const prev = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      csmHook.call(m, shader, renderer);
      injectFog(shader);
    };
    m.customProgramCacheKey = () => prevKey + '|csm';
    m.needsUpdate = true;
  }

  /** 相机视野或宽高比变化后调用 */
  updateFrustums(): void {
    this.csm.updateFrustums();
  }

  update(): void {
    this.csm.update();
  }

  dispose(): void {
    this.csm.dispose();
    this.csm.remove();
  }
}
