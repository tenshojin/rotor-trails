// 回声：旋翼声碰到山壁再回来。左右各看几条线，往外走，碰到比飞机还高的地面就是一面墙。
// 只看地形：一秒算几次、几百次取高度，几乎不花时间。

const ANGLES = [Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3];
const NEAR = 30;
const FAR = 520;
const STEP = 22;
/** 比飞机低这么多的山顶也算墙：声音照样打得到 */
const SLACK = 8;

function along(ground: (x: number, z: number) => number, x: number, y: number, z: number, dir: number): number {
  const dx = Math.sin(dir);
  const dz = -Math.cos(dir);
  for (let d = NEAR; d <= FAR; d += STEP) {
    if (ground(x + dx * d, z + dz * d) > y - SLACK) return d;
  }
  return 0;
}

/**
 * 左边、右边最近的山壁有多远（米），没有就是 0。heading：弧度，0 朝北（-z），顺时针。
 * 每边取三条线里最近的那条
 */
export function wallDistances(ground: (x: number, z: number) => number, x: number, y: number, z: number, heading: number): [number, number] {
  const near = (side: number): number => {
    let best = 0;
    for (const a of ANGLES) {
      const d = along(ground, x, y, z, heading + side * a);
      if (d > 0 && (best === 0 || d < best)) best = d;
    }
    return best;
  };
  return [near(-1), near(1)];
}
