
import { ToolInputError, readStringParam } from 'openclaw/plugin-sdk/core';

console.log('ToolInputError:', ToolInputError);
console.log('ToolInputError.name:', ToolInputError?.name);
console.log('ToolInputError.prototype:', ToolInputError?.prototype);

try {
  readStringParam({}, 'foo', { required: true });
} catch (e) {
  console.log('caught error type:', typeof e);
  console.log('caught error constructor:', e?.constructor?.name);
  console.log('is ToolInputError?', e instanceof ToolInputError);
  console.log('e.message:', e?.message);
  console.log('e.status:', e?.status);
}
