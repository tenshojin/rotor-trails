// 把 dist/index.html 转成 claude.ai Artifact 的私有试玩页（一个完整的 HTML 文档）。
// 用法：npm run build && node tools/artifact-page.mjs tmp/artifact/index.html（tmp/ 不进仓库）
// 输出页面引用 assets/ 下的 JS，以及 models/、textures/、draco/、ui/ 下的模型、贴图、Draco 解码器和菜单图片
// （都作为 Artifact 的附属文件发布）；CSS 直接内联。
// .glb 模型转成 base64 文本（Artifact 不托管 .glb），写在输出页面旁边的 models/ 目录里。
// 大峡谷（real/）不发布：中圈影像一个文件 21 MB，超过 Artifact 单个文件 20 MiB 的上限，30 厘米影像又在另一个网站上
// （Artifact 里访问别的网站会被拦）。页面里设 window.__artifact = true，游戏在这里不列出真实地形的地图。
// 发布（每次最多 64 MiB、256 个文件）：先发 models/ 下的文件，再发其余文件和 index.html，同时删掉旧版本留下、这次没有的文件。
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
// 预加载的分块（three、rapier）：和入口一起开始下载。不带 crossorigin，和下面的入口脚本一样，否则浏览器会再下一遍
const preloads = [...html.matchAll(/<link rel="modulepreload" crossorigin href="\.\/(assets\/[^"]+\.js)">/g)].map((m) => `<link rel="modulepreload" href="${m[1]}">`).join('\n');
// 样式表两样都放：内联一份（页面一定有样式），再链接一份 assets/ 里的同一个文件。游戏本体是入口定好语言以后动态加载的，
// 加载它的那段代码会先确认样式表在不在页面上：看到这个链接就不再自己插；不然它自己插一个，万一那个文件没加载成功，整个游戏就不启动了
// 网页图标是内嵌的 SVG（data: 网址，Artifact 允许），照搬
const icon = html.match(/<link rel="icon" href="data:[^"]*" \/>/)?.[0] ?? '';
const css = fs.readFileSync(path.join('dist', cssHref), 'utf8');
// public/ 下的模型与贴图（构建时原样复制到 dist/）：游戏按相对路径加载，Artifact 里也发布在同样的路径
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// Include emitted WASM and other dependencies, not only JS entry chunks.
const assets = walk('dist/assets').map((f) => path.relative('dist/assets', f).split(path.sep).join('/'));
const media = ['models', 'textures', 'draco', 'ui'].filter((d) => fs.existsSync(path.join('dist', d))).flatMap((d) => walk(path.join('dist', d))).map((f) => path.relative('dist', f).split(path.sep).join('/'));
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

const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title}</title>
${icon}
${preloads}
<style>
:root { color-scheme: dark; }
${headStyle.trim()}
</style>
<style>
${css.trim()}
</style>
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
${body}
<script>window.__modelExt = '.txt'; window.__artifact = true;</script>
<script type="module" src="${entry}"></script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(JSON.stringify({ page: out, bytes: page.length, files: Object.fromEntries([...assets.map((f) => [`assets/${f}`, `dist/assets/${f}`]), ...files, ['licenses.md', 'dist/licenses.md']]) }, null, 2));
