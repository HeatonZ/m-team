import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // setup-sdk-mock.js 已删除 — SDK helpers 和 createTestPluginApi 移至 helpers/testApi.js
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,ts}'],
    alias: [
      {
        // 匹配 import from 'openclaw/plugin-sdk/core'
        find: /^openclaw\/plugin-sdk\/core$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      {
        // 匹配 import from 'openclaw' (bare specifier)
        find: /^openclaw$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'node_modules/**']
    }
  }
});
