// 天上绕场飞的轻型飞机：小机场不能只有停着的飞机。沿跑道低空通场，拉起来绕一圈，再回来。
// 位置来自 sim/movers.ts（只看时间）：物理里撞得上的就是这一架，下雨起雾不飞的时候两边都没有它。

import * as THREE from 'three/webgpu';
import type { PlaneMover } from '../sim/movers';
import { instanceModel, type ModelLib } from './modelLib';
import { getGlowTexture } from './propsView';

export class Traffic {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly disc: THREE.Mesh;
  /** 夜里的航行灯：左红右绿，尾灯和着陆灯白的 */
  private readonly lamps = [0xff3020, 0x30ff60, 0xfff2d8].map((color) => new THREE.SpriteMaterial({ map: typeof document === 'undefined' ? null : getGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  private lastDist = -1;
  /** 声音用：离耳朵多远、朝耳朵过来多快 */
  readonly sound = { dist: 1e5, closing: 0 };

  constructor(private readonly mover: PlaneMover, lib: ModelLib) {
    const template = lib.templates.get(mover.model);
    if (template) {
      for (const im of instanceModel(template, [{ name: mover.model, pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }])) {
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
    this.mover.pose(0, this.root.position, this.root.quaternion);
  }

  /** t：时间（秒，和物理同一个钟）；dt：这一帧多长（算声音的远近变化）；night：0 白天 .. 1 夜里；show：下雨起雾的时候不飞 */
  update(t: number, dt: number, night: number, show: boolean, ear: THREE.Vector3): void {
    // （模型没加载到就不飞：天上不能只有一个螺旋桨圆盘）
    this.root.visible = show && this.meshes.length > 0;
    for (const m of this.lamps) {
      m.opacity = night * 0.95;
      // 白天灯是灭的：材质不可见，three.js 整个跳过这些灯
      m.visible = m.opacity > 0.003;
    }
    this.mover.pose(t, this.root.position, this.root.quaternion);
    if (dt > 0) {
      const d = this.root.position.distanceTo(ear);
      this.sound.closing = this.lastDist < 0 ? 0 : (this.lastDist - d) / dt;
      this.lastDist = d;
    }
    this.sound.dist = show ? this.root.position.distanceTo(ear) : 1e5;
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
