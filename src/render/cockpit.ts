// 三维驾驶舱：内壁（遮罩挖出挡风玻璃、侧窗、顶窗、下视窗）、窗框、仪表台、遮光罩、座椅、中央操纵台、
// 顶部开关板、周期变距杆/总距杆/脚蹬（随实际操纵动画）、三块仪表屏幕、带雨滴效果的玻璃。

import * as THREE from 'three';
import { drawEICAS, drawMFD, drawPFD, type InstrumentData } from './instruments';
import { getNoiseTexture } from './textures';

/** 驾驶员眼点（机体坐标） */
export const EYE = new THREE.Vector3(0.46, 0.46, -0.62);

// 机舱内壁采用与外部机身一致的椭球（略缩小）
function shellGeometry(scale: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 64, 32);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const front = z < 0;
    z *= front ? 1.95 : 1.55;
    x *= 1.02 * (front ? 1 - Math.max(0, -z - 1.2) * 0.12 : 1 - z * 0.08);
    y *= 1.05;
    if (y < -0.55) y = -0.55 - (y + 0.55) * 0.35;
    p.setXYZ(i, x * scale, (y + 0.1) * scale + 0.1 * (1 - scale), z * scale - 0.35);
  }
  g.computeVertexNormals();
  return g;
}

/** 窗户区域（球面 UV 空间：u = 方位，0.75 = 正前，0.5 = 右侧；v = 0 顶部，0.5 赤道） */
const WINDOWS: Array<[number, number, number, number]> = [
  [0.625, 0.742, 0.17, 0.5], // 风挡左半
  [0.758, 0.875, 0.17, 0.5], // 风挡右半
  [0.64, 0.86, 0.045, 0.14], // 顶窗
  [0.665, 0.735, 0.6, 0.76], // 下视窗左
  [0.765, 0.835, 0.6, 0.76], // 下视窗右
  [0.515, 0.605, 0.24, 0.58], // 右前门
  [0.405, 0.495, 0.28, 0.55], // 右后门
  [0.895, 0.985, 0.24, 0.58], // 左前门
  [0.005, 0.095, 0.28, 0.55], // 左后门
];

function windowMask(): { solid: THREE.CanvasTexture; glass: THREE.CanvasTexture; color: THREE.CanvasTexture } {
  const W = 1024;
  const H = 512;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const solid = mk();
  const glass = mk();
  const color = mk();
  const gs = solid.getContext('2d')!;
  const gg = glass.getContext('2d')!;
  const gc = color.getContext('2d')!;
  gs.fillStyle = '#fff';
  gs.fillRect(0, 0, W, H);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, W, H);
  gc.fillStyle = '#7f8790';
  gc.fillRect(0, 0, W, H);
  // 内饰细节：缝线与面板
  gc.strokeStyle = 'rgba(0,0,0,0.25)';
  gc.lineWidth = 2;
  for (let y = 0; y < H; y += 32) {
    gc.beginPath();
    gc.moveTo(0, y);
    gc.lineTo(W, y);
    gc.stroke();
  }
  gc.fillStyle = '#5a616a';
  gc.fillRect(0, H * 0.62, W, H * 0.38);
  const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  for (const [u0, u1, v0, v1] of WINDOWS) {
    const x = u0 * W;
    const y = v0 * H;
    const w = (u1 - u0) * W;
    const h = (v1 - v0) * H;
    gs.fillStyle = '#000';
    rr(gs, x, y, w, h, 14);
    gs.fill();
    gg.fillStyle = '#fff';
    rr(gg, x - 2, y - 2, w + 4, h + 4, 15);
    gg.fill();
    gc.strokeStyle = '#262a30';
    gc.lineWidth = 12;
    rr(gc, x - 3, y - 3, w + 6, h + 6, 16);
    gc.stroke();
  }
  const t = (c: HTMLCanvasElement, srgb: boolean) => {
    const tx = new THREE.CanvasTexture(c);
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 4;
    return tx;
  };
  return { solid: t(solid, false), glass: t(glass, false), color: t(color, true) };
}

export class Cockpit {
  readonly root = new THREE.Group();
  private screens: Array<{ tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; kind: 'pfd' | 'mfd' | 'eicas' }> = [];
  private cyclic = new THREE.Group();
  private collective = new THREE.Group();
  private pedalL = new THREE.Mesh();
  private pedalR = new THREE.Mesh();
  readonly glassUniforms = { uRain: { value: 0 }, uTime: { value: 0 }, uFlow: { value: 0 }, uNoise: { value: getNoiseTexture() }, uShield: { value: 0 } };
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private lastDraw = -1;
  mapRange = 2000;
  minimap: HTMLCanvasElement | null = null;

  constructor() {
    const masks = windowMask();
    const shellMat = new THREE.MeshStandardMaterial({ map: masks.color, alphaMap: masks.solid, alphaTest: 0.5, side: THREE.BackSide, roughness: 0.9, metalness: 0 });
    const shell = new THREE.Mesh(shellGeometry(0.975), shellMat);
    this.root.add(shell);
    this.mats.push(shellMat);
    this.geos.push(shell.geometry);

    // 玻璃：雨滴（静止水珠 + 随气流上爬的水流）+ 护盾时的淡蓝色边缘
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xb8c8d0, alphaMap: masks.glass, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.6 });
    const GU = this.glassUniforms;
    glassMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, GU);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv2;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv2 = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vUv2;\nuniform float uRain, uTime, uFlow, uShield;\nuniform sampler2D uNoise;')
        .replace(
          '#include <alphamap_fragment>',
          /* glsl */ `#include <alphamap_fragment>
{
  vec2 uv = vUv2 * vec2(14.0, 7.0);
  float cells = texture2D(uNoise, uv * 0.25).b;
  float drops = smoothstep(0.16, 0.05, cells) * step(0.45, texture2D(uNoise, uv * 0.031).r);
  vec2 fuv = vec2(vUv2.x * 22.0, vUv2.y * 6.0 + uTime * (0.15 + uFlow * 1.6));
  float streak = smoothstep(0.82, 0.95, texture2D(uNoise, fuv * vec2(0.08, 0.02)).g) * smoothstep(0.2, 1.0, uFlow + 0.3);
  float w = clamp((drops * 0.85 + streak * 0.6) * uRain, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.95), w);
  diffuseColor.a = clamp(diffuseColor.a + w * 0.38, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.7, 1.0), uShield * 0.6);
  diffuseColor.a += uShield * 0.08;
}`,
        );
    };
    glassMat.customProgramCacheKey = () => 'cockpit-glass-v1';
    const glass = new THREE.Mesh(shellGeometry(0.985), glassMat);
    glass.renderOrder = 20;
    this.root.add(glass);
    this.mats.push(glassMat);
    this.geos.push(glass.geometry);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x555b63, roughness: 0.7, metalness: 0.2 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x40454c, roughness: 0.85, metalness: 0.05 });
    const glareMat = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.98, metalness: 0 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x4d5868, roughness: 0.95, metalness: 0 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a4f56, roughness: 0.95, metalness: 0 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.2 });
    this.mats.push(frameMat, panelMat, glareMat, seatMat, floorMat, gripMat);
    // 舱内补光（模拟窗口进来的漫反射光）
    const fill = new THREE.PointLight(0xf4f0e8, 0.9, 4, 2);
    fill.position.set(0.1, 0.75, -0.7);
    this.root.add(fill);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      this.geos.push(geo);
      return m;
    };
    // 地板与座椅
    add(new THREE.BoxGeometry(1.85, 0.06, 2.4), floorMat, 0, -0.78, -0.55);
    for (const sx of [-0.46, 0.46]) {
      add(new THREE.BoxGeometry(0.5, 0.14, 0.52), seatMat, sx, -0.38, -0.32);
      add(new THREE.BoxGeometry(0.5, 0.78, 0.12), seatMat, sx, 0.02, -0.02, -0.12);
      add(new THREE.BoxGeometry(0.42, 0.18, 0.1), seatMat, sx, 0.52, 0.03, -0.12);
      add(new THREE.BoxGeometry(0.06, 0.44, 0.06), frameMat, sx, -0.6, -0.32);
    }
    // 仪表台（向后倾斜）与遮光罩
    add(new THREE.BoxGeometry(1.72, 0.42, 0.14), panelMat, 0, -0.15, -1.42, -0.32);
    add(new THREE.BoxGeometry(1.78, 0.05, 0.4), glareMat, 0, 0.08, -1.37, -0.05);
    add(new THREE.BoxGeometry(1.7, 0.3, 0.5), panelMat, 0, -0.5, -1.55);
    // 中央操纵台
    add(new THREE.BoxGeometry(0.3, 0.42, 0.85), panelMat, 0, -0.56, -1.0, 0.25);
    // 顶部开关板
    add(new THREE.BoxGeometry(0.34, 0.06, 0.62), panelMat, 0, 0.96, -0.52);
    for (let i = 0; i < 12; i++) {
      add(new THREE.BoxGeometry(0.03, 0.03, 0.03), gripMat, -0.12 + (i % 4) * 0.08, 0.92, -0.72 + Math.floor(i / 4) * 0.13);
    }
    // 窗框：A 柱、中柱、门框
    const beam = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(t, t, len);
      const m = new THREE.Mesh(g, frameMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.lookAt(b.clone().applyMatrix4(this.root.matrixWorld));
      m.castShadow = true;
      this.root.add(m);
      this.geos.push(g);
    };
    beam(new THREE.Vector3(0, 0.1, -1.62), new THREE.Vector3(0, 1.0, -0.86), 0.045);
    beam(new THREE.Vector3(0.86, 0.06, -1.38), new THREE.Vector3(0.78, 0.96, -0.62), 0.055);
    beam(new THREE.Vector3(-0.86, 0.06, -1.38), new THREE.Vector3(-0.78, 0.96, -0.62), 0.055);
    beam(new THREE.Vector3(0.99, -0.3, -0.12), new THREE.Vector3(0.93, 0.9, -0.12), 0.06);
    beam(new THREE.Vector3(-0.99, -0.3, -0.12), new THREE.Vector3(-0.93, 0.9, -0.12), 0.06);
    beam(new THREE.Vector3(0.8, 0.98, -0.6), new THREE.Vector3(-0.8, 0.98, -0.6), 0.05);

    // 仪表屏幕
    const screen = (kind: 'pfd' | 'mfd' | 'eicas', x: number, y: number, z: number, w: number, h: number) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 512;
      const ctx = cv.getContext('2d')!;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.mats.push(mat);
      const g = new THREE.PlaneGeometry(w, h);
      const m = add(g, mat, x, y, z, -0.32);
      m.castShadow = false;
      this.screens.push({ tex, ctx, kind });
    };
    screen('pfd', 0.42, -0.12, -1.345, 0.25, 0.25);
    screen('mfd', 0.12, -0.12, -1.345, 0.25, 0.25);
    screen('eicas', -0.2, -0.12, -1.345, 0.25, 0.25);

    // 周期变距杆
    this.cyclic.position.set(0.46, -0.76, -0.78);
    add(new THREE.CylinderGeometry(0.018, 0.025, 0.56, 8), frameMat, 0, 0.28, 0, 0, 0, 0, this.cyclic);
    add(new THREE.CylinderGeometry(0.03, 0.028, 0.13, 10), gripMat, 0, 0.6, 0, 0, 0, 0, this.cyclic);
    this.root.add(this.cyclic);
    // 总距杆（座椅左侧，向前伸出）
    this.collective.position.set(0.16, -0.5, -0.08);
    add(new THREE.CylinderGeometry(0.02, 0.022, 0.56, 8), frameMat, 0, 0, -0.28, Math.PI / 2, 0, 0, this.collective);
    add(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10), gripMat, 0, 0, -0.58, Math.PI / 2, 0, 0, this.collective);
    this.root.add(this.collective);
    // 脚蹬
    this.pedalL = add(new THREE.BoxGeometry(0.1, 0.18, 0.04), gripMat, 0.32, -0.66, -1.22, -0.5);
    this.pedalR = add(new THREE.BoxGeometry(0.1, 0.18, 0.04), gripMat, 0.6, -0.66, -1.22, -0.5);
  }

  /** stick：周期变距（俯仰、滚转 -1..1），collective 0..1，pedal -1..1 */
  updateControls(stickPitch: number, stickRoll: number, collective: number, pedal: number): void {
    this.cyclic.rotation.set(-stickPitch * 0.22, 0, -stickRoll * 0.22);
    this.collective.rotation.x = collective * 0.32;
    this.pedalL.position.z = -1.22 - pedal * 0.05;
    this.pedalR.position.z = -1.22 + pedal * 0.05;
  }

  updateGlass(t: number, rain: number, airspeed: number, shield: number): void {
    this.glassUniforms.uTime.value = t;
    this.glassUniforms.uRain.value = rain;
    this.glassUniforms.uFlow.value = Math.min(1, airspeed / 35);
    this.glassUniforms.uShield.value = shield;
  }

  /** 以约 20 Hz 重绘仪表。 */
  drawInstruments(t: number, d: InstrumentData): void {
    if (t - this.lastDraw < 0.05) return;
    this.lastDraw = t;
    for (const s of this.screens) {
      if (s.kind === 'pfd') drawPFD(s.ctx, d);
      else if (s.kind === 'mfd') drawMFD(s.ctx, d, this.minimap, this.mapRange);
      else drawEICAS(s.ctx, d);
      s.tex.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const s of this.screens) s.tex.dispose();
  }
}
