// 飞行参数探针：打印各种机动下的实际数值，用于调校。
// 运行：npx vitest run --config vitest.tools.config.ts tools/flightprobe.tool.ts --silent=false
import { it } from 'vitest';
import { FLAT } from '../tests/testmap';
import { run, sessionFor } from '../tests/helpers';
import type { GameSession } from '../src/sim/session';
import type { AssistId } from '../src/config/flight';

const R2D = 180 / Math.PI;

function line(s: GameSession, tag: string) {
  const t = s.flight.telemetry;
  console.log(
    `${tag.padEnd(20)} t=${s.t.toFixed(1)} gs=${s.groundSpeed.toFixed(1)} vs=${s.body.vel.y.toFixed(2)} y=${s.body.pos.y.toFixed(1)} p=${(t.pitch * R2D).toFixed(1)} r=${(t.roll * R2D).toFixed(1)} hdg=${(t.heading * R2D).toFixed(0)} c=${t.collective.toFixed(2)} P=${(t.powerUsed / 1000).toFixed(0)}/${(t.powerAvail / 1000).toFixed(0)} lim=${t.torqueLimited ? 1 : 0} x=${s.body.pos.x.toFixed(0)} z=${s.body.pos.z.toFixed(0)}`,
  );
}

for (const assist of ['novice', 'standard', 'challenge'] as AssistId[]) {
  it(`probe ${assist}`, async () => {
    const s = await sessionFor(FLAT, assist, 'calm');
    console.log(`==== ${assist} ====`);
    if (assist === 'challenge') {
      run(s, 2.4, { vertical: 1 });
      line(s, 'coll up 2.4s');
      for (let i = 0; i < 40; i++) {
        const v = s.body.vel.y;
        const tgt = s.body.pos.y < 120 ? 4 : 0;
        run(s, 0.2, { vertical: v < tgt - 0.6 ? 1 : v > tgt + 0.6 ? -1 : 0 });
        run(s, 0.3, {});
      }
      line(s, 'manual climb');
    } else {
      run(s, 1, { vertical: 1 });
      line(s, 'climb 1s');
      run(s, 5, { vertical: 1 });
      line(s, 'climb 6s');
      run(s, 14, { vertical: 1 });
      line(s, 'climb 20s');
      run(s, 3, {});
      line(s, 'release 3s');
    }
    const pitchHold = (sec: number) => {
      // 挑战模式：用短促的 W 建立约 -12° 姿态
      for (let i = 0; i < sec * 4; i++) {
        const p = s.flight.telemetry.pitch * R2D;
        run(s, 0.25, { pitch: p > -12 ? 1 : p < -16 ? -1 : 0 });
      }
    };
    const W = (sec: number) => (assist === 'challenge' ? pitchHold(sec) : run(s, sec, { pitch: 1 }));
    W(4);
    line(s, 'W 4s');
    W(8);
    line(s, 'W 12s');
    W(15);
    line(s, 'W 27s');
    W(20);
    line(s, 'W 47s');
    run(s, 5, {});
    line(s, 'release 5s');
    run(s, 10, {});
    line(s, 'release 15s');
    const z0 = s.body.pos.z;
    run(s, 10, { turn: 1 });
    line(s, 'D 10s');
    run(s, 3, {});
    line(s, 'release 3s');
    void z0;
    run(s, 6, { pitch: -1 });
    line(s, 'S 6s');
    run(s, 6, { pitch: -1 });
    line(s, 'S 12s');
    s.toggleHover();
    run(s, 10, {});
    line(s, 'hover 10s');
    run(s, 15, {});
    line(s, 'hover 25s');
    run(s, 10, { vertical: -1 });
    line(s, 'hover desc 10s');
    run(s, 50, { vertical: -1 });
    line(s, 'hover desc 60s');
    run(s, 5, {});
    line(s, 'after');
    console.log('touchdown', JSON.stringify(s.lastTouchdown?.metrics));
    console.log('durability', s.damage.durability.toFixed(1), 'events', s.drainEvents().map((e) => e.type).join(','));
    s.dispose();
  });
}

it('wind drift & hover in 10 m/s crosswind', async () => {
  const s = await sessionFor(FLAT, 'standard', 'east10');
  run(s, 8, { vertical: 1 });
  run(s, 3, {});
  line(s, 'airborne in wind');
  run(s, 10, {});
  line(s, 'no input 10s');
  s.toggleHover();
  run(s, 20, {});
  line(s, 'hover 20s');
  const x0 = s.body.pos.x;
  const z0 = s.body.pos.z;
  run(s, 20, {});
  line(s, 'hover 40s');
  console.log('hover drift in 20s:', Math.hypot(s.body.pos.x - x0, s.body.pos.z - z0).toFixed(2), 'm');
  s.dispose();
});
