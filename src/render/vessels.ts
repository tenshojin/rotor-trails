// 水上走的船：港湾里的渡轮和渔船、河上的客船。世界里停着不动的东西再多也是一张画，远处有一条船拖着白浪慢慢走，
// 这张画才是活的。位置和朝向来自 sim/movers.ts（只看时间，物理里撞得上的就是这一条），模型和港口里停着的是同一批。
// 尾浪沿着船走过的航线往后铺（不是挂在船上的一块板）：平贴着水面，转弯时顺着航迹弯过去。
// 以前尾浪跟着船身一起轻轻横摇，一百多米宽的浪有一边沉到水面下面，看上去只剩一边、一截。

import * as THREE from 'three/webgpu';
import { abs, float, mix, positionWorld, smoothstep, texture, uv, vec3 } from 'three/tsl';
import { FOG } from './atmosphere';
import { findLoop, type Point, type VesselMover } from '../sim/movers';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';
import { getNoiseTexture } from './textures';

export { findLoop };

/** 尾浪的半张角：开尔文尾迹，不管船多快都是 19.5° */
export const WAKE_TAN = 0.354;
/** 尾浪沿航线切几段（越往后越稀） */
const WAKE_ROWS = 28;

interface Vessel {
  mover: VesselMover;
  root: THREE.Group;
  wake: THREE.Mesh;
  pos: Float32Array;
}

/** 尾浪：WAKE_ROWS + 1 排，每排三个点（左、中、右）。u 沿长度 0..1，v 横向 -1..1 */
function wakeGeometry(): { geo: THREE.BufferGeometry; pos: Float32Array } {
  const pos = new Float32Array((WAKE_ROWS + 1) * 3 * 3);
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= WAKE_ROWS; i++) for (const v of [-1, 0, 1]) uvs.push(wakeU(i), v);
  for (let i = 0; i < WAKE_ROWS; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array((WAKE_ROWS + 1) * 9).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return { geo, pos };
}

/** 第 i 排在尾浪上的位置（0 = 船头，1 = 尾巴）：船边上排得密，后面疏 */
function wakeU(i: number): number {
  const k = i / WAKE_ROWS;
  return k * (0.35 + 0.65 * k);
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
  // 平贴在水面上：深度稍微往前挪一点，远处也不会和水面打架
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return m;
}

const _p: Point = [0, 0];
const _q: Point = [0, 0];
const _r: Point = [0, 0];

export class Vessels {
  readonly group = new THREE.Group();
  private readonly list: Vessel[] = [];
  private readonly wakeMat = wakeMaterial();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** 夜里的航行灯：左红右绿，桅顶一盏白的。材质就这三个 */
  private readonly lamps = [0xff3020, 0x30ff60, 0xfff2d8].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));

  constructor(movers: readonly VesselMover[], lib: ModelLib) {
    for (const mover of movers) {
      const template = lib.templates.get(mover.model);
      if (!template) continue;
      const root = new THREE.Group();
      for (const im of instanceModel(template, [{ name: mover.model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }])) {
        // （船一直在动，实例的包围球是原点的：不要拿它剔除）
        im.frustumCulled = false;
        root.add(im);
        this.meshes.push(im);
      }
      // 航行灯按“船头朝 -z”的坐标摆：转回模型的坐标（模型长边沿 x）
      const lamps = new THREE.Group();
      lamps.rotation.y = mover.bow === 1 ? -Math.PI / 2 : Math.PI / 2;
      const beam = mover.len * 0.16;
      const high = 2 + mover.len * 0.2;
      [[-beam, high * 0.6, -mover.len * 0.2, 0], [beam, high * 0.6, -mover.len * 0.2, 1], [0, high, 0, 2]].forEach(([x, y, z, k]) => {
        const s = new THREE.Sprite(this.lamps[k]);
        s.position.set(x, y, z);
        s.scale.setScalar(1.6 + mover.len * 0.03);
        lamps.add(s);
      });
      root.add(lamps);
      const { geo, pos } = wakeGeometry();
      this.geos.push(geo);
      const wake = new THREE.Mesh(geo, this.wakeMat);
      wake.renderOrder = 3;
      wake.frustumCulled = false;
      this.group.add(root, wake);
      this.list.push({ mover, root, wake, pos });
    }
    this.update(0);
  }

  /** t：时间（秒，和物理同一个钟）；night：0 白天 .. 1 夜里 */
  update(t: number, night = 0): void {
    for (const m of this.lamps) m.opacity = night * 0.9;
    for (const v of this.list) {
      v.mover.pose(t, v.root.position, v.root.quaternion);
      this.layWake(v, t);
    }
  }

  /** 尾浪沿航线往后铺：从船头前面一点（船首波）开始，越往后张得越开 */
  private layWake(v: Vessel, t: number): void {
    const m = v.mover;
    const R = m.route;
    const L = m.len * 5;
    const s0 = m.s(t) + m.len * 0.42;
    const y = m.water + 0.05;
    const P = v.pos;
    for (let i = 0; i <= WAKE_ROWS; i++) {
      const d = wakeU(i) * L;
      const s = s0 - d;
      R.at(s, _p);
      R.at(s + 3, _q);
      R.at(s - 3, _r);
      const tx = _q[0] - _r[0];
      const tz = _q[1] - _r[1];
      const l = Math.hypot(tx, tz) || 1;
      // 横向：航迹的法线；宽度按开尔文角，船边上至少有半个船宽
      const w = Math.max(m.len * 0.09, d * WAKE_TAN);
      const nx = (-tz / l) * w;
      const nz = (tx / l) * w;
      const k = i * 9;
      P[k] = _p[0] - nx;
      P[k + 1] = y;
      P[k + 2] = _p[1] - nz;
      P[k + 3] = _p[0];
      P[k + 4] = y;
      P[k + 5] = _p[1];
      P[k + 6] = _p[0] + nx;
      P[k + 7] = y;
      P[k + 8] = _p[1] + nz;
    }
    (v.wake.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 第几条船的尾浪顶点（测试用） */
  wakePoints(i: number): Float32Array | null {
    return this.list[i]?.pos ?? null;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geos) g.dispose();
    this.wakeMat.dispose();
    for (const m of this.lamps) m.dispose();
    this.list.length = this.meshes.length = this.geos.length = 0;
    this.group.clear();
  }
}
