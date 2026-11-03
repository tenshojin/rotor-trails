// 建筑/道具渲染：把 PropBuilder 合批数据转成网格；锚点生成风向袋、旗帜、信标灯、经幡等动态对象。

import * as THREE from 'three/webgpu';
import { attribute, float, max, positionGeometry, positionLocal, positionWorld, sin, texture, uniform, vec3, vec4 } from 'three/tsl';
import type { MatKey, ModelInstance } from '../world/propBuilder';
import type { WorldData } from '../world/worldgen';
import { addDetail, DETAIL } from './detailTextures';
import { instanceModel, LodModel, type ModelLib } from './modelLib';
import { getNoiseTexture } from './textures';

/** 三级细节模型的切换距离（米，再乘画质系数）：近景几何细节 → 中景贴图 → 远景体块 */
const LOD_DIST: [number, number] = [110, 420];

let glowTex: THREE.CanvasTexture | null = null;
export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

function makeMaterials(detail: THREE.DataArrayTexture | null): Record<MatKey, THREE.Material> {
  const noise = getNoiseTexture();
  // 岩石：顶点色 × 两层世界坐标噪声（明暗斑驳）
  const rock = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const P = positionWorld;
  const rn = texture(noise, P.xz.mul(0.06).add(P.y.mul(0.05))).g.mul(0.6).add(texture(noise, P.xy.mul(0.2).add(0.3)).g.mul(0.4));
  rock.colorNode = vec4(vec3(rn.mul(0.5).add(0.75)), 1.0);
  const std = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const rough = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const metal = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 });
  if (detail) {
    // 照片细节：墙面灰泥、混凝土、波纹铁皮（不再是纯色块）
    addDetail(std, detail, DETAIL.plaster, 0.8);
    addDetail(rough, detail, DETAIL.concrete, 1.0);
    addDetail(metal, detail, DETAIL.corrugated, 1.0);
  }
  return {
    std,
    rough,
    metal,
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6 }),
    emit: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    rock,
  };
}

interface Sock {
  pivot: THREE.Object3D;
  pos: THREE.Vector3;
  phase: number;
}

interface Glow {
  sprite: THREE.Sprite;
  period: number;
  phase: number;
  base: number;
  fogSafe: boolean;
}

export class PropsView {
  readonly group = new THREE.Group();
  readonly materials: Record<MatKey, THREE.Material>;
  private socks: Sock[] = [];
  private flags: Sock[] = [];
  private glows: Glow[] = [];
  private flagMat: THREE.MeshStandardNodeMaterial;
  private prayerMat: THREE.Material | null = null;
  /** 经幡的风采样点（每组取一个），用于驱动摆动幅度 */
  private prayerSamples: THREE.Vector3[] = [];
  private flagUniforms = { uTime: uniform(0), uWindAmt: uniform(0.5) };
  private geos: THREE.BufferGeometry[] = [];
  /** 模型实例（几何体与材质属于模型库，由模型库释放） */
  private instanced: THREE.InstancedMesh[] = [];
  private lods: LodModel[] = [];
  /** 细节分级距离系数（随画质：低 0.7 … 极高 1.7） */
  lodScale = 1;

  constructor(world: WorldData, lib: ModelLib | null = null, detail: THREE.DataArrayTexture | null = null) {
    this.materials = makeMaterials(detail);
    // Blender 模型：同名实例合在一起做实例化绘制
    const byName = new Map<string, ModelInstance[]>();
    for (const inst of world.builder.models) {
      if (!lib?.templates.has(inst.name)) continue;
      const arr = byName.get(inst.name) ?? [];
      arr.push(inst);
      byName.set(inst.name, arr);
    }
    for (const [name, list] of byName) {
      const t = lib!.templates;
      if (t.has(`${name}@1`) && t.has(`${name}@2`)) {
        // 三级细节：近景几何瓦与全部细节 → 中景贴图屋面 → 远景体块
        const lod = new LodModel([t.get(name)!, t.get(`${name}@1`)!, t.get(`${name}@2`)!], list, LOD_DIST);
        this.lods.push(lod);
        for (const im of lod.meshes) {
          this.instanced.push(im);
          this.group.add(im);
        }
        continue;
      }
      for (const im of instanceModel(t.get(name)!, list)) {
        this.instanced.push(im);
        this.group.add(im);
      }
    }
    for (const [key, b] of world.builder.batches) {
      if (b.pos.length === 0) continue;
      const [tag, matName] = key.split('|');
      // 有对应 Blender 模型的部分不再画程序几何体（它们只作为模型缺失时的后备）
      if (tag && byName.has(tag)) continue;
      const mat = matName as MatKey;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      this.geos.push(g);
      const m = new THREE.Mesh(g, this.materials[mat]);
      m.castShadow = mat !== 'emit' && mat !== 'glass';
      m.receiveShadow = mat !== 'emit';
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    // 动态对象
    const sockGeo = this.makeSockGeometry();
    const sockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    this.flagMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const FU = this.flagUniforms;
    {
      // 旗面沿旗杆外侧（+X）起伏：越远离旗杆摆得越大；风小时下垂
      const fx = max(0.0, positionGeometry.x);
      const wave = sin(fx.mul(2.6).sub(FU.uTime.mul(FU.uWindAmt.mul(6.0).add(5.0))).add(positionGeometry.y.mul(0.8))).mul(fx).mul(FU.uWindAmt.mul(0.1).add(0.06));
      this.flagMat.positionNode = positionLocal.add(vec3(0.0, fx.mul(float(1).sub(FU.uWindAmt)).mul(-0.35), wave));
    }
    const glow = getGlowTexture();
    const prayers: typeof world.builder.anchors = [];
    for (const a of world.builder.anchors) {
      const pos = new THREE.Vector3(...a.pos);
      if (a.type === 'windsock') {
        const pivot = new THREE.Object3D();
        pivot.position.copy(pos);
        const m = new THREE.Mesh(sockGeo, sockMat);
        m.castShadow = true;
        pivot.add(m);
        this.group.add(pivot);
        this.socks.push({ pivot, pos, phase: Math.random() * 6 });
      } else if (a.type === 'prayer') {
        prayers.push(a);
      } else if (a.type === 'flag') {
        const pivot = new THREE.Object3D();
        pivot.position.copy(pos);
        pivot.add(new THREE.Mesh(this.makeFlagGeometry(String(a.p?.color ?? 'jp'), a.s), this.flagMat));
        this.group.add(pivot);
        this.flags.push({ pivot, pos, phase: Math.random() * 6 });
      } else if (a.type === 'blink' || a.type === 'beacon') {
        const color = String(a.p?.color ?? 'red');
        const hex = color === 'red' ? 0xff3a2a : color === 'green' ? 0x40ff70 : color === 'blue' ? 0x4080ff : 0xfff2c8;
        const mat = new THREE.SpriteMaterial({ map: glow, color: hex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: a.type !== 'beacon' });
        const s = new THREE.Sprite(mat);
        s.position.copy(pos);
        const base = a.type === 'beacon' ? 14 : 3;
        s.scale.setScalar(base);
        this.group.add(s);
        this.glows.push({ sprite: s, period: Number(a.p?.period ?? 1.5), phase: Math.random(), base, fogSafe: a.type === 'beacon' });
      }
    }
    if (prayers.length > 0) this.buildPrayerFlags(prayers);
  }

  /** 经幡：所有小旗合并成一个网格（一次绘制），沿绳子方向排列、向下悬挂，在着色器里随风摆动。 */
  private buildPrayerFlags(list: Array<{ pos: [number, number, number]; rotY: number; s: number; p?: Record<string, number | string> }>): void {
    const COLORS: Record<string, [number, number, number]> = {
      blue: [0.12, 0.32, 0.78],
      white: [0.95, 0.95, 0.92],
      red: [0.82, 0.12, 0.1],
      green: [0.1, 0.56, 0.26],
      yellow: [0.96, 0.8, 0.12],
    };
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const hang: number[] = [];
    const phase: number[] = [];
    const sway: number[] = [];
    for (const a of list) {
      const s = a.s;
      const w = 0.62 * s;
      const h = 0.48 * s;
      const dx = Math.cos(a.rotY);
      const dz = -Math.sin(a.rotY);
      const nx = -dz;
      const nz = dx;
      const [x, y, z] = a.pos;
      const c = COLORS[String(a.p?.color ?? 'white')] ?? COLORS.white;
      if (!this.prayerSamples.some((q) => q.distanceToSquared(new THREE.Vector3(x, y, z)) < 60 * 60)) this.prayerSamples.push(new THREE.Vector3(x, y, z));
      const ph = Math.random() * Math.PI * 2;
      // 四个角：上沿挂在绳上（hang=0），下沿自由（hang=1）
      const corners: Array<[number, number, number]> = [
        [-w / 2, 0, 0],
        [w / 2, 0, 0],
        [w / 2, -h, 1],
        [-w / 2, -h, 1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [u, v, hg] = corners[k];
        pos.push(x + dx * u, y + v, z + dz * u);
        nor.push(nx, 0, nz);
        col.push(c[0], c[1], c[2]);
        hang.push(hg);
        phase.push(ph);
        sway.push(nx, 0, nz);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aHang', new THREE.Float32BufferAttribute(hang, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 3));
    g.computeBoundingSphere();
    this.geos.push(g);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const FU = this.flagUniforms;
    {
      // 经幡：每面小旗绕挂绳摆动（aSway = 摆动方向，aHang = 离绳子的距离，aPhase = 相位）
      const aHang = attribute('aHang', 'float');
      const aPhase = attribute('aPhase', 'float');
      const aSway = attribute('aSway', 'vec3');
      const sw = sin(FU.uTime.mul(FU.uWindAmt.mul(5.0).add(3.0)).add(aPhase)).add(sin(FU.uTime.mul(7.3).add(aPhase.mul(2.1))).mul(0.35));
      mat.positionNode = positionLocal.add(aSway.mul(sw).mul(aHang).mul(FU.uWindAmt.mul(0.24).add(0.06))).add(vec3(0.0, aHang.mul(FU.uWindAmt).mul(0.12), 0.0));
    }
    this.prayerMat = mat;
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    m.frustumCulled = true;
    this.group.add(m);
  }

  private makeSockGeometry(): THREE.BufferGeometry {
    // 沿 +X 的锥形风袋，红白条纹
    const g = new THREE.CylinderGeometry(0.22, 0.45, 2.6, 10, 5, true);
    g.rotateZ(Math.PI / 2);
    g.translate(1.35, 0, 0);
    const pos = g.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const band = Math.floor((x / 2.6) * 5);
      const red = band % 2 === 0;
      colors.push(red ? 0.85 : 0.95, red ? 0.25 : 0.95, red ? 0.12 : 0.95);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }

  private makeFlagGeometry(kind: string, s: number): THREE.BufferGeometry {
    const w = 1.8 * s;
    const h = 1.2 * s;
    const g = new THREE.PlaneGeometry(w, h, 10, 4);
    g.translate(w / 2, -h / 2, 0);
    const pos = g.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / w;
      const y = -pos.getY(i) / h;
      let r = 0.95;
      let gg = 0.95;
      let b = 0.95;
      if (kind === 'jp') {
        if (Math.hypot((x - 0.5) * 1.5, y - 0.5) < 0.3) [r, gg, b] = [0.75, 0.08, 0.12];
      } else if (kind === 'no') {
        [r, gg, b] = [0.73, 0.1, 0.17];
        const cx = Math.abs(x - 0.36) < 0.09 || Math.abs(y - 0.5) < 0.12;
        const ci = Math.abs(x - 0.36) < 0.045 || Math.abs(y - 0.5) < 0.06;
        if (cx) [r, gg, b] = [0.95, 0.95, 0.95];
        if (ci) [r, gg, b] = [0.0, 0.13, 0.36];
      } else if (kind === 'us') {
        const stripe = Math.floor(y * 13) % 2 === 0;
        [r, gg, b] = stripe ? [0.7, 0.13, 0.2] : [0.95, 0.95, 0.95];
        if (x < 0.4 && y < 0.54) [r, gg, b] = [0.24, 0.23, 0.43];
      } else if (kind === 'br') {
        [r, gg, b] = [0.0, 0.6, 0.29];
        if (Math.abs(x - 0.5) / 0.42 + Math.abs(y - 0.5) / 0.38 < 1) [r, gg, b] = [1.0, 0.87, 0.0];
        if (Math.hypot((x - 0.5) * 1.5, y - 0.5) < 0.2) [r, gg, b] = [0.0, 0.15, 0.46];
      } else if (kind === 'np') {
        [r, gg, b] = [0.86, 0.08, 0.24];
      } else if (kind === 'orange') {
        [r, gg, b] = [0.95, 0.45, 0.1];
      }
      colors.push(r, gg, b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }

  /** windAt(x,y,z) 返回该处的空气速度（来自仿真风场）。 */
  update(t: number, camPos: THREE.Vector3, windAt: (p: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3): void {
    for (const l of this.lods) l.update(camPos, this.lodScale);
    const w = new THREE.Vector3();
    for (const s of this.socks) {
      if (s.pos.distanceToSquared(camPos) > 2500 * 2500) continue;
      windAt(s.pos, w);
      const spd = Math.hypot(w.x, w.z);
      const yaw = Math.atan2(-w.z, w.x);
      s.pivot.rotation.set(0, 0, 0);
      s.pivot.rotation.y = yaw + Math.sin(t * 2.3 + s.phase) * 0.06 * Math.min(1, spd / 6);
      s.pivot.rotation.z = -(1 - Math.min(1, spd / 11)) * 1.25 + Math.sin(t * 5.1 + s.phase) * 0.03 * Math.min(1, spd / 5);
    }
    let windAmt = 0;
    let n = 0;
    for (const f of this.flags) {
      if (f.pos.distanceToSquared(camPos) > 2000 * 2000) continue;
      windAt(f.pos, w);
      const spd = Math.hypot(w.x, w.z);
      f.pivot.rotation.y = Math.atan2(-w.z, w.x);
      windAmt += Math.min(1, spd / 10);
      n++;
    }
    for (const p of this.prayerSamples) {
      if (p.distanceToSquared(camPos) > 2000 * 2000) continue;
      windAt(p, w);
      windAmt += Math.min(1, Math.hypot(w.x, w.z) / 10);
      n++;
    }
    this.flagUniforms.uTime.value = t;
    this.flagUniforms.uWindAmt.value = n > 0 ? windAmt / n : 0.4;
    for (const g of this.glows) {
      const p = ((t / g.period + g.phase) % 1 + 1) % 1;
      const on = p < 0.18 ? 1 : 0.06;
      const d = g.sprite.position.distanceTo(camPos);
      const fade = g.fogSafe ? Math.exp(-d / 1600) : 1;
      g.sprite.material.opacity = on * fade;
      const scale = g.fogSafe ? g.base * Math.max(1, d / 160) : g.base;
      g.sprite.scale.setScalar(Math.min(scale, g.fogSafe ? 90 : 6));
    }
  }

  dispose(): void {
    for (const im of this.instanced) im.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.flagMat.dispose();
    this.prayerMat?.dispose();
  }
}
