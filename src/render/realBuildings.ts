// 南缘的房子（数据见 maps/grandcanyonBuildings.ts）。屋顶直接用航拍的颜色：从上面看和照片上的屋顶一模一样，
// 只是立起来了；墙是木头和石头的颜色，一层层的窗户用着色器画。一个网格一次画完。

import * as THREE from 'three/webgpu';
import { attribute, float, fract, mix, positionWorld, smoothstep, step, texture, vec3, vec4, vertexColor } from 'three/tsl';
import type { RealBridgeDef, RealBuildingDef } from '../maps/types';
import { bridgeDeckY, buildingFrame } from '../world/realData';
import type { Heightfield } from '../sim/terrain';

export class RealBuildings {
  readonly group = new THREE.Group();
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.MeshStandardNodeMaterial;

  constructor(list: readonly RealBuildingDef[], bridges: readonly RealBridgeDef[], terrain: Heightfield, image: THREE.Texture) {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const wall: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], roof: number, u0: number, u1: number, v0: number, v1: number, tint: number[]): void => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 6; i++) nor.push(...n);
      for (let i = 0; i < 6; i++) col.push(...tint);
      wall.push(u0, v0, roof, u1, v0, roof, u1, v1, roof, u0, v0, roof, u1, v1, roof, u0, v1, roof);
    };
    const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: number[], b: number[]): number[] => {
      const x = a[1] * b[2] - a[2] * b[1];
      const y = a[2] * b[0] - a[0] * b[2];
      const z = a[0] * b[1] - a[1] * b[0];
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    list.forEach((b, i) => {
      const [cx, cz, w, d, rot, , ridge] = b;
      const f = buildingFrame(terrain, b);
      const r = (rot * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const at = (u: number, v: number, y: number): number[] => [cx + u * c - v * s, y, cz + u * s + v * c];
      const hw = w / 2;
      const hd = d / 2;
      // 木头、石头、灰泥，一栋一个颜色
      const k = (i * 37) % 5;
      const tint = [[0.2, 0.15, 0.1], [0.26, 0.21, 0.16], [0.33, 0.28, 0.22], [0.17, 0.14, 0.12], [0.38, 0.33, 0.27]][k];
      const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (let e = 0; e < 4; e++) {
        const [u0, v0] = corners[e];
        const [u1, v1] = corners[(e + 1) % 4];
        const a = at(u0, v0, f.base);
        const bb = at(u1, v1, f.base);
        const t1 = at(u1, v1, f.top);
        const t0 = at(u0, v0, f.top);
        quad(a, t0, t1, bb, cross(sub(t0, a), sub(bb, a)), 0, 0, Math.hypot(u1 - u0, v1 - v0), 0, f.top - f.base, tint);
      }
      const A = at(-hw, -hd, f.top);
      const B = at(hw, -hd, f.top);
      const C = at(hw, hd, f.top);
      const D = at(-hw, hd, f.top);
      if (ridge > 0) {
        // 两面坡，屋脊顺着长边
        const R0 = at(-hw, 0, f.top + ridge);
        const R1 = at(hw, 0, f.top + ridge);
        quad(A, R0, R1, B, cross(sub(R0, A), sub(B, A)), 1, 0, 0, 0, 0, tint);
        quad(D, C, R1, R0, cross(sub(C, D), sub(R0, D)), 1, 0, 0, 0, 0, tint);
        // 山墙
        pos.push(...A, ...D, ...R0, ...B, ...R1, ...C);
        const n0 = cross(sub(D, A), sub(R0, A));
        const n1 = cross(sub(R1, B), sub(C, B));
        for (let q = 0; q < 3; q++) nor.push(...n0);
        for (let q = 0; q < 3; q++) nor.push(...n1);
        for (let q = 0; q < 6; q++) {
          col.push(...tint);
          wall.push(0, 0, 0);
        }
      } else {
        quad(A, D, C, B, [0, 1, 0], 1, 0, 0, 0, 0, tint);
      }
    });
    // 一根方木：从 a 到 b，宽 w，高 h
    const beam = (a: number[], b: number[], w: number, h: number, tint: number[]): void => {
      const d = sub(b, a);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const t = [d[0] / l, d[1] / l, d[2] / l];
      const side = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : cross(t, [0, 1, 0]);
      const up = cross(side, t);
      const off = (p: number[], s: number, u: number): number[] => [p[0] + side[0] * s + up[0] * u, p[1] + side[1] * s + up[1] * u, p[2] + side[2] * s + up[2] * u];
      const c: [number, number][] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      for (let e = 0; e < 4; e++) {
        const [s0, u0] = c[e];
        const [s1, u1] = c[(e + 1) % 4];
        const p0 = off(a, s0, u0);
        const p1 = off(a, s1, u1);
        const q1 = off(b, s1, u1);
        const q0 = off(b, s0, u0);
        quad(p0, q0, q1, p1, cross(sub(q0, p0), sub(p1, p0)), 0, 0, 0, 0, 0, tint);
      }
    };
    for (const b of bridges) {
      const y = bridgeDeckY(terrain, b);
      const steel = [0.05, 0.05, 0.055];
      const dx = b[2] - b[0];
      const dz = b[3] - b[1];
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const at = (t: number, s: number, h: number): number[] => [b[0] + dx * t + nx * s, y + h, b[1] + dz * t + nz * s];
      const tower = 8;
      beam(at(0, 0, 0), at(1, 0, 0), 1.7, 0.3, [0.13, 0.11, 0.09]);
      for (const s of [-0.85, 0.85]) {
        beam(at(0, s, 1.1), at(1, s, 1.1), 0.06, 0.06, steel);
        for (const e of [0, 1]) beam([at(e, s * 1.5, 0)[0], y - 4, at(e, s * 1.5, 0)[2]], at(e, s * 1.5, tower), 0.34, 0.34, steel);
        // 主缆：抛物线，中间垂到桥面上方一点；每隔几米一根吊索
        const n = 18;
        let last = at(0, s * 1.5, tower);
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const sag = tower - 1.6 - (tower - 1.6) * 4 * t * (1 - t);
          const p = at(t, s * 1.4, sag + 1.6);
          beam(last, p, 0.07, 0.07, steel);
          if (i < n) beam(p, at(t, s, 0), 0.03, 0.03, steel);
          last = p;
        }
      }
    }
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setAttribute('wallInfo', new THREE.Float32BufferAttribute(wall, 3));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, vertexColors: true });
    const info = attribute<'vec3'>('wallInfo', 'vec3');
    const uv = positionWorld.xz.div(terrain.size).add(0.5);
    const roof = texture(image, uv).rgb;
    // 墙上的窗：一层 3.2 米，一扇窗一个开间 2.8 米
    const fx = fract(info.x.div(2.8));
    const fy = fract(info.y.div(3.2));
    const pane = step(0.26, fx).mul(step(fx, 0.74)).mul(step(0.32, fy)).mul(step(fy, 0.78)).mul(smoothstep(0.9, 1.2, info.y));
    const walls = mix(vertexColor().rgb, vec3(0.035, 0.045, 0.055), pane.mul(0.9));
    m.colorNode = vec4(mix(walls, roof, info.z), float(1));
    this.mat = m;
    const mesh = new THREE.Mesh(this.geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.group.clear();
  }
}
