// 旗子的图案：用画布按真实比例画（日本、挪威、美国、巴西、尼泊尔、纯橙色），做成贴图。
// 以前是 10×4 的网格按顶点上色：日之丸的圆糊成一团，挪威的十字是锯齿，美国国旗 13 道条纹画不出来，
// 尼泊尔的旗子是个红长方形（真的是两个叠起来的三角旗）。
// 没有画布的环境（单元测试）返回 null，调用方退回顶点色。

import * as THREE from 'three/webgpu';

/** 旗面的宽高比（宽 / 高） */
export function flagAspect(kind: string): number {
  return kind === 'no' ? 22 / 16 : kind === 'us' ? 1.9 : kind === 'br' ? 1.43 : kind === 'np' ? 1 / 1.219 : 1.5;
}

/** 尼泊尔国旗的轮廓（宽 = 1，从旗杆顶往下量，y 向下）：上面一个小三角、下面一个大三角 */
export const NEPAL_OUTLINE: Array<[number, number]> = [
  [0, 0],
  [1.0, 0.56],
  [0.36, 0.56],
  [1.0, 1.219],
  [0, 1.219],
];

/** 点在不在多边形里（射线法） */
export function inOutline(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, points = 5, inner = 0.4): void {
  g.beginPath();
  for (let k = 0; k < points * 2; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / points;
    const rr = k % 2 ? r * inner : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}

function draw(g: CanvasRenderingContext2D, kind: string, W: number, H: number): void {
  const fill = (c: string, x: number, y: number, w: number, h: number): void => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  if (kind === 'jp') {
    fill('#f4f2ee', 0, 0, W, H);
    g.fillStyle = '#bc002d';
    g.beginPath();
    g.arc(W / 2, H / 2, (H * 3) / 10, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'no') {
    // 22 × 16：十字中心偏向旗杆一侧（左 6、十字 4、右 12；上下各 6）
    const u = W / 22;
    fill('#ba0c2f', 0, 0, W, H);
    fill('#f4f2ee', 6 * u, 0, 4 * u, H);
    fill('#f4f2ee', 0, 6 * u, W, 4 * u);
    fill('#00205b', 7 * u, 0, 2 * u, H);
    fill('#00205b', 0, 7 * u, W, 2 * u);
  } else if (kind === 'us') {
    const s = H / 13;
    for (let k = 0; k < 13; k++) fill(k % 2 ? '#f4f2ee' : '#b22234', 0, k * s, W, s + 0.5);
    const cw = W * 0.4;
    const ch = s * 7;
    fill('#3c3b6e', 0, 0, cw, ch);
    g.fillStyle = '#f4f2ee';
    for (let row = 0; row < 9; row++) {
      const n = row % 2 ? 5 : 6;
      for (let c = 0; c < n; c++) {
        const x = (cw / 12) * (row % 2 ? 2 + c * 2 : 1 + c * 2);
        const y = (ch / 10) * (row + 1);
        star(g, x, y, ch * 0.045);
      }
    }
  } else if (kind === 'br') {
    fill('#009b3a', 0, 0, W, H);
    g.fillStyle = '#fedf00';
    g.beginPath();
    g.moveTo(W * 0.085, H / 2);
    g.lineTo(W / 2, H * 0.12);
    g.lineTo(W * 0.915, H / 2);
    g.lineTo(W / 2, H * 0.88);
    g.closePath();
    g.fill();
    g.fillStyle = '#002776';
    g.beginPath();
    g.arc(W / 2, H / 2, H * 0.25, 0, Math.PI * 2);
    g.fill();
    // 白色的弧带
    g.strokeStyle = '#f4f2ee';
    g.lineWidth = H * 0.035;
    g.beginPath();
    g.arc(W * 0.42, H * 0.85, H * 0.47, -Math.PI * 0.52, -Math.PI * 0.12);
    g.stroke();
    g.fillStyle = '#f4f2ee';
    for (let k = 0; k < 14; k++) star(g, W / 2 + Math.cos(k * 2.4) * H * 0.13, H * 0.56 + Math.sin(k * 1.7) * H * 0.1, H * 0.012);
  } else if (kind === 'np') {
    // 深蓝的边、绯红的旗面；上面白色的月亮、下面白色的太阳
    const poly = (inset: number): void => {
      g.beginPath();
      NEPAL_OUTLINE.forEach(([x, y], i) => {
        const px = x * W + (x < 0.5 ? inset : -inset * 1.6);
        const py = (y / 1.219) * H + (y < 0.1 ? inset * 1.6 : y > 1.2 ? -inset : 0);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.closePath();
      g.fill();
    };
    fill('#003893', 0, 0, W, H);
    g.fillStyle = '#dc143c';
    poly(W * 0.045);
    g.fillStyle = '#f4f2ee';
    // 月亮：一个白圆减掉一个红圆，上面一圈小光芒
    g.beginPath();
    g.arc(W * 0.26, H * 0.3, W * 0.1, 0, Math.PI);
    g.fill();
    g.fillStyle = '#dc143c';
    g.beginPath();
    g.arc(W * 0.26, H * 0.27, W * 0.085, 0, Math.PI);
    g.fill();
    g.fillStyle = '#f4f2ee';
    star(g, W * 0.26, H * 0.33, W * 0.06, 8, 0.55);
    star(g, W * 0.26, H * 0.74, W * 0.11, 12, 0.6);
  } else {
    fill(kind === 'orange' ? '#f07018' : '#f4f2ee', 0, 0, W, H);
  }
}

/** 画好的旗面贴图；没有画布（单元测试）时返回 null */
export function flagTexture(kind: string): THREE.CanvasTexture | null {
  try {
    const W = 512;
    const H = Math.round(W / flagAspect(kind));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d') as CanvasRenderingContext2D | null;
    if (!g || typeof g.arc !== 'function' || typeof g.beginPath !== 'function') return null;
    draw(g, kind, W, H);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } catch {
    return null;
  }
}
