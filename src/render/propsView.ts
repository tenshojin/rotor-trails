// 建筑/道具渲染：把 PropBuilder 合批数据转成网格；锚点生成风向袋、旗帜、信标灯、经幡等动态对象。

import * as THREE from 'three/webgpu';
import { abs, attribute, cameraViewMatrix, float, fract, max, mix, normalize, normalWorld, positionGeometry, positionLocal, positionWorld, pow, sin, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { wetColor, wetRough, windowGlow } from './wetness';
import type { MatKey, ModelInstance } from '../world/propBuilder';
import type { MapDef } from '../maps/types';
import type { WorldData } from '../world/worldgen';
import { addDetail, DETAIL } from './detailTextures';
import { instanceModel, LodModel, type ModelLib } from './modelLib';
import { refineRock } from './rockMesh';
import { getRockReliefTexture, makeStrataTexture } from './terrainMacro';
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

function makeMaterials(detail: THREE.DataArrayTexture | null, map: MapDef): Record<MatKey, THREE.Material> {
  const noise = getNoiseTexture();
  // 岩石：顶点色 × 世界坐标噪声（明暗斑驳）+ 水平的岩层纹，表面用和地形岩壁相同的脊状浮雕（三平面投影，两个尺度）
  const rock = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const P = positionWorld;
  const rn = texture(noise, P.xz.mul(0.06).add(P.y.mul(0.05))).g.mul(0.6).add(texture(noise, P.xy.mul(0.2).add(0.3)).g.mul(0.4));
  const relief = getRockReliefTexture();
  const nW = normalize(normalWorld);
  const aw = pow(abs(nW), vec3(4.0));
  const tw = aw.div(aw.x.add(aw.y).add(aw.z));
  const relS = (s: number, o: number) => {
    const fx = texture(relief, P.zy.div(s).add(o));
    const fy = texture(relief, P.xz.div(s).add(o));
    const fz = texture(relief, P.xy.div(s).add(o));
    const hgt = fx.b.mul(tw.x).add(fy.b.mul(tw.y)).add(fz.b.mul(tw.z));
    const ux = fx.rg.mul(2.0).sub(1.0);
    const uy = fy.rg.mul(2.0).sub(1.0);
    const uz = fz.rg.mul(2.0).sub(1.0);
    return vec4(vec3(0.0, ux.y, ux.x).mul(tw.x).add(vec3(uy.x, 0.0, uy.y).mul(tw.y)).add(vec3(uz.x, uz.y, 0.0).mul(tw.z)), hgt);
  };
  const rA = relS(46.0, 0.13);
  const rB = relS(11.0, 0.57);
  // 贴近飞过岩拱、石柱时看得到的一层
  const rC = relS(2.9, 0.29);
  const band = texture(noise, vec2(P.y.mul(0.021), P.x.mul(0.0007).add(P.z.mul(0.0005)))).r;
  const mott = vec3(rn.mul(0.3).add(0.56).add(rA.w.mul(0.34)).add(rB.w.mul(0.24)).add(rC.w.mul(0.18)).mul(band.mul(0.5).add(0.78)));
  rock.colorNode = vec4(mott, 1.0);
  if (map.rockForm) {
    // 岩拱、石林和旁边的山是同一套地层：颜色按高度查同一张表
    const R = map.rockForm;
    let sw: THREE.Node<'float'> = P.x.mul(R.dip[0]).add(P.z.mul(R.dip[1]));
    for (const [kx, kz, a, ph] of R.waves) sw = sw.add(sin(P.x.mul(kx).add(P.z.mul(kz)).add(ph)).mul(a));
    const lut = makeStrataTexture(R);
    const y = P.y.add(sw).add(rn.sub(0.5).mul(4.0));
    rock.vertexColors = false;
    rock.colorNode = vec4(texture(lut, vec2(y.sub(R.y0).div(R.y1 - R.y0), 0.5)).rgb.mul(mott.mul(0.8).add(0.1)), 1.0);
  }
  rock.normalNode = normalize(cameraViewMatrix.mul(vec4(normalize(nW.add(rA.xyz.mul(1.1)).add(rB.xyz.mul(0.9)).add(rC.xyz.mul(0.8))), 0.0)).xyz);
  const std = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const rough = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const metal = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 });
  // 片石砌体（地基、田埂石墙）：颜色由顶点色决定，石缝与起伏来自照片细节
  const stone = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  if (detail) {
    // 照片细节：墙面灰泥、混凝土、波纹铁皮（不再是纯色块）
    addDetail(std, detail, DETAIL.plaster, 0.8);
    addDetail(rough, detail, DETAIL.concrete, 1.0);
    addDetail(metal, detail, DETAIL.corrugated, 1.0);
    addDetail(stone, detail, DETAIL.stone, 1.0);
  }
  // 停机坪：一块块的板、风吹日晒的污渍、滑橇和轮胎磨出来的黑印，标线也跟着旧
  const pad = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  {
    const stain = texture(noise, P.xz.mul(0.09)).r.mul(0.55).add(texture(noise, P.xz.mul(0.33).add(0.2)).g.mul(0.3)).add(texture(noise, P.xz.mul(1.4).add(0.6)).g.mul(0.15));
    const grain = texture(noise, P.xz.mul(3.1).add(0.1)).a.mul(0.1).add(0.95);
    const q = P.xz.div(4.6);
    const jx = abs(fract(q.x).sub(0.5));
    const jz = abs(fract(q.y).sub(0.5));
    const joint = smoothstep(0.487, 0.497, max(jx, jz));
    const scuff = smoothstep(0.62, 0.84, texture(noise, vec2(P.x.mul(0.31), P.z.mul(0.055)).add(0.37)).r).mul(smoothstep(0.5, 0.7, texture(noise, P.xz.mul(0.05).add(0.71)).g));
    const k = smoothstep(0.3, 0.72, stain).mul(0.34).add(0.56).mul(grain).mul(float(1).sub(joint.mul(0.5))).mul(float(1).sub(scuff.mul(0.34)));
    pad.colorNode = vec4(vec3(k), 1.0);
  }
  // 雨天的湿润效果（颜色变深、变光滑；朝上的面最明显）
  for (const m of [std, rough, metal, stone, rock, pad]) {
    m.colorNode = wetColor((m.colorNode as THREE.Node<'vec4'> | null) ?? vec4(1, 1, 1, 1));
    m.roughnessNode = wetRough(float(m.roughness));
  }
  const glass = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6 });
  {
    // 偏蓝的是太阳能板，不算窗
    const c = attribute<'vec3'>('color', 'vec3');
    glass.emissiveNode = windowGlow(step(c.b, c.r.mul(1.6).add(0.02)));
  }
  return {
    pad,
    std,
    rough,
    metal,
    glass,
    emit: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    // 电线：细杆，不投影（几毫米宽的影子看不见，却要在每层阴影里各画一遍）
    wire: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }),
    rock,
    stone,
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
  private fallMats: THREE.Material[] = [];
  private fallMist: THREE.Sprite[] = [];
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
    this.materials = makeMaterials(detail, world.map);
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
      if (mat === 'rock') {
        const r = refineRock(b.pos, b.col);
        g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(r.col, 3));
      } else {
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      }
      g.computeBoundingSphere();
      this.geos.push(g);
      const m = new THREE.Mesh(g, this.materials[mat]);
      m.castShadow = mat !== 'emit' && mat !== 'glass' && mat !== 'wire';
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
      } else if (a.type === 'waterfall') {
        this.buildWaterfall(world, a);
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

  /**
   * 瀑布：贴着山壁往下流的水带。从水边沿山坡最陡的方向往上找到水源，沿这条线铺一条随地形起伏的带子，
   * 一条条白色水流在着色器里向下滚动，底部是水雾。
   */
  private buildWaterfall(world: WorldData, a: { pos: [number, number, number]; p?: Record<string, number | string> }): void {
    const T = world.terrain;
    const hTop = Number(a.p?.h ?? 120);
    const w = Number(a.p?.w ?? 8);
    const line: Array<[number, number]> = [];
    let x = a.pos[0];
    let z = a.pos[2];
    const ground = world.map.waterLevel ?? -Infinity;
    // 先走到水边，再往上爬
    for (let i = 0; i < 400 && T.heightAt(x, z) > ground + 0.5; i++) {
      const n = T.normalAt(x, z);
      x += n.x * 3;
      z += n.z * 3;
    }
    for (let i = 0; i < 900 && T.heightAt(x, z) < hTop; i++) {
      line.push([x, z]);
      const n = T.normalAt(x, z);
      const l = Math.hypot(n.x, n.z) || 1;
      // 沿坡向上（法线水平分量的反方向），加一点左右摆动
      const sway = Math.sin(i * 0.11) * 0.35 + Math.sin(i * 0.037 + 1.7) * 0.25;
      x += (-n.x / l - (n.z / l) * sway) * 3;
      z += (-n.z / l + (n.x / l) * sway) * 3;
    }
    line.reverse();
    // 水面以下的部分不画
    while (line.length > 1 && T.heightAt(line[line.length - 1][0], line[line.length - 1][1]) < ground + 0.3) line.pop();
    if (line.length < 4) return;
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const COLS = 6;
    let along = 0;
    line.forEach(([px, pz], i) => {
      const [qx, qz] = line[Math.min(line.length - 1, i + 1)];
      const [rx, rz] = line[Math.max(0, i - 1)];
      const dx = qx - rx;
      const dz = qz - rz;
      const l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l;
      const sz = dx / l;
      const k = i / (line.length - 1);
      const width = w * (0.45 + 0.75 * k);
      if (i) along += Math.hypot(px - line[i - 1][0], T.heightAt(px, pz) - T.heightAt(line[i - 1][0], line[i - 1][1]), pz - line[i - 1][1]);
      for (let c = 0; c <= COLS; c++) {
        const u = c / COLS;
        const ox = px + sx * (u - 0.5) * width;
        const oz = pz + sz * (u - 0.5) * width;
        const n = T.normalAt(ox, oz);
        pos.push(ox + n.x * 0.5, T.heightAt(ox, oz) + n.y * 0.5, oz + n.z * 0.5);
        uvs.push(u, along);
      }
      if (i) {
        for (let c = 0; c < COLS; c++) {
          const p0 = (i - 1) * (COLS + 1) + c;
          const p1 = i * (COLS + 1) + c;
          idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.geos.push(g);
    const noise = getNoiseTexture();
    const U = uv();
    const fall = this.flagUniforms.uTime.mul(0.11);
    // 水流：横向细、纵向长的噪声，向下滚动；两层速度不同，看上去不是一整块在平移
    const s1 = texture(noise, vec2(U.x.mul(0.7).add(0.13), U.y.mul(0.0035).sub(fall))).g;
    const s2 = texture(noise, vec2(U.x.mul(1.6).add(0.41), U.y.mul(0.0085).sub(fall.mul(1.7)))).g;
    const edge = smoothstep(0.0, 0.32, U.x).mul(smoothstep(1.0, 0.68, U.x));
    const flow = smoothstep(0.34, 0.66, s1.mul(0.6).add(s2.mul(0.4)));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.colorNode = vec4(mix(vec3(0.72, 0.78, 0.82), vec3(1.0, 1.0, 1.0), flow), 1.0);
    m.opacityNode = edge.mul(flow.mul(0.6).add(0.34));
    // 山壁常年背阴，水花靠天光也是白的
    m.emissiveNode = vec3(0.3, 0.33, 0.36).mul(flow.mul(0.6).add(0.4));
    this.fallMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 3;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    // 底部水雾
    const glow = getGlowTexture();
    const [bx, bz] = line[line.length - 1];
    for (let i = 0; i < 6; i++) {
      const sm = new THREE.SpriteMaterial({ map: glow, color: 0xe8eef2, transparent: true, depthWrite: false, opacity: 0.2 });
      const sp = new THREE.Sprite(sm);
      sp.position.set(bx + Math.cos(i * 2.4) * w * 0.5, Math.max(ground, T.heightAt(bx, bz)) + 2 + i * 1.6, bz + Math.sin(i * 2.4) * w * 0.5);
      sp.scale.setScalar(w * (1.6 + i * 0.5));
      this.group.add(sp);
      this.fallMist.push(sp);
    }
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
    for (const m of this.fallMats) m.dispose();
    for (const s of this.fallMist) (s.material as THREE.Material).dispose();
  }
}
