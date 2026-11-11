// 版本号和反馈入口：主菜单左下角、关于页、导出的存档里都写它。发新版时改这里和 package.json。

export const VERSION = '1.1';

/** 作者的署名：制作人员名单里写它（媒体资料 docs/press/README.md 里也是这个名字）。
 *  GitHub 账号名 tenshojin 只出现在网址里，不当署名用 */
export const AUTHOR = 'TIANCHENG JIN';

/** 玩家反馈问题和建议的地方（关于页的链接） */
export const FEEDBACK_URL = 'https://github.com/tenshojin/rotor-trails/issues';

/**
 * 浏览器和系统，写在关于页的“运行环境”那一行里：玩家反馈卡顿时附上它，就知道走的是哪条路
 * （Linux 上常见的问题都和浏览器有没有 WebGPU、有没有用上显卡有关）
 */
export function browserOf(userAgent: string): string {
  const v = (re: RegExp): string | null => re.exec(userAgent)?.[1] ?? null;
  const browser =
    (v(/Edg\/(\d+)/) && `Edge ${v(/Edg\/(\d+)/)}`) ||
    (v(/OPR\/(\d+)/) && `Opera ${v(/OPR\/(\d+)/)}`) ||
    (v(/Firefox\/(\d+)/) && `Firefox ${v(/Firefox\/(\d+)/)}`) ||
    (v(/Chrome\/(\d+)/) && `Chrome ${v(/Chrome\/(\d+)/)}`) ||
    (v(/Version\/(\d+)[\d.]* .*Safari/) && `Safari ${v(/Version\/(\d+)[\d.]* .*Safari/)}`) ||
    '?';
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS' : /CrOS/.test(userAgent) ? 'ChromeOS' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS X|Macintosh/.test(userAgent) ? 'macOS' : /Linux|X11/.test(userAgent) ? 'Linux' : '?';
  return `${browser} · ${os}`;
}
