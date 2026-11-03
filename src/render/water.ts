// 水面：PBR 材质 + 动态法线（多组波浪 + 噪声，方向随风）、按水深着色、岸边泡沫、雨点涟漪。

import * as THREE from 'three';
import type { MapDef } from '../maps/types';
import { getNoiseTexture } from './textures';

export class WaterView {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(map: MapDef, depthTex: THREE.Texture) {
    const level = map.waterLevel ?? 0;
    const size = map.size * 3.4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      uTime: { value: 0 },
      uNoise: { value: getNoiseTexture() },
      uDepth: { value: depthTex },
      uMapSize: { value: map.size },
      uDeep: { value: new THREE.Color().setHex(map.biome.waterDeep) },
      uShallow: { value: new THREE.Color().setHex(map.biome.waterShallow) },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWave: { value: 0.5 },
      uRain: { value: 0 },
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.92, envMapIntensity: 1.0 });
    const U = this.uniforms;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
varying vec3 vWPos;
uniform float uTime, uMapSize, uWave, uRain;
uniform sampler2D uNoise, uDepth;
uniform vec3 uDeep, uShallow;
uniform vec2 uWind;
float wDepth = 1.0;
float wFoam = 0.0;`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `{
  vec2 muv = vWPos.xz / uMapSize + 0.5;
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  wDepth = mix(1.0, texture2D(uDepth, muv).r, inside);
  vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 0.55, wDepth));
  float fn = texture2D(uNoise, vWPos.xz * 0.06 + uWind * uTime * 0.02).g;
  wFoam = (1.0 - smoothstep(0.0, 0.05 + fn * 0.05, wDepth)) * inside;
  c = mix(c, vec3(0.92, 0.95, 0.96), wFoam * 0.75);
  diffuseColor.rgb *= c;
  diffuseColor.a *= mix(0.55, 0.95, smoothstep(0.0, 0.25, wDepth));
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
{
  vec2 w = normalize(uWind + vec2(0.0001));
  vec2 p = vWPos.xz;
  float t = uTime;
  vec2 o1 = w * t * 0.9;
  vec2 o2 = vec2(-w.y, w.x) * t * 0.5;
  float a = texture2D(uNoise, (p + o1 * 6.0) * 0.012).r;
  float b = texture2D(uNoise, (p - o2 * 4.0) * 0.031).g;
  float c2 = texture2D(uNoise, (p + o1 * 3.0) * 0.09 + 0.31).g;
  float h = a * 0.5 + b * 0.35 + c2 * 0.15;
  h += uRain * 0.25 * texture2D(uNoise, p * 0.7 + vec2(t * 0.37, -t * 0.53)).b;
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * (0.6 + uWave * 1.6));
}`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness + wFoam * 0.6 + uRain * 0.06;');
    };
    this.material.customProgramCacheKey = () => 'water-v1';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  update(t: number, windX: number, windZ: number, windSpeed: number, rain: number): void {
    this.uniforms.uTime.value = t;
    (this.uniforms.uWind.value as THREE.Vector2).set(windX, windZ);
    this.uniforms.uWave.value = Math.min(1, windSpeed / 14);
    this.uniforms.uRain.value = rain;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
