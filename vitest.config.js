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
        // SDK helpers 指向 testApi.js（mock 实现）
        find: /^openclaw\/agents\/tools\/common$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      {
        // SDK core 也指向 testApi.js
        find: /^openclaw\/plugin-sdk\/core$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      {
        // plugin-test-api
        find: /^openclaw\/plugin-sdk\/plugin-test-api$/,
        replacement: path.resolve(__dirname, 'tests/helpers/testApi.js'),
      },
      {
        // bare openclaw
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
