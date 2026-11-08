// 阴影贴图只留深度：每层阴影的渲染目标去掉颜色贴图（只有“透光阴影”才读它），4 层 4096² 省 268 MB 显存；
// 只有深度时尺寸取深度贴图的，改画质换阴影分辨率时深度贴图要跟着改
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { shadow } from 'three/tsl';
import { useDepthOnlyShadowMaps } from '../src/render/sunShadows';

type Target = { shadowMap: THREE.RenderTarget; depthTexture: THREE.DepthTexture };

function setup(transmitted: boolean): Target {
  useDepthOnlyShadowMaps();
  const light = new THREE.DirectionalLight();
  light.shadow.mapSize.set(4096, 4096);
  const node = shadow(light, light.shadow) as unknown as { setupRenderTarget(s: THREE.LightShadow, b: unknown): Target };
  const builder = {
    renderer: { shadowMap: { type: THREE.PCFShadowMap, transmitted }, reversedDepthBuffer: true },
    createRenderTarget: (w: number, h: number, o?: THREE.RenderTargetOptions) => new THREE.RenderTarget(w, h, o),
  };
  return node.setupRenderTarget(light.shadow, builder);
}

describe('阴影贴图只留深度', () => {
  it('没有颜色贴图，只有深度贴图', () => {
    const { shadowMap, depthTexture } = setup(false);
    expect(shadowMap.textures).toHaveLength(0);
    expect(shadowMap.depthTexture).toBe(depthTexture);
    expect(depthTexture.image.width).toBe(4096);
  });

  it('改阴影分辨率时深度贴图跟着改', () => {
    const { shadowMap, depthTexture } = setup(false);
    shadowMap.setSize(4096, 4096);
    shadowMap.setSize(2048, 2048);
    expect(depthTexture.image.width).toBe(2048);
    expect(depthTexture.image.height).toBe(2048);
    expect(shadowMap.width).toBe(2048);
  });

  it('打开透光阴影时保留颜色贴图', () => {
    const { shadowMap } = setup(true);
    expect(shadowMap.textures).toHaveLength(1);
  });
});
