import { describe, expect, it, vi } from 'vitest';
import { Tutorial, TUTORIAL_STEPS } from '../src/game/tutorial';
import { defaultSettings } from '../src/game/settings';
import type { GameSession } from '../src/sim/session';

function session() {
  return { agl: 15, flight: { telemetry: { heading: 0 } } } as unknown as GameSession;
}

describe('教学状态与提示', () => {
  it('达标需要连续保持，反复擦过目标不能累积成完成', () => {
    const t = new Tutorial(defaultSettings());
    const s = session();
    t.start(s);
    t.update(s, 0.4);
    s.agl = 5;
    t.update(s, 0.1);
    s.agl = 15;
    t.update(s, 0.4);
    expect(t.index).toBe(0);
    t.update(s, 0.3);
    expect(t.index).toBe(1);
  });

  it('恢复检查点的航向变化不当作转向训练进度', () => {
    const t = new Tutorial(defaultSettings());
    const s = session();
    t.start(s);
    t.skip(s); t.skip(s); t.skip(s);
    s.flight.telemetry.heading = Math.PI;
    t.resumeStep(s);
    t.update(s, 0.1);
    expect(t.index).toBe(3);
    expect(t.progress).toBe(0);
  });

  it('训练中改键后说明立即使用当前设置', () => {
    const t = new Tutorial(defaultSettings());
    const next = defaultSettings();
    next.bindings.up = ['KeyR'];
    t.setSettings(next);
    expect(t.html()).toContain('<kbd>R</kbd>');
    expect(t.html()).not.toContain('<kbd>空格</kbd>');
  });

  it('回车被飞行或暂停动作占用后，教学提示改用暂停菜单跳步', () => {
    const settings = defaultSettings();
    const tutorial = new Tutorial(settings);
    expect(tutorial.html()).toContain('按 <kbd>Enter</kbd> 跳过此步');
    settings.bindings.up = ['Enter'];
    settings.bindings.pause = ['KeyL'];
    tutorial.setSettings(settings);
    expect(tutorial.html()).toContain('在暂停菜单选择“跳过当前教学步骤”');
    expect(tutorial.html()).toContain('<kbd>L</kbd> 暂停/退出教学');
    expect(tutorial.html()).not.toContain('按 <kbd>Enter</kbd> 跳过此步');
    settings.bindings.up = ['Space'];
    settings.bindings.pause = ['Enter'];
    tutorial.setSettings(settings);
    expect(tutorial.html()).toContain('在暂停菜单选择“跳过当前教学步骤”');
    expect(tutorial.html()).toContain('<kbd>回车</kbd> 暂停/退出教学');
    settings.bindings.pause = ['KeyP'];
    tutorial.setSettings(settings);
    expect(tutorial.html()).toContain('按 <kbd>Enter</kbd> 跳过此步');
  });

  it('悬停训练要求连续保持，离开后不能沿用前一段保持时间', () => {
    const t = new Tutorial(defaultSettings());
    const s = { ...session(), groundSpeed: 0, flight: { telemetry: { heading: 0, hover: 'holding' } } } as unknown as GameSession;
    t.start(s);
    for (let i = 0; i < 5; i++) t.skip(s);
    for (let i = 0; i < 40; i++) t.update(s, 0.1);
    expect(t.progress).toBeCloseTo(0.8);
    s.flight.telemetry.hover = 'off';
    t.update(s, 0.1);
    expect(t.progress).toBe(0);
    s.flight.telemetry.hover = 'holding';
    for (let i = 0; i < 20; i++) t.update(s, 0.1);
    expect(t.index).toBe(5);
    expect(t.progress).toBeCloseTo(0.4);
  });

  it('教学文字在进度整百分比不变时复用，改键后重新生成', () => {
    const t = new Tutorial(defaultSettings());
    const text = vi.spyOn(TUTORIAL_STEPS[0], 'text');
    try {
      for (let i = 0; i < 300; i++) t.html();
      expect(text).toHaveBeenCalledOnce();
      const next = defaultSettings();
      next.bindings.up = ['KeyR'];
      t.setSettings(next);
      expect(t.html()).toContain('<kbd>R</kbd>');
      expect(text).toHaveBeenCalledTimes(2);
    } finally { text.mockRestore(); }
  });
});
