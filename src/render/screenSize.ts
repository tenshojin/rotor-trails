// 远处的小东西画不画：镜头每帧记下“1 米远处 1 米长占几个像素”（画面高度 / (2·tan(半视角))）。
// 风向袋、旗子、补给无人机的机身这类几米大的东西，远到不足 1 个像素就不画：画面上看不出来，
// three.js 却要为每个物体付一次提交的开销（主线程每个物体十几微秒）。
// 按像素算，所以长焦镜头和高分辨率屏幕会画得更远。

import type * as THREE from 'three/webgpu';

export const SCREEN = { pxPerMeter: 620 };

/** 每帧镜头更新之后调用。viewHeight = 画面高度（像素） */
export function updateScreenScale(cam: THREE.PerspectiveCamera, viewHeight: number): void {
  SCREEN.pxPerMeter = (viewHeight * cam.zoom) / (2 * Math.tan((cam.fov * Math.PI) / 360));
}

/** 长 size 米的东西在 d 米外约占几个像素 */
export function pixelSize(size: number, d: number): number {
  return (size * SCREEN.pxPerMeter) / Math.max(d, 1e-3);
}

/** 不足 1 个像素就不画，超过 1.4 个像素再画回来；中间保持原样，不在门槛上来回闪 */
export function bigEnough(shown: boolean, size: number, d: number): boolean {
  const px = pixelSize(size, d);
  return shown ? px >= 1 : px >= 1.4;
}
