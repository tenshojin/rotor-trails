// 滑橇起落架：四个支点的射线弹簧-阻尼 + 摩擦模型。
// 正常着陆由弹簧吸收；冲击超过行程时由刚体滑橇碰撞体承受（计为重着陆）。

import { Quaternion, Vector3 } from 'three';
import { HELI } from '../config/flight';
import { clamp, G } from '../core/math';
import type { BodyState } from './flight';
import type { ColliderTag, PhysicsWorld } from './physics';

export interface GearContact {
  active: boolean;
  compression: number;
  force: number;
  tag: ColliderTag | null;
  point: Vector3;
}

export interface TouchdownEvent {
  /** 接地瞬间的下降速度（m/s，正值） */
  descent: number;
  /** 水平速度（m/s） */
  horizontal: number;
  pitch: number;
  roll: number;
  tag: ColliderTag;
}

const _p = new Vector3();
const _d = new Vector3();
const _v = new Vector3();
const _r = new Vector3();
const _n = new Vector3();
const _vt = new Vector3();
const _off = new Vector3();
const _fr = new Vector3();
const _q = new Quaternion();

export class Gear {
  readonly attach: Vector3[];
  readonly contacts: GearContact[];
  weightOnSkids = 0;
  contactCount = 0;
  /** 本步发生的接地事件（下一步清空） */
  touchdown: TouchdownEvent | null = null;
  /** 当前承重最大的支点所在的表面 */
  surface: ColliderTag | null = null;
  private airTime = 10;
  private readonly forces: Array<{ f: Vector3; p: Vector3 }> = [];
  /** 静摩擦：这个支点粘在地面的哪一点上（null = 没粘住，在滑） */
  private readonly anchors: Array<Vector3 | null> = [null, null, null, null];

  constructor() {
    const S = HELI.skid;
    this.attach = [
      new Vector3(-S.halfSpan, S.attachY, S.front),
      new Vector3(S.halfSpan, S.attachY, S.front),
      new Vector3(-S.halfSpan, S.attachY, S.rear),
      new Vector3(S.halfSpan, S.attachY, S.rear),
    ];
    this.contacts = this.attach.map(() => ({ active: false, compression: 0, force: 0, tag: null, point: new Vector3() }));
    for (let i = 0; i < 4; i++) this.forces.push({ f: new Vector3(), p: new Vector3() });
  }

  /** grounded：恢复/出生时已停在地面上（不产生接地事件） */
  reset(grounded = false): void {
    this.airTime = grounded ? 0 : 10;
    // （起点检查点就在这之后存：这里不算“压在滑橇上”的话，它会被记成悬在空中）
    this.weightOnSkids = grounded ? 1 : 0;
    this.touchdown = null;
    this.anchors.fill(null);
    for (const c of this.contacts) {
      c.active = false;
      c.compression = 0;
      c.force = 0;
      c.tag = null;
    }
  }

  /** 计算四个支点的力（世界坐标，作用点），返回需要施加的点力列表。 */
  compute(phys: PhysicsWorld, b: BodyState, mass: number, dt: number, pitch: number, roll: number): Array<{ f: Vector3; p: Vector3 }> {
    const S = HELI.skid;
    const out: Array<{ f: Vector3; p: Vector3 }> = [];
    _q.copy(b.quat);
    _d.set(0, -1, 0).applyQuaternion(_q);
    let total = 0;
    let count = 0;
    let best = 0;
    let bestTag: ColliderTag | null = null;
    const maxLen = S.restLength + S.travel + 0.6;
    for (let i = 0; i < 4; i++) {
      const c = this.contacts[i];
      _p.copy(this.attach[i]).applyQuaternion(_q).add(b.pos);
      const hit = phys.castRay(_p, _d, maxLen, false);
      c.active = false;
      c.force = 0;
      c.compression = 0;
      if (!hit) {
        this.anchors[i] = null;
        continue;
      }
      const x = S.restLength - hit.distance;
      if (x <= 0) {
        this.anchors[i] = null;
        continue;
      }
      const xc = Math.min(x, S.travel);
      _r.subVectors(_p, b.pos);
      _v.copy(b.angVel).cross(_r).add(b.vel);
      const xdot = _v.dot(_d);
      const N = Math.max(0, S.stiffness * xc + S.damping * xdot);
      _n.copy(hit.normal);
      const pf = this.forces[i];
      pf.p.copy(_p).addScaledVector(_d, hit.distance);
      pf.f.copy(_n).multiplyScalar(N);
      // 摩擦：切向速度阻尼，受库仑摩擦上限约束
      _vt.copy(_v).addScaledVector(_n, -_v.dot(_n));
      const vtLen = _vt.length();
      const fMax = S.friction * N;
      if (vtLen < S.stickSpeed) {
        // 静摩擦：几乎不动时滑橇粘在地面的一个点上，力由偏离这一点多远来算。
        // 只按速度算的话，任何持续的力都能推着飞机慢慢走：旋翼一转，机头就在地上一点点往右蹭
        const a = this.anchors[i] ?? (this.anchors[i] = pf.p.clone());
        _off.subVectors(pf.p, a);
        _off.addScaledVector(_n, -_off.dot(_n));
        _fr.copy(_off).multiplyScalar(-S.stickSpring).addScaledVector(_vt, -S.stickiness);
        const m = _fr.length();
        if (m > fMax) {
          // 拉不住了：松开，改成滑动摩擦
          _fr.multiplyScalar(fMax / m);
          this.anchors[i] = null;
        }
        pf.f.add(_fr);
      } else {
        this.anchors[i] = null;
        pf.f.addScaledVector(_vt, -Math.min(fMax, S.stickiness * vtLen) / vtLen);
      }
      out.push(pf);
      c.active = true;
      c.compression = x;
      c.force = N;
      c.tag = hit.tag;
      c.point.copy(pf.p);
      total += N;
      count++;
      if (N > best) {
        best = N;
        bestTag = hit.tag;
      }
    }
    this.weightOnSkids = total / (mass * G);
    this.contactCount = count;
    this.surface = bestTag;
    this.touchdown = null;
    if (count > 0) {
      if (this.airTime > 0.35 && bestTag) {
        this.touchdown = {
          descent: Math.max(0, -b.vel.y),
          horizontal: Math.hypot(b.vel.x, b.vel.z),
          pitch,
          roll,
          tag: bestTag,
        };
      }
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }
    return out;
  }

  /** 滑橇底面离地高度估计（m），无接触时由外部射线给出。 */
  static skidBottomOffset(): number {
    return -(HELI.skid.attachY - HELI.skid.restLength);
  }

  static clampAgl(v: number): number {
    return clamp(v, 0, 9999);
  }
}
