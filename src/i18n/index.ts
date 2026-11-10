// 多语言。界面文字在代码里就是中文原文，原文同时是查译文的键：
//   tr('已暂停')                 当场翻译
//   tr`从最近检查点继续（${label}）`   带数值的句子，键是“从最近检查点继续（{0}）”，译文里用 {0}、{1} 摆位置
//   tr('关闭@@状态')              同一句中文在不同地方要译成不同的词时，加 @@ 说明（中文显示时去掉）
//   trKey('五重塔')              只做标记、不翻译：存档里当名字用的地名，定义处保持中文，显示时再 tr(名字)
//
// 语言在启动时定下来，换语言要刷新页面：地图、课程、勋章这些文字是模块加载时就建好的表。
// 所以入口 main.ts 先 initI18n()，再加载游戏的其余部分。测试环境里没有浏览器语言，一律是中文，现有测试不受影响。
//
// 这个文件不能 import 游戏里的任何模块（它们一加载就会调用 tr）。

export type Lang = 'zh' | 'en' | 'ja';
export type LangSetting = 'auto' | Lang;

/** 设置里列出来的语言，名字用各自的文字写 */
export const LANGS: ReadonlyArray<{ id: Lang; name: string; html: string }> = [
  { id: 'zh', name: '简体中文', html: 'zh-CN' },
  { id: 'en', name: 'English', html: 'en' },
  { id: 'ja', name: '日本語', html: 'ja' },
];

/** 译文：一句话，或者一个函数（英文的单复数这类要看数值的） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Entry = string | ((...v: any[]) => string);
export type Dict = Readonly<Record<string, Entry>>;
/** 字典里的一条：[英文, 日文]（dict/ 下面每个文件一张表，键是中文原文） */
export type Pair = readonly [en: Entry, ja: Entry];
export type Table = Readonly<Record<string, Pair>>;

/** 从 [英文, 日文] 的表里取一种语言 */
export function column(table: Table, l: Exclude<Lang, 'zh'>): Dict {
  const i = l === 'en' ? 0 : 1;
  const out: Record<string, Entry> = {};
  for (const k of Object.keys(table)) out[k] = table[k][i];
  return out;
}

/** 存档的键（和 game/save.ts 的 SAVE_KEY 一样；这里不能 import 它，tests/i18n.test.ts 守着两边一致） */
export const SAVE_KEY_FOR_LANG = 'rotorTrails.save';

let lang: Lang = 'zh';
let dict: Dict | null = null;
const tplKeys = new WeakMap<TemplateStringsArray, string>();

/** 没找到译文的原文（只在非中文时记）：巡检时读 window.__i18nMissing 看还漏了哪些 */
export const missing = new Set<string>();

const known = (x: unknown): x is Lang => x === 'zh' || x === 'en' || x === 'ja';

export function currentLang(): Lang {
  return lang;
}

/** 直接指定语言和字典（启动时、测试里用） */
export function setLang(l: Lang, d: Dict | null): void {
  lang = l;
  dict = l === 'zh' ? null : d;
  missing.clear();
}

/** 模板的键：把 ${} 换成 {0}、{1}…… */
export function templateKey(strings: ReadonlyArray<string>): string {
  let key = strings[0];
  for (let i = 1; i < strings.length; i++) key += `{${i - 1}}${strings[i]}`;
  return key;
}

function fill(text: string, v: readonly unknown[]): string {
  return v.length ? text.replace(/\{(\d+)\}/g, (m, n: string) => (Number(n) < v.length ? String(v[Number(n)]) : m)) : text;
}

export function tr(s: string): string;
export function tr(s: TemplateStringsArray, ...v: unknown[]): string;
export function tr(s: string | TemplateStringsArray, ...v: unknown[]): string {
  if (typeof s === 'string') {
    if (dict) {
      const e = dict[s];
      if (e !== undefined) return typeof e === 'function' ? e() : e;
      if (s) missing.add(s);
    }
    const at = s.indexOf('@@');
    return at < 0 ? s : s.slice(0, at);
  }
  if (dict) {
    let key = tplKeys.get(s);
    if (key === undefined) {
      key = templateKey(s);
      tplKeys.set(s, key);
    }
    const e = dict[key];
    if (e !== undefined) return typeof e === 'function' ? e(...v) : fill(e, v);
    missing.add(key);
  }
  let out = s[0];
  for (let i = 1; i < s.length; i++) out += String(v[i - 1]) + s[i];
  return out;
}

/** 只做标记：这句中文要有译文，但这里先不翻（当名字、当键用），显示的地方再 tr(它) */
export function trKey<T extends string>(s: T): T {
  return s;
}

/** 把几样东西连成一句：中文用顿号，别的语言用各自的写法 */
export function trList(items: readonly string[]): string {
  return items.join(tr('、'));
}

/**
 * 选语言：网址里的 ?lang= 最优先（发链接、测试用），其次是设置里选定的，最后看浏览器的语言列表。
 * 浏览器是别的语言（法语、德语……）就用英文；什么都不知道（测试环境）就用中文。
 */
export function pickLang(query: string | null | undefined, saved: unknown, nav: readonly string[]): Lang {
  if (known(query)) return query;
  if (known(saved)) return saved;
  for (const n of nav) {
    const l = String(n).toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return nav.length ? 'en' : 'zh';
}

/** 存档里选定的语言（读不到就是 auto）。直接读 localStorage：这时候存档模块还不能加载 */
export function savedLang(): LangSetting {
  try {
    const raw = globalThis.localStorage?.getItem(SAVE_KEY_FOR_LANG);
    if (!raw) return 'auto';
    const v = (JSON.parse(raw) as { settings?: { lang?: unknown } } | null)?.settings?.lang;
    return known(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** 启动时调一次：定语言、加载字典。字典下载失败就退回中文（总比白屏好） */
export async function initI18n(): Promise<Lang> {
  let query: string | null = null;
  let nav: readonly string[] = [];
  try {
    query = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
    nav = globalThis.navigator?.languages?.length ? globalThis.navigator.languages : globalThis.navigator?.language ? [globalThis.navigator.language] : [];
  } catch {
    /* 没有浏览器环境 */
  }
  let l = pickLang(query, savedLang(), nav);
  let d: Dict | null = null;
  if (l !== 'zh') {
    try {
      d = column((await import('./dict/index.ts')).default, l);
    } catch (e) {
      console.warn('i18n: dictionary failed to load, falling back to zh', e);
      l = 'zh';
    }
  }
  setLang(l, d);
  try {
    document.documentElement.lang = LANGS.find((x) => x.id === l)!.html;
    document.documentElement.dataset.lang = l;
    (globalThis as { __i18nMissing?: Set<string> }).__i18nMissing = missing;
  } catch {
    /* 没有 document */
  }
  return l;
}
