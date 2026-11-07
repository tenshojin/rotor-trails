// 水上走的船：港湾里的渡轮和渔船、河上的客船。世界里停着不动的东西再多也是一张画，远处有一条船拖着白浪慢慢走，
// 这张画才是活的。一张图几条，模型和港口里停着的是同一批；位置在 CPU 上算，尾浪是一块贴在水面上的三角形。
// 没有碰撞：航线都在开阔水面上，飞机要贴着水面才碰得到。

import * as THREE from 'three/webgpu';
import { abs, float, mix, positionWorld, smoothstep, texture, uv, vec3 } from 'three/tsl';
import { damp } from '../core/math';
import { FOG } from './atmosphere';
import { mulberry32 } from '../core/noise';
import type { VesselDef } from '../maps/types';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';
import { getNoiseTexture } from './textures';

type Point = [number, number];

/** 尾浪的半张角：开尔文尾迹，不管船多快都是 19.5° */
const WAKE_TAN = 0.354;

/**
 * 在开阔水面上找一个椭圆航线：绕一圈全是够深的水。找不到就返回 null。
 * ground：水底高度。圈子转着试，从大到小。
 */
export function findLoop(ground: (x: number, z: number) => number, water: number, half: number, seed: number): Point[] | null {
  const rng = mulberry32(seed);
  for (let i = 0; i < 400; i++) {
    const big = 1 - i / 500;
    const rx = (340 + 560 * rng()) * big;
    const rz = rx * (0.28 + 0.3 * rng());
    const rot = rng() * Math.PI;
    const cx = (rng() * 2 - 1) * (half - rx);
    const cz = (rng() * 2 - 1) * (half - rx);
    const pts: Point[] = [];
    let ok = true;
    for (let k = 0; k < 64 && ok; k++) {
      const a = (k / 64) * Math.PI * 2;
      const u = Math.cos(a) * rx;
      const v = Math.sin(a) * rz;
      const x = cx + u * Math.cos(rot) - v * Math.sin(rot);
      const z = cz + u * Math.sin(rot) + v * Math.cos(rot);
      // 离岸和岛都留点距离：往外再看一圈
      ok = Math.abs(x) < half && Math.abs(z) < half && ground(x, z) < water - 3 && ground(x + 60, z) < water - 1 && ground(x - 60, z) < water - 1 && ground(x, z + 60) < water - 1 && ground(x, z - 60) < water - 1;
      pts.push([x, z]);
    }
    if (ok) return pts;
  }
  return null;
}

class Route {
  private readonly cum: number[] = [0];
  readonly len: number;

  constructor(private readonly pts: Point[]) {
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i % pts.length];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    this.len = this.cum[pts.length];
  }

  at(s: number, out: Point): Point {
    s = ((s % this.len) + this.len) % this.len;
    let lo = 0;
    let hi = this.pts.length;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo];
    const b = this.pts[hi % this.pts.length];
    const k = (s - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    return out;
  }
}

interface Vessel {
  root: THREE.Group;
  route: Route;
  s: number;
  speed: number;
  /** 模型的船头朝哪边：-1 = -X，1 = +X */
  bow: number;
  yaw: number;
  bob: number;
}

function wakeGeometry(): THREE.BufferGeometry {
  // 从船头往后（+z）张开的一块：u 沿长度，v 横向 -1..1。长度和宽度在 Mesh 的缩放里
  const rows = 10;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    for (const v of [-1, 0, 1]) {
      pos.push(v * u, 0, u);
      uvs.push(u, v);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wakeMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const noise = getNoiseTexture();
  const u = uv().x;
  const v = abs(uv().y);
  // 噪声按世界坐标取：白沫留在水上，船往前走，不是一张图跟着船跑
  const p = positionWorld.xz;
  const a = texture(noise, p.div(19.0)).r;
  const b = texture(noise, p.div(6.3).add(0.31)).g;
  const foam = a.mul(0.6).add(b.mul(0.4));
  // 两条斜着张开的浪 + 船尾中间翻起来的一道
  const arms = smoothstep(0.66, 0.94, v).mul(float(1).sub(smoothstep(0.94, 1.0, v)));
  const core = float(1).sub(smoothstep(0.0, 0.3, v)).mul(smoothstep(0.03, 0.1, u)).mul(float(1).sub(smoothstep(0.1, 0.62, u)));
  const fade = float(1).sub(u);
  m.opacityNode = arms.mul(fade.mul(fade)).mul(smoothstep(0.3, 0.62, foam)).mul(0.5).add(core.mul(smoothstep(0.22, 0.6, foam)).mul(0.62)).mul(smoothstep(0.0, 0.025, u));
  // （这个材质不受光：亮度跟着天色走，不然夜里海上两道白光）
  m.colorNode = mix(vec3(0.62, 0.68, 0.7), vec3(0.9, 0.93, 0.94), foam).mul(FOG.color).mul(1.6);
  return m;
}

const _p: Point = [0, 0];
const _n: Point = [0, 0];

export class Vessels {
  readonly group = new THREE.Group();
  private readonly list: Vessel[] = [];
  private readonly wakeGeo = wakeGeometry();
  private readonly wakeMat = wakeMaterial();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** 夜里的航行灯：左红右绿，桅顶一盏白的。材质就这三个 */
  private readonly lamps = [0xff3020, 0x30ff60, 0xfff2d8].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));

  /** ground：地形高度（水底），water：水面高度，half：可以走的范围 */
  constructor(defs: VesselDef[], lib: ModelLib, ground: (x: number, z: number) => number, private readonly water: number, half: number, seed: number) {
    defs.forEach((d, i) => {
      const template = lib.templates.get(d.model);
      const pts = d.route ?? findLoop(ground, water, half, seed + i * 97);
      if (!template || !pts) return;
      const root = new THREE.Group();
      for (const im of instanceModel(template, [{ name: d.model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }])) {
        // （船一直在动，实例的包围球是原点的：不要拿它剔除）
        im.frustumCulled = false;
        root.add(im);
        this.meshes.push(im);
      }
      const wake = new THREE.Mesh(this.wakeGeo, this.wakeMat);
      const l = d.len * 5;
      // 模型和尾浪都朝 -z 的方向走：尾浪从船头往后张开
      wake.scale.set(l * WAKE_TAN, 1, l);
      wake.position.set(0, 0.1, -d.len * 0.42);
      wake.renderOrder = 3;
      wake.frustumCulled = false;
      const hull = new THREE.Group();
      hull.add(...root.children);
      // 模型的长边沿 X：转到 -Z
      hull.rotation.y = d.bow === 1 ? Math.PI / 2 : -Math.PI / 2;
      root.add(hull, wake);
      const beam = d.len * 0.16;
      const high = 2 + d.len * 0.2;
      [[-beam, high * 0.6, -d.len * 0.2, 0], [beam, high * 0.6, -d.len * 0.2, 1], [0, high, 0, 2]].forEach(([x, y, z, k]) => {
        const s = new THREE.Sprite(this.lamps[k]);
        s.position.set(x, y, z);
        s.scale.setScalar(1.6 + d.len * 0.03);
        root.add(s);
      });
      this.group.add(root);
      const route = new Route(pts);
      this.list.push({ root, route, s: route.len * ((i * 0.37) % 1), speed: d.speed, bow: d.bow ?? -1, yaw: NaN, bob: i * 1.7 });
    });
    this.update(0.016, 0);
  }

  /** night：0 白天 .. 1 夜里 */
  update(dt: number, t: number, night = 0): void {
    for (const m of this.lamps) m.opacity = night * 0.9;
    if (dt <= 0) return;
    for (const v of this.list) {
      v.s += v.speed * dt;
      v.route.at(v.s, _p);
      v.route.at(v.s + 12, _n);
      const want = Math.atan2(-(_n[0] - _p[0]), -(_n[1] - _p[1]));
      if (Number.isNaN(v.yaw)) v.yaw = want;
      // （走最短的方向）
      const d = Math.atan2(Math.sin(want - v.yaw), Math.cos(want - v.yaw));
      v.yaw = damp(v.yaw, v.yaw + d, 1.4, dt);
      const r = v.root;
      r.position.set(_p[0], this.water + 0.06 * Math.sin(t * 0.9 + v.bob), _p[1]);
      r.rotation.set(0.006 * Math.sin(t * 0.7 + v.bob), v.yaw, 0.012 * Math.sin(t * 0.55 + v.bob * 1.3), 'YXZ');
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.wakeGeo.dispose();
    this.wakeMat.dispose();
    for (const m of this.lamps) m.dispose();
    this.list.length = this.meshes.length = 0;
    this.group.clear();
  }
}
