// 程序道具的细节纹理（见 tools/prep_detail.py、tools/prep_drystone.py）：灰泥、混凝土、波纹铁皮、木板、片石墙、干砌石墙六层打包成纹理数组，
// 三平面投影叠加在顶点色上——法线细节 + 明暗起伏。整个会话只加载一次。

import * as THREE from 'three/webgpu';
import { abs, cameraViewMatrix, dot, float, Fn, int, max, mix, normalize, normalViewGeometry, normalWorld, positionWorld, pow, sqrt, struct, texture, vec3, vec4 } from 'three/tsl';
import { loadBitmapBatch } from './bitmapBatch';

export const DETAIL = { plaster: 0, concrete: 1, corrugated: 2, planks: 3, stone: 4, drystone: 5 } as const;
/** 各层一个平铺单元的尺寸（米） */
const TILE = [1.6, 2.7, 1.2, 1.9, 2.2, 2.0];
// drystone：不用灰浆的干砌石墙（tools/prep_drystone.py 程序生成：石缝是黑的，每块石头深浅不同、中间鼓起）
const NAMES = ['plaster', 'concrete', 'corrugated', 'planks', 'stone', 'drystone'];

let cache: Promise<THREE.DataArrayTexture | null> | null = null;

export function loadDetailTextures(): Promise<THREE.DataArrayTexture | null> {
  cache ??= (async () => {
    let bmps: ImageBitmap[] = [];
    try {
      const size = 512;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      const data = new Uint8Array(size * size * 4 * NAMES.length);
      bmps = await loadBitmapBatch(NAMES.map((n) => `textures/detail/${n}.webp`));
      bmps.forEach((b, i) => {
        g.drawImage(b, 0, 0, size, size);
        data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
      });
      const t = new THREE.DataArrayTexture(data, size, size, NAMES.length);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    } catch (e) {
      cache = null;
      console.warn('细节纹理加载失败：', e);
      return null;
    } finally {
      for (const bmp of bmps) bmp.close();
    }
  })();
  return cache;
}

const DetailOut = struct({ lum: 'float', nrm: 'vec3' });

/**
 * 给（顶点色）节点材质加三平面细节：layer = DETAIL 中的一层，strength 0..1。
 * 颜色：照片明暗起伏乘在顶点色上；法线：照片法线（whiteout 混合）按强度混入。
 */
export function addDetail(mat: THREE.MeshStandardNodeMaterial, tex: THREE.DataArrayTexture, layer: number, strength = 1): void {
  const t = TILE[layer];
  const res = Fn(() => {
    const n = normalize(normalWorld);
    const P = positionWorld;
    const a = pow(abs(n), vec3(4.0));
    const w = a.div(a.x.add(a.y).add(a.z));
    const sx = texture(tex, P.zy.div(t)).depth(int(layer));
    const sy = texture(tex, P.xz.div(t)).depth(int(layer));
    const sz = texture(tex, P.xy.div(t)).depth(int(layer));
    const lum = sx.b.mul(w.x).add(sy.b.mul(w.y)).add(sz.b.mul(w.z));
    const un = (v: THREE.Node<'vec4'>) => {
      const xy = v.rg.mul(2).sub(1);
      return vec3(xy.x, xy.y.negate(), sqrt(max(0, float(1).sub(dot(xy, xy)))));
    };
    const tx = un(sx);
    const ty = un(sy);
    const tz = un(sz);
    const bx = vec3(tx.xy.add(n.zy), abs(tx.z).mul(n.x));
    const by = vec3(ty.xy.add(n.xz), abs(ty.z).mul(n.y));
    const bz = vec3(tz.xy.add(n.xy), abs(tz.z).mul(n.z));
    const nrm = normalize(bx.zyx.mul(w.x).add(by.xzy.mul(w.y)).add(bz.mul(w.z)));
    return DetailOut(lum, nrm);
  })();
  const lum = res.get('lum') as THREE.Node<'float'>;
  const nrm = res.get('nrm') as THREE.Node<'vec3'>;
  mat.colorNode = vec4(vec3(lum.sub(0.5).mul(0.9 * strength).add(1.0)), 1.0);
  mat.normalNode = normalize(mix(normalViewGeometry, cameraViewMatrix.mul(vec4(nrm, 0.0)).xyz, 0.85 * strength));
}
