import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,ts}'],
    alias: [
      {
        // helpers.ts 和 src/tools/index.ts 中的 SDK helpers（jsonResult/readStringParam/
        // ToolInputError 等）→ testApi.js 本地 mock，与 SDK 签名兼容
        find: /^openclaw\/plugin-sdk\/core$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      {
        // 同上，openclaw/agents/tools/common 也 alias 到同一文件
        find: /^openclaw\/agents\/tools\/common$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      // openclaw/plugin-sdk/plugin-test-api 保持走官方 SDK
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'node_modules/**']
    }
  }
});
