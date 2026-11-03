// 把 dist/index.html 转成 claude.ai Artifact 的页面格式（发布时平台会自动包上 <html><head><body> 骨架）。
// 用法：npm run build && node tools/artifact-page.mjs <输出的 html 路径>
// 输出页面引用 assets/ 下的 JS 与 models/、textures/ 下的模型贴图（都作为 Artifact 的附属文件发布）；CSS 直接内联。
// .glb 模型转成 base64 文本（Artifact 不托管 .glb），写在输出页面旁边的 models/ 目录里。
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
// public/ 下的模型与贴图（构建时原样复制到 dist/）：游戏按相对路径加载，Artifact 里也发布在同样的路径
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const media = ['models', 'textures', 'draco'].filter((d) => fs.existsSync(path.join('dist', d))).flatMap((d) => walk(path.join('dist', d))).map((f) => path.relative('dist', f).split(path.sep).join('/'));
// Artifact 不托管 .glb：转成 base64 文本（<名字>.glb.txt）放在输出页面旁边，游戏里由 src/render/gltf.ts 解码
const outDir = path.dirname(path.resolve(out));
const files = [];
for (const f of media) {
  if (!f.endsWith('.glb')) {
    files.push([f, `dist/${f}`]);
    continue;
  }
  const dst = path.join(outDir, f + '.txt');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, fs.readFileSync(path.join('dist', f)).toString('base64'));
  files.push([f + '.txt', dst.split(path.sep).join('/')]);
}

const page = `<title>${title}</title>
<style>
:root { color-scheme: dark; }
${headStyle.trim()}
</style>
<style>
${css.trim()}
</style>
${body}
<script>window.__modelExt = '.txt';</script>
<script type="module" src="${entry}"></script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(JSON.stringify({ page: out, bytes: page.length, files: Object.fromEntries([...assets.map((f) => [`assets/${f}`, `dist/assets/${f}`]), ...files, ['licenses.md', 'dist/licenses.md']]) }, null, 2));
