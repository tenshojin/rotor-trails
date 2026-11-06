// 座舱里能点的东西：模型的 hs_* 节点。这里负责三件事：
// 1. 鼠标射线落在哪个控件上（按控件自己的包围盒算，太小的放大一点，手指大小才点得中）；
// 2. 控件的位置跟着 Systems 的状态动（翘板摆、拨杆拨、旋钮转、断路器弹出来）；
// 3. 指示灯跟着状态亮。

import * as THREE from 'three/webgpu';
import { CONTROLS, type ControlDef } from '../sim/controls';
import type { Systems } from '../sim/systems';

const DEG = Math.PI / 180;
/** 点击范围的最小边长：约一个指尖 */
const MIN_HIT = 0.013;
const STEP_ANGLES: Record<string, number[]> = {
  eng_main: [-52, 0, 52],
  xp_knob: [-60, -20, 20, 60],
};
/** 音频按键上方的小灯：第 i 个对应哪个状态 */
const AUDIO_LEDS = ['aCom1', 'aCom2', 'aNav', 'aAdf', 'aIcs', 'aPa', 'aSpkr', 'aMkr', 'aDme', 'aAux'];

/** 模型里的仪表和屏幕：不会动，只有读数 */
const ZONES: Record<string, string> = {
  gglass_asi: 'gauge_asi',
  gglass_alt: 'gauge_alt',
  gglass_vsi: 'gauge_vsi',
  gglass_turn: 'gauge_turn',
  gglass_hsi: 'gauge_hsi',
  gglass_hdg2: 'gauge_hdg2',
  gglass_nr: 'gauge_nr',
  gglass_clock: 'gauge_clock',
  scr_ai: 'gauge_ai',
  scr_vemd1: 'gauge_vemd1',
  scr_vemd2: 'gauge_vemd2',
  scr_gps: 'gauge_gps',
  scr_ann: 'gauge_ann',
  scr_efb: 'gauge_efb',
};

export interface Spot {
  id: string;
  def: ControlDef;
  obj: THREE.Object3D;
  kind: 'rock' | 'tog' | 'knob' | 'press' | 'pull' | 'lever' | 'guard' | 'zone';
  axis: THREE.Vector3;
  pos0: THREE.Vector3;
  quat0: THREE.Quaternion;
  angle: number;
  travel: number;
  /** 包围盒（节点自己的坐标） */
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** 控件中心（座舱坐标） */
  center: THREE.Vector3;
  /** 动画当前值：转角或位移 */
  now: number;
  /** 按键按下的程度 0..1 */
  push: number;
  held: number;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** 射线和盒子的交点距离，没打中返回 -1 */
function hitBox(o: THREE.Vector3, d: THREE.Vector3, lo: THREE.Vector3, hi: THREE.Vector3): number {
  let t0 = 0;
  let t1 = 10;
  for (const k of ['x', 'y', 'z'] as const) {
    const inv = 1 / (Math.abs(d[k]) < 1e-9 ? 1e-9 : d[k]);
    let a = (lo[k] - o[k]) * inv;
    let b = (hi[k] - o[k]) * inv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

export class CockpitControls {
  readonly spots: Spot[] = [];
  private byId = new Map<string, Spot>();
  private leds = new Map<string, THREE.Mesh>();
  private ledOff: THREE.MeshBasicMaterial;
  private ledAmber: THREE.MeshBasicMaterial;
  private ledGreen: THREE.MeshBasicMaterial;
  private ledRed: THREE.MeshBasicMaterial;
  private ring: THREE.Sprite | null = null;
  private ringTex: THREE.CanvasTexture | null = null;
  private ringMat: THREE.SpriteMaterial | null = null;

  constructor(scene: THREE.Object3D, private readonly root: THREE.Object3D) {
    const box = new THREE.Box3();
    scene.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const name = o.name;
      if (mesh.isMesh && name.startsWith('led_')) {
        this.leds.set(name, mesh);
        return;
      }
      // 用了两种材质的控件在 glTF 里是一个组、下面挂两个网格：转组，不转网格
      if (o.parent?.name.startsWith('hs_')) return;
      const hs = name.startsWith('hs_') ? name.slice(3) : ZONES[name];
      if (!hs) return;
      const def = CONTROLS.get(hs);
      if (!def) {
        console.warn('座舱控件没有定义：', hs);
        return;
      }
      box.makeEmpty();
      o.traverse((c) => {
        const g = (c as THREE.Mesh).geometry;
        if (!g) return;
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      });
      const min = box.min.clone();
      const max = box.max.clone();
      for (const k of ['x', 'y', 'z'] as const) {
        const grow = Math.max(0, MIN_HIT - (max[k] - min[k])) / 2;
        min[k] -= grow;
        max[k] += grow;
      }
      const data = o.userData as { kind?: Spot['kind']; axis?: number[]; angle?: number; travel?: number };
      const center = box.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld).applyMatrix4(rootInv);
      const spot: Spot = {
        id: hs,
        def,
        obj: o,
        kind: name.startsWith('hs_') ? (data.kind ?? 'press') : 'zone',
        axis: new THREE.Vector3().fromArray(data.axis ?? [0, 0, 1]).normalize(),
        pos0: o.position.clone(),
        quat0: o.quaternion.clone(),
        angle: (data.angle ?? 28) * DEG,
        travel: data.travel ?? 0.002,
        min,
        max,
        center,
        now: 0,
        push: 0,
        held: 0,
      };
      this.spots.push(spot);
      this.byId.set(hs, spot);
    });
    const led = (c: number) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    this.ledOff = led(0x1b1610);
    this.ledAmber = led(0xffa828);
    this.ledGreen = led(0x46e070);
    this.ledRed = led(0xff3020);
    for (const m of this.leds.values()) {
      m.material = this.ledOff;
      m.castShadow = false;
    }
  }

  /** 检查单提示的那个控件：外面一圈慢慢呼吸的光圈。只有超仿真才用到，第一次提示时才建 */
  private makeRing(): THREE.Sprite {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    g.strokeStyle = '#ffd27a';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
    this.ringTex = new THREE.CanvasTexture(cv);
    this.ringMat = new THREE.SpriteMaterial({ map: this.ringTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0, toneMapped: false });
    const ring = new THREE.Sprite(this.ringMat);
    ring.layers.mask = 1 << 2;
    ring.renderOrder = 30;
    ring.visible = false;
    this.root.add(ring);
    this.ring = ring;
    return ring;
  }

  get(id: string): Spot | undefined {
    return this.byId.get(id);
  }

  /** 按键：让它陷下去一下 */
  pressAnim(s: Spot): void {
    s.held = 0.14;
  }

  /** 鼠标射线（座舱坐标）打中的控件。按钮比后面的屏幕优先 */
  pick(origin: THREE.Vector3, dir: THREE.Vector3): Spot | null {
    let best: Spot | null = null;
    let bestT = Infinity;
    for (const s of this.spots) {
      _m.copy(s.obj.matrix).invert();
      _o.copy(origin).applyMatrix4(_m);
      _d.copy(dir).transformDirection(_m);
      const t = hitBox(_o, _d, s.min, s.max);
      if (t < 0) continue;
      // 屏幕和表盘是大面，同一条线上有按钮时让给按钮
      const score = s.kind === 'zone' ? t + 0.05 : t;
      if (score < bestT) {
        best = s;
        bestT = score;
      }
    }
    return best;
  }

  /** 控件当前应该在的位置 */
  private target(s: Spot, sys: Systems): number {
    const key = s.def.key;
    const v = key ? sys.c[key] : 0;
    switch (s.kind) {
      case 'rock':
        return v > 0.5 ? -s.angle : s.angle;
      case 'tog':
        if (s.def.type === 'step') return (1 - v) * s.angle * (s.id === 'elt' ? -1 : 1);
        return v > 0.5 ? -s.angle : s.angle;
      case 'guard':
        return v > 0.5 ? s.angle : 0;
      case 'pull':
      case 'lever':
        return v > 0.5 ? 0 : s.travel;
      case 'knob': {
        const steps = STEP_ANGLES[s.id];
        if (steps) return steps[Math.round(v)] * DEG;
        if (s.def.type === 'flip') return (v > 0.5 ? 40 : -40) * DEG;
        if (s.def.type === 'step') return v * 34 * DEG;
        const lo = s.def.min ?? 0;
        const hi = s.def.max ?? 1;
        if (key === 'baro' || key === 'hdgBug' || key === 'comStby' || key === 'aiTrim') return (v / (s.def.step ?? 1)) * 6 * DEG;
        return (((v - lo) / (hi - lo)) * 270 - 135) * DEG;
      }
      default:
        return 0;
    }
  }

  animate(sys: Systems, dt: number, t: number): void {
    const spin = 1 - Math.exp(-dt * 30);
    for (const s of this.spots) {
      if (s.kind === 'zone') continue;
      const goal = this.target(s, sys);
      s.now += (goal - s.now) * spin;
      s.held = Math.max(0, s.held - dt);
      s.push += ((s.held > 0 ? 1 : 0) - s.push) * (1 - Math.exp(-dt * 45));
      const o = s.obj;
      if (s.kind === 'press') {
        o.position.copy(s.pos0).addScaledVector(s.axis, s.travel * s.push);
      } else if (s.kind === 'pull' || s.kind === 'lever') {
        o.position.copy(s.pos0).addScaledVector(s.axis, s.now);
      } else {
        // 旋钮顺时针为正：转轴朝着驾驶员，所以取负
        _q.setFromAxisAngle(s.axis, s.kind === 'knob' ? -s.now : s.now);
        o.quaternion.copy(s.quat0).premultiply(_q);
      }
    }
    this.updateLeds(sys, t);
  }

  private updateLeds(sys: Systems, t: number): void {
    const audio = sys.feeds('ob_audio');
    for (let i = 0; i < AUDIO_LEDS.length; i++) {
      const m = this.leds.get(`led_au_${i}`);
      if (m) m.material = audio && sys.c[AUDIO_LEDS[i]] > 0.5 ? this.ledGreen : this.ledOff;
    }
    const sw = this.leds.get('led_sw');
    if (sw) sw.material = sys.landingLight ? this.ledAmber : this.ledOff;
    const ovh = this.leds.get('led_ovh');
    // 顶部红灯：主告警，亮着时一闪一闪，点灯板确认
    if (ovh) ovh.material = sys.powered && sys.masterCaution && Math.floor(t * 3) % 2 === 0 ? this.ledRed : this.ledOff;
  }

  /** 让检查单提示的控件外面亮一圈（id 为空就收起来） */
  highlight(id: string | null, t: number): void {
    const s = id ? this.byId.get(id) : undefined;
    if (!s) {
      if (this.ring) this.ring.visible = false;
      return;
    }
    const ring = this.ring ?? this.makeRing();
    ring.visible = true;
    ring.position.copy(s.center);
    _v.copy(s.max).sub(s.min);
    const size = Math.max(0.05, Math.max(_v.x, _v.y, _v.z) * 2.1);
    const beat = 0.5 + 0.5 * Math.sin(t * 3.2);
    ring.scale.setScalar(size * (1 + 0.14 * beat));
    this.ringMat!.opacity = 0.35 + 0.5 * beat;
  }

  dispose(): void {
    this.ring?.removeFromParent();
    this.ringMat?.dispose();
    this.ringTex?.dispose();
    for (const m of [this.ledOff, this.ledAmber, this.ledGreen, this.ledRed]) m.dispose();
    this.spots.length = 0;
    this.byId.clear();
    this.leds.clear();
  }
}
