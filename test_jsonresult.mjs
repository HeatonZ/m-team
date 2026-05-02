
import { jsonResult } from 'openclaw/plugin-sdk/core';
const r = jsonResult({ taskId: 'test_123' });
console.log('type:', typeof r);
console.log('isArray:', Array.isArray(r));
if (r && typeof r === 'object') {
    console.log('keys:', Object.keys(r));
    if (r.content) console.log('content:', JSON.stringify(r.content));
    if (r.ok !== undefined) console.log('ok:', r.ok);
    if (r.data !== undefined) console.log('data:', JSON.stringify(r.data));
}
