import { describe, expect, it } from 'vitest';
import { SkyModel } from '../src/render/skyModel';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const params = { haze: 1, albedo: [0.15, 0.15, 0.15] as [number, number, number], altitude: 0.3 };

function skyAt(elDeg: number): SkyModel {
  const m = new SkyModel();
  m.update(Math.sin((elDeg * Math.PI) / 180), params);
  return m;
}

describe('物理大气', () => {
  const noon = skyAt(60);
  const dusk = skyAt(5);

  it('晴天天顶是蓝的，地平线比天顶亮', () => {
    const z = noon.radiance(1.5, Math.PI / 2 - 0.01, [0, 0, 0]);
    const h = noon.radiance(1.5, 0.02, [0, 0, 0]);
    expect(z[2]).toBeGreaterThan(z[1]);
    expect(z[1]).toBeGreaterThan(z[0]);
    expect(lum(h)).toBeGreaterThan(lum(z));
  });

  it('亮度符合实测量级：太阳照度 10 万勒克斯时天顶约几千尼特', () => {
    const z = noon.radiance(1.5, Math.PI / 2 - 0.01, [0, 0, 0]);
    const nits = lum(z) * 100000;
    expect(nits).toBeGreaterThan(1000);
    expect(nits).toBeLessThan(9000);
  });

  it('天光的照度是阳光的一成上下', () => {
    const e = noon.skyIrradiance([0, 0, 0]);
    const t = noon.sunTransmittance([0, 0, 0]);
    const k = lum(e) / (lum(t) * Math.sin((60 * Math.PI) / 180));
    expect(k).toBeGreaterThan(0.06);
    expect(k).toBeLessThan(0.35);
  });

  it('太阳越低，阳光越红越暗', () => {
    const a = noon.sunTransmittance([0, 0, 0]);
    const b = dusk.sunTransmittance([0, 0, 0]);
    expect(lum(b)).toBeLessThan(lum(a) * 0.7);
    expect(b[0] / b[2]).toBeGreaterThan((a[0] / a[2]) * 3);
  });

  it('黄昏时朝太阳的地平线是暖的，背对太阳是冷的', () => {
    const toward = dusk.radiance(0.02, 0.03, [0, 0, 0]);
    const away = dusk.radiance(Math.PI - 0.02, 0.03, [0, 0, 0]);
    expect(toward[0] / toward[2]).toBeGreaterThan(away[0] / away[2]);
    expect(lum(toward)).toBeGreaterThan(lum(away));
  });

  it('霾越重，太阳周围越白，阳光越弱', () => {
    const hazy = new SkyModel();
    hazy.update(Math.sin((60 * Math.PI) / 180), { ...params, haze: 4 });
    expect(lum(hazy.sunTransmittance([0, 0, 0]))).toBeLessThan(lum(noon.sunTransmittance([0, 0, 0])));
    const h = hazy.radiance(0.3, 0.9, [0, 0, 0]);
    const c = noon.radiance(0.3, 0.9, [0, 0, 0]);
    expect(h[0] / h[2]).toBeGreaterThan(c[0] / c[2]);
  });

  it('表里没有非法数字', () => {
    for (const v of dusk.sky) expect(Number.isFinite(v)).toBe(true);
  });

  it('算一遍不要太久（加载和换时段时跑一次）', () => {
    const m = new SkyModel();
    const t0 = performance.now();
    m.update(0.5, params);
    const full = performance.now() - t0;
    const t1 = performance.now();
    m.update(0.1, params);
    const onlySky = performance.now() - t1;
    console.log(`全部 ${full.toFixed(0)} ms，换太阳 ${onlySky.toFixed(0)} ms`);
    expect(full).toBeLessThan(1500);
    expect(onlySky).toBeLessThan(600);
  });
});
