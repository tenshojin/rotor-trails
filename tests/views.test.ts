// 飞行中的镜头：任务和训练固定座舱视角（玩家反馈：正常开始游戏也能切到机外），休闲飞行在座舱、追尾、电影镜头之间换
import { describe, expect, it } from 'vitest';
import { nextView } from '../src/game/views';

describe('切换视角', () => {
  it('任务和训练（不是休闲飞行）按了也不换', () => {
    for (const mode of ['cockpit', 'chase', 'cinema']) expect(nextView(mode, false)).toBeNull();
  });

  it('休闲飞行：座舱 → 追尾 → 电影镜头 → 座舱', () => {
    expect(nextView('cockpit', true)).toBe('chase');
    expect(nextView('chase', true)).toBe('cinema');
    expect(nextView('cinema', true)).toBe('cockpit');
  });

  it('拍照、坠毁这些特殊镜头之后按一下回到座舱', () => {
    expect(nextView('photo', true)).toBe('cockpit');
    expect(nextView('crash', true)).toBe('cockpit');
  });
});
