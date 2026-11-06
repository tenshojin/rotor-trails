// 河流（峡谷谷底、冰川谷）：沿河道铺一条带子，河岸把带子的两边盖住，水边线就是地形和水面的交线。
// 水流方向上滚动的两层噪声做波纹，坡陡的河段起白沫；倒影和海面一样按屏幕步进（见 mirror.ts）。

import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraFar,
  cameraNear,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  fwidth,
  length,
  max,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionView,
  pow,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { RiverDef } from '../maps/types';
import { FOG } from './atmosphere';
import { sceneDepthNode, screenMirror } from './mirror';
import type { ReflectField } from './reflectMap';
import type { SkyDome } from './sky';
import { getNoiseTexture } from './textures';

type N<T extends string> = THREE.Node<T>;

/** 带子比河道宽多少：边缘埋在河岸下面 */
const OVERLAP = 1.5;

function ribbon(r: RiverDef): THREE.BufferGeometry {
  const pts = r.pts;
  const COLS = 4;
  const pos: number[] = [];
  const uvs: number[] = [];
  const flow: number[] = [];
  const hw: number[] = [];
  const rapid: number[] = [];
  const idx: number[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const drop = Math.max(0, (a[2] - b[2]) / l);
    const half = pts[i][3] * OVERLAP;
    for (let c = 0; c <= COLS; c++) {
      const u = (c / COLS) * 2 - 1;
      pos.push(pts[i][0] - tz * half * u, pts[i][2], pts[i][1] + tx * half * u);
      uvs.push(u * OVERLAP, s);
      flow.push(tx, tz);
      hw.push(pts[i][3]);
      rapid.push(Math.min(1, drop / 0.06));
    }
  }
  const row = COLS + 1;
  for (let i = 0; i < pts.length - 1; i++)
    for (let c = 0; c < COLS; c++) {
      const v = i * row + c;
      idx.push(v, v + 1, v + row, v + 1, v + row + 1, v + row);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('hw', new THREE.Float32BufferAttribute(hw, 1));
  g.setAttribute('rapid', new THREE.Float32BufferAttribute(rapid, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class RiverView {
  readonly group = new THREE.Group();
  /** 倒影开关（低画质关闭） */
  readonly ssr = uniform(1);
  private readonly time = uniform(0);
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];

  constructor(rivers: RiverDef[], reversedDepth: boolean, private readonly field: ReflectField | null, private readonly sky: SkyDome) {
    const depthNode = sceneDepthNode(reversedDepth);
    for (const r of rivers) {
      const g = ribbon(r);
      const m = this.material(r, depthNode);
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.mats.push(m);
      this.geos.push(g);
    }
  }

  private material(r: RiverDef, depthNode: THREE.TextureNode): THREE.MeshPhysicalNodeMaterial {
    const noise = getNoiseTexture();
    const deep = new THREE.Color().setHex(r.deep);
    const shallow = new THREE.Color().setHex(r.shallow);
    const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.14, metalness: 0, ior: 1.333, envMapIntensity: 1.0, transparent: true });
    const t = this.time;
    const q = uv();
    const hw = attribute<'float'>('hw', 'float');
    const steep = attribute<'float'>('rapid', 'float');
    const fl = attribute<'vec2'>('flow', 'vec2');
    // 河面坐标（米）：x 横向，y 沿水流；水流速度在急流处更快
    const p = vec2(q.x.mul(hw), q.y);
    // 急流是一段一段的：坡再陡，也是几十米翻白水、几十米平水交替，不是整条河都在沸腾
    const reach = smoothstep(0.44, 0.62, texture(noise, vec2(p.y.mul(0.0023), 0.37)).r.mul(0.7).add(texture(noise, vec2(p.y.mul(0.0071), 0.71)).g.mul(0.3)));
    const rapid = steep.mul(reach.mul(0.88).add(0.12)).toVar();
    const spd = rapid.mul(2.2).add(1).mul(r.speed);
    const grad = (uvN: N<'vec2'>, e: number) => {
      const hx = texture(noise, uvN.add(vec2(e, 0))).g.sub(texture(noise, uvN.sub(vec2(e, 0))).g);
      const hy = texture(noise, uvN.add(vec2(0, e))).g.sub(texture(noise, uvN.sub(vec2(0, e))).g);
      return vec2(hx, hy).div(2 * e);
    };
    // 水纹顺着水流拉长（横向的尺度比纵向小得多），看上去是一条条流线，而不是一片片鳞
    const g1 = grad(vec2(p.x.mul(0.035), p.y.sub(t.mul(spd)).mul(0.0085)), 0.004).mul(0.035);
    const g2 = grad(vec2(p.x.mul(0.11).add(0.3), p.y.sub(t.mul(spd).mul(1.4)).mul(0.021)), 0.004).mul(0.11);
    const g3 = grad(vec2(p.x.mul(0.34).add(0.7), p.y.sub(t.mul(spd).mul(1.8)).mul(0.075)), 0.006).mul(0.34);
    // 比像素还细的水纹只会变成一片噪点：一个像素盖住的水面越大，细纹淡得越多
    const foot = length(fwidth(p));
    const near2 = float(1).sub(smoothstep(0.25, 1.1, foot));
    const near3 = float(1).sub(smoothstep(0.08, 0.4, foot));
    const gl = g1.add(g2.mul(near2.mul(0.34))).add(g3.mul(near3.mul(0.1))).mul(rapid.mul(0.9).add(0.2));
    // 河面局部坐标 → 世界：y 分量沿水流方向，x 分量横向
    const gw = vec2(fl.x.mul(gl.y).sub(fl.y.mul(gl.x)), fl.y.mul(gl.y).add(fl.x.mul(gl.x)));
    const nW = normalize(vec3(gw.x.negate(), 1.0, gw.y.negate()));
    // 白沫：急流里的一条条白水，和岸边的一线泡沫
    const fN = texture(noise, vec2(p.x.mul(0.055), p.y.sub(t.mul(spd).mul(1.2)).mul(0.011))).g.mul(0.58).add(texture(noise, vec2(p.x.mul(0.2).add(0.4), p.y.sub(t.mul(spd).mul(1.5)).mul(0.036))).r.mul(0.42));
    const foam = clamp(smoothstep(float(0.71).sub(rapid.mul(0.2)), float(0.8).sub(rapid.mul(0.13)), fN).mul(rapid.mul(0.82).add(0.02)), 0.0, 1.0).toVar();
    const edge = smoothstep(0.1, 1.0, abs(q.x));
    // 水深、含沙量一段一段地变：河心偏深，泥沙带顺水流拉长
    const plume = texture(noise, vec2(p.x.mul(0.016), p.y.mul(0.0028))).r.mul(0.42).add(0.79);
    const alb = mix(vec3(deep.r, deep.g, deep.b), vec3(shallow.r, shallow.g, shallow.b), edge).mul(plume);
    const body = mix(alb, vec3(0.9, 0.93, 0.94), foam.mul(0.85));
    mat.colorNode = vec4(body.mul(foam.mul(0.7).add(0.3)), 1.0);
    mat.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0.0)).xyz);
    mat.roughnessNode = float(0.12).add(foam.mul(0.6)).add(rapid.mul(0.08));
    const refl = screenMirror(nW, foam, depthNode, this.ssr, this.field, float(0.012), this.sky);
    const reflRgb = refl.get('rgb') as N<'vec3'>;
    const nV = normalize(cameraViewMatrix.mul(vec4(normalize(mix(nW, vec3(0.0, 1.0, 0.0), 0.5)), 0.0)).xyz);
    const ndv = clamp(dot(nV, normalize(positionView).negate()), 0.0, 1.0);
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(ndv), 5.0)));
    const reflK = (refl.get('total') as N<'float'>).toVar();
    mat.specularIntensityNode = float(1).sub(reflK);
    // 水体内部散射的颜色主要来自天光，不怎么跟着阳光走（和海面一样）
    const skyLight = FOG.color.mul(0.42);
    mat.emissiveNode = body.mul(skyLight).mul(max(float(1).sub(fres), 0.0)).add(reflRgb.mul(fres.mul(reflK)));
    // 水边：水面和河岸的交线是地形网格的一个个三角形，硬切的话是一圈折线。水浅的地方慢慢透出岸来
    const bed = perspectiveDepthToViewZ(depthNode.r, cameraNear, cameraFar).negate();
    mat.opacityNode = smoothstep(0.0, 0.8, bed.sub(positionView.z.negate()));
    return mat;
  }

  update(t: number): void {
    this.time.value = t;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
