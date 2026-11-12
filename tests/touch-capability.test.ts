import { afterEach, describe, expect, it, vi } from 'vitest';
import { touchOnly } from '../src/ui/touchControls';
afterEach(() => vi.unstubAllGlobals());
describe('触控设备识别', () => {
  it('主要输入为触控时，连接了精细指针也保留触控操作', () => {
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === '(hover: none) and (pointer: coarse)' || query === '(any-pointer: fine)' }) });
    expect(touchOnly()).toBe(true);
  });
  it('主要输入为鼠标的桌面不强制切成触控', () => {
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(touchOnly()).toBe(false);
  });
});
