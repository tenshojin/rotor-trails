// 草丛：贴近地面时（起降、低飞）地形贴图的分辨率不够，地面是一层平滑的绿色。这里在镜头周围铺一圈草丛：
// 地面分成 16 米一块，每块的草丛只在第一次进入范围时生成一次（按块的坐标定种子，同一块每次都一样），
// 环形缓冲区：一块离开范围，它的位置就让给新进来的那块，只上传变化的部分。飞高了整组隐藏，不花任何开销。
//
// 草的颜色和地形的草地层用同一份噪声与配色，远处接得上。

import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  float,
  length,
  mix,
  normalViewGeometry,
  positionGeometry,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { WorldData } from '../world/worldgen';
import { getNoiseTexture } from './textures';

const TILE = 16;
/** 镜头所在的块往外几块（半径约 88 米） */
const RANGE = 5;
const SIDE = RANGE * 2 + 1;
/** 每块最多多少丛 */
const PER = 230;
/** 贴地多高以内才显示 */
const SHOW_AGL = 75;
/** 每帧最多生成几块 */
const BUDGET = 8;

/** 各地图草的密度（草地多的 1，荒漠零星几丛） */
const DENSITY: Record<string, number> = { japan: 1, fjord: 1, amazon: 0.8, canyon: 0.2, himalaya: 0.55, training: 1 };

function tuftTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const x = 20 + rnd() * (W - 40);
    const lean = (rnd() - 0.5) * 80;
    const h = 40 + rnd() * 84;
    const w = 1.4 + rnd() * 2.2;
    const v = 150 + rnd() * 105;
    const grd = g.createLinearGradient(0, H, 0, H - h);
    grd.addColorStop(0, `rgb(${v * 0.55},${v * 0.55},${v * 0.55})`);
    grd.addColorStop(1, `rgb(${v},${v},${v})`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - w, H);
    g.quadraticCurveTo(x + lean * 0.2 - w * 0.5, H - h * 0.6, x + lean, H - h);
    g.quadraticCurveTo(x + lean * 0.2 + w * 0.5, H - h * 0.6, x + w, H);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** 三片交叉的面：宽 1 米、高 0.5 米，法线朝上（打光和地面一致） */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 0.5, cz, -cx, 0.5, -cz);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly geo = tuftGeometry();
  private readonly tex = tuftTexture();
  private readonly mat: THREE.MeshStandardNodeMaterial;
  private readonly slots = new Int32Array(SIDE * SIDE * 2).fill(1 << 30);
  private readonly time = uniform(0);
  private readonly density: number;

  constructor(private readonly world: WorldData, forest: THREE.Texture) {
    this.density = DENSITY[world.map.id] ?? 0.6;
    const B = world.map.biome;
    const c3 = (hex: number) => {
      const c = new THREE.Color().setHex(hex);
      return vec3(c.r, c.g, c.b);
    };
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
    const noise = getNoiseTexture();
    const P = positionWorld;
    const muv = P.xz.div(world.map.size).add(0.5);
    const n1 = texture(noise, P.xz.mul(0.0021)).r;
    const g2 = smoothstep(0.35, 0.65, n1);
    const fo = clamp(texture(forest, muv).r.mul(1.3), 0.0, 0.85);
    const base = mix(mix(c3(B.grass), c3(B.grass2), g2), c3(B.forestFloor), fo);
    const t = texture(this.tex, uv());
    const fade = float(1).sub(smoothstep(62.0, 86.0, length(P.sub(cameraPosition))));
    // 同一丛里草叶的深浅、不同丛之间的色差
    const vary = texture(noise, P.xz.mul(0.37)).g.mul(0.5).add(0.78);
    m.colorNode = vec4(base.mul(t.r.mul(1.15).add(0.1)).mul(vary), t.a.mul(fade));
    // 双面渲染时背面不翻转法线，否则一半草叶是黑的
    m.normalNode = normalViewGeometry;
    // 风：草尖晃动
    const hgt = positionGeometry.y;
    const wx = positionLocal.x.mul(0.31).add(positionLocal.z.mul(0.23));
    const sway = sin(this.time.mul(1.9).add(wx)).mul(0.05).add(sin(this.time.mul(4.3).add(wx.mul(2.1))).mul(0.02));
    m.positionNode = positionLocal.add(vec3(sway, 0.0, sway.mul(0.7)).mul(hgt));
    this.mat = m;
    const n = SIDE * SIDE * PER;
    this.mesh = new THREE.InstancedMesh(this.geo, m, n);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, ZERO);
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** 生成一块（i、j：块坐标）的草丛，写进第 slot 个位置 */
  private fill(i: number, j: number, slot: number): void {
    const W = this.world;
    const T = W.terrain;
    const map = W.map;
    const res = T.res;
    const surf = W.surface;
    const wl = map.waterLevel ?? -1e9;
    const rockSlope = map.biome.rockSlope * 0.72;
    let seed = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ 0x9e3779b9) >>> 0 || 1;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 4294967296;
    };
    const base = slot * PER;
    const n = Math.round(PER * this.density);
    let k = 0;
    for (let c = 0; c < n; c++) {
      const x = (i + rnd()) * TILE;
      const z = (j + rnd()) * TILE;
      const sc = 0.6 + rnd() * 0.75;
      const rot = rnd() * Math.PI * 2;
      if (!T.inside(x, z, 4)) continue;
      const h = T.heightAt(x, z);
      if (h < wl + 0.7) continue;
      if (T.slopeAt(x, z) > rockSlope) continue;
      const ix = Math.round((x + T.half) / T.cell);
      const iz = Math.round((z + T.half) / T.cell);
      const o = (iz * res + ix) * 4;
      if (surf[o] > 70 || surf[o + 1] > 90 || surf[o + 2] > 130 || surf[o + 3] > 50) continue;
      if (h > map.biome.snowLine - 40) continue;
      if (h < map.biome.beachTop + 1.2) continue;
      _p.set(x, h - 0.04, z);
      _q.setFromAxisAngle(_up, rot);
      _s.set(sc, sc * (0.8 + 0.5 * rnd()), sc);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(base + k, _m);
      k++;
    }
    for (; k < PER; k++) this.mesh.setMatrixAt(base + k, ZERO);
    const im = this.mesh.instanceMatrix;
    im.addUpdateRange(base * 16, PER * 16);
    im.needsUpdate = true;
  }

  update(t: number, cam: THREE.Vector3): void {
    const T = this.world.terrain;
    const wl = this.world.map.waterLevel ?? -1e9;
    const agl = cam.y - Math.max(T.heightAt(cam.x, cam.z), wl);
    const show = agl < SHOW_AGL && this.density > 0;
    this.group.visible = show;
    if (!show) return;
    this.time.value = t;
    const ci = Math.floor(cam.x / TILE);
    const cj = Math.floor(cam.z / TILE);
    let budget = BUDGET;
    this.mesh.instanceMatrix.clearUpdateRanges();
    // 从镜头所在的块往外一圈圈检查，近处先生成
    for (let r = 0; r <= RANGE && budget > 0; r++) {
      for (let dj = -r; dj <= r && budget > 0; dj++) {
        for (let di = -r; di <= r && budget > 0; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          const slot = (((i % SIDE) + SIDE) % SIDE) + (((j % SIDE) + SIDE) % SIDE) * SIDE;
          if (this.slots[slot * 2] === i && this.slots[slot * 2 + 1] === j) continue;
          this.slots[slot * 2] = i;
          this.slots[slot * 2 + 1] = j;
          this.fill(i, j, slot);
          budget--;
        }
      }
    }
  }

  dispose(): void {
    this.mesh.dispose();
    this.geo.dispose();
    this.tex.dispose();
    this.mat.dispose();
  }
}
