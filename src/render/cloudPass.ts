// 体积云的渲染通道：半分辨率光线步进 + 时间累积，结果写到一张纹理上，天空穹顶直接采样。
//
// 云都在几公里之外，画面上变化很慢：每帧把上一帧的结果按相机转动重投影过来，和这一帧（起点抖动过的）步进结果混合，
// 相当于十来帧的采样累积在一起，云边又软又干净，不会有逐像素的抖动颗粒；分辨率减半后步进次数还能加倍，总开销反而更小。

import * as THREE from 'three/webgpu';
import { float, Fn, mix, normalize, step, texture, uniform, uv, vec2, vec4 } from 'three/tsl';

const SCALE = 0.5;
/** 云最多算这么多个像素：大屏幕（外接 4K、2560 宽）按比例再缩小一点。云是软的、又有时间累积，看不出来，
 * 光线步进的开销却和像素数成正比（2560×1440 下关掉体积云能多 40% 帧率） */
const PIXEL_BUDGET = 520_000;
/** 历史帧的权重：越大越干净，但相机快速移动时云的更新越慢 */
const HISTORY = 0.9;

const _size = /*@__PURE__*/ new THREE.Vector2();

export class CloudPass {
  /** 天空穹顶采样的纹理节点（每帧指向最新的结果） */
  readonly tex: THREE.TextureNode;
  private readonly rts: [THREE.RenderTarget, THREE.RenderTarget];
  private readonly material = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh(this.material);
  /** 上一帧的结果（只有一个材质：着色器很大，编译一次就够，每帧换它指向的纹理） */
  private readonly hist: THREE.TextureNode;
  private readonly camWorld = uniform(new THREE.Matrix4());
  private readonly projInv = uniform(new THREE.Matrix4());
  private readonly prevView = uniform(new THREE.Matrix4());
  private readonly prevProj = uniform(new THREE.Matrix4());
  private readonly history = uniform(0);
  private cur = 0;
  /** 接下来几帧不用历史（刚开始、瞬移之后） */
  private warm = 0;
  private readonly lastPos = new THREE.Vector3(1e9, 0, 0);

  constructor(march: (d: THREE.Node<'vec3'>) => THREE.Node<'vec4'>) {
    const mk = (name: string) => {
      const rt = new THREE.RenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType });
      rt.texture.name = name;
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.rts = [mk('CloudA'), mk('CloudB')];
    this.tex = texture(this.rts[0].texture);
    this.hist = texture(this.rts[1].texture);
    this.material.name = 'CloudMarch';
    this.material.fragmentNode = Fn(() => {
      const uvN = uv();
      const ndc = vec2(uvN.x, uvN.y.oneMinus()).mul(2.0).sub(1.0);
      const vp = this.projInv.mul(vec4(ndc, 0.5, 1.0));
      const vd = normalize(vp.xyz.div(vp.w));
      const wd = normalize(this.camWorld.mul(vec4(vd, 0.0)).xyz);
      const cl = march(wd);
      // 云很远，重投影时只看相机转动
      const pv = this.prevView.mul(vec4(wd, 0.0)).xyz;
      const pc = this.prevProj.mul(vec4(pv, 1.0));
      const pn = pc.xy.div(pc.w);
      const puv = vec2(pn.x, pn.y.negate()).mul(0.5).add(0.5);
      const inside = step(pv.z, 0.0).mul(step(0.0, puv.x)).mul(step(puv.x, 1.0)).mul(step(0.0, puv.y)).mul(step(puv.y, 1.0));
      return mix(cl, this.hist.sample(puv), float(this.history).mul(inside));
    })();
  }

  render(r: THREE.WebGPURenderer, cam: THREE.PerspectiveCamera): void {
    r.getSize(_size);
    const k = Math.min(SCALE, Math.sqrt(PIXEL_BUDGET / Math.max(1, _size.x * _size.y)));
    const w = Math.max(1, Math.round(_size.x * k));
    const h = Math.max(1, Math.round(_size.y * k));
    if (this.rts[0].width !== w || this.rts[0].height !== h) {
      this.rts[0].setSize(w, h);
      this.rts[1].setSize(w, h);
      this.warm = 2;
    }
    cam.updateMatrixWorld();
    // 瞬移（复位、切换视角）时历史不再可信
    if (this.lastPos.distanceToSquared(cam.position) > 400 * 400) this.warm = 2;
    this.lastPos.copy(cam.position);
    this.camWorld.value.copy(cam.matrixWorld);
    this.projInv.value.copy(cam.projectionMatrixInverse);
    this.history.value = this.warm > 0 ? 0 : HISTORY;
    if (this.warm > 0) this.warm--;
    this.hist.value = this.rts[1 - this.cur].texture;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rts[this.cur]);
    try {
      this.quad.render(r);
    } finally {
      r.setRenderTarget(prev);
    }
    this.tex.value = this.rts[this.cur].texture;
    this.cur = 1 - this.cur;
    this.prevView.value.copy(cam.matrixWorldInverse);
    this.prevProj.value.copy(cam.projectionMatrix);
  }

  /** A lighting change invalidates both accumulated cloud frames. */
  reset(): void {
    this.warm = 2;
  }

  dispose(): void {
    for (const rt of this.rts) rt.dispose();
    this.material.dispose();
  }
}
