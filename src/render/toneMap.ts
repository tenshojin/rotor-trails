// 色调映射：把线性 HDR 画面压到显示器能显示的范围。
//
// 用的是《GT7》的做法（Polyphony Digital 在 SIGGRAPH 2025 公开的算法和示例代码）：
//   · 一条有脚（暗部）有肩（亮部）的曲线，暗部压出层次，亮部慢慢收住，不会一下子白掉；
//   · 亮度和色度分开处理：只对三个通道分别做曲线，亮的颜色会偏色（蓝天变青、夕阳变黄）；
//     只在感知均匀的 ICtCp 空间里做，又太“干净”。这里按比例把两种结果混起来；
//   · 特别亮的颜色往白色收（太阳、高光），和眼睛、相机的感觉一样。
// 之前用的 Khronos Neutral 是给商品展示设计的（尽量不改物体本身的颜色），户外的太阳、天空这种大动态范围，
// Khronos 自己也建议用电影式的映射。
//
// 下面的曲线和颜色空间转换由 gt7_tone_mapping.cpp 改写成 TSL：
// MIT License. Copyright (c) 2025 Polyphony Digital Inc.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of
// the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import type * as THREE from 'three/webgpu';
import { exp, exp2, float, Fn, log2, max, min, mix, pow, smoothstep, step, vec3 } from 'three/tsl';

type V3 = THREE.Node<'vec3'>;
type F1 = THREE.Node<'float'>;

/** 帧缓冲里 1.0 对应多少尼特 */
const REFERENCE = 100;
/** 标准动态范围显示器上，1.0 算多少尼特（GT 的约定） */
const PAPER_WHITE = 250;
const PEAK = PAPER_WHITE / REFERENCE;

// 曲线参数（《GT7》的默认值）
const ALPHA = 0.25;
const MID = 0.538;
const LINEAR = 0.444;
const TOE = 1.28;
const K = (LINEAR - 1) / (ALPHA - 1);
const KA = PEAK * LINEAR + PEAK * K;
const KB = -PEAK * K * Math.exp(LINEAR / K);
const KC = -1 / (K * PEAK);

const BLEND = 0.6;
const FADE_START = 0.98;
const FADE_END = 1.16;

// ST-2084（PQ）
const M1 = 0.1593017578125;
const M2 = 78.84375;
const C1 = 0.8359375;
const C2 = 18.8515625;
const C3 = 18.6875;
const PQ_MAX = 10000;

/** 帧缓冲线性值 → PQ 编码 */
function toPQ(v: F1): F1 {
  const ym = pow(max(v, 0).mul(REFERENCE / PQ_MAX), M1);
  return exp2(log2(ym.mul(C2).add(C1)).sub(log2(ym.mul(C3).add(1))).mul(M2));
}

/** PQ 编码 → 帧缓冲线性值 */
function fromPQ(n: F1): F1 {
  const np = pow(min(max(n, 0), 1), 1 / M2);
  const l = max(np.sub(C1), 0).div(float(C2).sub(np.mul(C3)));
  return pow(l, 1 / M1).mul(PQ_MAX / REFERENCE);
}

/** 线性 Rec.2020 → ICtCp */
function rgbToICtCp(c: V3): V3 {
  const l = toPQ(c.x.mul(1688).add(c.y.mul(2146)).add(c.z.mul(262)).div(4096)).toVar();
  const m = toPQ(c.x.mul(683).add(c.y.mul(2951)).add(c.z.mul(462)).div(4096)).toVar();
  const s = toPQ(c.x.mul(99).add(c.y.mul(309)).add(c.z.mul(3688)).div(4096)).toVar();
  return vec3(l.add(m).mul(0.5), l.mul(6610).sub(m.mul(13613)).add(s.mul(7003)).div(4096), l.mul(17933).sub(m.mul(17390)).sub(s.mul(543)).div(4096));
}

/** ICtCp → 线性 Rec.2020 */
function iCtCpToRgb(c: V3): V3 {
  const l = fromPQ(c.x.add(c.y.mul(0.00860904)).add(c.z.mul(0.11103))).toVar();
  const m = fromPQ(c.x.sub(c.y.mul(0.00860904)).sub(c.z.mul(0.11103))).toVar();
  const s = fromPQ(c.x.add(c.y.mul(0.560031)).sub(c.z.mul(0.320627))).toVar();
  return max(vec3(l.mul(3.43661).sub(m.mul(2.50645)).add(s.mul(0.0698454)), l.mul(-0.79133).add(m.mul(1.9836)).sub(s.mul(0.192271)), l.mul(-0.0259499).sub(m.mul(0.0989137)).add(s.mul(1.12486))), vec3(0));
}

function curve(x: F1): F1 {
  const v = max(x, 0).toVar();
  const wl = smoothstep(0, MID, v);
  const toe = pow(v.div(MID), TOE).mul(MID);
  const low = mix(toe, v, wl);
  const shoulder = exp(v.mul(KC)).mul(KB).add(KA);
  return mix(low, shoulder, step(LINEAR * PEAK, v));
}

const R709_TO_2020 = (c: V3): V3 =>
  vec3(c.x.mul(0.6274).add(c.y.mul(0.3293)).add(c.z.mul(0.0433)), c.x.mul(0.0691).add(c.y.mul(0.9195)).add(c.z.mul(0.0114)), c.x.mul(0.0164).add(c.y.mul(0.088)).add(c.z.mul(0.8956)));
const R2020_TO_709 = (c: V3): V3 =>
  vec3(c.x.mul(1.6605).sub(c.y.mul(0.5876)).sub(c.z.mul(0.0728)), c.x.mul(-0.1246).add(c.y.mul(1.1329)).sub(c.z.mul(0.0083)), c.x.mul(-0.0182).sub(c.y.mul(0.1006)).add(c.z.mul(1.1187)));

/** 线性 Rec.709（已乘曝光）→ 线性 Rec.709，0..1 */
export const gt7ToneMapping = Fn(([input]: [V3]) => {
  const rgb = max(R709_TO_2020(vec3(input)), vec3(0)).toVar();
  const ucs = rgbToICtCp(rgb).toVar();
  const skewed = vec3(curve(rgb.x), curve(rgb.y), curve(rgb.z)).toVar();
  const skewedUcs = rgbToICtCp(skewed).toVar();
  const targetI = toPQ(float(PEAK * ((1688 + 2146 + 262) / 4096)));
  const chroma = float(1).sub(smoothstep(FADE_START, FADE_END, ucs.x.div(targetI)));
  const scaled = iCtCpToRgb(vec3(skewedUcs.x, ucs.y.mul(chroma), ucs.z.mul(chroma)));
  const out = min(mix(skewed, scaled, BLEND), vec3(PEAK)).mul(1 / PEAK);
  return max(R2020_TO_709(out), vec3(0));
});
