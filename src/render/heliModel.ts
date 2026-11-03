// 直升机外观模型（程序化，机体坐标与物理碰撞体一致）：机身、尾梁、垂尾、平尾、尾桨、发动机整流罩、
// 三片主旋翼（高速时显示为模糊桨盘）、滑橇、航行灯与防撞闪光灯。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HELI } from '../config/flight';
import { getGlowTexture } from './propsView';

function painted(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHex(fn(pos.getX(i), pos.getY(i), pos.getZ(i)));
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

const livery = (x: number, y: number, z: number): number => {
  if (y < -0.35) return 0x2b3442;
  if (Math.abs(y - 0.0) < 0.12 && z > -1.6) return 0xd2542a;
  if (y > 0.86) return 0xe9ebee;
  void x;
  return 0xe6e8ea;
};

export class HeliModel {
  readonly root = new THREE.Group();
  /** 驾驶舱视角时隐藏的外部蒙皮 */
  readonly exterior = new THREE.Group();
  readonly rotor = new THREE.Group();
  readonly tailRotor = new THREE.Group();
  private blades: THREE.Mesh;
  private disc: THREE.Mesh;
  private discMat: THREE.MeshBasicMaterial;
  private bladeMat: THREE.MeshStandardMaterial;
  private tailDisc: THREE.Mesh;
  private beacon: THREE.Sprite;
  private navLights: THREE.Sprite[] = [];
  private rotorAngle = 0;
  private tailAngle = 0;
  readonly skids = new THREE.Group();
  private mats: THREE.Material[] = [];

  constructor() {
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.6, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a38, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.55, envMapIntensity: 2 });
    this.mats.push(body, dark, glass);

    // 机舱：拉长的椭球 + 后部收缩
    const cabin = new THREE.SphereGeometry(1, 28, 18);
    const cp = cabin.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      let x = cp.getX(i);
      let y = cp.getY(i);
      let z = cp.getZ(i);
      const front = z < 0 ? 1 : 0;
      z *= front ? 1.95 : 1.55;
      x *= 1.02 * (front ? 1 - Math.max(0, -z - 1.2) * 0.12 : 1 - z * 0.08);
      y *= 1.05;
      if (y < -0.55) y = -0.55 - (y + 0.55) * 0.35;
      cp.setXYZ(i, x, y + 0.1, z - 0.35);
    }
    cabin.computeVertexNormals();
    const cabinMesh = new THREE.Mesh(painted(cabin, livery), body);
    cabinMesh.castShadow = true;
    this.exterior.add(cabinMesh);

    // 挡风玻璃（外部）
    const ws = new THREE.SphereGeometry(1.03, 24, 12, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.18, Math.PI * 0.42);
    const wp = ws.getAttribute('position');
    for (let i = 0; i < wp.count; i++) {
      wp.setXYZ(i, wp.getX(i) * 1.02, wp.getY(i) * 1.05 + 0.1, wp.getZ(i) * 1.95 - 0.35);
    }
    ws.computeVertexNormals();
    const wsMesh = new THREE.Mesh(ws, glass);
    this.exterior.add(wsMesh);

    // 发动机整流罩
    const cowl = new THREE.CapsuleGeometry(0.55, 1.6, 4, 10);
    cowl.rotateX(Math.PI / 2);
    cowl.scale(1, 0.75, 1);
    cowl.translate(0, 1.05, 0.55);
    const cowlMesh = new THREE.Mesh(painted(cowl, () => 0xdfe2e5), body);
    cowlMesh.castShadow = true;
    this.exterior.add(cowlMesh);
    const exhaust = new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10);
    exhaust.rotateX(Math.PI / 2);
    exhaust.translate(0, 1.1, 1.75);
    this.exterior.add(new THREE.Mesh(exhaust, dark));

    // 尾梁
    const boom = new THREE.CylinderGeometry(0.2, 0.42, 6.2, 12, 1);
    boom.rotateX(Math.PI / 2);
    boom.translate(0, 0.62, 4.15);
    const boomMesh = new THREE.Mesh(painted(boom, (x, y) => (y > 0.68 ? 0xe6e8ea : 0xd2542a)), body);
    boomMesh.castShadow = true;
    this.root.add(boomMesh); // 驾驶舱里向后看也能看到尾梁

    // 垂尾与平尾
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(0.9, 0);
    fin.lineTo(1.25, 1.55);
    fin.lineTo(0.75, 1.6);
    fin.lineTo(0, 0.2);
    const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: false });
    finG.rotateY(-Math.PI / 2);
    finG.translate(0.04, 0.55, 6.4);
    this.root.add(new THREE.Mesh(painted(finG, () => 0xd2542a), body));
    const stab = new THREE.BoxGeometry(2.2, 0.06, 0.55);
    stab.translate(0, 0.62, 5.6);
    this.root.add(new THREE.Mesh(painted(stab, () => 0xe6e8ea), body));

    // 尾桨
    this.tailRotor.position.set(-0.32, HELI.colliders.tailRotorY + 0.15, HELI.colliders.tailRotorZ);
    const tb = new THREE.BoxGeometry(0.04, 1.5, 0.14);
    const tb2 = tb.clone().rotateX(Math.PI / 2);
    this.tailRotor.add(new THREE.Mesh(mergeGeometries([tb, tb2]), dark));
    const tdm = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    this.mats.push(tdm);
    this.tailDisc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20).rotateY(Math.PI / 2), tdm);
    this.tailRotor.add(this.tailDisc);
    this.root.add(this.tailRotor);

    // 主旋翼
    this.rotor.position.set(0, HELI.hubHeight, 0);
    const mast = new THREE.CylinderGeometry(0.09, 0.12, 0.55, 10);
    mast.translate(0, -0.25, 0);
    this.rotor.add(new THREE.Mesh(mast, dark));
    const hub = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12);
    this.rotor.add(new THREE.Mesh(hub, dark));
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 1 });
    this.mats.push(this.bladeMat);
    const bladeParts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const bl = new THREE.BoxGeometry(HELI.rotorRadius - 0.3, 0.04, 0.32);
      bl.translate((HELI.rotorRadius - 0.3) / 2 + 0.3, 0.02, 0);
      bl.rotateY((k / 3) * Math.PI * 2);
      bladeParts.push(bl);
    }
    this.blades = new THREE.Mesh(mergeGeometries(bladeParts), this.bladeMat);
    this.blades.castShadow = true;
    this.rotor.add(this.blades);
    // 模糊桨盘：径向条纹贴图
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(30,30,32,0.0)');
    grd.addColorStop(0.12, 'rgba(30,30,32,0.35)');
    grd.addColorStop(0.92, 'rgba(30,30,32,0.22)');
    grd.addColorStop(0.97, 'rgba(230,230,230,0.35)');
    grd.addColorStop(1, 'rgba(30,30,32,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const discTex = new THREE.CanvasTexture(cv);
    discTex.colorSpace = THREE.SRGBColorSpace;
    this.discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.6 });
    this.mats.push(this.discMat);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(HELI.rotorRadius, 48).rotateX(-Math.PI / 2), this.discMat);
    this.disc.position.y = 0.03;
    this.disc.renderOrder = 5;
    this.rotor.add(this.disc);
    this.root.add(this.rotor);

    // 滑橇
    const S = HELI.skid;
    const skidY = S.attachY - S.restLength + 0.05;
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.7 });
    this.mats.push(tubeMat);
    for (const sx of [-S.halfSpan, S.halfSpan]) {
      const len = S.rear - S.front + 0.8;
      const tube = new THREE.CylinderGeometry(0.055, 0.055, len, 8);
      tube.rotateX(Math.PI / 2);
      tube.translate(sx, skidY, (S.rear + S.front) / 2 - 0.2);
      const tip = new THREE.CylinderGeometry(0.055, 0.055, 0.6, 8);
      tip.rotateX(Math.PI / 2 - 0.6);
      tip.translate(sx, skidY + 0.16, S.front - 0.62);
      this.skids.add(new THREE.Mesh(mergeGeometries([tube, tip]), tubeMat));
      for (const cz of [S.front + 0.45, S.rear - 0.35]) {
        const strut = new THREE.CylinderGeometry(0.06, 0.06, 0.95, 8);
        strut.rotateZ(sx > 0 ? 0.42 : -0.42);
        strut.translate(sx * 0.82, skidY + 0.43, cz);
        this.skids.add(new THREE.Mesh(strut, tubeMat));
      }
    }
    this.skids.traverse((o) => (o.castShadow = true));
    this.root.add(this.skids);
    this.root.add(this.exterior);

    // 灯光
    const glow = getGlowTexture();
    const mk = (hex: number, x: number, y: number, z: number, s: number) => {
      const m = new THREE.SpriteMaterial({ map: glow, color: hex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.mats.push(m);
      const sp = new THREE.Sprite(m);
      sp.position.set(x, y, z);
      sp.scale.setScalar(s);
      this.root.add(sp);
      return sp;
    };
    this.navLights.push(mk(0xff2a1a, -1.05, 0.1, -0.2, 0.5), mk(0x30ff60, 1.05, 0.1, -0.2, 0.5), mk(0xffffff, 0, 0.8, 7.1, 0.45));
    this.beacon = mk(0xff3010, 0, 1.45, 1.2, 1.2);
  }

  setCockpitView(cockpit: boolean): void {
    this.exterior.visible = !cockpit;
  }

  /** rpm：旋翼转速比例（0..1），t：时间，dt：帧间隔 */
  update(t: number, dt: number, rpm: number): void {
    const omega = (HELI.tipSpeed / HELI.rotorRadius) * rpm;
    this.rotorAngle = (this.rotorAngle + omega * dt) % (Math.PI * 2);
    this.tailAngle = (this.tailAngle + omega * 5.2 * dt) % (Math.PI * 2);
    this.blades.rotation.y = this.rotorAngle;
    // 高转速时桨叶变透明、显示模糊桨盘（避免频闪）
    const blur = Math.min(1, Math.max(0, (rpm - 0.3) / 0.5));
    this.bladeMat.opacity = 1 - blur * 0.82;
    this.bladeMat.depthWrite = blur < 0.5;
    this.discMat.opacity = blur * 0.55;
    this.disc.rotation.y = -this.rotorAngle * 0.13;
    this.tailRotor.rotation.x = this.tailAngle;
    (this.tailDisc.material as THREE.MeshBasicMaterial).opacity = blur * 0.3;
    const b = (t % 1.2) < 0.08 ? 1 : 0.0;
    this.beacon.material.opacity = b;
    for (const l of this.navLights) l.material.opacity = 0.9;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}
