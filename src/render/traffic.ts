// 天上绕场飞的轻型飞机：小机场不能只有停着的飞机。沿跑道低空通场，拉起来绕一圈，再回来。
// 位置在 CPU 上算，没有碰撞（和走的船一样）。

import * as THREE from 'three/webgpu';
import { damp } from '../core/math';
import type { TrafficDef } from '../maps/types';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';

/** 航线切成这么多段，每段几乎一样长 */
const SEGMENTS = 480;
/** 坡度最大 35 度（小飞机绕场不会压得更狠） */
const MAX_BANK = 0.61;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Traffic {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly pts: THREE.Vector3[];
  private readonly seg: number;
  private readonly speed: number;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly disc: THREE.Mesh;
  /** 夜里的航行灯：左红右绿，尾灯和着陆灯白的 */
  private readonly lamps = [0xff3020, 0x30ff60, 0xfff2d8].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  private s = 0;
  private roll = 0;
  private lastDist = -1;
  /** 声音用：离耳朵多远、朝耳朵过来多快 */
  readonly sound = { dist: 1e5, closing: 0 };

  constructor(def: TrafficDef, lib: ModelLib) {
    const curve = new THREE.CatmullRomCurve3(def.route.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
    this.pts = curve.getSpacedPoints(SEGMENTS);
    this.seg = curve.getLength() / SEGMENTS;
    this.speed = def.speed;
    const template = lib.templates.get(def.model);
    if (template) {
      for (const im of instanceModel(template, [{ name: def.model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }])) {
        // （飞机一直在动，实例的包围球是原点的：不要拿它剔除）
        im.frustumCulled = false;
        this.root.add(im);
        this.meshes.push(im);
      }
    }
    // 转起来的螺旋桨就是一层淡淡的圆盘
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicNodeMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false }));
    this.disc.position.set(0, 1.25, -4.22);
    this.root.add(this.disc);
    [[-5.95, 2.5, -0.85, 0, 1.3], [5.95, 2.5, -0.85, 1, 1.3], [0, 3.05, 4.45, 2, 1], [0, 0.9, -3.4, 2, 3.2]].forEach(([x, y, z, k, size]) => {
      const lamp = new THREE.Sprite(this.lamps[k]);
      lamp.position.set(x, y, z);
      lamp.scale.setScalar(size);
      this.root.add(lamp);
    });
    this.group.add(this.root);
    this.place(0.016);
  }

  private at(s: number, out: THREE.Vector3): THREE.Vector3 {
    const n = SEGMENTS;
    const f = (((s / this.seg) % n) + n) % n;
    const i = Math.floor(f);
    return out.lerpVectors(this.pts[i], this.pts[i + 1], f - i);
  }

  private heading(s: number): number {
    this.at(s - 8, _a);
    this.at(s + 8, _b);
    return Math.atan2(-(_b.x - _a.x), -(_b.z - _a.z));
  }

  private place(dt: number): void {
    const s = this.s;
    const yaw = this.heading(s);
    // 转弯有多急就压多大的坡度：向心加速度 = v²·曲率
    const turn = Math.atan2(Math.sin(this.heading(s + 30) - this.heading(s - 30)), Math.cos(this.heading(s + 30) - this.heading(s - 30))) / 60;
    const want = Math.max(-MAX_BANK, Math.min(MAX_BANK, Math.atan((this.speed * this.speed * turn) / 9.81)));
    this.roll = damp(this.roll, want, 1.6, dt);
    this.at(s - 8, _a);
    this.at(s + 8, _b);
    const climb = Math.atan2(_b.y - _a.y, Math.hypot(_b.x - _a.x, _b.z - _a.z));
    this.at(s, this.root.position);
    // 机头比航迹高一点（迎角）
    this.root.rotation.set(climb + 0.05, yaw, this.roll, 'YXZ');
  }

  /** night：0 白天 .. 1 夜里；show：下雨起雾的时候不飞 */
  update(dt: number, night: number, show: boolean, ear: THREE.Vector3): void {
    // （模型没加载到就不飞：天上不能只有一个螺旋桨圆盘）
    this.root.visible = show && this.meshes.length > 0;
    for (const m of this.lamps) m.opacity = night * 0.95;
    if (dt > 0) {
      this.s += this.speed * dt;
      this.place(dt);
      const d = this.root.position.distanceTo(ear);
      this.sound.closing = this.lastDist < 0 ? 0 : (this.lastDist - d) / dt;
      this.lastDist = d;
      this.sound.dist = show ? d : 1e5;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    for (const m of this.lamps) m.dispose();
    this.meshes.length = 0;
    this.group.clear();
  }
}
