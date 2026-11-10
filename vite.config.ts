import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';

/**
 * 入口（src/main.ts）先定语言、加载字典，再动态加载游戏本体（src/boot.ts）：字典要在地图、课程那些表建好之前到位。
 * 这样页面里只剩入口一个脚本，游戏本体、three.js、物理引擎和样式表要等语言定好才开始下载，比原来晚一拍。
 * 这里把它们写回页面的 <head>，和入口同时开始下：modulepreload 只下载、不执行，执行的先后不变；样式表照旧直接链接
 * （运行时加载游戏本体的那段代码看到页面上已经有同一个样式表，就不再插一遍）。
 * tools/artifact-page.mjs 也按这两种标签从 dist/index.html 里找样式表和要预加载的分块。
 */
function preloadGame(): Plugin {
  return {
    name: 'rotor-preload-game',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx): HtmlTagDescriptor[] {
        const files = Object.keys(ctx.bundle ?? {}).sort();
        const css = files.filter((f) => /^assets\/boot-[^/]+\.css$/.test(f));
        const js = files.filter((f) => /^assets\/(boot|three|rapier)-[^/]+\.js$/.test(f));
        return [
          ...css.map((f): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: true, href: `./${f}` }, injectTo: 'head' })),
          ...js.map((f): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `./${f}` }, injectTo: 'head' })),
        ];
      },
    },
  };
}

// 相对路径 base：构建产物可以部署在任意子路径下（例如 GitHub Pages 的 /rotor-trails/）。
export default defineConfig({
  base: './',
  plugins: [preloadGame()],
  build: {
    target: 'es2022',
    // Rapier 物理引擎把 WASM 以 base64 内嵌在 JS 里（约 3 MB），单独成块后超过默认提示阈值是预期的
    chunkSizeWarningLimit: 4500,
    sourcemap: false,
    // 构建时把所有打包进来的第三方库的许可证汇总到 dist/licenses.md，随网站一起发布
    license: { fileName: 'licenses.md' },
    rolldownOptions: {
      output: {
        // 第三方库单独成块：游戏代码更新时，浏览器缓存里的大文件（物理引擎、three.js）可以继续使用
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
