
import { jsonResult } from 'openclaw/plugin-sdk/core';

const result = jsonResult({ taskId: 'test_123' });
console.log('jsonResult result:', JSON.stringify(result, null, 2));

// Simulate extract
function extract(r) {
    console.log('extract input type:', typeof r, Array.isArray(r) ? 'array' : '');
    console.log('extract input keys:', r ? Object.keys(r) : 'null/undefined');
    if (r && Array.isArray(r.content)) {
        console.log('has content array');
        const text = r.content.find?.((c) => c.type === 'text') ?? r.content[0];
        console.log('text block:', text);
        if (text?.text) {
            try {
                return JSON.parse(text.text);
            } catch (e) {
                console.log('JSON parse error:', e.message);
            }
        }
        return r.content;
    }
    if (r && r.ok === true) return r.data;
    return r;
}

const extracted = extract(result);
console.log('extracted:', extracted);
