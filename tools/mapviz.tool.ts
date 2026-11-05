// 地图俯视图与航线净空报告：npx vitest run --config vitest.tools.config.ts tools/mapviz.tool.ts --silent=false
// 环境变量 MAP=japan 只生成一张。输出到 tmp/maps/<id>.png
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAPS } from '../src/maps/index';
import '../src/maps/all';
import { generateWorld } from '../src/world/worldgen';
import { checkRoutes } from '../src/sim/routeCheck';
import { routePolylines } from '../src/sim/nav';
import { Raster, encodePNG } from './png';

const only = process.env.MAP;

it('mapviz', async () => {
  const out = path.resolve('tmp/maps');
  fs.mkdirSync(out, { recursive: true });
  for (const definition of MAPS) {
    if (only && definition.id !== only) continue;
    const t0 = Date.now();
    const world = await generateWorld(definition, false);
    const map = world.map;
    const genMs = Date.now() - t0;
    if (process.env.PROBE) {
      for (const p of process.env.PROBE.split(';')) {
        const [px, pz] = p.split(',').map(Number);
        console.log(`probe (${px},${pz}) h=${world.terrain.heightAt(px, pz).toFixed(1)} slope=${world.terrain.slopeAt(px, pz).toFixed(2)}`);
      }
    }
    const N = 1024;
    const R = new Raster(N, N);
    const T = world.terrain;
    const k = N / map.size;
    const toPx = (x: number, z: number): [number, number] => [(x + map.size / 2) * k, (z + map.size / 2) * k];
    for (let py = 0; py < N; py++)
      for (let px = 0; px < N; px++) {
        const x = -T.half + ((px + 0.5) / N) * T.size;
        const z = -T.half + ((py + 0.5) / N) * T.size;
        const h = T.heightAt(x, z);
        const e = 8;
        const dx = T.heightAt(x + e, z) - T.heightAt(x - e, z);
        const dz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
        const shade = Math.max(0.3, Math.min(1.3, 0.9 - (dx * 0.7 + dz * 0.9) / (2 * e)));
        let c: [number, number, number];
        if (map.waterLevel !== null && h < map.waterLevel) {
          const d = Math.min(1, (map.waterLevel - h) / 30);
          c = [40 - 20 * d, 120 - 60 * d, 150 - 40 * d];
        } else {
          const t = Math.min(1, Math.max(0, (h - T.minH) / (T.maxH - T.minH + 1)));
          c = [90 + 140 * t, 130 + 90 * t, 70 + 140 * t];
          if (T.slopeAt(x, z) > map.biome.rockSlope) c = [130, 120, 110];
          if (h > map.biome.snowLine) c = [235, 240, 245];
        }
        R.set(px, py, c[0] * shade, c[1] * shade, c[2] * shade);
        // 等高线
        if (map.waterLevel === null || h >= map.waterLevel) {
          const step = 50;
          if (Math.floor(h / step) !== Math.floor(T.heightAt(x + T.size / N, z) / step)) R.set(px, py, 40, 40, 40, 90);
        }
      }
    for (let i = 0; i < world.trees.count; i += 3) {
      const [px, py] = toPx(world.trees.x[i], world.trees.z[i]);
      R.set(px, py, 20, 70, 25, 160);
    }
    for (const c of world.colliders) {
      if (c.tag.kind === 'pad') continue;
      const [px, py] = toPx(c.c[0], c.c[2]);
      R.set(px, py, 200, 60, 200);
    }
    for (const z of map.windZones) {
      const [ax, ay] = toPx(z.a[0], z.a[1]);
      const [bx, by] = toPx(z.b[0], z.b[1]);
      R.line(ax, ay, bx, by, [120, 200, 255]);
      R.circle(ax, ay, Math.round(z.radius * k), [120, 200, 255]);
      R.circle(bx, by, Math.round(z.radius * k), [120, 200, 255]);
    }
    const spawnPad = map.pads.find((p) => p.id === map.spawn.padId)!;
    const lines = routePolylines(map, spawnPad.pos);
    const cols: Array<[number, number, number]> = [
      [0, 230, 255],
      [255, 140, 0],
      [255, 255, 0],
      [255, 80, 200],
    ];
    const pathIdx = new Map<string, number>();
    for (const l of lines) {
      const ci = pathIdx.get(`${l.leg}`) ?? 0;
      pathIdx.set(`${l.leg}`, ci + 1);
      for (let i = 1; i < l.points.length; i++) {
        const [x0, y0] = toPx(l.points[i - 1].pos[0], l.points[i - 1].pos[2]);
        const [x1, y1] = toPx(l.points[i].pos[0], l.points[i].pos[2]);
        R.line(x0, y0, x1, y1, cols[ci % cols.length], 2);
      }
    }
    for (const n of map.nodes) {
      const [px, py] = toPx(n.pos[0], n.pos[2]);
      R.circle(px, py, 4, n.checkpoint ? [255, 255, 255] : [0, 0, 0]);
    }
    for (const p of map.pads) {
      const [px, py] = toPx(p.pos[0], p.pos[2]);
      const s = Math.max(3, Math.round((p.size / 2) * k));
      const c: [number, number, number] = p.kind === 'repair' ? [60, 255, 90] : p.kind === 'final' ? [60, 120, 255] : p.kind === 'start' ? [255, 255, 255] : [255, 120, 30];
      for (let i = -s; i <= s; i++) {
        R.set(px + i, py - s, ...c);
        R.set(px + i, py + s, ...c);
        R.set(px - s, py + i, ...c);
        R.set(px + s, py + i, ...c);
      }
    }
    for (const p of map.pickups) {
      const [px, py] = toPx(p.pos[0], p.pos[2]);
      R.circle(px, py, 4, p.kind === 'boost' ? [255, 220, 0] : p.kind === 'shield' ? [60, 160, 255] : [60, 255, 120], true);
    }
    for (const o of [...map.mission.main, ...map.mission.optional]) {
      const pts = o.kind === 'inspect' ? o.points.map((p) => p.pos) : [o.kind === 'hover' ? o.center : o.approach];
      for (const p of pts) {
        const [px, py] = toPx(p[0], p[2]);
        R.circle(px, py, 7, map.mission.main.includes(o) ? [80, 255, 140] : [200, 140, 255]);
      }
    }
    const issues = checkRoutes(world, spawnPad.pos);
    for (const is of issues) {
      const [px, py] = toPx(is.x, is.z);
      R.line(px - 4, py - 4, px + 4, py + 4, [255, 0, 0], 2);
      R.line(px - 4, py + 4, px + 4, py - 4, [255, 0, 0], 2);
    }
    fs.writeFileSync(path.join(out, `${map.id}.png`), encodePNG(N, N, R.data));
    const worst = issues.slice(0, 12).map((i) => `  leg${i.leg}/${i.path} (${i.x.toFixed(0)},${i.z.toFixed(0)}) y=${i.y.toFixed(0)} obst=${i.obstacle.toFixed(0)} need=${i.need.toFixed(0)}`);
    let total = 0;
    for (const l of lines.filter((l) => l.path.tag === 'main' || l.path.tag === 'safe' || l.leg >= 0)) {
      for (let i = 1; i < l.points.length; i++) total += Math.hypot(l.points[i].pos[0] - l.points[i - 1].pos[0], l.points[i].pos[2] - l.points[i - 1].pos[2]);
    }
    console.log(
      `[${map.id}] gen ${genMs} ms · h ${T.minH.toFixed(0)}..${T.maxH.toFixed(0)} · trees ${world.trees.count} · colliders ${world.colliders.length} · route issues ${issues.length}\n${worst.join('\n')}`,
    );
  }
});
