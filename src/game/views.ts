// 飞行中的镜头：休闲飞行可以在座舱、追尾、电影镜头之间换；任务和训练（包括超仿真）只用座舱视角。
// 玩家反馈：正常开始游戏也能切到机外，等于开着上帝视角飞任务（看得见机身离障碍物多远、背后是什么）。
// 暂停时的拍照模式、回放不算飞行，不受影响。

export type FlyView = 'cockpit' | 'chase' | 'cinema';

/** 按一下“切换视角”以后换到哪个镜头；不能换（不是休闲飞行）返回 null */
export function nextView(current: string, free: boolean): FlyView | null {
  if (!free) return null;
  return current === 'cockpit' ? 'chase' : current === 'chase' ? 'cinema' : 'cockpit';
}
