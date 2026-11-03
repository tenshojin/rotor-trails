import { defineConfig } from 'vitest/config';

// 开发工具（地图俯视图、航线净空可视化），不属于常规测试。
export default defineConfig({
  test: {
    include: ['tools/**/*.tool.ts'],
    environment: 'node',
    testTimeout: 600000,
  },
});
