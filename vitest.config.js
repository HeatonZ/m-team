import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // 每个测试文件共享同一个 DB 实例（setupFiles 已初始化）
    // test 文件 import 的模块如果再次调用 init()，需确保 DB_PATH 已设置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'node_modules/**']
    }
  }
});
