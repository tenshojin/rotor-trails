// 建筑/道具渲染：把 PropBuilder 合批数据转成网格；锚点生成风向袋、旗帜、信标灯、经幡等动态对象。

import * as THREE from 'three';
import type { MatKey } from '../world/propBuilder';
import type { WorldData } from '../world/worldgen';
import { getNoiseTexture } from './textures';

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

function makeMaterials(): Record<MatKey, THREE.Material> {
  const noise = getNoiseTexture();
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  rock.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform sampler2D uNoise;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat rn = texture2D(uNoise, vWP.xz * 0.06 + vWP.y * 0.05).g * 0.6 + texture2D(uNoise, vWP.xy * 0.2 + 0.3).g * 0.4;\ndiffuseColor.rgb *= 0.75 + 0.5 * rn;',
      );
  };
  rock.customProgramCacheKey = () => 'rock-v1';
  return {
    std: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    rough: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 }),
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
  private flagMat: THREE.MeshStandardMaterial;
  private flagUniforms = { uTime: { value: 0 }, uWindAmt: { value: 0.5 } };
  private geos: THREE.BufferGeometry[] = [];

  constructor(world: WorldData) {
    this.materials = makeMaterials();
    for (const [key, b] of world.builder.batches) {
      if (b.pos.length === 0) continue;
      const mat = key.split('|')[0] as MatKey;
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
    this.flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const FU = this.flagUniforms;
    this.flagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = FU.uTime;
      shader.uniforms.uWindAmt = FU.uWindAmt;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindAmt;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nfloat fx = max(0.0, position.x);\ntransformed.z += sin(fx * 2.6 - uTime * (5.0 + uWindAmt * 6.0) + position.y * 0.8) * fx * (0.06 + 0.1 * uWindAmt);\ntransformed.y -= fx * (1.0 - uWindAmt) * 0.35;',
        );
    };
    const glow = getGlowTexture();
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
      } else if (a.type === 'flag' || a.type === 'prayer') {
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
    for (const g of this.geos) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.flagMat.dispose();
  }
}
