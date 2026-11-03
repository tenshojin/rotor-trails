// 各海拔的功率余量：npx vitest run --config vitest.tools.config.ts tools/perf.tool.ts --silent=false
import { it } from 'vitest';
import { HELI, densityRatio, engineAltitudeFactor } from '../src/config/flight';
import { powerRequired } from '../src/sim/flight';

it('perf', () => {
  for (const cargo of [0, 1, 2]) {
    const m = HELI.massBase + cargo * HELI.crateMass;
    const W = m * 9.81;
    for (const alt of [0, 1000, 2000, 2800, 3500, 4000, 4500, 5000, 5500]) {
      const s = densityRatio(alt);
      const rho = 1.225 * s;
      const pAvail = Math.min(HELI.transmissionLimit, HELI.enginePowerSL * engineAltitudeFactor(alt));
      const pH = powerRequired(W, rho, 0, 0, 1);
      // 找出可持续的最大垂直爬升率（悬停中）与 25 m/s 前飞时的爬升率
      let vc = 0;
      for (let v = 0; v < 15; v += 0.05) if (powerRequired(W, rho, v, 0, 1) <= pAvail) vc = v;
      let vc25 = 0;
      for (let v = 0; v < 15; v += 0.05) if (powerRequired(W, rho, v, 25, 1) <= pAvail) vc25 = v;
      console.log(`cargo=${cargo} m=${m} alt=${alt} sigma=${s.toFixed(3)} pAvail=${(pAvail / 1e3).toFixed(0)}kW pHover=${(pH / 1e3).toFixed(0)}kW margin=${((pAvail / pH - 1) * 100).toFixed(0)}% vclimbHover=${vc.toFixed(2)} vclimb@25=${vc25.toFixed(2)}`);
    }
  }
});
