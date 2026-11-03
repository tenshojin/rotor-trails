import { defineConfig } from 'vite';

// 相对路径 base：构建产物可以部署在任意子路径下（例如 GitHub Pages 的 /rotor-trails/）。
export default defineConfig({
  base: './',
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
