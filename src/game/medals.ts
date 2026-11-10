// 勋章：全部从存档算出来，不多记东西（只记哪些已经提示过）。飞行记录里看，拿到的时候提示一下。

import type { SaveData } from './save';
import { tr } from '../i18n';

export interface MedalWorld {
  /** 飞行训练几课、超仿真几课 */
  lessons: number;
  simLessons: number;
  /** 有任务的地图（训练场不算）和各自的可选任务 */
  missions: Array<{ id: string; optional: string[] }>;
  /** 每张图有多少地方可去 */
  places: Array<{ id: string; total: number }>;
}

export interface Medal {
  id: string;
  name: string;
  how: string;
  /** 现在到多少、要到多少 */
  progress(d: SaveData, w: MedalWorld): [number, number];
  /** 进度怎么写（缺省写成 3 / 10） */
  text?(now: number, goal: number): string;
}

const clock = (now: number, goal: number): string => tr`${Math.floor(now / 60)} / ${Math.floor(goal / 60)} 分钟`;

export const MEDALS: readonly Medal[] = [
  { id: 'first', name: tr('离地'), how: tr('在空中待满一分钟'), progress: (d) => [d.log.seconds, 60], text: clock },
  { id: 'school', name: tr('结业'), how: tr('学完飞行训练的每一课'), progress: (d, w) => [d.lessonsDone.length, w.lessons] },
  { id: 'sim', name: tr('亲手飞'), how: tr('学完超仿真的每一课'), progress: (d, w) => [d.simLessonsDone.length, w.simLessons] },
  { id: 'land25', name: tr('老手'), how: tr('平安落地 25 次'), progress: (d) => [d.log.landings, 25] },
  { id: 'land100', name: tr('机长'), how: tr('平安落地 100 次'), progress: (d) => [d.log.landings, 100] },
  {
    id: 'feather',
    name: tr('羽毛'),
    how: tr('接地时下降速度不到 0.2 m/s'),
    progress: (d) => [d.log.softest !== null && d.log.softest < 0.2 ? 1 : 0, 1],
    text: () => '',
  },
  { id: 'hour', name: tr('一小时'), how: tr('飞满一小时'), progress: (d) => [d.log.seconds, 3600], text: clock },
  { id: 'hour10', name: tr('十小时'), how: tr('飞满十小时'), progress: (d) => [d.log.seconds, 36000], text: clock },
  { id: 'photo', name: tr('航拍'), how: tr('存下 20 张照片'), progress: (d) => [d.log.photos, 20] },
  {
    id: 'routes',
    name: tr('全线'),
    how: tr('完成每张地图的任务'),
    progress: (d, w) => [w.missions.filter((m) => d.maps[m.id as keyof SaveData['maps']]?.completed).length, w.missions.length],
  },
  {
    id: 'extras',
    name: tr('一个不落'),
    how: tr('做完所有的可选任务'),
    progress: (d, w) => {
      const all = w.missions.flatMap((m) => m.optional.map((o) => [m.id, o] as const));
      return [all.filter(([id, o]) => d.maps[id as keyof SaveData['maps']]?.optionalDone.includes(o)).length, all.length];
    },
  },
  {
    id: 'rating',
    name: tr('全 S'),
    how: tr('每张地图都拿到 S 评价'),
    progress: (d, w) => [w.missions.filter((m) => d.maps[m.id as keyof SaveData['maps']]?.bestRating === 'S').length, w.missions.length],
  },
  {
    id: 'places',
    name: tr('走遍'),
    how: tr('到过每张地图上的每个地方'),
    progress: (d, w) => [w.places.reduce((a, p) => a + Math.min(p.total, d.visited[p.id as keyof SaveData['visited']]?.length ?? 0), 0), w.places.reduce((a, p) => a + p.total, 0)],
  },
];

export function medalDone(m: Medal, d: SaveData, w: MedalWorld): boolean {
  const [now, goal] = m.progress(d, w);
  return goal > 0 && now >= goal;
}

/** 这一刻新拿到的勋章（还没提示过的）。记下来，下次不再报 */
export function newMedals(d: SaveData, w: MedalWorld): Medal[] {
  const fresh = MEDALS.filter((m) => !d.medals.includes(m.id) && medalDone(m, d, w));
  for (const m of fresh) d.medals.push(m.id);
  return fresh;
}

export function medalRows(d: SaveData, w: MedalWorld): Array<{ name: string; how: string; done: boolean; note: string }> {
  return MEDALS.map((m) => {
    const [now, goal] = m.progress(d, w);
    const done = goal > 0 && now >= goal;
    const shown = Math.min(now, goal);
    return { name: m.name, how: m.how, done, note: done ? '' : m.text ? m.text(shown, goal) : `${Math.floor(shown)} / ${goal}` };
  });
}
