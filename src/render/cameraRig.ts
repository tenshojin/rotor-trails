// 相机：第一人称驾驶员视角（鼠标控制视线，不控制飞机偏航），可选追尾视角。
// 机体真实运动（俯仰/滚转/偏航/振动）始终作用于相机；额外的头部晃动与镜头震动由设置单独控制。

import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { EYE } from './cockpit';

export interface CameraSettings {
  fov: number;
  /** 座舱视点的左右位置（机体坐标 x，米；0 = 机身中线，0.45 = 机长座位） */
  eyeX: number;
  shake: number; // 0..1
  headMotion: boolean;
}

/** 眼睛相对颈椎转轴的位置（米）：前方、上方 */
const NECK_F = 0.09;
const NECK_U = 0.06;

/** 默认视线略向下（约 5°）：外面的景色占画面大半，仪表板上半部分留在视野下缘 */
export const DEFAULT_PITCH = -0.09;

const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const _off = new THREE.Vector3();
const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = DEFAULT_PITCH;
  mode: 'cockpit' | 'chase' = 'cockpit';
  private recenter = false;
  private head = new THREE.Vector3();
  private impact = 0;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private prevVel = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.05, 30000);
    // 图层 1 = 只出现在远处的物体（中景 / 远景模型、远处地形块）：主相机看得到，最近两层阴影不画它们（见 sunShadows.ts）
    this.camera.layers.enable(1);
    // 图层 2 = 只进最近两层阴影的物体（座舱内部等）；近处的普通物体同时带图层 0 和 2
    this.camera.layers.enable(2);
    this.camera.layers.enable(3);
  }

  look(dx: number, dy: number): void {
    this.recenter = false;
    this.yaw = clamp(this.yaw - dx, -2.7, 2.7);
    this.pitch = clamp(this.pitch - dy, -1.3, 1.15);
  }

  center(): void {
    this.recenter = true;
  }

  kick(strength: number): void {
    this.impact = Math.min(1.5, this.impact + strength);
  }

  update(dt: number, t: number, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3, rpmLoad: number, s: CameraSettings): void {
    const cam = this.camera;
    if (cam.fov !== s.fov) {
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
    }
    if (this.recenter) {
      this.yaw = damp(this.yaw, 0, 8, dt);
      this.pitch = damp(this.pitch, DEFAULT_PITCH, 8, dt);
      if (Math.abs(this.yaw) < 0.002 && Math.abs(this.pitch - DEFAULT_PITCH) < 0.002) this.recenter = false;
    }
    // 机体加速度 → 头部惯性位移（可关闭）
    const acc = _e.copy(vel).sub(this.prevVel).divideScalar(Math.max(1e-3, dt));
    this.prevVel.copy(vel);
    if (s.headMotion && dt > 0) {
      _q.copy(quat).invert();
      const local = acc.applyQuaternion(_q);
      const target = _target.set(clamp(-local.x * 0.004, -0.05, 0.05), clamp(-local.y * 0.003, -0.04, 0.04), clamp(-local.z * 0.004, -0.05, 0.05));
      this.head.x = damp(this.head.x, target.x, 6, dt);
      this.head.y = damp(this.head.y, target.y, 6, dt);
      this.head.z = damp(this.head.z, target.z, 6, dt);
    } else this.head.multiplyScalar(Math.exp(-dt * 6));
    this.impact = Math.max(0, this.impact - dt * 2.5);

    if (this.mode === 'cockpit') {
      // 转头的视点运动：眼睛在颈椎转轴前方约 9 cm、上方 6 cm，转头时绕颈椎转；看向身后时上身再往看的方向转、
      // 向前探身，从座椅肩部旁边看出去（否则头枕会挡满整个视野）；下看时前倾，便于从下视窗观察。
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      const cp = Math.cos(this.pitch);
      const sp = Math.sin(this.pitch);
      const nx = -sy * cp * NECK_F;
      const ny = sp * NECK_F + cp * NECK_U - NECK_U;
      const nz = NECK_F - cy * cp * NECK_F;
      const tw = clamp((Math.abs(this.yaw) - 0.9) / 1.5, 0, 1);
      const twist = tw * tw * (3 - 2 * tw);
      const down = clamp((-this.pitch - 0.5) / 0.6, 0, 1);
      _off.set(s.eyeX + nx - Math.sign(this.yaw) * twist * 0.13 - down * 0.04, EYE.y + ny - down * 0.08, EYE.z + nz - down * 0.1 - twist * 0.24).add(this.head);
      _off.applyQuaternion(quat);
      cam.position.copy(pos).add(_off);
      // 振动（真实旋翼振动 + 碰撞冲击），强度由设置控制
      const vib = s.shake * (0.0005 + 0.0008 * rpmLoad);
      const imp = s.shake * this.impact * 0.02;
      _eul.set(
        this.pitch + Math.sin(t * 83) * vib + Math.sin(t * 37.1) * imp,
        this.yaw + Math.sin(t * 71) * vib * 0.6 + Math.sin(t * 29.3) * imp,
        Math.sin(t * 53) * vib * 0.5 + Math.sin(t * 41.7) * imp * 0.7,
      );
      _qh.setFromEuler(_eul);
      cam.quaternion.copy(quat).multiply(_qh);
    } else {
      // 追尾视角：跟随航向，平滑
      const fwd = _forward.set(0, 0, -1).applyQuaternion(quat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const want = _target.copy(pos).addScaledVector(fwd, -17);
      want.y += 5.5;
      if (!this.chaseInit) {
        this.chasePos.copy(want);
        this.chaseInit = true;
      }
      this.chasePos.x = damp(this.chasePos.x, want.x, 4, dt);
      this.chasePos.y = damp(this.chasePos.y, want.y, 4, dt);
      this.chasePos.z = damp(this.chasePos.z, want.z, 4, dt);
      cam.position.copy(this.chasePos);
      cam.lookAt(pos.x, pos.y + 1.2, pos.z);
      _eul.set(this.pitch * 0.5, this.yaw, 0);
      _qh.setFromEuler(_eul);
      cam.quaternion.multiply(_qh);
    }
  }

  setMode(m: 'cockpit' | 'chase'): void {
    this.mode = m;
    this.chaseInit = false;
  }
}
