import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { lerpWeather, makeWeather, WeatherState, type WeatherPreset } from '../src/sim/weather';
import { WindField, gustEnvelope, timeToNextGust, type WindZoneDef } from '../src/sim/wind';

const presets: WeatherPreset[] = [
  { id: 'a', label: 'A', kind: 'clear', desc: '', params: makeWeather({ windDirFrom: 350 }) },
  { id: 'b', label: 'B', kind: 'wind', desc: '', params: makeWeather({ windDirFrom: 10, visibility: 1000 }) },
];

describe('天气与风场边界', () => {
  it('风向插值不受等价角度的整圈偏移影响', () => {
    for (let turnsA = -3; turnsA <= 3; turnsA++) for (let turnsB = -3; turnsB <= 3; turnsB++) {
      const a = makeWeather({ windDirFrom: 90 + turnsA * 360 });
      const b = makeWeather({ windDirFrom: turnsB * 360 });
      expect(lerpWeather(a, b, 0.5, makeWeather({})).windDirFrom).toBe(45);
    }
  });

  it.each([Number.NaN, Infinity, -Infinity])('非法过渡时长 %s 被拒绝且不破坏原状态', (duration) => {
    const weather = new WeatherState(presets, 'a');
    const before = weather.snapshot();
    expect(() => weather.transitionTo('b', duration)).toThrow();
    expect(weather.snapshot()).toEqual(before);
  });

  it('异常帧间隔不使天气回退或变成 NaN', () => {
    const weather = new WeatherState(presets, 'a');
    weather.transitionTo('b', 10);
    weather.update(2, 0);
    const before = weather.snapshot();
    const current = { ...weather.current };
    for (const dt of [Number.NaN, Infinity, -Infinity, -1]) weather.update(dt, 0);
    expect(weather.snapshot()).toEqual(before);
    expect(weather.current).toEqual(current);
  });

  it.each([0, -1, Number.NaN, Infinity])('非法能见度 %s 在进入仿真前被拒绝', (visibility) => {
    expect(() => new WeatherState([{ ...presets[0], params: { ...presets[0].params, visibility } }], 'a')).toThrow();
  });

  it.each([0, -1, Number.NaN, Infinity])('非法阵风周期 %s 不产生 NaN 倒计时', (period) => {
    expect(() => gustEnvelope(1, period, 0, 1)).toThrow();
    expect(() => timeToNextGust(1, period, 0)).toThrow();
    const zone: WindZoneDef = { id: 'gust', name: '', a: [0, 0], b: [0, 0], radius: 20, feather: 10, kind: 'gust', gust: { period, amp: 4 } };
    expect(() => new WindField({ dirFrom: 0, speed: 0, gustAmp: 0, turbulence: 0, zoneScale: 1 }, [zone], () => 0, 1)).toThrow();
  });

  it('零长度风区在中心、羽化环与边界外均有限且连续', () => {
    const zone: WindZoneDef = { id: 'lift', name: '', a: [10, 10], b: [10, 10], radius: 20, feather: 10, kind: 'lift', vertical: 3 };
    const wind = new WindField({ dirFrom: 0, speed: 0, gustAmp: 0, turbulence: 0, zoneScale: 1 }, [zone], () => 0, 1);
    let previous = 3;
    for (let distance = 0; distance <= 40; distance += 0.25) {
      const sample = wind.sample(10 + distance, 50, 10, 0, new Vector3());
      expect(sample.toArray().every(Number.isFinite)).toBe(true);
      expect(sample.y).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous - sample.y).toBeLessThan(0.12);
      previous = sample.y;
    }
    expect(previous).toBe(0);
  });

  it.each([0.3, 0.5, 1, 2])('局部阵风反馈与真实风场使用相同有效权重（倍率 %s）', (zoneScale) => {
    const zone: WindZoneDef = { id: 'gust', name: '阵风区', a: [0, 0], b: [0, 0], radius: 20, feather: 10, kind: 'gust', gust: { amp: 10, period: 10 } };
    const wind = new WindField({ dirFrom: 0, speed: 0, gustAmp: 0, turbulence: 0, zoneScale }, [zone], () => 0, 1);
    const actual = wind.sample(0, 50, 0, 1.5, new Vector3()).length();
    expect(wind.info(0, 50, 0, 1.5).gust).toBeCloseTo(actual, 10);
  });

  it('关闭局部风区时不再报告阵风区或即将到来的阵风', () => {
    const zone: WindZoneDef = { id: 'gust', name: '阵风区', a: [0, 0], b: [0, 0], radius: 20, feather: 10, kind: 'gust', gust: { amp: 10, period: 10 } };
    const wind = new WindField({ dirFrom: 0, speed: 0, gustAmp: 0, turbulence: 0, zoneScale: 0 }, [zone], () => 0, 1);
    expect(wind.sample(0, 50, 0, 8, new Vector3()).length()).toBe(0);
    expect(wind.info(0, 50, 0, 8)).toMatchObject({ zone: null, gust: 0, gustIn: null });
  });
});
