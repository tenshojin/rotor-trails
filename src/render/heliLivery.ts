// 机身涂装：不走 UV，机身坐标直接投影到贴图上（tools/blender/heli_livery.py 画的）。座舱外壳和后机身是两个模型，
// 用同一张图、同一套投影，接口处的条纹自然对得上；分色线和网格的面没有关系，贴多近都是一条光滑的线。
//
// 贴图：第 0 块左舷、第 1 块右舷（都是人站在飞机旁边看到的样子，所以右舷的 u 是反的）、第 2 块俯视。
// 朝上朝下的面用俯视那块，朝下的再染成机腹的深蓝。

import * as THREE from 'three/webgpu';
import { abs, bumpMap, dFdx, dFdy, float, mix, normalLocal, positionGeometry, smoothstep, step, texture, vec2, vec3, vec4 } from 'three/tsl';

const COLOR_URL = 'models/heli_livery.webp';
const DETAIL_URL = 'models/heli_livery_h.webp';

// 贴图的尺度（和 heli_livery.py 一致）
const NOSE = 2.56;
const LENGTH = 10.24;
const TOP = 1.88;
const TALL = 3;
const ROWS = 3200;
const SIDE_ROWS = 1200;
const TOP_START = 2400;
const PX_PER_M = 400;
/** 深蓝 / 白：俯视那块是白底，朝下的面乘上它就是机腹 */
const BELLY = vec3(0.094, 0.16, 0.29);

export interface LiveryTextures {
  color: THREE.Texture;
  detail: THREE.Texture;
}

let shared: { refs: number; job: Promise<LiveryTextures | null> } | null = null;

async function load(): Promise<LiveryTextures | null> {
  try {
    const loader = new THREE.TextureLoader();
    const [color, detail] = await Promise.all([
      loader.loadAsync(new URL(COLOR_URL, document.baseURI).href),
      loader.loadAsync(new URL(DETAIL_URL, document.baseURI).href),
    ]);
    for (const t of [color, detail]) {
      t.flipY = false;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    }
    color.colorSpace = THREE.SRGBColorSpace;
    color.needsUpdate = detail.needsUpdate = true;
    return { color, detail };
  } catch (error) {
    console.warn('机身涂装贴图加载失败，用纯色：', error);
    return null;
  }
}

/** 外观和座舱外壳共用一份贴图：借的时候加一，用完 releaseLivery */
export function acquireLivery(): Promise<LiveryTextures | null> {
  shared ??= { refs: 0, job: load() };
  shared.refs++;
  return shared.job;
}

export function releaseLivery(): void {
  if (!shared || --shared.refs > 0) return;
  const job = shared.job;
  shared = null;
  void job.then((t) => {
    t?.color.dispose();
    t?.detail.dispose();
  });
}

/** 把 src 的漆换成投影涂装（带一层清漆）。src 的法线、透明度这些都不要：漆就是漆 */
export function liveryMaterial(src: THREE.Material, t: LiveryTextures): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.name = src.name;
  m.side = src.side;
  m.metalness = 0;
  m.clearcoat = 0.5;
  m.clearcoatRoughness = 0.12;
  const p = positionGeometry;
  const along = p.z.add(NOSE).div(LENGTH);
  const high = float(TOP).sub(p.y).div(TALL);
  const right = step(0, p.x);
  const k = SIDE_ROWS / ROWS;
  const sideUv = vec2(mix(along, float(1).sub(along), right), high.add(right).mul(k));
  // x = 0 这条线上 uv 是跳变的：导数要用连续的那一份，不然机头正中间有一条糊的线
  const flip = right.mul(-2).add(1);
  const gx = vec2(dFdx(along).mul(flip), dFdx(high).mul(k));
  const gy = vec2(dFdy(along).mul(flip), dFdy(high).mul(k));
  const topUv = vec2(along, float(TOP_START / ROWS).add(float(1).sub(p.x).mul(PX_PER_M / ROWS)));
  const up = normalLocal.y;
  const flat = smoothstep(0.72, 0.9, abs(up));
  const topTint = mix(BELLY, vec3(1), step(0, up));
  const col = mix(texture(t.color, sideUv).grad(gx, gy).rgb, texture(t.color, topUv).rgb.mul(topTint), flat);
  const detail = mix(texture(t.detail, sideUv).grad(gx, gy).rg, texture(t.detail, topUv).rg, flat);
  m.colorNode = vec4(col, 1);
  m.roughnessNode = detail.y;
  // 接缝和铆钉在清漆上有一点起伏：只在侧面的投影上算（导数跳变的那条线都在侧面权重为零的地方）
  m.normalNode = bumpMap(texture(t.detail, sideUv).r, float(0.6).mul(float(1).sub(flat)));
  return m;
}
