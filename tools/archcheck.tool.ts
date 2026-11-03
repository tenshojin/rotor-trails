// 校验岩拱碰撞体方向与网格一致：npx vitest run --config vitest.tools.config.ts tools/archcheck.tool.ts --silent=false
import { it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { PropBuilder } from '../src/world/propBuilder';
import { PROP_FNS } from '../src/world/props/index';
import { Rng } from '../src/core/noise';

it('arch colliders follow the arch mesh', () => {
  for (const rot of [0, 0.7, -1.2]) {
    const B = new PropBuilder(true);
    B.at(100, 50, -30, rot, 1);
    PROP_FNS.arch(B, { type: 'arch', pos: [100, 50, -30], p: { span: 80, rise: 60, thick: 12, depth: 16 } }, new Rng(1), undefined as never);
    // 网格顶点范围（世界坐标）
    let maxDistFromPlane = 0;
    const spanDir = new Vector3(Math.cos(rot), 0, -Math.sin(rot));
    for (const b of B.batches.values()) {
      for (let i = 0; i < b.pos.length; i += 3) {
        const v = new Vector3(b.pos[i] - 100, b.pos[i + 1] - 50, b.pos[i + 2] + 30);
        const along = v.dot(spanDir);
        const perp = v.clone().addScaledVector(spanDir, -along);
        perp.y = 0;
        maxDistFromPlane = Math.max(maxDistFromPlane, perp.length());
      }
    }
    let worst = 0;
    for (const c of B.colliders) {
      if (c.kind !== 'boxq') continue;
      const q = new Quaternion(c.q[0], c.q[1], c.q[2], c.q[3]);
      const zAxis = new Vector3(0, 0, 1).applyQuaternion(q);
      const xAxis = new Vector3(1, 0, 0).applyQuaternion(q);
      const center = new Vector3(c.c[0] - 100, c.c[1] - 50, c.c[2] + 30);
      // 长轴应位于拱平面内（垂直于拱的厚度方向），宽轴（x）应垂直于拱平面
      const zOut = Math.abs(zAxis.dot(new Vector3().crossVectors(spanDir, new Vector3(0, 1, 0)).normalize()));
      const xIn = Math.abs(xAxis.dot(spanDir));
      const cAlong = center.dot(spanDir);
      const cPerp = center.clone().addScaledVector(spanDir, -cAlong);
      cPerp.y = 0;
      worst = Math.max(worst, zOut, xIn, cPerp.length() / 10);
    }
    console.log(`rot=${rot} meshHalfDepth=${maxDistFromPlane.toFixed(1)} worstMisalign=${worst.toFixed(3)} colliders=${B.colliders.length}`);
    expect(worst).toBeLessThan(0.05);
  }
});
