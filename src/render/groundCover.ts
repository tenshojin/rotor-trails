// 草丛：地形贴图的分辨率不够，地面是一层平滑的绿色。这里在镜头周围铺两圈草丛：
//   · 近圈（约 88 米）：一丛丛细草，起降时看得清草叶；
//   · 中圈（到几百米）：大一些、密一些的草团，让远处的草地还是毛茸茸的，不是到某一圈就突然光秃。
// 再远的草地由地形着色器画（一簇簇的明暗，见 terrainShader.ts），实体的灌木由 vegetation 种。：
// 地面分成 16 米一块，每块的草丛只在第一次进入范围时生成一次（按块的坐标定种子，同一块每次都一样），
// 环形缓冲区：一块离开范围，它的位置就让给新进来的那块，只上传变化的部分。飞高了整组隐藏，不花任何开销。
//
// 草的颜色和地形的草地层用同一份噪声与配色，远处接得上。

import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  float,
  interleavedGradientNoise,
  length,
  max,
  mix,
  normalViewGeometry,
  positionGeometry,
  positionLocal,
  positionWorld,
  screenCoordinate,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { HELI } from '../config/flight';
import type { WorldData } from '../world/worldgen';
import { gustAt, WASH, WIND } from './atmosphere';
import { getNoiseTexture } from './textures';

interface RingDef {
  /** 一块多大（米） */
  tile: number;
  /** 镜头所在的块往外几块 */
  range: number;
  /** 每块最多多少丛 */
  per: number;
  /** 大小范围、高度相对宽度的比例 */
  size: [number, number];
  tall: [number, number];
  /** 贴地多高以内才显示 */
  agl: number;
  /** 每帧最多生成几块 */
  budget: number;
}

/** 近圈（半径约 88 米）、中圈 */
const NEAR: RingDef = { tile: 16, range: 5, per: 230, size: [0.6, 1.35], tall: [0.8, 1.3], agl: 130, budget: 8 };
const MID: RingDef = { tile: 48, range: 10, per: 340, size: [2.3, 4.4], tall: [0.42, 0.7], agl: 420, budget: 4 };
/** 各画质的中圈半径（块）：0 = 不画 */
export const GRASS_MID: Record<string, number> = { low: 0, medium: 5, high: 8, ultra: 10 };

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

/** 中圈的草团：叶子密得多，下半截几乎是实心的（离远了贴图缩小时才不会被透明度裁掉） */
function clumpTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  let seed = 29;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = 'rgb(96,96,96)';
  g.beginPath();
  g.moveTo(8, H);
  for (let x = 8; x <= W - 8; x += 12) g.lineTo(x, H - 38 - 34 * Math.sin((x / W) * Math.PI) - rnd() * 16);
  g.lineTo(W - 8, H);
  g.closePath();
  g.fill();
  for (let i = 0; i < 240; i++) {
    const x = 10 + rnd() * (W - 20);
    const lean = (rnd() - 0.5) * 46;
    const edge = Math.sin((x / W) * Math.PI);
    const h = (34 + rnd() * 74) * (0.45 + 0.55 * edge);
    const w = 1.6 + rnd() * 2.6;
    const v = 110 + rnd() * 145;
    g.fillStyle = `rgb(${v},${v},${v})`;
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

/** 一圈草：环形缓冲区，一块离开范围，它的位置就让给新进来的那块 */
class Ring {
  readonly mesh: THREE.InstancedMesh;
  readonly side: number;
  private readonly slots: Int32Array;
  range: number;

  constructor(readonly def: RingDef, geo: THREE.BufferGeometry, mat: THREE.Material) {
    this.side = def.range * 2 + 1;
    this.range = def.range;
    this.slots = new Int32Array(this.side * this.side * 2).fill(1 << 30);
    const n = this.side * this.side * def.per;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, ZERO);
  }

  /** 从镜头所在的块往外一圈圈检查，近处先生成 */
  update(cam: THREE.Vector3, fill: (i: number, j: number, slot: number, ring: Ring) => void): void {
    const { tile, budget: most } = this.def;
    const S = this.side;
    const ci = Math.floor(cam.x / tile);
    const cj = Math.floor(cam.z / tile);
    let budget = most;
    this.mesh.instanceMatrix.clearUpdateRanges();
    for (let r = 0; r <= this.range && budget > 0; r++) {
      for (let dj = -r; dj <= r && budget > 0; dj++) {
        for (let di = -r; di <= r && budget > 0; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          const slot = (((i % S) + S) % S) + (((j % S) + S) % S) * S;
          if (this.slots[slot * 2] === i && this.slots[slot * 2 + 1] === j) continue;
          this.slots[slot * 2] = i;
          this.slots[slot * 2 + 1] = j;
          fill(i, j, slot, this);
          budget--;
        }
      }
    }
  }
}

export class GroundCover {
  readonly group = new THREE.Group();
  private readonly near: Ring;
  private readonly mid: Ring;
  private readonly geo = tuftGeometry();
  private readonly tex = tuftTexture();
  private readonly clump = clumpTexture();
  private readonly mats: THREE.MeshStandardNodeMaterial[] = [];
  private readonly time = uniform(0);
  /** 中圈画到多远（米） */
  private readonly midFar = uniform(400);
  private readonly density: number;

  constructor(private readonly world: WorldData, forest: THREE.Texture, ground: THREE.Texture, midRange: number) {
    this.density = DENSITY[world.map.id] ?? 0.6;
    const B = world.map.biome;
    const c3 = (hex: number) => {
      const c = new THREE.Color().setHex(hex);
      return vec3(c.r, c.g, c.b);
    };
    const noise = getNoiseTexture();
    const material = (tex: THREE.Texture, fade: THREE.Node<'float'>, mid: boolean): THREE.MeshStandardNodeMaterial => {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
      const P = positionWorld;
      const muv = P.xz.div(world.map.size).add(0.5);
      const n1 = texture(noise, P.xz.mul(0.0021)).r;
      const g2 = smoothstep(0.35, 0.65, n1);
      const fo = clamp(texture(forest, muv).r.mul(1.3), 0.0, 0.85);
      // 颜色跟着这块地：地表颜色图里有这里的草、枯草、林下、沙地，草团才融得进地面
      const base = mix(mix(mix(c3(B.grass), c3(B.grass2), g2), c3(B.forestFloor), fo), texture(ground, muv).rgb, mid ? 0.8 : 0.5);
      const t = texture(tex, uv());
      // 同一丛里草叶的深浅、不同丛之间的色差
      const vary = texture(noise, P.xz.mul(0.37)).g.mul(0.5).add(0.78);
      // （地表颜色图是平均的反照率，比照了太阳的地面暗：中圈提亮一点，不然草团是地上一块块深色的斑）
      m.colorNode = vec4(base.mul(t.r.mul(1.15).add(0.1)).mul(vary).mul(mid ? 1.7 : 1), t.a.mul(fade));
      // 双面渲染时背面不翻转法线，否则一半草叶是黑的
      m.normalNode = normalViewGeometry;
      // 风：草尖晃动
      const hgt = positionGeometry.y;
      const wx = positionLocal.x.mul(0.31).add(positionLocal.z.mul(0.23));
      // 阵风扫过时一片草一起倒下去，草尖还在抖；风停了也有一点轻轻的晃动
      const gust = gustAt(positionLocal.xz).toVar();
      const amp = (WIND.k as unknown as THREE.Node<'float'>).mul(gust.mul(1.7).add(0.45)).toVar();
      const quiver = sin(this.time.mul(1.9).add(wx)).mul(0.6).add(sin(this.time.mul(4.3).add(wx.mul(2.1))).mul(0.3));
      const down = WIND.dir as unknown as THREE.Node<'vec2'>;
      const sway = amp.mul(quiver.mul(0.42).add(0.9)).mul(mid ? 1.5 : 1.25).toVar();
      // 旋翼下洗：气流打到地面后向四周散开，把草一圈圈压倒，一阵一阵往外跑，草尖还在急促地抖
      const wv = positionLocal.xz.sub(WASH.xy);
      const wd = length(wv).max(0.01);
      const wdir = wv.div(wd);
      const rn = wd.div(HELI.rotorRadius);
      const wk = smoothstep(0.15, 0.7, rn).mul(float(1).sub(smoothstep(1.7, 4.2, rn))).mul(WASH.z);
      const puff = max(sin(wd.mul(0.85).sub(this.time.mul(7.5)).add(wx.mul(0.7))).mul(0.42).add(0.62), 0.0);
      const shake = sin(this.time.mul(24.0).add(wx.mul(3.1))).mul(0.16);
      const lay = wk.mul(puff.add(shake)).mul(hgt).toVar();
      m.positionNode = positionLocal.add(vec3(down.x.mul(sway), sway.mul(-0.22), down.y.mul(sway)).mul(hgt)).add(vec3(wdir.x.mul(2.1), float(-0.8), wdir.y.mul(2.1)).mul(lay));
      this.mats.push(m);
      return m;
    };
    const dist = length(positionWorld.sub(cameraPosition));
    const nearFade = float(1).sub(smoothstep(62.0, 86.0, dist));
    // 中圈：进出都是一棵棵抖着换的，不是一条线上突然出现
    const ign = interleavedGradientNoise(screenCoordinate.xy);
    const midFade = step(ign, smoothstep(52.0, 84.0, dist).mul(float(1).sub(smoothstep(this.midFar.mul(0.62), this.midFar, dist))));
    this.near = new Ring(NEAR, this.geo, material(this.tex, nearFade, false));
    this.mid = new Ring(MID, this.geo, material(this.clump, midFade, true));
    this.group.add(this.near.mesh, this.mid.mesh);
    this.group.visible = false;
    this.setMidRange(midRange);
  }

  /** 中圈画几块（画质变化时调用） */
  setMidRange(range: number): void {
    this.mid.range = Math.min(MID.range, range);
    this.mid.mesh.visible = range > 0;
    this.midFar.value = Math.max(1, (this.mid.range - 0.5) * MID.tile);
  }

  /** 生成一块（i、j：块坐标）的草丛，写进第 slot 个位置 */
  private fill = (i: number, j: number, slot: number, ring: Ring): void => {
    const W = this.world;
    const T = W.terrain;
    const map = W.map;
    const res = T.res;
    const surf = W.surface;
    const wl = map.waterLevel ?? -1e9;
    const rockSlope = map.biome.rockSlope * 0.72;
    const { tile, per, size, tall } = ring.def;
    const mesh = ring.mesh;
    let seed = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(tile, 83492791) ^ 0x9e3779b9) >>> 0 || 1;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed / 4294967296;
    };
    const base = slot * per;
    const n = Math.round(per * this.density);
    let k = 0;
    for (let c = 0; c < n; c++) {
      const x = (i + rnd()) * tile;
      const z = (j + rnd()) * tile;
      const sc = size[0] + rnd() * (size[1] - size[0]);
      const rot = rnd() * Math.PI * 2;
      const tk = tall[0] + rnd() * (tall[1] - tall[0]);
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
      _s.set(sc, sc * tk, sc);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(base + k, _m);
      k++;
    }
    for (; k < per; k++) mesh.setMatrixAt(base + k, ZERO);
    const im = mesh.instanceMatrix;
    im.addUpdateRange(base * 16, per * 16);
    im.needsUpdate = true;
  };

  update(t: number, cam: THREE.Vector3): void {
    const T = this.world.terrain;
    const wl = this.world.map.waterLevel ?? -1e9;
    const agl = cam.y - Math.max(T.heightAt(cam.x, cam.z), wl);
    const near = agl < NEAR.agl && this.density > 0;
    const mid = agl < MID.agl && this.density > 0 && this.mid.range > 0;
    this.group.visible = near || mid;
    this.near.mesh.visible = near;
    this.mid.mesh.visible = mid;
    if (!near && !mid) return;
    this.time.value = t;
    if (near) this.near.update(cam, this.fill);
    if (mid) this.mid.update(cam, this.fill);
  }

  dispose(): void {
    this.near.mesh.dispose();
    this.mid.mesh.dispose();
    this.geo.dispose();
    this.tex.dispose();
    this.clump.dispose();
    for (const m of this.mats) m.dispose();
  }
}
