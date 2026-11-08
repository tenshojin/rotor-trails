// 路上跑的车：港区的路上来来回回几辆，天黑了开着灯。和停着的车是同一批模型。
// 位置来自 sim/movers.ts（只看时间，开到路的尽头停一会儿，掉头回来）：物理里撞得上的就是这一辆。

import * as THREE from 'three/webgpu';
import type { CarMover } from '../sim/movers';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';

interface Car {
  mover: CarMover;
  root: THREE.Group;
  meshes: THREE.InstancedMesh[];
}

export class RoadCars {
  readonly group = new THREE.Group();
  private readonly cars: Car[] = [];
  private readonly lamps = [0xfff0d0, 0xff2a18].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));

  constructor(movers: readonly CarMover[], lib: ModelLib) {
    for (const mover of movers) {
      const template = lib.templates.get(mover.model);
      if (!template) continue;
      const root = new THREE.Group();
      const meshes = instanceModel(template, [{ name: mover.model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }]);
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
      this.cars.push({ mover, root, meshes });
    }
    this.update(0, 0);
  }

  /** t：时间（秒，和物理同一个钟）；night：0 白天 .. 1 夜里 */
  update(t: number, night: number): void {
    this.lamps[0].opacity = night * 0.9;
    this.lamps[1].opacity = night * 0.8;
    // 白天灯是灭的：材质不可见，three.js 整个跳过这些灯（否则每盏灯照样提交、叠一块全透明的面片）
    for (const m of this.lamps) m.visible = m.opacity > 0.003;
    for (const c of this.cars) c.mover.pose(t, c.root.position, c.root.quaternion);
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
