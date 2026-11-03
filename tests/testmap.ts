// 测试专用地图：大片平地 + 一堵墙（碰撞测试）+ 无风/有风两种天气。
import { makeWeather } from '../src/sim/weather';
import type { MapDef } from '../src/maps/types';
import { TRAINING } from '../src/maps/training';
import { registerProps } from '../src/world/props/index';

registerProps({
  testWall(B, d) {
    const w = Number(d.p?.w ?? 200);
    const h = Number(d.p?.h ?? 120);
    const t = Number(d.p?.t ?? 20);
    B.box(0, h / 2, 0, w, h, t, 0x888888);
  },
});

export const FLAT: MapDef = {
  ...TRAINING,
  id: 'training',
  name: '测试平地',
  size: 8192,
  res: 513,
  seed: 7,
  altitudeOffset: 0,
  waterLevel: null,
  buildTerrain(b) {
    b.fill(() => 0);
  },
  spawn: { padId: 'S', heading: 0 },
  pads: [
    { id: 'S', name: '起点', pos: [0, 0.4, 0], size: 22, kind: 'start', style: 'ground' },
    { id: 'P2', name: '目标', pos: [0, 0.4, -400], size: 20, kind: 'final', style: 'ground' },
    { id: 'R', name: '维修', pos: [80, 0.4, 0], size: 18, kind: 'repair', style: 'ground', repair: { amount: 100, uses: 1 } },
  ],
  props: [{ type: 'testWall', pos: [2500, 0, 0], rotY: Math.PI / 2, p: { w: 300, h: 150, t: 30 } }],
  vegetation: [],
  clearings: [],
  nodes: [{ id: 'n1', pos: [0, 60, -200], radius: 40, label: '航点1', checkpoint: true }],
  legs: [{ to: 'land', paths: [{ id: 'm', label: '主航线', detail: '', tag: 'main', nodes: ['n1'] }] }],
  mission: {
    startCargo: 0,
    main: [{ id: 'land', kind: 'land', title: '降落', detail: '', padId: 'P2', dwell: 2, approach: [0, 30, -400] }],
    optional: [],
  },
  pickups: [
    { id: 'b1', kind: 'boost', pos: [0, 40, 300] },
    { id: 's1', kind: 'shield', pos: [0, 40, 400] },
    { id: 'r1', kind: 'repair', pos: [0, 40, 500] },
  ],
  windZones: [],
  weathers: [
    { id: 'calm', label: '无风', kind: 'clear', desc: '', params: makeWeather({ windSpeed: 0, gustAmp: 0, turbulence: 0 }) },
    { id: 'east10', label: '东风 10', kind: 'wind', desc: '', params: makeWeather({ windDirFrom: 90, windSpeed: 10, gustAmp: 0, turbulence: 0 }) },
    { id: 'gusty', label: '阵风', kind: 'wind', desc: '', params: makeWeather({ windDirFrom: 90, windSpeed: 8, gustAmp: 4, turbulence: 0.5 }) },
  ],
  defaultWeather: 'calm',
};
