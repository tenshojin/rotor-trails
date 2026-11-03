import { defineConfig } from 'vite';

// 相对路径 base：构建产物可以部署在任意子路径下（例如 GitHub Pages 的 /rotor-trails/）。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
