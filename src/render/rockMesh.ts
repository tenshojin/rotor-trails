// 程序岩石（海蚀柱、岩拱、石柱、礁石）的几何精修：原始网格只有几十个三角形，棱角分明，一看就是多面体。
// 这里把长边细分到几米一段，沿法线加两层噪声起伏，再算平滑法线——轮廓有了岩石的凹凸，光照也不再是一块块平面。
// 细分只看每条边自身的长度，共用一条边的两个三角形切法相同，不会裂开。

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 三维值噪声（-1..1） */
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const p = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return (
    l(
      l(l(p(0, 0, 0), p(1, 0, 0), sx), l(p(0, 1, 0), p(1, 1, 0), sx), sy),
      l(l(p(0, 0, 1), p(1, 0, 1), sx), l(p(0, 1, 1), p(1, 1, 1), sx), sy),
      sz,
    ) *
      2 -
    1
  );
}

type V = [number, number, number, number, number, number]; // 位置 + 颜色

const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2, (a[5] + b[5]) / 2];
const len2 = (a: V, b: V) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export interface RockMesh {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
}

export function refineRock(pos: ArrayLike<number>, col: ArrayLike<number>, maxEdge = 3.2, maxTris = 900000): RockMesh {
  // 三角形太多时放宽细分长度
  let edge = maxEdge;
  const nTri = pos.length / 9;
  if (nTri * 8 > maxTris) edge *= 1.6;
  const L2 = edge * edge;
  const out: V[] = [];
  const emit = (a: V, b: V, c: V, depth: number): void => {
    const s0 = len2(a, b) > L2;
    const s1 = len2(b, c) > L2;
    const s2 = len2(c, a) > L2;
    if (depth >= 7 || (!s0 && !s1 && !s2)) {
      out.push(a, b, c);
      return;
    }
    const d = depth + 1;
    const ab = s0 ? mid(a, b) : a;
    const bc = s1 ? mid(b, c) : b;
    const ca = s2 ? mid(c, a) : c;
    if (s0 && s1 && s2) {
      emit(a, ab, ca, d);
      emit(ab, b, bc, d);
      emit(ca, bc, c, d);
      emit(ab, bc, ca, d);
    } else if (s0 && s1) {
      emit(ab, b, bc, d);
      emit(a, ab, bc, d);
      emit(a, bc, c, d);
    } else if (s1 && s2) {
      emit(bc, c, ca, d);
      emit(a, b, bc, d);
      emit(a, bc, ca, d);
    } else if (s2 && s0) {
      emit(ca, a, ab, d);
      emit(ab, b, c, d);
      emit(ab, c, ca, d);
    } else if (s0) {
      emit(a, ab, c, d);
      emit(ab, b, c, d);
    } else if (s1) {
      emit(a, b, bc, d);
      emit(a, bc, c, d);
    } else {
      emit(a, b, ca, d);
      emit(b, c, ca, d);
    }
  };
  for (let i = 0; i < pos.length; i += 9) {
    const v = (k: number): V => [pos[i + k], pos[i + k + 1], pos[i + k + 2], col[i + k], col[i + k + 1], col[i + k + 2]];
    emit(v(0), v(3), v(6), 0);
  }
  // 焊接相同位置的顶点，求平滑法线
  const key = (v: V) => `${Math.round(v[0] * 200)},${Math.round(v[1] * 200)},${Math.round(v[2] * 200)}`;
  const ids = new Map<string, number>();
  const idx = new Int32Array(out.length);
  const nrm: number[] = [];
  const smooth = (): void => {
    nrm.length = 0;
    for (let i = 0; i < ids.size * 3; i++) nrm.push(0);
    for (let t = 0; t < out.length; t += 3) {
      const a = out[t];
      const b = out[t + 1];
      const c = out[t + 2];
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const j = idx[t + k] * 3;
        nrm[j] += nx;
        nrm[j + 1] += ny;
        nrm[j + 2] += nz;
      }
    }
  };
  out.forEach((v, i) => {
    const k = key(v);
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
    }
    idx[i] = id;
  });
  smooth();
  // 沿法线起伏：两层噪声（十几米的大块 + 三四米的小块），同一焊接点只算一次
  const moved = new Float32Array(ids.size * 3);
  const done = new Uint8Array(ids.size);
  for (let i = 0; i < out.length; i++) {
    const id = idx[i];
    if (!done[id]) {
      done[id] = 1;
      const v = out[i];
      const j = id * 3;
      const l = 1 / (Math.hypot(nrm[j], nrm[j + 1], nrm[j + 2]) || 1);
      const a = noise3(v[0] / 14, v[1] / 9, v[2] / 14);
      const b = noise3(v[0] / 4.1 + 7, v[1] / 3.1, v[2] / 4.1);
      const d = a * 1.5 + b * 0.55;
      moved[j] = v[0] + nrm[j] * l * d;
      moved[j + 1] = v[1] + nrm[j + 1] * l * d;
      moved[j + 2] = v[2] + nrm[j + 2] * l * d;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const j = idx[i] * 3;
    const v = out[i];
    out[i] = [moved[j], moved[j + 1], moved[j + 2], v[3], v[4], v[5]];
  }
  smooth();
  const P = new Float32Array(out.length * 3);
  const N = new Float32Array(out.length * 3);
  const C = new Float32Array(out.length * 3);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    const j = idx[i] * 3;
    const l = 1 / (Math.hypot(nrm[j], nrm[j + 1], nrm[j + 2]) || 1);
    P.set([v[0], v[1], v[2]], i * 3);
    N.set([nrm[j] * l, nrm[j + 1] * l, nrm[j + 2] * l], i * 3);
    C.set([v[3], v[4], v[5]], i * 3);
  }
  return { pos: P, nor: N, col: C };
}
