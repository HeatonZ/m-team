import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup-sdk-mock.js', './tests/setup.js'],
    include: ['tests/**/*.test.{js,ts}'],
    alias: [
      {
        // 匹配 import from 'openclaw/plugin-sdk/core'
        find: /^openclaw\/plugin-sdk\/core$/,
        replacement: path.resolve(__dirname, 'tests/helpers/openclaw-plugin-sdk-core.js'),
      },
      {
        // 匹配 import from 'openclaw' (bare specifier)
        find: /^openclaw$/,
        replacement: path.resolve(__dirname, 'tests/helpers/openclaw-plugin-sdk-core.js'),
      },
    ],
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
