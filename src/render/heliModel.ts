// 直升机外观模型（程序化，机体坐标与物理碰撞体一致）：机身、尾梁、垂尾、平尾、尾桨、发动机整流罩、
// 三片主旋翼（高速时显示为模糊桨盘）、滑橇、航行灯与防撞闪光灯。

import * as THREE from 'three/webgpu';
import { atan, cos, float, length, materialOpacity, mix, pow, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HELI } from '../config/flight';
import { loadGltf } from './gltf';
import { getGlowTexture } from './propsView';
import { modelResources } from './modelResources';
import { acquireLivery, liveryMaterial, releaseLivery } from './heliLivery';
import { mergeShadowCasters } from './shadowProxy';

const EXT_URL = 'models/heli_ext.glb';

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
  private discMat: THREE.MeshBasicNodeMaterial;
  private readonly rimK = uniform(0.035);
  /** 桨盘上虚的桨影有多重（外面的镜头才有） */
  private readonly sectorK = uniform(1);
  /** 桨影转到哪了：比桨叶慢得多，就像视频里的车轮效应 */
  private discAngle = 0;
  /** 夜里曝光开得大，桨尖的圆环会变成天上的一道弧线：调暗（0 = 没有） */
  rimDim = 1;
  private inCockpit = true;
  private bladeMat: THREE.MeshStandardMaterial;
  private tailDisc: THREE.Mesh;
  private beacon: THREE.Sprite;
  /** 防撞灯、航行灯开着没有（超仿真里由开关决定） */
  beaconOn = true;
  navOn = true;
  private navLights: THREE.Sprite[] = [];
  private rotorAngle = 0;
  private tailAngle = 0;
  readonly skids = new THREE.Group();
  private mats: THREE.Material[] = [];
  /** 程序生成的外观部件（Blender 外观模型加载成功后隐藏） */
  private proc: THREE.Object3D[] = [];
  /** Blender 外观模型（models/heli_ext.glb）已加载 */
  extLoaded = false;
  private glbBladeMats: THREE.MeshStandardMaterial[] = [];
  private geos = new Set<THREE.BufferGeometry>();
  private extResources: ReturnType<typeof modelResources> | null = null;
  private disposed = false;
  private rotorSpin = new THREE.Group();
  /** Blender 外观的桨叶网格（高速旋转时不投影） */
  private glbBlades: THREE.Mesh[] = [];
  /** 外观模型加载完成（失败也会 resolve，extLoaded 为 false） */
  readonly ready: Promise<void>;
  /** 拍照：相当于快门很快，桨叶一片一片定住，不是虚的 */
  get frozen(): boolean {
    return this.stopped;
  }

  set frozen(on: boolean) {
    if (on === this.stopped) return;
    this.stopped = on;
    // 平时桨叶是半透明的（转起来要虚），定住的时候是实心的
    for (const m of this.glbBladeMats) {
      m.transparent = !on;
      m.needsUpdate = true;
    }
  }

  private stopped = false;
  private usesLivery = false;

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
    this.proc.push(boomMesh);

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
    const finMesh = new THREE.Mesh(painted(finG, () => 0xd2542a), body);
    this.root.add(finMesh);
    this.proc.push(finMesh);
    const stab = new THREE.BoxGeometry(2.2, 0.06, 0.55);
    stab.translate(0, 0.62, 5.6);
    const stabMesh = new THREE.Mesh(painted(stab, () => 0xe6e8ea), body);
    this.root.add(stabMesh);
    this.proc.push(stabMesh);

    // 尾桨
    this.tailRotor.position.set(-0.32, HELI.colliders.tailRotorY + 0.15, HELI.colliders.tailRotorZ);
    const tb = new THREE.BoxGeometry(0.04, 1.5, 0.14);
    const tb2 = tb.clone().rotateX(Math.PI / 2);
    const trMesh = new THREE.Mesh(mergeGeometries([tb, tb2]), dark);
    this.tailRotor.add(trMesh);
    this.proc.push(trMesh);
    const tdm = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
    this.mats.push(tdm);
    this.tailDisc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20).rotateY(Math.PI / 2), tdm);
    this.tailRotor.add(this.tailDisc);
    this.root.add(this.tailRotor);

    // 主旋翼
    this.rotor.position.set(0, HELI.hubHeight, 0);
    const mast = new THREE.CylinderGeometry(0.09, 0.12, 0.55, 10);
    mast.translate(0, -0.25, 0);
    const mastMesh = new THREE.Mesh(mast, dark);
    this.rotor.add(mastMesh);
    this.proc.push(mastMesh);
    const hub = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12);
    const hubMesh = new THREE.Mesh(hub, dark);
    this.rotor.add(hubMesh);
    this.proc.push(hubMesh);
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
    this.proc.push(this.blades);
    // 模糊桨盘：着色器里直接算径向渐变（真实照片里转动的旋翼只是一层很淡的灰影，桨尖一圈略亮）
    this.discMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, opacity: 0.6 });
    {
      const r = length(uv().sub(0.5)).mul(2.0);
      const rim = smoothstep(0.9, 0.97, r).mul(float(1).sub(smoothstep(0.97, 1.0, r)));
      const body = smoothstep(0.08, 0.14, r).mul(mix(0.2, 0.12, smoothstep(0.14, 0.9, r))).mul(float(1).sub(smoothstep(0.95, 1.0, r)));
      // 从外面看：相机的快门拍下来是三道虚的桨影，比一层匀净的灰更像在转（座舱里肉眼看不出，sectorK 是 0）
      const c = uv().sub(0.5);
      const sector = pow(cos(atan(c.y, c.x).mul(3.0)).mul(0.5).add(0.5), 5.0);
      const blades = body.mul(float(1).add(sector.mul(this.sectorK).mul(3.2)));
      this.discMat.colorNode = mix(vec3(0.012, 0.012, 0.014), vec3(0.79, 0.79, 0.79), rim.mul(this.rimK.mul(28.0).min(1.0)));
      // 桨尖一圈只略微显出（太亮的话从座舱里看，晴空上会横着一道白色弧线）
      this.discMat.opacityNode = blades.add(rim.mul(this.rimK)).mul(materialOpacity);
    }
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
    this.proc.push(this.skids, this.exterior);

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
    this.root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) this.geos.add((object as THREE.Mesh).geometry);
    });
    this.ready = this.loadExt().catch((e) => console.warn('外观模型加载失败，使用程序外观：', e));
  }

  /** 加载 Blender 外观模型；成功后隐藏程序生成的外观（失败时保留，游戏照常可玩）。 */
  private async loadExt(): Promise<void> {
    this.usesLivery = true;
    const [gltf, livery] = await Promise.all([loadGltf(EXT_URL), acquireLivery()]);
    const scene = gltf.scene;
    const resources = modelResources(scene);
    if (this.disposed) {
      resources.dispose();
      return;
    }
    scene.updateMatrixWorld(true);
    const body = scene.getObjectByName('ext_body');
    const main = scene.getObjectByName('main_rotor');
    const tail = scene.getObjectByName('tail_rotor');
    if (!body || !main || !tail) {
      resources.dispose();
      throw new Error('heli_ext.glb 缺少节点');
    }
    this.extResources = resources;
    for (const o of this.proc) o.visible = false;
    // 涂装：机身一个材质，逐像素从贴图取（贴图没到就是纯色，但白漆要压暗：
    // 反照率 0.8 太高，山和水都暗，曝光开得大，追尾视角里机身一片死白，看不出形状）
    const painted = new Map<THREE.Material, THREE.Material>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const paint = m.material as THREE.MeshStandardMaterial;
      if (paint.name !== 'cp_paint') return;
      let next = painted.get(paint);
      if (!next) {
        if (livery) {
          next = liveryMaterial(paint, livery);
          this.mats.push(next);
        } else {
          paint.color.multiplyScalar(0.72);
          next = paint;
        }
        painted.set(paint, next);
      }
      m.material = next;
    });
    this.root.add(body);
    // 主旋翼：桨毂与桨叶放进一个随转速旋转的子组（桨毂位置与程序旋翼相同）
    this.rotor.position.copy(main.position);
    this.rotor.add(this.rotorSpin);
    for (const c of [...main.children]) this.rotorSpin.add(c);
    this.rotorSpin.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name.startsWith('blades')) {
        this.glbBlades.push(m);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const sm = mat as THREE.MeshStandardMaterial;
          sm.transparent = true;
          this.glbBladeMats.push(sm);
        }
      }
    });
    this.tailRotor.position.copy(tail.position);
    for (const c of [...tail.children]) this.tailRotor.add(c);
    // 灯装在模型上它们真正的位置：航行灯在平尾两端，防撞灯在垂尾顶上
    this.navLights[0].position.set(-1.13, 0.72, 5.38);
    this.navLights[1].position.set(1.13, 0.72, 5.38);
    this.navLights[2].position.set(0, 0.78, 7.32);
    this.beacon.position.set(0, 1.82, 7.26);
    // 机身外壳、桨毂、尾桨这些多材质的组在阴影里各合成一个只投影的网格（见 shadowProxy.ts）；
    // 主旋翼桨叶是透明材质、转快了不投影，不合
    for (const part of [body, this.rotorSpin, this.tailRotor]) {
      const proxies = mergeShadowCasters(part);
      for (const g of proxies.geometries) this.geos.add(g);
      this.mats.push(...proxies.materials);
    }
    this.extLoaded = true;
  }

  setCockpitView(cockpit: boolean): void {
    // Blender 外观模型从座舱里只能透过顶窗看到整流罩与旋翼，始终显示；程序外观在座舱视角时隐藏
    if (!this.extLoaded) this.exterior.visible = !cockpit;
    this.inCockpit = cockpit;
    this.sectorK.value = cockpit ? 0 : 1;
    // 从座舱里看，桨尖那一圈在暗的山壁前会变成一道横着的亮线；肉眼其实看不到它
    this.rimK.value = (cockpit ? 0.004 : 0.011) * this.rimDim;
    // 两侧航行灯和顶上的防撞灯离眼睛不到两米，从座舱里看会变成一大团光（真实的灯是朝外照的）；尾灯离得远，留着
    this.navLights[0].visible = !cockpit;
    this.navLights[1].visible = !cockpit;
    this.beacon.visible = !cockpit;
  }

  /** rpm：旋翼转速比例（0..1），t：时间，dt：帧间隔 */
  update(t: number, dt: number, rpm: number): void {
    const omega = (HELI.tipSpeed / HELI.rotorRadius) * rpm;
    this.rotorAngle = (this.rotorAngle + omega * dt) % (Math.PI * 2);
    this.tailAngle = (this.tailAngle + omega * 5.2 * dt) % (Math.PI * 2);
    this.blades.rotation.y = this.rotorAngle;
    this.rotorSpin.rotation.y = this.rotorAngle;
    // 高转速时桨叶变透明、显示模糊桨盘（避免频闪）
    const blur = this.stopped ? 0 : Math.min(1, Math.max(0, (rpm - 0.3) / 0.5));
    // 从座舱里看：高速转动的桨叶肉眼看不出一片一片的，只有桨盘那层淡淡的灰影。
    // 哪怕只留 5% 的不透明度，每一帧都会有一块半透明的四边形横在头顶，所以转起来就整片隐藏
    const fade = this.inCockpit ? 1 : 0.82;
    const bladeA = 1 - blur * fade;
    this.bladeMat.opacity = bladeA;
    this.bladeMat.depthWrite = blur < 0.5;
    for (const m of this.glbBladeMats) {
      m.opacity = bladeA;
      m.depthWrite = blur < 0.5;
    }
    this.blades.visible = !this.extLoaded && bladeA > 0.004;
    for (const m of this.glbBlades) m.visible = bladeA > 0.004;
    this.discMat.opacity = blur * (this.inCockpit ? 0.14 : 0.8);
    // 高速旋转时桨叶不投影：每帧角度不同的桨叶阴影会被时间抗锯齿累积成一整块深色圆盘，
    // 而真实的旋翼阴影只是很淡的闪烁
    const shadow = blur < 0.35;
    this.blades.castShadow = shadow;
    for (const m of this.glbBlades) m.castShadow = shadow;
    this.discAngle = (this.discAngle - omega * 0.05 * dt) % (Math.PI * 2);
    this.disc.rotation.y = this.discAngle;
    this.tailRotor.rotation.x = this.tailAngle;
    (this.tailDisc.material as THREE.MeshBasicMaterial).opacity = blur * 0.3;
    const b = this.beaconOn && (t % 1.2) < 0.08 ? 1 : 0.0;
    this.beacon.material.opacity = b;
    // 白天的航行灯只是一个小亮点，到晚上才是一团光
    const day = this.rimDim > 0.5;
    const glow = day ? 0.3 : 0.9;
    for (const l of this.navLights) l.material.opacity = this.navOn ? glow : 0;
    this.beacon.scale.setScalar(day ? 0.5 : 1.2);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geos) g.dispose();
    for (const m of new Set(this.mats)) m.dispose();
    this.extResources?.dispose();
    if (this.usesLivery) releaseLivery();
    this.root.clear();
    this.geos.clear();
    this.glbBlades.length = this.glbBladeMats.length = this.mats.length = this.proc.length = 0;
  }
}
