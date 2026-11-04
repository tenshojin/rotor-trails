// 世界里的导航元素。原则：场景里只放现实中说得通的东西，方向与距离交给 HUD 的目标菱形和屏幕边缘箭头。
//   · 任务目标：现场点燃的烟幕（SAR 常用：老远就能看到，还能看出风向）+ 停机坪四角 / 悬停区周围闪烁的引导灯；
//   · 巡查点：闪烁的小灯；
//   · 补给：悬停等待的无人机（吊舱颜色区分动力 / 护盾 / 维修），靠近时对接；
//   · 三维航线标记（光环、箭头）是可选项，默认关闭（设置 → 显示）。

import * as THREE from 'three/webgpu';
import type { MapDef, ObjectiveDef, V3 } from '../maps/types';
import type { GameSession } from '../sim/session';
import { getGlowTexture } from './propsView';
import { SmokePlume } from './smokePlume';

/** 烟幕的一团：柔和的絮状圆斑 */
let smokeTex: THREE.CanvasTexture | null = null;
export function getSmokeTexture(): THREE.CanvasTexture {
  if (smokeTex) return smokeTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() ** 0.7 * 38;
    const r = 12 + rnd() * 22;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.16)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  smokeTex = new THREE.CanvasTexture(cv);
  smokeTex.colorSpace = THREE.SRGBColorSpace;
  return smokeTex;
}

const _wind = new THREE.Vector3();

/**
 * 导航标记材质：不受雾影响（雾天/低云中仍能看到当前航点与航线箭头，保证公平），
 * 但仍做深度测试，会被地形和建筑遮挡；远近的明暗由 update() 按距离控制。
 */
function emissive(hex: number, opacity = 0.85): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });
}

export class NavView {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private chevrons: THREE.Mesh[] = [];
  /** 引导灯（停机坪四角、悬停区一圈、巡查点） */
  private lamps: THREE.Sprite[] = [];
  private lampOn = 0;
  private plume: SmokePlume;
  private smokeSrc = new THREE.Vector3();
  private smokeOn = false;
  /** 烟罐口的火光（天黑时看得见）0..1 */
  flare = 0;
  private lastT = 0;
  private pickups = new Map<string, { obj: THREE.Group; kind: string; base: THREE.Vector3; led: THREE.Sprite; rotors: THREE.Mesh[] }>();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  visible = true;
  /** 三维航线标记（光环、箭头） */
  guides = false;

  constructor(map: MapDef, reversedDepth: boolean) {
    const ringGeo = new THREE.TorusGeometry(1, 0.035, 8, 48);
    this.geos.push(ringGeo);
    for (let i = 0; i < 3; i++) {
      const m = emissive(i === 0 ? 0x38e8ff : 0x38e8ff, i === 0 ? 0.85 : 0.35);
      this.mats.push(m);
      const r = new THREE.Mesh(ringGeo, m);
      r.renderOrder = 10;
      this.rings.push(r);
      this.group.add(r);
    }
    const chev = new THREE.Shape();
    chev.moveTo(0, 1.2);
    chev.lineTo(1.2, -0.2);
    chev.lineTo(0.7, -0.6);
    chev.lineTo(0, 0.2);
    chev.lineTo(-0.7, -0.6);
    chev.lineTo(-1.2, -0.2);
    chev.closePath();
    const chevGeo = new THREE.ShapeGeometry(chev);
    chevGeo.rotateX(-Math.PI / 2);
    this.geos.push(chevGeo);
    const chevMat = emissive(0x38e8ff, 0.55);
    chevMat.side = THREE.DoubleSide;
    this.mats.push(chevMat);
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(chevGeo, chevMat);
      c.scale.setScalar(2.2);
      c.renderOrder = 10;
      this.chevrons.push(c);
      this.group.add(c);
    }
    const glow = getGlowTexture();
    for (let i = 0; i < 12; i++) {
      const m = new THREE.SpriteMaterial({ map: glow, color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
      this.mats.push(m);
      const sp = new THREE.Sprite(m);
      sp.visible = false;
      this.lamps.push(sp);
      this.group.add(sp);
    }
    this.plume = new SmokePlume(reversedDepth);
    this.group.add(this.plume.mesh);
    this.buildPickups(map);
  }

  /** 补给无人机：四旋翼 + 机腹吊舱（颜色区分补给种类）+ 闪烁的信标灯 */
  private buildPickups(map: MapDef): void {
    const glow = getGlowTexture();
    const body = new THREE.BoxGeometry(0.62, 0.16, 0.62);
    const arm = new THREE.BoxGeometry(1.5, 0.05, 0.07);
    const disc = new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2);
    const pod = new THREE.CapsuleGeometry(0.2, 0.42, 4, 12).rotateZ(Math.PI / 2);
    this.geos.push(body, arm, disc, pod);
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.3 });
    const blur = new THREE.MeshBasicMaterial({ color: 0x1a1c20, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(dark, blur);
    for (const p of map.pickups) {
      const g = new THREE.Group();
      const color = p.kind === 'boost' ? 0xe0a820 : p.kind === 'shield' ? 0x2f7fd0 : 0x38a860;
      const podMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.1 });
      this.mats.push(podMat);
      g.add(new THREE.Mesh(body, dark));
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const a = new THREE.Mesh(arm, dark);
        a.rotation.y = r;
        g.add(a);
      }
      const rotors: THREE.Mesh[] = [];
      for (const [x, z] of [[0.53, 0.53], [-0.53, 0.53], [0.53, -0.53], [-0.53, -0.53]]) {
        const d = new THREE.Mesh(disc, blur);
        d.position.set(x, 0.1, z);
        rotors.push(d);
        g.add(d);
      }
      const pm = new THREE.Mesh(pod, podMat);
      pm.position.y = -0.3;
      g.add(pm);
      const lm = new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
      this.mats.push(lm);
      const led = new THREE.Sprite(lm);
      led.position.y = -0.1;
      g.add(led);
      g.scale.setScalar(1.7);
      g.position.set(...p.pos);
      this.group.add(g);
      this.pickups.set(p.id, { obj: g, kind: p.kind, base: new THREE.Vector3(...p.pos), led, rotors });
    }
  }

  update(s: GameSession, t: number, camPos: THREE.Vector3, cam: THREE.Camera): void {
    const nav = s.nav.info;
    const show = this.visible && s.state === 'running';
    const guides = show && this.guides;
    const dt = Math.min(0.5, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.group.visible = this.visible;
    // 航点光环
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const p = nav.preview[i];
      const isFork = nav.mode === 'fork';
      if (!guides || !p || nav.mode === 'approach' || (nav.mode === 'complete') || (i > 0 && !isFork && i >= nav.preview.length)) {
        r.visible = false;
        continue;
      }
      r.visible = true;
      r.position.set(...p.pos);
      const next = nav.preview[i + 1]?.pos ?? p.pos;
      const prev: V3 = i === 0 ? [camPos.x, camPos.y, camPos.z] : nav.preview[i - 1].pos;
      const dir = new THREE.Vector3(next[0] - prev[0], 0, next[2] - prev[2]);
      if (dir.lengthSq() < 1) dir.set(p.pos[0] - camPos.x, 0, p.pos[2] - camPos.z);
      r.lookAt(r.position.clone().add(dir));
      const rad = Math.max(8, Math.min(28, p.radius * 0.45));
      const dist = camPos.distanceTo(r.position);
      const pulse = i === 0 ? 1 + Math.sin(t * 3) * 0.04 : 1;
      r.scale.setScalar(rad * pulse * Math.max(1, dist / 1400));
      (r.material as THREE.MeshBasicMaterial).opacity = (i === 0 || isFork ? 0.85 : 0.3) * Math.min(1, 0.35 + dist / 300);
    }
    // 箭头：沿当前航段，高速时间距更大，数量有限
    let ci = 0;
    if (guides && nav.mode !== 'complete' && nav.mode !== 'fork') {
      const speed = s.groundSpeed;
      const spacing = Math.max(40, Math.min(140, speed * 2.2));
      const pts: V3[] = [[camPos.x, camPos.y, camPos.z], ...nav.preview.slice(0, 2).map((p) => p.pos)];
      let budget = 520 + speed * 6;
      let offset = spacing;
      for (let k = 1; k < pts.length && ci < this.chevrons.length && budget > 0; k++) {
        const a = new THREE.Vector3(...pts[k - 1]);
        const b = new THREE.Vector3(...pts[k]);
        const seg = b.clone().sub(a);
        const len = seg.length();
        if (len < 1) continue;
        seg.normalize();
        for (let d = offset; d < len - 25 && ci < this.chevrons.length && budget > 0; d += spacing) {
          const c = this.chevrons[ci++];
          c.visible = true;
          c.position.copy(a).addScaledVector(seg, d);
          c.rotation.set(0, Math.atan2(-seg.x, -seg.z), 0);
          budget -= spacing;
        }
        offset = spacing;
      }
    }
    for (; ci < this.chevrons.length; ci++) this.chevrons[ci].visible = false;
    // 任务目标的烟幕与引导灯
    const cur = s.mission.current();
    this.lampOn = 0;
    this.smokeOn = false;
    if (show && cur) this.placeObjective(cur.def, cur.visited, s, t, camPos);
    for (let i = this.lampOn; i < this.lamps.length; i++) this.lamps[i].visible = false;
    this.updateSmoke(dt, s, cam);
    // 补给无人机
    for (const [id, p] of this.pickups) {
      p.obj.visible = !s.pickupsTaken.has(id);
      if (!p.obj.visible) continue;
      // 悬停时的轻微漂移
      p.obj.position.set(p.base.x + Math.sin(t * 0.7 + p.base.z) * 0.5, p.base.y + Math.sin(t * 1.3 + p.base.x) * 0.4, p.base.z + Math.cos(t * 0.6 + p.base.x) * 0.5);
      p.obj.rotation.y = Math.sin(t * 0.21 + p.base.y) * 1.2;
      p.obj.rotation.z = Math.sin(t * 0.9 + p.base.x) * 0.04;
      // 信标：每 1.2 秒闪一下，离得越远灯看起来越大一点（否则几百米外就看不见了）
      const d = camPos.distanceTo(p.base);
      const on = (t + p.base.x * 0.01) % 1.2 < 0.16 ? 1 : 0.22;
      p.led.scale.setScalar(Math.min(14, Math.max(1.6, d / 70)) * (0.6 + 0.4 * on));
      (p.led.material as THREE.SpriteMaterial).opacity = on;
    }
  }

  private lamp(x: number, y: number, z: number, camPos: THREE.Vector3, bright: number, hex = 0xffd9a0): void {
    const sp = this.lamps[this.lampOn++];
    if (!sp) return;
    sp.visible = true;
    sp.position.set(x, y, z);
    const d = camPos.distanceTo(sp.position);
    sp.scale.setScalar(Math.min(10, Math.max(0.9, d / 90)));
    const m = sp.material as THREE.SpriteMaterial;
    m.color.setHex(hex);
    m.opacity = bright;
  }

  private placeObjective(def: ObjectiveDef, visited: boolean[], s: GameSession, t: number, camPos: THREE.Vector3): void {
    if (def.kind === 'land') {
      const pad = s.pad(def.padId);
      if (!pad) return;
      const [px, py, pz] = pad.pos;
      this.smokeSrc.set(px + pad.size * 0.62, py + 0.3, pz + pad.size * 0.62);
      this.smokeOn = true;
      // 四角的引导灯依次闪烁
      const r = (pad.size / 2) * 1.02;
      const c = Math.cos(pad.rotY ?? 0);
      const n = Math.sin(pad.rotY ?? 0);
      const k = Math.floor(t * 3) % 4;
      [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([a, b], i) => {
        this.lamp(px + (a * c + b * n) * r, py + 0.5, pz + (-a * n + b * c) * r, camPos, i === k ? 1 : 0.28);
      });
    } else if (def.kind === 'hover') {
      // 烟罐放在地上（悬停点本身可能在半空）
      const sx = def.center[0] + def.radius * 1.5;
      const sz = def.center[2] + def.radius * 1.5;
      this.smokeSrc.set(sx, Math.max(s.world.terrain.heightAt(sx, sz), s.world.map.waterLevel ?? -1e9) + 0.4, sz);
      this.smokeOn = true;
      const k = Math.floor(t * 4) % 8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.lamp(def.center[0] + Math.cos(a) * def.radius, def.center[1] + 0.5, def.center[2] + Math.sin(a) * def.radius, camPos, i === k ? 1 : 0.3);
      }
    } else {
      def.points.forEach((p, i) => {
        if (visited[i]) return;
        this.lamp(p.pos[0], p.pos[1], p.pos[2], camPos, 0.45 + 0.55 * (Math.sin(t * 5 + i) > 0 ? 1 : 0), 0xffc860);
      });
    }
  }

  /** 烟幕：从地面升起、随风飘散（见 smokePlume.ts） */
  private updateSmoke(dt: number, s: GameSession, cam: THREE.Camera): void {
    s.wind.sample(this.smokeSrc.x, this.smokeSrc.y + 15, this.smokeSrc.z, s.t, _wind);
    this.plume.update(dt, this.smokeOn ? this.smokeSrc : null, _wind.x, _wind.z, cam, this.flare);
  }

  dispose(): void {
    this.plume.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const p of this.pickups.values()) {
      p.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    }
  }
}
