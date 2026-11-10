// HUD 标记旁边的字：压在面板、航点读数上时换到标记另一边；两边都压着就淡一些（玩家反馈前的自查：字压着字看不清）
import { describe, expect, it } from 'vitest';
import { placeLabel, signed } from '../src/ui/hud';

const panel = { left: 1380, top: 310, right: 1590, bottom: 520 };
const nav = { left: 520, top: 0, right: 1080, bottom: 92 };

describe('标记文字的位置', () => {
  it('旁边没有面板：放在原位', () => {
    expect(placeLabel(800, 40, 300, 345, [panel, nav])).toEqual({ y: 300, dim: false });
  });

  it('压着上方的航点读数：换到标记下面', () => {
    expect(placeLabel(800, 50, 80, 125, [panel, nav])).toEqual({ y: 125, dim: false });
  });

  it('两边都压着面板：留在原位但淡一些', () => {
    expect(placeLabel(1450, 40, 400, 445, [panel, nav])).toEqual({ y: 400, dim: true });
  });

  it('没有备用位置时压着就淡一些', () => {
    expect(placeLabel(1450, 40, 400, undefined, [panel])).toEqual({ y: 400, dim: true });
  });

  it('面板收起来（没有遮挡物）时一律正常显示', () => {
    expect(placeLabel(1450, 40, 400, 445, [])).toEqual({ y: 400, dim: false });
  });
});

describe('带正负号的读数', () => {
  it('正数带加号，负数带减号', () => {
    expect(signed(12.4)).toBe('+12');
    expect(signed(-3.6)).toBe('-4');
    expect(signed(2.345, 1)).toBe('+2.3');
    expect(signed(-0.26, 1)).toBe('-0.3');
  });

  it('四舍五入之后是 0 的不带符号（不显示 -0、+0.0）', () => {
    expect(signed(0)).toBe('0');
    expect(signed(-0.2)).toBe('0');
    expect(signed(0.4)).toBe('0');
    expect(signed(-0.04, 1)).toBe('0.0');
    expect(signed(0.04, 1)).toBe('0.0');
    expect(signed(-0)).toBe('0');
  });
});
