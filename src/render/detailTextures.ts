// 程序道具的细节纹理（见 tools/prep_detail.py）：灰泥、混凝土、波纹铁皮、木板四层打包成纹理数组，
// 三平面投影叠加在顶点色上——法线细节 + 明暗起伏。整个会话只加载一次。

import * as THREE from 'three';

export const DETAIL = { plaster: 0, concrete: 1, corrugated: 2, planks: 3 } as const;
/** 各层一个平铺单元的尺寸（米） */
const TILE = [1.6, 2.7, 1.2, 1.9];
const NAMES = ['plaster', 'concrete', 'corrugated', 'planks'];

let cache: Promise<THREE.DataArrayTexture | null> | null = null;

export function loadDetailTextures(): Promise<THREE.DataArrayTexture | null> {
  cache ??= (async () => {
    try {
      const size = 512;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      const data = new Uint8Array(size * size * 4 * NAMES.length);
      const bmps = await Promise.all(
        NAMES.map(async (n) => {
          const r = await fetch(new URL(`textures/detail/${n}.webp`, document.baseURI).href);
          if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`);
          return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        }),
      );
      bmps.forEach((b, i) => {
        g.drawImage(b, 0, 0, size, size);
        data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
        b.close();
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
      console.warn('细节纹理加载失败：', e);
      return null;
    }
  })();
  return cache;
}

/**
 * 给（顶点色）MeshStandardMaterial 加三平面细节：layer = DETAIL 中的一层，strength 0..1。
 * 保留材质已有的 onBeforeCompile。
 */
export function addDetail(mat: THREE.MeshStandardMaterial, tex: THREE.DataArrayTexture, layer: number, strength = 1): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uDetail = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDWP;\nvarying vec3 vDWN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vDWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vDWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
vDWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDWN = normalize(mat3(modelMatrix) * objectNormal);
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDWP;
varying vec3 vDWN;
uniform highp sampler2DArray uDetail;
vec3 dNrm = vec3(0.0, 1.0, 0.0);
float dLum = 0.5;
void detailSample() {
  vec3 n = normalize(vDWN);
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float t = ${TILE[layer].toFixed(2)};
  vec4 sx = texture(uDetail, vec3(vDWP.zy / t, ${layer.toFixed(1)}));
  vec4 sy = texture(uDetail, vec3(vDWP.xz / t, ${layer.toFixed(1)}));
  vec4 sz = texture(uDetail, vec3(vDWP.xy / t, ${layer.toFixed(1)}));
  dLum = sx.b * w.x + sy.b * w.y + sz.b * w.z;
  vec3 tx = vec3(sx.rg * 2.0 - 1.0, 0.0); tx.y = -tx.y; tx.z = sqrt(max(0.0, 1.0 - dot(tx.xy, tx.xy)));
  vec3 ty = vec3(sy.rg * 2.0 - 1.0, 0.0); ty.y = -ty.y; ty.z = sqrt(max(0.0, 1.0 - dot(ty.xy, ty.xy)));
  vec3 tz = vec3(sz.rg * 2.0 - 1.0, 0.0); tz.y = -tz.y; tz.z = sqrt(max(0.0, 1.0 - dot(tz.xy, tz.xy)));
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  dNrm = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\ndetailSample();\ndiffuseColor.rgb *= 1.0 + (dLum - 0.5) * ${(0.9 * strength).toFixed(3)};`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nnormal = normalize(mix(normal, (viewMatrix * vec4(dNrm, 0.0)).xyz, ${(0.85 * strength).toFixed(3)}));`,
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|detail${layer}_${strength}`;
}
