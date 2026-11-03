// 天气特效：三维雨线（方向 = 雨滴相对飞机的速度，能直观看出风向与飞行速度）、低云层、闪电。

import * as THREE from 'three';
import { getNoiseTexture } from './textures';

export class RainFx {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.ShaderMaterial;
  private count: number;

  constructor(maxCount: number) {
    this.count = maxCount;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) {
      off[i * 4] = Math.random() * 60;
      off[i * 4 + 1] = Math.random() * 40;
      off[i * 4 + 2] = Math.random() * 60;
      off[i * 4 + 3] = Math.random();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3(0, -9, 0) },
        uRel: { value: new THREE.Vector3(0, -9, 0) },
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(60, 40, 60) },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0.72, 0.76, 0.8) },
      },
      vertexShader: /* glsl */ `
attribute vec4 aOff;
uniform vec3 uCam, uVel, uRel, uBox;
uniform float uTime;
varying float vA;
varying float vT;
void main() {
  vec3 P = aOff.xyz + uVel * uTime * (0.85 + 0.3 * aOff.w);
  P = mod(P - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  float d = distance(P, cameraPosition);
  vec3 D = normalize(uRel);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 S = normalize(cross(D, toCam) + vec3(1e-4));
  float len = clamp(length(uRel) * 0.045, 0.35, 3.2);
  vec3 pos = P - D * position.y * len + S * position.x * 0.018 * (1.0 + d * 0.02);
  vA = smoothstep(2.6, 4.5, d) * (1.0 - smoothstep(18.0, 30.0, d));
  vT = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying float vA;
varying float vT;
void main() {
  float a = uOpacity * vA * (0.35 + 0.65 * vT);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.count = 0;
  }

  /** rain 0..1；wind：空气速度；camVel：相机（飞机）速度 */
  update(t: number, cam: THREE.Vector3, rain: number, wind: THREE.Vector3, camVel: THREE.Vector3, density: number): void {
    const u = this.mat.uniforms;
    (u.uCam.value as THREE.Vector3).copy(cam);
    const fall = 8.5 + rain * 2;
    (u.uVel.value as THREE.Vector3).set(wind.x, -fall + wind.y, wind.z);
    (u.uRel.value as THREE.Vector3).set(wind.x - camVel.x, -fall + wind.y - camVel.y, wind.z - camVel.z);
    u.uTime.value = t;
    u.uOpacity.value = Math.min(0.55, rain * 0.6);
    this.mesh.count = rain > 0.02 ? Math.floor(this.count * Math.min(1, rain * 1.2) * density) : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export class CloudLayer {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private geo: THREE.PlaneGeometry;
  private offset = new THREE.Vector2();

  constructor(size: number) {
    this.geo = new THREE.PlaneGeometry(size * 1.8, size * 1.8, 1, 1);
    this.geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uNoise: { value: getNoiseTexture() },
          uOff: { value: new THREE.Vector2(i * 0.137, i * 0.071) },
          uDensity: { value: 0 },
          uLayer: { value: i / 6 },
          uLit: { value: new THREE.Color(0.92, 0.93, 0.95) },
          uDark: { value: new THREE.Color(0.55, 0.58, 0.62) },
          uFade: { value: 3000 },
        },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uOff;
uniform float uDensity, uLayer, uFade;
uniform vec3 uLit, uDark;
varying vec3 vW;
void main() {
  vec2 p = vW.xz * 0.00045 + uOff;
  float n = texture2D(uNoise, p).r * 0.6 + texture2D(uNoise, p * 3.1 + 0.3).g * 0.3 + texture2D(uNoise, p * 9.0).a * 0.1;
  float edge = 1.0 - abs(uLayer - 0.5) * 2.0;
  float c = smoothstep(0.62 - uDensity * 0.35 - edge * 0.12, 0.85 - uDensity * 0.2, n);
  float d = distance(vW, cameraPosition);
  float a = c * uDensity * (0.35 + 0.25 * edge) * (1.0 - smoothstep(uFade * 0.5, uFade, d));
  if (a < 0.004) discard;
  vec3 col = mix(uDark, uLit, clamp(uLayer * 0.8 + n * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`,
      });
      this.mats.push(m);
      const mesh = new THREE.Mesh(this.geo, m);
      mesh.renderOrder = 15;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  update(dt: number, base: number, top: number, density: number, windX: number, windZ: number, overcast: number, camPos: THREE.Vector3): void {
    this.group.visible = density > 0.02;
    if (!this.group.visible) return;
    this.offset.x += windX * dt * 0.00045;
    this.offset.y += windZ * dt * 0.00045;
    this.group.children.forEach((m, i) => {
      m.position.set(camPos.x, base + ((top - base) * i) / 6, camPos.z);
      const u = this.mats[i].uniforms;
      (u.uOff.value as THREE.Vector2).set(i * 0.137 - this.offset.x - camPos.x * 0, i * 0.071 - this.offset.y);
      u.uDensity.value = density;
      (u.uDark.value as THREE.Color).setRGB(0.6 - overcast * 0.2, 0.62 - overcast * 0.2, 0.66 - overcast * 0.2);
    });
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** 闪电：根据天气强度随机触发，返回当前闪光亮度；thunder 回调用于延迟雷声。 */
export class Lightning {
  private next = 6;
  private flash = 0;
  private flicker = 0;
  enabled = true;

  update(t: number, dt: number, intensity: number, onStrike: (distance: number) => void): number {
    if (!this.enabled || intensity <= 0.01) {
      this.flash = Math.max(0, this.flash - dt * 4);
      return this.flash;
    }
    if (t > this.next) {
      this.flash = 0.6 + Math.random() * 0.4;
      this.flicker = 0.35;
      this.next = t + (6 + Math.random() * 14) / Math.max(0.2, intensity);
      onStrike(800 + Math.random() * 3500);
    }
    if (this.flicker > 0) {
      this.flicker -= dt;
      if (Math.random() < 0.15) this.flash = Math.max(this.flash, 0.4 + Math.random() * 0.5);
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    return this.flash * 0.7;
  }
}
