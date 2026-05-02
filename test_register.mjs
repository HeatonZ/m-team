
import { createTestPluginApi } from 'openclaw/plugin-sdk/plugin-test-api.js';

const tools = new Map();

const base = createTestPluginApi({
  pluginConfig: {},
  logger: { info() {}, warn() {}, error() {}, debug() {} },
});

const originalRegisterTool = base.registerTool.bind(base);
base.registerTool = (tool, opts = {}) => {
  console.log('registerTool called, tool name:', tool.name);
  console.log('tool type:', typeof tool);
  console.log('tool.execute type:', typeof tool.execute);
  tools.set(tool.name, {
    name: tool.name,
    execute: typeof tool.execute === 'function' ? tool.execute.bind(tool) : undefined,
    parameters: tool.parameters,
  });
  originalRegisterTool(tool, opts);
};

// Now register a simple tool
base.registerTool({
  name: 'test_tool',
  description: 'test',
  parameters: { type: 'object', properties: {} },
  async execute(toolCallId, rawParams) {
    console.log('execute called with params:', JSON.stringify(rawParams));
    return { content: [{ type: 'text', text: '{"ok":true,"data":{"taskId":"test_123"}}' }] };
  },
});

const tool = tools.get('test_tool');
console.log('stored tool:', tool ? tool.name : 'NOT FOUND');
if (tool) {
  const result = await tool.execute('call-1', { foo: 'bar' });
  console.log('execute result:', JSON.stringify(result, null, 2));
}
