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
  /** 地面高度（电影镜头要躲开地形） */
  ground?: (x: number, z: number) => number;
  /** 机身振动 0..1（超仿真的飞行模型算的：平移升力过渡、涡环、失速） */
  vibration?: number;
  /** 旋翼转速比：超仿真里旋翼不转就没有振动 */
  rotor?: number;
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
/** 拍照模式的竖直视角范围（度）：全画幅 14 mm 到 300 mm 左右 */
export const PHOTO_FOV: readonly [number, number] = [4.6, 81];
/** 电影镜头一共几种 */
const CINE_SHOTS = 5;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = DEFAULT_PITCH;
  mode: 'cockpit' | 'chase' | 'cinema' | 'photo' = 'cockpit';
  /** 视野缩放（1 = 不缩放，越小越近）：超仿真里滚轮用，看清远处的表 */
  zoom = 1;
  /** 探身：够远处的按钮时头也会往前（0..1） */
  lean = 0;
  private zoomNow = 1;
  private recenter = false;
  private head = new THREE.Vector3();
  private impact = 0;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  /** 追尾时往转弯内侧偏多少（-1..1）：正后方只看得到尾梁，一转弯才看得到机身侧面 */
  private chaseSide = 0;
  private chaseHeading = 0;
  private prevVel = new THREE.Vector3();
  /** 电影镜头：第几个镜头、拍了多久、机位、焦距（竖直视角） */
  private shot = -1;
  private shotT = 0;
  private cine = new THREE.Vector3();
  private cineFov = 40;
  private cineAim = new THREE.Vector3();
  /** 拍照模式：世界定格，机位归玩家。竖直视角（度）和倾斜（弧度）面板上也能改 */
  photoFov = 40;
  photoRoll = 0;
  private photoYaw = 0;
  private photoPitch = 0;
  private photoVel = new THREE.Vector3();
  private photoBack: 'cockpit' | 'chase' | 'cinema' = 'cockpit';

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

  /**
   * 电影镜头：像风光片那样一个镜头接一个镜头，切换时才换机位。
   *   0 飞越：机位在前方的地面附近，等直升机飞过去（长焦，背后是远山）
   *   1 伴飞：贴在侧面一起飞（中焦）
   *   2 高空：远远地从后上方看，直升机只是风景里的一个小点（广角）
   *   3 迎面：飞在前方斜侧，回头拍机头（长焦，背后是刚飞过的地方）
   *   4 环绕：慢慢绕着直升机转一段（中焦）
   */
  private cinema(dt: number, pos: THREE.Vector3, vel: THREE.Vector3, ground: (x: number, z: number) => number): void {
    this.shotT += dt;
    const sp = Math.hypot(vel.x, vel.z);
    const fx = sp > 3 ? vel.x / sp : 0;
    const fz = sp > 3 ? vel.z / sp : -1;
    const dist = this.cine.distanceTo(pos);
    const kind = ((this.shot % CINE_SHOTS) + CINE_SHOTS) % CINE_SHOTS;
    // 山挡住了直升机，这个镜头就不能用了
    const hidden = (): boolean => {
      for (let k = 0.15; k < 0.95; k += 0.2) {
        _target.lerpVectors(this.cine, pos, k);
        if (ground(_target.x, _target.z) + 3 > _target.y) return true;
      }
      return false;
    };
    const over = this.shot < 0 || (this.shotT > 1 && hidden()) || (kind === 0 ? this.shotT > 4 && (dist > 300 || this.shotT > 18) : this.shotT > [0, 13, 10, 11, 12][kind]);
    if (over) {
      this.shot++;
      this.shotT = 0;
      const next = this.shot % CINE_SHOTS;
      // 左右交替，别总在同一边
      const side = this.shot % 2 === 0 ? 1 : -1;
      if (next === 0) {
        const ahead = 110 + sp * 5;
        const x = pos.x + fx * ahead - fz * side * 46;
        const z = pos.z + fz * ahead + fx * side * 46;
        // 比直升机低一点就够了：再低就是对着天空拍它的肚子
        this.cine.set(x, Math.max(ground(x, z) + 7, pos.y - 9), z);
        this.cineFov = 30;
      } else this.cineFov = [0, 44, 58, 30, 38][next];
      this.cineAim.copy(pos);
    }
    const now = this.shot % CINE_SHOTS;
    const side = this.shot % 2 === 0 ? 1 : -1;
    if (now === 1) {
      const x = pos.x - fx * 15 - fz * side * 24;
      const z = pos.z - fz * 15 + fx * side * 24;
      _target.set(x, Math.max(ground(x, z) + 5, pos.y + 3), z);
      this.cine.lerp(_target, this.shotT < 0.05 ? 1 : 1 - Math.exp(-dt * 3));
    } else if (now === 2) {
      const x = pos.x - fx * 95 - fz * side * 40;
      const z = pos.z - fz * 95 + fx * side * 40;
      _target.set(x, Math.max(ground(x, z) + 12, pos.y + 42), z);
      this.cine.lerp(_target, this.shotT < 0.05 ? 1 : 1 - Math.exp(-dt * 1.2));
    } else if (now === 3) {
      const x = pos.x + fx * 26 - fz * side * 11;
      const z = pos.z + fz * 26 + fx * side * 11;
      _target.set(x, Math.max(ground(x, z) + 5, pos.y + 0.5), z);
      this.cine.lerp(_target, this.shotT < 0.05 ? 1 : 1 - Math.exp(-dt * 2.6));
    } else if (now === 4) {
      const a = this.shotT * 0.2 * side + this.shot;
      const x = pos.x + Math.sin(a) * 21;
      const z = pos.z + Math.cos(a) * 21;
      _target.set(x, Math.max(ground(x, z) + 5, pos.y + 3.5), z);
      this.cine.lerp(_target, this.shotT < 0.05 ? 1 : 1 - Math.exp(-dt * 5));
    }
    // 取景跟得慢一点，不要死死钉在直升机上
    this.cineAim.lerp(pos, 1 - Math.exp(-dt * 4));
    this.camera.position.copy(this.cine);
    this.camera.lookAt(this.cineAim);
  }

  update(dt: number, t: number, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3, rpmLoad: number, s: CameraSettings): void {
    const cam = this.camera;
    if (this.mode === 'photo') {
      this.prevVel.copy(vel);
      if (Math.abs(cam.fov - this.photoFov) > 0.01) {
        cam.fov = this.photoFov;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (this.mode === 'cinema') {
      this.cinema(dt, pos, vel, s.ground ?? (() => -1e4));
      this.prevVel.copy(vel);
      if (cam.fov !== this.cineFov) {
        cam.fov = this.cineFov;
        cam.updateProjectionMatrix();
      }
      return;
    }
    this.zoomNow = damp(this.zoomNow, this.zoom, 9, dt);
    const fov = s.fov * (this.mode === 'cockpit' ? this.zoomNow : 1);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
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
      _off.set(s.eyeX + nx - Math.sign(this.yaw) * twist * 0.13 - down * 0.04, EYE.y + ny - down * 0.08 - this.lean * 0.02, EYE.z + nz - down * 0.1 - twist * 0.24 - this.lean * 0.07).add(this.head);
      _off.applyQuaternion(quat);
      cam.position.copy(pos).add(_off);
      // 振动（真实旋翼振动 + 碰撞冲击），强度由设置控制。三片桨每转一圈三次：约 19 Hz 的上下抖
      const rotor = s.rotor ?? 1;
      const vib = s.shake * rotor * (0.0005 + 0.0008 * rpmLoad + 0.0065 * (s.vibration ?? 0));
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
      const heading = Math.atan2(fwd.x, -fwd.z);
      if (dt > 0) {
        const turn = Math.atan2(Math.sin(heading - this.chaseHeading), Math.cos(heading - this.chaseHeading)) / dt;
        this.chaseSide = damp(this.chaseSide, clamp(turn / 0.6, -1, 1), 1.6, dt);
      }
      this.chaseHeading = heading;
      const want = _target.copy(pos).addScaledVector(fwd, -14);
      want.x += -fwd.z * this.chaseSide * 5.5;
      want.z += fwd.x * this.chaseSide * 5.5;
      want.y += 4.2;
      if (!this.chaseInit) {
        this.chasePos.copy(want);
        this.chaseInit = true;
      }
      this.chasePos.x = damp(this.chasePos.x, want.x, 5.5, dt);
      this.chasePos.y = damp(this.chasePos.y, want.y, 5.5, dt);
      this.chasePos.z = damp(this.chasePos.z, want.z, 5.5, dt);
      cam.position.copy(this.chasePos);
      cam.lookAt(pos.x, pos.y + 1.2, pos.z);
      _eul.set(this.pitch * 0.5, this.yaw, 0);
      _qh.setFromEuler(_eul);
      cam.quaternion.multiply(_qh);
    }
  }

  /** 进拍照模式。在座舱里的话先走到机身斜后方：那里才拍得到飞机，座舱里也挪不开身 */
  enterPhoto(pos: THREE.Vector3, quat: THREE.Quaternion, floor: (x: number, z: number) => number): void {
    if (this.mode === 'photo') return;
    const cam = this.camera;
    this.photoBack = this.mode;
    this.photoFov = 40;
    if (this.mode === 'cockpit') {
      const fwd = _forward.set(0, 0, -1).applyQuaternion(quat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      const x = pos.x - fwd.x * 15 - fwd.z * 9;
      const z = pos.z - fwd.z * 15 + fwd.x * 9;
      cam.position.set(x, Math.max(pos.y + 2.5, floor(x, z) + 1.5), z);
      cam.lookAt(pos.x, pos.y + 0.8, pos.z);
    } else this.photoFov = clamp(cam.fov, PHOTO_FOV[0], PHOTO_FOV[1]);
    _eul.setFromQuaternion(cam.quaternion, 'YXZ');
    this.photoYaw = _eul.y;
    this.photoPitch = _eul.x;
    this.photoRoll = 0;
    this.photoVel.set(0, 0, 0);
    this.mode = 'photo';
  }

  leavePhoto(): void {
    if (this.mode === 'photo') this.setMode(this.photoBack);
  }

  /**
   * 拍照的机位：move 是前后、左右、上下（-1..1）。按离地高度定速度：贴着地要慢慢挪，高处一下要走很远。
   * look 的单位是弧度，长焦的时候手要稳，所以跟着视角一起变小。
   */
  movePhoto(dt: number, move: { x: number; y: number; z: number }, look: readonly [number, number], fast: boolean, half: number, floor: (x: number, z: number) => number): void {
    const cam = this.camera;
    const k = this.photoFov / 50;
    this.photoYaw -= look[0] * k;
    this.photoPitch = clamp(this.photoPitch - look[1] * k, -1.5, 1.5);
    _eul.set(this.photoPitch, this.photoYaw, this.photoRoll);
    cam.quaternion.setFromEuler(_eul);
    const agl = cam.position.y - floor(cam.position.x, cam.position.z);
    const speed = clamp(agl * 0.5, 5, 90) * (fast ? 4 : 1);
    // 朝前走的时候跟着镜头抬头低头：不然看着谷底却走不下去
    const sy = Math.sin(this.photoYaw);
    const cy = Math.cos(this.photoYaw);
    const flat = Math.cos(this.photoPitch) * move.z;
    _target.set(cy * move.x - sy * flat, Math.sin(this.photoPitch) * move.z + move.y, -sy * move.x - cy * flat).multiplyScalar(speed);
    this.photoVel.lerp(_target, 1 - Math.exp(-dt * 7));
    const p = cam.position.addScaledVector(this.photoVel, dt);
    p.x = clamp(p.x, -half, half);
    p.z = clamp(p.z, -half, half);
    const low = floor(p.x, p.z) + 0.7;
    if (p.y < low) {
      p.y = low;
      this.photoVel.y = Math.max(0, this.photoVel.y);
    }
  }

  /** 电影镜头现在就换下一个机位 */
  nextShot(): void {
    this.shotT = 1e6;
  }

  setMode(m: 'cockpit' | 'chase' | 'cinema'): void {
    this.shot = -1;
    this.mode = m;
    this.chaseInit = false;
  }
}
