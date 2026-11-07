// 路上跑的车：港区的路上来来回回几辆，天黑了开着灯。和停着的车是同一批模型。
// 只有画面，没有碰撞（飞机贴着路面飞才碰得到）。开到路的尽头停一会儿，掉头回来。

import * as THREE from 'three/webgpu';
import type { RoadCarsDef } from '../maps/types';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';

const SEGMENTS = 96;
/** 靠右走：离路中线多远（米） */
const LANE = 1.7;

interface Car {
  root: THREE.Group;
  meshes: THREE.InstancedMesh[];
  road: Road;
  s: number;
  dir: 1 | -1;
  speed: number;
  /** 到头了，歇多久 */
  rest: number;
}

interface Road {
  pts: THREE.Vector3[];
  seg: number;
  len: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class RoadCars {
  readonly group = new THREE.Group();
  private readonly cars: Car[] = [];
  private readonly lamps = [0xfff0d0, 0xff2a18].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));

  constructor(defs: readonly RoadCarsDef[], lib: ModelLib, private readonly ground: (x: number, z: number) => number) {
    defs.forEach((def, d) => {
      const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const road: Road = { pts: curve.getSpacedPoints(SEGMENTS), seg: curve.getLength() / SEGMENTS, len: curve.getLength() };
      def.models.forEach((model, i) => {
        const template = lib.templates.get(model);
        if (!template) return;
        const root = new THREE.Group();
        const meshes = instanceModel(template, [{ name: model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }]);
        for (const m of meshes) {
          // （车一直在动，实例的包围球是原点的：不要拿它剔除）
          m.frustumCulled = false;
          root.add(m);
        }
        // （车头朝 +x）
        for (const [x, y, z, k, size] of [[2.2, 0.76, -0.56, 0, 1.3], [2.2, 0.76, 0.56, 0, 1.3], [-2.2, 0.76, -0.58, 1, 0.8], [-2.2, 0.76, 0.58, 1, 0.8]]) {
          const lamp = new THREE.Sprite(this.lamps[k]);
          lamp.position.set(x, y, z);
          lamp.scale.setScalar(size);
          root.add(lamp);
        }
        this.group.add(root);
        const spread = (i + 0.5) / def.models.length;
        this.cars.push({ root, meshes, road, s: road.len * ((spread + d * 0.37) % 1), dir: i % 2 ? 1 : -1, speed: def.speed * (0.85 + 0.3 * ((i * 0.618) % 1)), rest: 0 });
      });
    });
    this.place();
  }

  private at(r: Road, s: number, out: THREE.Vector3): THREE.Vector3 {
    const f = Math.max(0, Math.min(SEGMENTS - 0.001, s / r.seg));
    const i = Math.floor(f);
    return out.lerpVectors(r.pts[i], r.pts[i + 1], f - i);
  }

  private place(): void {
    for (const c of this.cars) {
      this.at(c.road, c.s - 3 * c.dir, _a);
      this.at(c.road, c.s + 3 * c.dir, _b);
      const dx = _b.x - _a.x;
      const dz = _b.z - _a.z;
      const l = Math.hypot(dx, dz) || 1;
      // 靠右走：从上往下看，前进方向 (dx, dz) 的右手边是 (-dz, dx)
      const x = (_a.x + _b.x) / 2 - (dz / l) * LANE;
      const z = (_a.z + _b.z) / 2 + (dx / l) * LANE;
      const y = this.ground(x, z);
      const pitch = Math.atan2(this.ground(x + (dx / l) * 2, z + (dz / l) * 2) - this.ground(x - (dx / l) * 2, z - (dz / l) * 2), 4);
      c.root.position.set(x, y, z);
      c.root.rotation.set(0, Math.atan2(-dz, dx), pitch, 'YXZ');
    }
  }

  /** night：0 白天 .. 1 夜里 */
  update(dt: number, night: number): void {
    this.lamps[0].opacity = night * 0.9;
    this.lamps[1].opacity = night * 0.8;
    if (dt <= 0) return;
    for (const c of this.cars) {
      if (c.rest > 0) {
        c.rest -= dt;
        continue;
      }
      c.s += c.speed * c.dir * dt;
      if (c.s >= c.road.len - 4 || c.s <= 4) {
        c.s = Math.max(4, Math.min(c.road.len - 4, c.s));
        c.dir = c.dir > 0 ? -1 : 1;
        c.rest = 3 + 9 * ((c.road.len + c.speed * 13.7) % 1);
      }
    }
    this.place();
  }

  /** 第几辆车现在的位置（测试和巡检用） */
  position(i: number): THREE.Vector3 | null {
    return this.cars[i]?.root.position ?? null;
  }

  dispose(): void {
    for (const c of this.cars) for (const m of c.meshes) m.dispose();
    for (const m of this.lamps) m.dispose();
    this.cars.length = 0;
  }
}
