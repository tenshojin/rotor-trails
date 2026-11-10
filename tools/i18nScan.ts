// 多语言的检查工具：把源码里的字符串字面量找出来，看哪些带汉字、有没有包在 tr() / trKey() 里、键是什么。
// tests/i18n.test.ts 用它核对“每句界面文字都有英文、日文译文”；也可以直接跑：
//   node tools/i18nScan.ts            列出还没包起来的中文、还缺译文的键
//   node tools/i18nScan.ts --dump tmp/i18n   把各语言缺的键按文件写成 JSON，翻译时照着填
// 只做词法扫描（注释、字符串、模板、正则），不依赖 TypeScript 编译器。

import fs from 'node:fs';
import path from 'node:path';

export interface Lit {
  file: string;
  line: number;
  kind: 'str' | 'tpl';
  /** 源码里的原样（带引号） */
  raw: string;
  /** 静态部分有没有汉字（模板里 ${} 的内容不算） */
  han: boolean;
  wrap: 'tr' | 'trKey' | null;
  /** 查字典的键（包在 tr / trKey 里的才有） */
  key: string | null;
  /** 用法不对 */
  problem?: string;
  /** 在源码里的位置（改代码的脚本用） */
  start: number;
  end: number;
  /** 静态文字各段在源码里的范围（模板被 ${} 切成几段；字符串只有一段） */
  spans: Array<[number, number]>;
  /** 这一行里字面量前面的代码（白名单按它认“这是哪个字段”） */
  ctx: string;
}

// 汉字，加上中文标点和全角符号（只有一个顿号、冒号的字面量也要翻）
export const HAN = /[㐀-鿿　-〿＀-￯]/;
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);

/** JS 字符串里的转义还原成字符 */
export function unescapeJs(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e: string) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === '\n' || e === '\r\n') return '';
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[e] ?? e;
  });
}

export function scanText(text: string, file = ''): Lit[] {
  const out: Lit[] = [];
  const n = text.length;
  let i = 0;
  let prev = '';
  let word = '';

  const lineStarts = [0];
  for (let k = 0; k < n; k++) if (text[k] === '\n') lineStarts.push(k + 1);
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const push = (kind: 'str' | 'tpl', start: number, end: number, chunks: string[], spans: Array<[number, number]>): void => {
    const before = text.slice(Math.max(0, start - 24), start);
    const call = /(?:^|[^\w$.])(tr|trKey)\(\s*$/.exec(before);
    const tagged = kind === 'tpl' && /(?:^|[^\w$.])tr$/.test(before);
    const line = lineOf(start);
    const lit: Lit = { file, line, kind, raw: text.slice(start, end), han: chunks.some((c) => HAN.test(c)), wrap: null, key: null, start, end, spans, ctx: text.slice(lineStarts[line - 1], start).slice(-80) };
    if (tagged) {
      lit.wrap = 'tr';
      lit.key = chunks.reduce((a, c, k) => (k === 0 ? c : `${a}{${k - 1}}${c}`), '');
    } else if (call) {
      lit.wrap = call[1] as 'tr' | 'trKey';
      const after = /^\s*(.)/.exec(text.slice(end, end + 40))?.[1] ?? '';
      if (chunks.length > 1) lit.problem = `${call[1]}(\`…\${}…\`) 的键会随数值变：带数值的句子写成 tr\`…\${}…\``;
      else if (after !== ')') lit.problem = `${call[1]}() 里只能放一个字面量（后面跟着“${after}”）`;
      else lit.key = chunks[0];
    }
    out.push(lit);
  };

  const readString = (q: string): void => {
    const start = i++;
    let body = '';
    while (i < n && text[i] !== q && text[i] !== '\n') {
      if (text[i] === '\\') {
        body += text[i] + (text[i + 1] ?? '');
        i += 2;
      } else body += text[i++];
    }
    i++;
    push('str', start, i, [unescapeJs(body)], [[start + 1, i - 1]]);
  };

  const readTemplate = (): void => {
    const start = i++;
    const chunks: string[] = [];
    const spans: Array<[number, number]> = [];
    let cur = '';
    let from = i;
    while (i < n && text[i] !== '`') {
      if (text[i] === '\\') {
        cur += text[i] + (text[i + 1] ?? '');
        i += 2;
      } else if (text[i] === '$' && text[i + 1] === '{') {
        chunks.push(unescapeJs(cur));
        spans.push([from, i]);
        cur = '';
        i += 2;
        const [p, w] = [prev, word];
        prev = '';
        word = '';
        code(true);
        [prev, word] = [p, w];
        i++;
        from = i;
      } else cur += text[i++];
    }
    chunks.push(unescapeJs(cur));
    spans.push([from, i]);
    i++;
    push('tpl', start, i, chunks, spans);
  };

  const readRegex = (): void => {
    i++;
    let cls = false;
    while (i < n && text[i] !== '\n') {
      const c = text[i];
      if (c === '\\') i += 2;
      else if (c === '[') {
        cls = true;
        i++;
      } else if (c === ']') {
        cls = false;
        i++;
      } else if (c === '/' && !cls) {
        i++;
        break;
      } else i++;
    }
    while (i < n && /[a-z]/.test(text[i])) i++;
  };

  /** 读代码；inExpr：模板的 ${ } 里，读到配对的 } 停下（不吃掉它） */
  function code(inExpr: boolean): void {
    let depth = 0;
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') {
        const j = text.indexOf('\n', i);
        i = j < 0 ? n : j;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        const j = text.indexOf('*/', i + 2);
        i = j < 0 ? n : j + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        readString(c);
        prev = '"';
        word = '';
        continue;
      }
      if (c === '`') {
        readTemplate();
        prev = '"';
        word = '';
        continue;
      }
      if (c === '/' && (REGEX_AFTER.has(prev) || (word && REGEX_AFTER_WORD.has(word)))) {
        readRegex();
        prev = '"';
        word = '';
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (inExpr && depth === 0) return;
        depth--;
      }
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (/[\w$]/.test(c)) word = /[\w$]/.test(prev) ? word + c : c;
      else word = '';
      prev = c;
      i++;
    }
  }

  code(false);
  return out.sort((a, b) => a.start - b.start);
}

/** 扫一个目录下的 .ts / .js（不看 .d.ts，不看 skip 里的子目录） */
export function scanDir(dir: string, skip: readonly string[] = []): Lit[] {
  const out: Lit[] = [];
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const rel = path.relative(dir, p).replace(/\\/g, '/');
      if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(name) && !name.endsWith('.d.ts')) out.push(...scanText(fs.readFileSync(p, 'utf8'), rel));
    }
  };
  walk(dir);
  return out;
}

/** 译文里用到的占位符编号 */
export function placeholders(s: string): number[] {
  return [...new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

export interface Report {
  /** 带汉字、没包在 tr / trKey 里的字面量 */
  bare: Lit[];
  problems: Lit[];
  /** 所有要有译文的键 → 第一次出现在哪个文件 */
  keys: Map<string, string>;
}

/** 字典目录不扫（里面的中文是键）。allow：允许不翻的中文字面量（文件 → 原文列表） */
export function report(srcDir: string, allow: Readonly<Record<string, readonly string[]>> = {}): Report {
  const lits = scanDir(srcDir, ['i18n/en', 'i18n/ja']);
  const keys = new Map<string, string>();
  for (const l of lits) if (l.key !== null && !keys.has(l.key)) keys.set(l.key, l.file);
  // 白名单的键是文件、以 / 结尾的目录，或者 *（所有文件）；值是“这一行里字面量之前的代码 + 字面量”里出现的片段
  const allowed = (l: Lit): boolean =>
    Object.entries(allow).some(([f, list]) => (f === '*' || (f.endsWith('/') ? l.file.startsWith(f) : l.file === f)) && list.some((a) => (l.ctx + l.raw).includes(a)));
  return {
    bare: lits.filter((l) => l.han && !l.wrap && !allowed(l)),
    problems: lits.filter((l) => l.problem),
    keys,
  };
}

// ---- 直接运行 ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '');
if (isMain) {
  const root = path.resolve(import.meta.dirname ?? '.', '..');
  const allowFile = path.join(root, 'tools', 'i18n-allow.json');
  const allow = fs.existsSync(allowFile) ? (JSON.parse(fs.readFileSync(allowFile, 'utf8')) as Record<string, string[]>) : {};
  const r = report(path.join(root, 'src'), allow);
  const dumpAt = process.argv.indexOf('--dump');
  const byFile = (list: Lit[]): Map<string, Lit[]> => {
    const m = new Map<string, Lit[]>();
    for (const l of list) m.set(l.file, [...(m.get(l.file) ?? []), l]);
    return m;
  };
  console.log(`keys: ${r.keys.size}   bare Han literals: ${r.bare.length}   problems: ${r.problems.length}`);
  for (const [f, list] of [...byFile(r.bare)].sort((a, b) => b[1].length - a[1].length)) console.log(`  bare ${String(list.length).padStart(4)}  ${f}`);
  for (const l of r.problems) console.log(`  PROBLEM ${l.file}:${l.line} ${l.problem}\n    ${l.raw.slice(0, 100)}`);
  if (process.argv.includes('--bare')) for (const l of r.bare) console.log(`${l.file}:${l.line}  ${l.raw.replace(/\s+/g, ' ').slice(0, 140)}`);
  for (const lang of ['en', 'ja']) {
    const mod = (await import(`../src/i18n/${lang}/index.ts`)) as { default: Record<string, unknown> };
    const dict = mod.default;
    const miss = [...r.keys].filter(([k]) => !(k in dict));
    const stale = Object.keys(dict).filter((k) => !r.keys.has(k));
    console.log(`${lang}: ${Object.keys(dict).length} entries, missing ${miss.length}, stale ${stale.length}`);
    if (process.argv.includes('--stale')) for (const k of stale) console.log(`  stale: ${k.slice(0, 80)}`);
    if (dumpAt > 0) {
      const dir = path.resolve(process.argv[dumpAt + 1]);
      fs.mkdirSync(dir, { recursive: true });
      const g: Record<string, string[]> = {};
      for (const [k, f] of miss) (g[f] ??= []).push(k);
      fs.writeFileSync(path.join(dir, `missing-${lang}.json`), JSON.stringify(g, null, 1));
    }
  }
}
