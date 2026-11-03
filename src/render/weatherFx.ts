// 天气特效：三维雨线（方向 = 雨滴相对飞机的速度，能直观看出风向与飞行速度）、低云层、闪电。

import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, cross, distance, float, length, mix, mod, normalize, positionGeometry, positionWorld, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import { getNoiseTexture } from './textures';

export class RainFx {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.MeshBasicNodeMaterial;
  private count: number;
  private u = {
    cam: uniform(new THREE.Vector3()),
    vel: uniform(new THREE.Vector3(0, -9, 0)),
    rel: uniform(new THREE.Vector3(0, -9, 0)),
    time: uniform(0),
    box: uniform(new THREE.Vector3(60, 40, 60)),
    opacity: uniform(0),
  };

  constructor(maxCount: number) {
    this.count = maxCount;
    // 普通几何体 + 逐实例属性（实例数由 InstancedMesh.count 控制；InstancedBufferGeometry 的实例数默认是无穷大）
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      off[i * 4] = Math.random() * 60;
      off[i * 4 + 1] = Math.random() * 40;
      off[i * 4 + 2] = Math.random() * 60;
      off[i * 4 + 3] = Math.random();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    const U = this.u;
    this.mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    // 每条雨线：在相机周围的盒子里循环下落；朝向 = 雨滴相对飞机的速度，宽度随距离略增（远处不至于断线）
    const aOff = attribute('aOff', 'vec4');
    const P0 = aOff.xyz.add(U.vel.mul(U.time).mul(aOff.w.mul(0.3).add(0.85)));
    const P = mod(P0.sub(U.cam).add(U.box.mul(0.5)), U.box).sub(U.box.mul(0.5)).add(U.cam);
    const d = distance(P, cameraPosition);
    const D = normalize(U.rel);
    const toCam = normalize(cameraPosition.sub(P));
    const S = normalize(cross(D, toCam).add(vec3(1e-4)));
    const len = clamp(length(U.rel).mul(0.045), 0.35, 3.2);
    this.mat.positionNode = P.sub(D.mul(positionGeometry.y).mul(len)).add(S.mul(positionGeometry.x).mul(d.mul(0.02).add(1.0).mul(0.018)));
    const dist = distance(positionWorld, cameraPosition);
    const vA = smoothstep(2.6, 4.5, dist).mul(float(1).sub(smoothstep(18.0, 30.0, dist)));
    this.mat.colorNode = vec3(0.72, 0.76, 0.8);
    this.mat.opacityNode = U.opacity.mul(vA).mul(positionGeometry.y.mul(0.65).add(0.35));
    this.mat.alphaTest = 0.003;
    this.mesh = new THREE.InstancedMesh(g, this.mat, maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.count = 0;
  }

  /** rain 0..1；wind：空气速度；camVel：相机（飞机）速度 */
  update(t: number, cam: THREE.Vector3, rain: number, wind: THREE.Vector3, camVel: THREE.Vector3, density: number): void {
    const u = this.u;
    u.cam.value.copy(cam);
    const fall = 8.5 + rain * 2;
    u.vel.value.set(wind.x, -fall + wind.y, wind.z);
    u.rel.value.set(wind.x - camVel.x, -fall + wind.y - camVel.y, wind.z - camVel.z);
    u.time.value = t;
    u.opacity.value = Math.min(0.55, rain * 0.6);
    this.mesh.count = rain > 0.02 ? Math.floor(this.count * Math.min(1, rain * 1.2) * density) : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private mats: THREE.MeshBasicNodeMaterial[] = [];
  private layers: Array<{ off: ReturnType<typeof makeCloudU>['off']; density: ReturnType<typeof makeCloudU>['density']; dark: ReturnType<typeof makeCloudU>['dark'] }> = [];
  private geo: THREE.PlaneGeometry;
  private offset = new THREE.Vector2();

  constructor(size: number) {
    this.geo = new THREE.PlaneGeometry(size * 1.8, size * 1.8, 1, 1);
    this.geo.rotateX(-Math.PI / 2);
    const noise = getNoiseTexture();
    for (let i = 0; i < 7; i++) {
      const U = makeCloudU(i);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const W = positionWorld;
      const p = W.xz.mul(0.00045).add(U.off);
      const n = texture(noise, p).r.mul(0.6).add(texture(noise, p.mul(3.1).add(0.3)).g.mul(0.3)).add(texture(noise, p.mul(9.0)).a.mul(0.1));
      const layer = i / 6;
      const edge = 1 - Math.abs(layer - 0.5) * 2;
      const c = smoothstep(float(0.62 - edge * 0.12).sub(U.density.mul(0.35)), float(0.85).sub(U.density.mul(0.2)), n);
      const d = distance(W, cameraPosition);
      const a = c.mul(U.density).mul(0.35 + 0.25 * edge).mul(float(1).sub(smoothstep(1500.0, 3000.0, d)));
      m.colorNode = mix(U.dark, vec3(0.92, 0.93, 0.95), clamp(n.mul(0.5).add(layer * 0.8), 0.0, 1.0));
      m.opacityNode = a;
      m.alphaTest = 0.004;
      this.mats.push(m);
      this.layers.push(U);
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.renderOrder = 15;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  update(dt: number, base: number, top: number, density: number, windX: number, windZ: number, overcast: number, camPos: THREE.Vector3): void {
    this.group.visible = density > 0.02;
    if (!this.group.visible) return;
    this.offset.x += windX * dt * 0.00045;
    this.offset.y += windZ * dt * 0.00045;
    this.group.children.forEach((m, i) => {
      m.position.set(camPos.x, base + ((top - base) * i) / 6, camPos.z);
      const u = this.layers[i];
      u.off.value.set(i * 0.137 - this.offset.x, i * 0.071 - this.offset.y);
      u.density.value = density;
      u.dark.value.setRGB(0.6 - overcast * 0.2, 0.62 - overcast * 0.2, 0.66 - overcast * 0.2);
    });
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function makeCloudU(i: number) {
  return { off: uniform(new THREE.Vector2(i * 0.137, i * 0.071)), density: uniform(0), dark: uniform(new THREE.Color(0.55, 0.58, 0.62)) };
}

/** 闪电：根据天气强度随机触发，返回当前闪光亮度；thunder 回调用于延迟雷声。 */
export class Lightning {
  private next = 6;
  private flash = 0;
  private flicker = 0;
  enabled = true;

  update(t: number, dt: number, intensity: number, onStrike: (distance: number) => void): number {
    if (!this.enabled || intensity <= 0.01) {
      this.flash = Math.max(0, this.flash - dt * 4);
      return this.flash;
    }
    if (t > this.next) {
      this.flash = 0.6 + Math.random() * 0.4;
      this.flicker = 0.35;
      this.next = t + (6 + Math.random() * 14) / Math.max(0.2, intensity);
      onStrike(800 + Math.random() * 3500);
    }
    if (this.flicker > 0) {
      this.flicker -= dt;
      if (Math.random() < 0.15) this.flash = Math.max(this.flash, 0.4 + Math.random() * 0.5);
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    return this.flash * 0.7;
  }
}
