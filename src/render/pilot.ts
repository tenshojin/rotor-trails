// 超仿真里“自己的身体”：坐在机长位上，右手握周期变距杆，左手握总距杆，脚踩脚蹬。
// 模型来自 tools/blender/pilot.py，这里只管让它动：
//   手臂、腿用两节反向动力学（给定手腕位置，算肘的位置）；
//   手指按姿势表弯曲（握杆、伸出食指按按钮、捏旋钮）；
//   鼠标指向按钮时左手离开总距杆伸过去，够不着就探身；手要回总距时再收回来。
// 所有计算都在座舱坐标里（和 cockpit.ts 相同：+x 右、+y 上、-z 机头）。

import * as THREE from 'three/webgpu';
import { loadGltf } from './gltf';
import { modelResources } from './modelResources';
import type { Spot } from './cockpitControls';

const URL_MODEL = 'models/pilot.glb';
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const DEG = Math.PI / 180;

type FingerPose = Record<'index' | 'middle' | 'ring' | 'pinky', [number, number, number]> & { thumb: [number, number, number] };

/** 模型绑定时手指的弯曲（度），和 pilot_sdf.py 的 BIND_FLEX 一样 */
const BIND: [number, number, number] = [28, 34, 20];

/** 手指姿势：每根手指三个关节的弯曲（度），拇指是往手心收的角度 */
const POSES: Record<'grip' | 'gripL' | 'point' | 'pinch' | 'relax', FingerPose> = {
  grip: { index: [46, 62, 34], middle: [54, 68, 40], ring: [58, 70, 42], pinky: [60, 72, 44], thumb: [14, 22, 16] },
  gripL: { index: [50, 60, 38], middle: [56, 66, 40], ring: [58, 68, 42], pinky: [60, 70, 44], thumb: [22, 24, 18] },
  point: { index: [4, 8, 6], middle: [62, 82, 50], ring: [68, 86, 52], pinky: [70, 86, 52], thumb: [24, 26, 20] },
  pinch: { index: [34, 40, 22], middle: [44, 56, 30], ring: [60, 74, 42], pinky: [64, 78, 44], thumb: [30, 12, 8] },
  relax: { index: [24, 30, 18], middle: [28, 34, 20], ring: [30, 36, 22], pinky: [32, 38, 22], thumb: [6, 6, 4] },
};
const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;

interface Rest {
  local: THREE.Quaternion;
  world: THREE.Quaternion;
  pos: THREE.Vector3;
}

interface Arm {
  side: 'R' | 'L';
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  L1: number;
  L2: number;
  /** 手的绑定姿势：手腕位置、手骨世界朝向、手掌坐标系（x 指尖、y 手背） */
  wrist: THREE.Vector3;
  frame: THREE.Quaternion;
  /** 手指弯曲轴（手骨局部） */
  flexAxis: THREE.Vector3;
  thumbAxis: THREE.Vector3;
  fingerNow: FingerPose;
  /** 伸直的食指指尖在手掌坐标系里的位置 */
  tip: THREE.Vector3;
}

function copyPose(p: FingerPose): FingerPose {
  return { index: [...p.index], middle: [...p.middle], ring: [...p.ring], pinky: [...p.pinky], thumb: [...p.thumb] };
}

export interface PilotInputs {
  dt: number;
  cyclic: { obj: THREE.Object3D; base: THREE.Quaternion } | undefined;
  collective: { obj: THREE.Object3D; base: THREE.Quaternion } | undefined;
  pedal: number;
  /** 眼点（座舱坐标）：手从这个方向够过去 */
  eye: THREE.Vector3;
  /** 刚动了总距键：手要回到杆上 */
  collectiveKey: boolean;
}

export class PilotBody {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  loaded = false;
  /** 探身的程度 0..1：相机也跟着往前一点 */
  lean = 0;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, Rest>();
  private arms: Partial<Record<'R' | 'L', Arm>> = {};
  private head: THREE.Mesh[] = [];
  private resources: ReturnType<typeof modelResources> | null = null;
  private disposed = false;
  // 左手够按钮的状态
  private reach = 0;
  private target: Spot | null = null;
  private goal = new THREE.Vector3();
  private leaveT = 0;
  private pokeT = 0;
  /** 点了控件、手还在路上：这时候手不能被总距抢回去 */
  private pressing = false;
  private wantPinch = false;

  constructor(private readonly convert: (m: THREE.MeshStandardMaterial) => THREE.Material) {
    this.ready = this.load().catch((e) => {
      console.warn('飞行员模型加载失败：', e);
    });
  }

  private async load(): Promise<void> {
    const gltf = await loadGltf(URL_MODEL);
    const scene = gltf.scene;
    const res = modelResources(scene);
    if (this.disposed) {
      res.dispose();
      return;
    }
    this.resources = res;
    const made = new Map<THREE.Material, THREE.Material>();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) {
        this.bones.set(o.name, b);
        const wq = new THREE.Quaternion();
        const wp = new THREE.Vector3();
        o.getWorldQuaternion(wq);
        o.getWorldPosition(wp);
        this.rest.set(o.name, { local: o.quaternion.clone(), world: wq, pos: wp });
      }
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.layers.mask = 1 << 2;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        const src = m.material as THREE.MeshStandardMaterial;
        let nm = made.get(src);
        if (!nm) {
          nm = this.convert(src);
          made.set(src, nm);
        }
        m.material = nm;
        if (src.name === 'pl_helmet' || src.name === 'pl_visor') this.head.push(m);
      }
    });
    this.arms.R = this.buildArm('R');
    this.arms.L = this.buildArm('L');
    this.root.add(scene);
    this.loaded = true;
  }

  private buildArm(side: 'R' | 'L'): Arm {
    const B = (n: string) => this.bones.get(`${n}_${side}`)!;
    const R = (n: string) => this.rest.get(`${n}_${side}`)!;
    const upper = B('upper');
    const fore = B('fore');
    const hand = B('hand');
    const wrist = R('hand').pos.clone();
    const mid = R('middle1').pos;
    const idx = R('index1').pos;
    const pnk = R('pinky1').pos;
    // 手掌坐标系：x 指向中指根，z 指向小指一侧（右手）或拇指一侧（左手）
    const X = _v.copy(mid).sub(wrist).normalize();
    const i2p = _v2.copy(pnk).sub(idx).normalize();
    const Z = side === 'R' ? i2p : i2p.negate();
    const Y = _v3.crossVectors(Z, X).normalize();
    const Z2 = _v4.crossVectors(X, Y).normalize();
    const frame = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, Y, Z2));
    // 手指往手心弯：指尖方向（x）转向 -y，转轴 = x × (-y)
    const flexWorld = new THREE.Vector3().crossVectors(X, _v2.copy(Y).negate()).normalize();
    const flexAxis = flexWorld.clone().applyQuaternion(_q.copy(R('hand').world).invert());
    // 拇指往手心收：绕手的 x 轴
    const thumbWorld = X.clone().multiplyScalar(side === 'R' ? 1 : -1);
    const thumbAxis = thumbWorld.applyQuaternion(_q.copy(R('hand').world).invert());
    // 伸直的食指：指尖在手掌坐标系里的位置
    const inv = _q.copy(frame).invert();
    const tip = idx.clone().sub(wrist).applyQuaternion(inv);
    let a = 0;
    const seg = ['index1', 'index2', 'index3'];
    POSES.point.index.forEach((f, i) => {
      a += f * DEG;
      const next = i < 2 ? R(seg[i + 1]).pos : null;
      const L = next ? next.distanceTo(R(seg[i]).pos) : 0.021;
      tip.x += Math.cos(a) * L;
      tip.y -= Math.sin(a) * L;
    });
    return {
      side,
      upper,
      fore,
      hand,
      L1: R('upper').pos.distanceTo(R('fore').pos),
      L2: R('fore').pos.distanceTo(wrist),
      wrist,
      frame,
      flexAxis,
      thumbAxis,
      fingerNow: copyPose(POSES.grip),
      tip,
    };
  }

  /** 外面的镜头才看得到头盔：第一人称时摄像机就在头里面 */
  setView(cockpit: boolean): void {
    for (const m of this.head) m.visible = !cockpit;
  }

  /** 点了控件：手抬起来伸过去。鼠标只是指着的时候手不动，那只是在看 */
  reachFor(spot: Spot): void {
    this.target = spot;
    this.leaveT = 0;
    this.pressing = true;
  }

  /** 手指到了没有 */
  touching(spot: Spot): boolean {
    return this.target === spot && this.reach > 0.9 && this.goal.distanceToSquared(spot.center) < 0.0004;
  }

  /** 鼠标按着不放：手留在控件上 */
  hold(spot: Spot): void {
    if (this.target === spot) this.leaveT = 0;
  }

  /** 按下去：手指往控件上戳一下，过一会儿收回 */
  poke(spot: Spot): void {
    this.target = spot;
    this.pokeT = 0.2;
    this.leaveT = 0;
    this.pressing = false;
  }

  private setWorld(b: THREE.Bone, world: THREE.Quaternion, parent: THREE.Quaternion): void {
    b.quaternion.copy(_q3.copy(parent).invert()).multiply(world);
  }

  /** 两节手臂：肩 s 到手腕 w，肘往 pole 弯。upperQ、foreQ 写回世界朝向 */
  private solveLimb(s: THREE.Vector3, w: THREE.Vector3, L1: number, L2: number, pole: THREE.Vector3, out: THREE.Vector3): void {
    const d = _v.copy(w).sub(s);
    const dist = Math.min(d.length(), (L1 + L2) * 0.999);
    d.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const p = _v2.copy(pole).sub(s);
    p.addScaledVector(d, -p.dot(d)).normalize();
    out.copy(s).addScaledVector(d, a).addScaledVector(p, h);
    // 够不着时手腕停在手臂伸直的地方
    w.copy(s).addScaledVector(d, dist);
  }

  private solveArm(arm: Arm, spineQ: THREE.Quaternion, shoulder: THREE.Vector3, wrist: THREE.Vector3, handFrame: THREE.Quaternion, pole: THREE.Vector3): void {
    const elbow = _elbow;
    this.solveLimb(shoulder, wrist, arm.L1, arm.L2, pole, elbow);
    const rU = this.rest.get(arm.upper.name)!;
    const rF = this.rest.get(arm.fore.name)!;
    const rH = this.rest.get(arm.hand.name)!;
    // 上臂
    const restDir = _v3.copy(rF.pos).sub(rU.pos).normalize();
    const dir = _v4.copy(elbow).sub(shoulder).normalize();
    const uq = _uq.setFromUnitVectors(restDir, dir).multiply(rU.world);
    this.setWorld(arm.upper, uq, spineQ);
    // 小臂
    restDir.copy(rH.pos).sub(rF.pos).normalize();
    dir.copy(wrist).sub(elbow).normalize();
    const fq = _fq.setFromUnitVectors(restDir, dir).multiply(rF.world);
    this.setWorld(arm.fore, fq, uq);
    // 手：目标手掌坐标系相对绑定时转了多少，手骨就转多少
    const hq = _hq.copy(handFrame).multiply(_q.copy(arm.frame).invert()).multiply(rH.world);
    this.setWorld(arm.hand, hq, fq);
  }

  private fingers(arm: Arm, pose: FingerPose, dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    const now = arm.fingerNow;
    for (const f of FINGERS) {
      for (let i = 0; i < 3; i++) {
        now[f][i] += (pose[f][i] - now[f][i]) * k;
        const b = this.bones.get(`${f}${i + 1}_${arm.side}`);
        if (!b) continue;
        const r = this.rest.get(b.name)!;
        // 弯曲轴换到这根骨头的局部：绑定时手掌和手指骨头的相对朝向是固定的
        const axis = _v.copy(arm.flexAxis).applyQuaternion(this.rest.get(arm.hand.name)!.world).applyQuaternion(_q.copy(r.world).invert());
        b.quaternion.copy(r.local).multiply(_q2.setFromAxisAngle(axis, (now[f][i] - BIND[i]) * DEG));
      }
    }
    for (let i = 0; i < 3; i++) {
      now.thumb[i] += (pose.thumb[i] - now.thumb[i]) * k;
      const b = this.bones.get(`thumb${i + 1}_${arm.side}`);
      if (!b) continue;
      const r = this.rest.get(b.name)!;
      const axis = _v.copy(arm.thumbAxis).applyQuaternion(this.rest.get(arm.hand.name)!.world).applyQuaternion(_q.copy(r.world).invert());
      b.quaternion.copy(r.local).multiply(_q2.setFromAxisAngle(axis, now.thumb[i] * DEG));
    }
  }

  update(p: PilotInputs): void {
    if (!this.loaded) return;
    const { dt } = p;
    const R = this.arms.R!;
    const L = this.arms.L!;
    // ---------- 左手要不要伸出去 ----------
    if (p.collectiveKey && !this.pressing && this.pokeT <= 0) this.target = null;
    this.pokeT = Math.max(0, this.pokeT - dt);
    if (this.target) {
      this.leaveT += dt;
      if (this.leaveT > 1.6 && this.pokeT <= 0) this.target = null;
    }
    const reachWanted = this.target ? 1 : 0;
    this.reach += (reachWanted - this.reach) * (1 - Math.exp(-dt * (reachWanted ? 8 : 6)));
    if (this.target) {
      this.goal.lerp(this.target.center, this.reach < 0.02 ? 1 : 1 - Math.exp(-dt * 16));
      this.wantPinch = this.target.kind === 'knob' || this.target.kind === 'lever';
    }
    const reach = this.reach * this.reach * (3 - 2 * this.reach);

    // ---------- 探身：要够的地方离肩膀太远时上身往前倾 ----------
    const rs = this.rest.get('spine')!;
    const shoulderL = this.rest.get('upper_L')!.pos;
    let leanWant = 0;
    if (reach > 0.01) {
      const need = this.goal.distanceTo(shoulderL) - (L.L1 + L.L2 + L.tip.length()) * 0.92;
      leanWant = Math.min(1, Math.max(0, need / 0.32));
    }
    this.lean += (leanWant * reach - this.lean) * (1 - Math.exp(-dt * 6));
    // 绕身体横轴往前倾：+x 轴，往 -z（机头）倒是负角
    const spineQ = _sq.setFromAxisAngle(_vx, -this.lean * 0.5).multiply(rs.world);
    const spine = this.bones.get('spine')!;
    spine.quaternion.copy(this.rest.get('pelvis') ? _q3.copy(this.rest.get('pelvis')!.world).invert() : _q3.identity()).multiply(spineQ);
    const lean = _sq2.setFromAxisAngle(_vx, -this.lean * 0.5);
    const shoulderAt = (name: string, out: THREE.Vector3) => out.copy(this.rest.get(name)!.pos).sub(rs.pos).applyQuaternion(lean).add(rs.pos);

    // ---------- 右手：一直握着周期变距杆 ----------
    const sR = shoulderAt('upper_R', _sR);
    const wR = _wR.copy(R.wrist);
    const fR = _fR.copy(R.frame);
    if (p.cyclic) {
      const d = _q.copy(p.cyclic.obj.quaternion).multiply(_q2.copy(p.cyclic.base).invert());
      wR.sub(p.cyclic.obj.position).applyQuaternion(d).add(p.cyclic.obj.position);
      fR.premultiply(d);
    }
    this.solveArm(R, spineQ, sR, wR, fR, _v.set(sR.x + 0.2, sR.y - 0.5, sR.z + 0.06).clone());
    this.fingers(R, POSES.grip, dt);

    // ---------- 左手：总距杆，或者伸向按钮 ----------
    const sL = shoulderAt('upper_L', _sL);
    const wL = _wL.copy(L.wrist);
    const fL = _fL.copy(L.frame);
    if (p.collective) {
      const d = _q.copy(p.collective.obj.quaternion).multiply(_q2.copy(p.collective.base).invert());
      wL.sub(p.collective.obj.position).applyQuaternion(d).add(p.collective.obj.position);
      fL.premultiply(d);
    }
    if (reach > 0.001) {
      // 指尖从视线方向过去，手背朝上：离控件 3 cm 悬着，按下时贴上去
      const n = _n.copy(p.eye).sub(this.goal).normalize();
      const gap = this.pokeT > 0 ? 0.004 : 0.032;
      const contact = _c.copy(this.goal).addScaledVector(n, gap);
      const X = _x.copy(n).negate();
      // 手略微向外偏一点，手腕不会绷得太直
      const up = _up.set(0.25, 1, 0.15).normalize();
      const Y = _y.copy(up).addScaledVector(X, -up.dot(X)).normalize();
      const Z = _z.crossVectors(X, Y);
      const goalFrame = _gq.setFromRotationMatrix(_m.makeBasis(X, Y, Z));
      const wristGoal = _wg.copy(L.tip).applyQuaternion(goalFrame).negate().add(contact);
      wL.lerp(wristGoal, reach);
      // 路上抬高一点，不从操纵杆里穿过去
      wL.y += Math.sin(reach * Math.PI) * 0.06;
      fL.slerp(goalFrame, reach);
    }
    this.solveArm(L, spineQ, sL, wL, fL, _v.set(sL.x - 0.26, sL.y - 0.46, sL.z + 0.12).clone());
    const pose = reach > 0.25 ? (this.wantPinch ? POSES.pinch : POSES.point) : POSES.gripL;
    this.fingers(L, pose, dt);

    // ---------- 腿：踩脚蹬 ----------
    this.leg('R', p.pedal * 0.032);
    this.leg('L', -p.pedal * 0.032);
  }

  private leg(side: 'R' | 'L', push: number): void {
    const thigh = this.bones.get(`thigh_${side}`);
    const shin = this.bones.get(`shin_${side}`);
    const foot = this.bones.get(`foot_${side}`);
    if (!thigh || !shin || !foot) return;
    const rT = this.rest.get(thigh.name)!;
    const rS = this.rest.get(shin.name)!;
    const rF = this.rest.get(foot.name)!;
    const L1 = rT.pos.distanceTo(rS.pos);
    const L2 = rS.pos.distanceTo(rF.pos);
    const ankle = _an.copy(rF.pos);
    ankle.z -= push;
    const pole = _v.copy(rS.pos).multiplyScalar(1);
    pole.y += 0.6;
    pole.z -= 0.2;
    this.solveLimb(rT.pos, ankle, L1, L2, pole.clone(), _kn);
    const pelvisQ = this.rest.get('pelvis')!.world;
    const d0 = _v3.copy(rS.pos).sub(rT.pos).normalize();
    const d1 = _v4.copy(_kn).sub(rT.pos).normalize();
    const tq = _uq.setFromUnitVectors(d0, d1).multiply(rT.world);
    this.setWorld(thigh, tq, pelvisQ);
    d0.copy(rF.pos).sub(rS.pos).normalize();
    d1.copy(ankle).sub(_kn).normalize();
    const sq = _fq.setFromUnitVectors(d0, d1).multiply(rS.world);
    this.setWorld(shin, sq, tq);
    // 脚掌贴着脚蹬，跟绑定时一样的朝向
    this.setWorld(foot, rF.world, sq);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    this.resources?.dispose();
    this.bones.clear();
    this.rest.clear();
    this.head.length = 0;
    this.loaded = false;
  }
}

const _vx = new THREE.Vector3(1, 0, 0);
const _elbow = new THREE.Vector3();
const _uq = new THREE.Quaternion();
const _fq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();
const _sq = new THREE.Quaternion();
const _sq2 = new THREE.Quaternion();
const _sR = new THREE.Vector3();
const _sL = new THREE.Vector3();
const _wR = new THREE.Vector3();
const _wL = new THREE.Vector3();
const _fR = new THREE.Quaternion();
const _fL = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _up = new THREE.Vector3();
const _gq = new THREE.Quaternion();
const _wg = new THREE.Vector3();
const _an = new THREE.Vector3();
const _kn = new THREE.Vector3();
