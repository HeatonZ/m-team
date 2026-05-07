/**
 * 从 src/types/tools.ts 读取 schema 对象，生成 src/types/tools.d.ts
 * 每次 build:plugin 前自动运行
 */

import { compile } from 'json-schema-to-typescript';
import path from 'node:path';
import fs from 'node:fs';

const TYPES_DIR = path.resolve('src/types');
const TOOLS_TS = path.resolve('src/types/tools.ts');

// 用动态 import 加载 ts 文件（ESM 兼容）
const toolsModule = await import('../src/types/tools.ts');
const tools = toolsModule;

const SCHEMAS = [
  'PublishTaskParams',
  'ClaimTaskParams',
  'CancelTaskParams',
  'CloseTaskParams',
  'CompleteTaskParams',
  'RejectTaskParams',
  'RelayTaskParams',
  'RelinquishTaskParams',
  'UpdateTaskParams',
  'GetPendingParams',
  'GetAgentActiveParams',
  'GetTaskParams',
  'GetAllTasksParams',
  'ContextOutputSchema',
];

async function generate() {
  const banner = `/**
 * 自动生成 — 请勿手动修改
 * 生成规则: json-schema-to-typescript
 * 源文件: src/types/tools.ts
 */`;

  const parts: string[] = [banner];

  for (const name of SCHEMAS) {
    if (!tools[name]) {
      console.warn(`[generate-tool-types] ${name} not found, skipping`);
      continue;
    }
    const schema = tools[name];
    const tsInterface = await compile(schema, name + 'Interface', {
      bannerComment: '',
      style: { singleQuote: true },
    });
    parts.push(tsInterface);
  }

  const output = parts.join('\n\n');
  const outputPath = path.join(TYPES_DIR, 'tools.d.ts');
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`[generate-tool-types] → ${outputPath} (${SCHEMAS.length} types)`);
}

generate().catch((err) => {
  console.error('[generate-tool-types] FAILED:', err);
  process.exit(1);
});
