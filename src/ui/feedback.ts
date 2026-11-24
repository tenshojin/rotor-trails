// 游戏内的「反馈问题和建议」：打开反馈小窗，写的内容发到作者邮箱（作者自己的 Cloudflare Worker 转发）。
// 小窗本身在 feedbackWidget.js（不依赖任何库，多个作品共用）。
import './feedbackWidget.js';
import { VERSION } from '../game/version';
import { currentLang } from '../i18n';

interface FeedbackApi {
  open(opts: Record<string, unknown>): void;
  close(): void;
}

/** claude.ai 私有试玩页（Artifact）里连不上反馈服务器：那里不显示反馈按钮，「关于」里留 GitHub 链接 */
export function inArtifact(): boolean {
  return !!(globalThis as { __artifact?: boolean }).__artifact;
}

/** page：在哪儿点开的（给作者看）；env：运行环境那一行（浏览器、系统、WebGPU / WebGL2、显卡），一起发过去 */
export function openFeedback(page: string, env?: string): void {
  const api = (window as unknown as { JimiFeedback?: FeedbackApi }).JimiFeedback;
  api?.open({ app: 'rotor-trails', version: VERSION, lang: currentLang(), page, meta: env ? { env } : undefined, accent: '#7cc4ff' });
}
