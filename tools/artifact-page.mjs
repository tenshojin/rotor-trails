// 把 dist/index.html 转成 claude.ai Artifact 的页面格式（发布时平台会自动包上 <html><head><body> 骨架）。
// 用法：npm run build && node tools/artifact-page.mjs <输出的 html 路径>
// 输出页面引用 assets/ 下的 JS（作为 Artifact 的附属文件发布）；CSS 直接内联。
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('用法：node tools/artifact-page.mjs <输出的 html 路径>');
  process.exit(1);
}
const html = fs.readFileSync('dist/index.html', 'utf8');
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error('dist/index.html 中找不到 ' + what);
  return m[1];
};
const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const headStyle = pick(/<head>[\s\S]*?<style>([\s\S]*?)<\/style>/, '加载画面样式');
const entry = pick(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, '入口脚本');
const cssHref = pick(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, '样式表');
const body = pick(/<body>([\s\S]*?)<\/body>/, '<body>').replace(/<script type="module"[\s\S]*?<\/script>/g, '').trim();
const css = fs.readFileSync(path.join('dist', cssHref), 'utf8');
const assets = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js'));

const page = `<title>${title}</title>
<style>
:root { color-scheme: dark; }
${headStyle.trim()}
</style>
<style>
${css.trim()}
</style>
${body}
<script type="module" src="${entry}"></script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(JSON.stringify({ page: out, bytes: page.length, files: Object.fromEntries([...assets.map((f) => [`assets/${f}`, `dist/assets/${f}`]), ['licenses.md', 'dist/licenses.md']]) }, null, 2));
