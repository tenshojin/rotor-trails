// 三维导航标记：当前航点光环、后续航点（较暗）、沿航线的少量箭头、任务光柱、停机坪进近框、悬停区、巡查点；
// Buff 补给的三维外观（动力 = 黄色闪电、护盾 = 蓝色六边形、维修 = 绿色十字）。

import * as THREE from 'three';
import type { MapDef, ObjectiveDef, V3 } from '../maps/types';
import type { GameSession } from '../sim/session';
import { getGlowTexture } from './propsView';

function emissive(hex: number, opacity = 0.85): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: true });
}

export class NavView {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private chevrons: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private optBeam: THREE.Mesh;
  private padFrame: THREE.Mesh;
  private hoverZone: THREE.Mesh;
  private inspect: THREE.Mesh[] = [];
  private pickups = new Map<string, { obj: THREE.Group; kind: string; base: THREE.Vector3 }>();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  visible = true;

  constructor(map: MapDef) {
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
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.geos.push(beamGeo);
    const beamMat = this.beamMaterial(0x42ff8a);
    const optMat = this.beamMaterial(0xc08bff);
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.optBeam = new THREE.Mesh(beamGeo, optMat);
    this.group.add(this.beam, this.optBeam);
    const frameGeo = new THREE.RingGeometry(0.92, 1, 4, 1);
    frameGeo.rotateX(-Math.PI / 2);
    frameGeo.rotateY(Math.PI / 4);
    this.geos.push(frameGeo);
    const fm = emissive(0x42ff8a, 0.8);
    fm.side = THREE.DoubleSide;
    this.mats.push(fm);
    this.padFrame = new THREE.Mesh(frameGeo, fm);
    this.group.add(this.padFrame);
    const hz = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
    hz.translate(0, 0.5, 0);
    this.geos.push(hz);
    const hm = emissive(0x42ff8a, 0.16);
    hm.side = THREE.DoubleSide;
    this.mats.push(hm);
    this.hoverZone = new THREE.Mesh(hz, hm);
    this.group.add(this.hoverZone);
    const dia = new THREE.OctahedronGeometry(2.4);
    this.geos.push(dia);
    const dm = emissive(0xffd23a, 0.85);
    this.mats.push(dm);
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(dia, dm);
      this.inspect.push(d);
      this.group.add(d);
    }
    this.buildPickups(map);
  }

  private beamMaterial(hex: number): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color().setHex(hex) }, uOpacity: { value: 0.5 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vY; void main(){ float a = (1.0 - vY) * uOpacity; gl_FragColor = vec4(uColor * a, a); }',
    });
    this.mats.push(m);
    return m;
  }

  private buildPickups(map: MapDef): void {
    const glow = getGlowTexture();
    for (const p of map.pickups) {
      const g = new THREE.Group();
      const color = p.kind === 'boost' ? 0xffd23a : p.kind === 'shield' ? 0x46b4ff : 0x4cff7a;
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.2, emissive: color, emissiveIntensity: 0.4, depthWrite: false }));
      const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(2.7, 1), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.5, toneMapped: false }));
      g.add(shell, wire);
      const core = new THREE.Group();
      const cm = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 });
      if (p.kind === 'boost') {
        const s = new THREE.Shape();
        s.moveTo(0.2, 1.4);
        s.lineTo(-0.8, -0.1);
        s.lineTo(-0.05, -0.1);
        s.lineTo(-0.3, -1.4);
        s.lineTo(0.8, 0.2);
        s.lineTo(0.05, 0.2);
        s.closePath();
        core.add(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.15), cm));
      } else if (p.kind === 'shield') {
        core.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 6).rotateX(Math.PI / 2), cm));
      } else {
        core.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.4), cm), new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.4), cm));
      }
      g.add(core);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      sp.scale.setScalar(11);
      g.add(sp);
      g.position.set(...p.pos);
      this.group.add(g);
      this.pickups.set(p.id, { obj: g, kind: p.kind, base: new THREE.Vector3(...p.pos) });
    }
  }

  update(s: GameSession, t: number, camPos: THREE.Vector3): void {
    const nav = s.nav.info;
    const show = this.visible && s.state === 'running';
    this.group.visible = this.visible;
    // 航点光环
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const p = nav.preview[i];
      const isFork = nav.mode === 'fork';
      if (!show || !p || nav.mode === 'approach' || (nav.mode === 'complete') || (i > 0 && !isFork && i >= nav.preview.length)) {
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
    if (show && nav.mode !== 'complete' && nav.mode !== 'fork') {
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
    // 任务光柱 / 停机坪框 / 悬停区 / 巡查点
    const cur = s.mission.current();
    this.beam.visible = false;
    this.padFrame.visible = false;
    this.hoverZone.visible = false;
    this.inspect.forEach((d) => (d.visible = false));
    if (show && cur) this.placeObjective(cur.def, cur.visited, s, t, camPos, true);
    this.optBeam.visible = false;
    if (show) {
      for (const o of s.mission.optional) {
        if (o.status === 'done') continue;
        const g = s.mission.goalOf(o, s.body.pos);
        this.optBeam.visible = true;
        this.optBeam.position.set(g[0], g[1] - 30, g[2]);
        const d = camPos.distanceTo(this.optBeam.position);
        this.optBeam.scale.set(Math.max(2, d / 300), 600, Math.max(2, d / 300));
        break;
      }
    }
    // Buff
    for (const [id, p] of this.pickups) {
      p.obj.visible = !s.pickupsTaken.has(id);
      if (!p.obj.visible) continue;
      p.obj.rotation.y = t * 1.4;
      p.obj.position.y = p.base.y + Math.sin(t * 2 + p.base.x) * 0.6;
    }
  }

  private placeObjective(def: ObjectiveDef, visited: boolean[], s: GameSession, t: number, camPos: THREE.Vector3, main: boolean): void {
    void main;
    if (def.kind === 'land') {
      const pad = s.pad(def.padId);
      if (!pad) return;
      this.beam.visible = true;
      this.beam.position.set(pad.pos[0], pad.pos[1], pad.pos[2]);
      const d = camPos.distanceTo(this.beam.position);
      this.beam.scale.set(Math.max(2.5, d / 260), 500, Math.max(2.5, d / 260));
      if (d < 600) {
        this.padFrame.visible = true;
        this.padFrame.position.set(pad.pos[0], pad.pos[1] + 0.15, pad.pos[2]);
        const sc = (pad.size / 2) * Math.SQRT2 * (1 + Math.sin(t * 4) * 0.03);
        this.padFrame.scale.set(sc, 1, sc);
        this.padFrame.rotation.y = pad.rotY ?? 0;
      }
    } else if (def.kind === 'hover') {
      this.beam.visible = true;
      this.beam.position.set(def.center[0], def.center[1], def.center[2]);
      const d = camPos.distanceTo(this.beam.position);
      this.beam.scale.set(Math.max(2.5, d / 260), 500, Math.max(2.5, d / 260));
      if (d < 800) {
        this.hoverZone.visible = true;
        this.hoverZone.position.set(def.center[0], def.center[1] + def.minH, def.center[2]);
        this.hoverZone.scale.set(def.radius, def.maxH - def.minH, def.radius);
      }
    } else {
      def.points.forEach((p, i) => {
        const d = this.inspect[i];
        if (!d || visited[i]) return;
        d.visible = true;
        d.position.set(...p.pos);
        d.rotation.y = t * 1.5;
        const dist = camPos.distanceTo(d.position);
        d.scale.setScalar(Math.max(1, dist / 250));
      });
    }
  }

  dispose(): void {
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
