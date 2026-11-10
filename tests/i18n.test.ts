// 多语言：译文查找的规则、语言怎么选，以及“每句界面文字都有英文和日文”这件事本身。
// 最后一组把整个 src 扫一遍：新加了界面文字却没包进 tr()、或者包了没写译文，这里会红。

import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SAVE_KEY_FOR_LANG, column, currentLang, missing, pickLang, setLang, templateKey, tr, trKey, trList, type Table } from '../src/i18n';
import ALL from '../src/i18n/dict/index';
import { SAVE_KEY } from '../src/game/save';
import { defaultSettings, sanitizeSettings } from '../src/game/settings';
import { placeholders, report, scanText } from '../tools/i18nScan';
import allow from '../tools/i18n-allow.json';

afterEach(() => setLang('zh', null));

describe('tr：用中文原文查译文', () => {
  const table: Table = {
    '已暂停': ['Paused', '一時停止中'],
    '第 {0} 课 · {1}': ['Lesson {0} · {1}', 'レッスン {0} · {1}'],
    '{0} 在 {1} 之后': ['{1} comes before {0}', '{1} のあとに {0}'],
    '{0} 箱': [(n: unknown) => `${n} ${Number(n) === 1 ? 'crate' : 'crates'}`, '{0} 箱'],
    '关闭': ['Close', '閉じる'],
    '关闭@@状态': ['off', 'オフ'],
    '、': [', ', '、'],
  };

  it('中文（没有字典）时原样返回，模板照常拼起来', () => {
    expect(currentLang()).toBe('zh');
    expect(tr('已暂停')).toBe('已暂停');
    expect(tr`第 ${3} 课 · ${'风'}`).toBe('第 3 课 · 风');
    expect(trKey('五重塔')).toBe('五重塔');
    expect(trList(['甲', '乙'])).toBe('甲、乙');
  });

  it('@@ 后面是给译者看的说明，中文显示时去掉', () => {
    expect(tr('关闭@@状态')).toBe('关闭');
  });

  it('有字典时查译文；模板的键是把 ${} 换成 {0}、{1}', () => {
    setLang('en', column(table, 'en'));
    expect(tr('已暂停')).toBe('Paused');
    expect(tr`第 ${3} 课 · ${'Wind'}`).toBe('Lesson 3 · Wind');
    expect(templateKey(['第 ', ' 课 · ', ''])).toBe('第 {0} 课 · {1}');
    setLang('ja', column(table, 'ja'));
    expect(tr('已暂停')).toBe('一時停止中');
    expect(tr`第 ${3} 课 · ${'風'}`).toBe('レッスン 3 · 風');
  });

  it('译文里的占位符可以换顺序', () => {
    setLang('en', column(table, 'en'));
    expect(tr`${'B'} 在 ${'A'} 之后`).toBe('A comes before B');
  });

  it('译文可以是函数（英文的单复数）', () => {
    setLang('en', column(table, 'en'));
    expect(tr`${1} 箱`).toBe('1 crate');
    expect(tr`${3} 箱`).toBe('3 crates');
    setLang('ja', column(table, 'ja'));
    expect(tr`${3} 箱`).toBe('3 箱');
  });

  it('同一句中文在不同地方可以译成不同的词', () => {
    setLang('en', column(table, 'en'));
    expect(tr('关闭')).toBe('Close');
    expect(tr('关闭@@状态')).toBe('off');
  });

  it('没有译文时退回中文，并记下来（巡检时看漏了哪些）', () => {
    setLang('en', column(table, 'en'));
    expect(tr('还没翻的话')).toBe('还没翻的话');
    expect(tr`还没翻的 ${7} 句`).toBe('还没翻的 7 句');
    expect([...missing]).toEqual(['还没翻的话', '还没翻的 {0} 句']);
  });

  it('列表的连接符跟着语言走', () => {
    setLang('en', column(table, 'en'));
    expect(trList(['Liftoff', 'Captain'])).toBe('Liftoff, Captain');
  });
});

describe('选语言', () => {
  it('网址里的 ?lang= 最优先，其次是设置里选定的', () => {
    expect(pickLang('ja', 'en', ['zh-CN'])).toBe('ja');
    expect(pickLang(null, 'en', ['zh-CN'])).toBe('en');
    expect(pickLang('klingon', 'auto', ['zh-CN'])).toBe('zh');
  });

  it('设置是“跟随浏览器”时看浏览器的语言列表，取第一个认识的', () => {
    expect(pickLang(null, 'auto', ['zh-TW', 'en'])).toBe('zh');
    expect(pickLang(null, 'auto', ['ja-JP', 'en-US'])).toBe('ja');
    expect(pickLang(null, 'auto', ['en-GB'])).toBe('en');
    expect(pickLang(null, 'auto', ['fr-FR', 'ja'])).toBe('ja');
  });

  it('浏览器是别的语言就用英文；什么都不知道（测试环境）是中文', () => {
    expect(pickLang(null, 'auto', ['de-DE', 'fr'])).toBe('en');
    expect(pickLang(null, undefined, [])).toBe('zh');
  });

  it('语言存在设置里，坏值回到“跟随浏览器”', () => {
    expect(defaultSettings().lang).toBe('auto');
    expect(sanitizeSettings({ lang: 'ja' }).lang).toBe('ja');
    expect(sanitizeSettings({ lang: 'xx' }).lang).toBe('auto');
    expect(SAVE_KEY_FOR_LANG).toBe(SAVE_KEY);
  });
});

describe('扫描工具', () => {
  it('认得出 tr() / tr`` / trKey()，跳过注释，模板里的 ${} 不算汉字', () => {
    const src = [
      "// 注释里的 '中文' 不算",
      "const a = tr('已暂停');",
      'const b = tr`第 ${n} 课`;',
      "const c = trKey('五重塔');",
      "const d = '没包起来';",
      'const e = `${f(\'里面这句没包\')} tail`;',
      'const g = `<p>${tr`嵌在模板里`}</p>`;',
    ].join('\n');
    const lits = scanText(src, 'x.ts');
    const keys = lits.filter((l) => l.key !== null).map((l) => l.key);
    expect(keys).toEqual(['已暂停', '第 {0} 课', '五重塔', '嵌在模板里']);
    const bare = lits.filter((l) => l.han && !l.wrap).map((l) => l.raw);
    expect(bare).toEqual(["'没包起来'", "'里面这句没包'"]);
  });

  it('tr() 里放带数值的模板是错的（键会变），要写成 tr``', () => {
    const lits = scanText('const a = tr(`第 ${n} 课`);', 'x.ts');
    expect(lits.find((l) => l.problem)?.problem).toContain('tr`');
  });
});

describe('界面文字都有译文', () => {
  const r = report(fileURLToPath(new URL('../src', import.meta.url)), allow as Record<string, string[]>);
  const dict = ALL as Readonly<Record<string, readonly [unknown, unknown]>>;

  it('带汉字的字面量都包在 tr() / trKey() 里（开发者看的报错在 tools/i18n-allow.json 里列着）', () => {
    expect(r.bare.map((l) => `${l.file}:${l.line} ${l.raw.slice(0, 40)}`)).toEqual([]);
    expect(r.problems.map((l) => `${l.file}:${l.line} ${l.problem}`)).toEqual([]);
  });

  it('每一句都有英文和日文', () => {
    const lost = [...r.keys].filter(([k]) => !(k in dict)).map(([k, f]) => `${f}: ${k.slice(0, 40)}`);
    expect(lost).toEqual([]);
    const empty = Object.entries(dict).filter(([k, v]) => k.trim() !== '' && v.some((x) => typeof x === 'string' && x.trim() === '')).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('字典里没有已经不用的句子', () => {
    expect(Object.keys(dict).filter((k) => !r.keys.has(k))).toEqual([]);
  });

  it('译文的占位符和原文对得上，标记（<b>、<kbd>）一个不少', () => {
    const tags = (s: string): string[] => (s.match(/<\/?[a-zA-Z]+/g) ?? []).sort();
    const bad: string[] = [];
    for (const [k, pair] of Object.entries(dict)) {
      pair.forEach((v, i) => {
        if (typeof v !== 'string') return;
        const lang = i === 0 ? 'en' : 'ja';
        if (placeholders(v).join() !== placeholders(k).join()) bad.push(`${lang} 占位符：${k.slice(0, 30)}`);
        if (tags(v).join() !== tags(k).join()) bad.push(`${lang} 标记：${k.slice(0, 30)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('英文里没有残留的中日文字符', () => {
    const cjk = /[぀-ヿ㐀-鿿＀-￯　-〿]/;
    const left = Object.entries(dict).filter(([, v]) => typeof v[0] === 'string' && cjk.test(v[0])).map(([k]) => k.slice(0, 30));
    expect(left).toEqual([]);
  });

  it('函数写的译文（单复数）能跑，单数复数不一样', () => {
    const fns = Object.entries(dict).filter(([, v]) => typeof v[0] === 'function');
    expect(fns.length).toBeGreaterThan(0);
    for (const [k, v] of fns) {
      const f = v[0] as (...a: unknown[]) => string;
      expect(f(1), k).not.toBe(f(2));
      expect(f(2), k).toMatch(/2/);
    }
  });
});
