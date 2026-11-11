// 任务说明和提示里的速度上限，要和 HUD 上的“地速”用同一个单位（设置里可选 km/h、kt、m/s，默认 km/h）。
// 地图和任务逻辑不知道玩家选了哪个单位，先写成记号 {v:25}（意思是 25 m/s），显示的地方再换成“90 km/h”。
// tr 的占位符只认 {0}、{1}，不会碰这个记号；放进 tr`` 里时它跟着 {0} 走，译文不用管单位。
// （2026-11-11 玩家反馈：任务写“速度 < 25 m/s”，HUD 上看到的是 km/h，以为单位写错了）

/** 速度上限的记号：speedMark(25) → “{v:25}” */
export function speedMark(metersPerSecond: number): string {
  return `{v:${metersPerSecond}}`;
}

/** 把文字里的速度记号换成 fmt(米每秒) 的写法 */
export function fillSpeeds(text: string, fmt: (metersPerSecond: number) => string): string {
  return text.includes('{v:') ? text.replace(/\{v:(-?\d+(?:\.\d+)?)\}/g, (_m, v: string) => fmt(Number(v))) : text;
}
