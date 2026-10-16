import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('./public/supervisor-category-ceiling.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('./netlify/functions/supervisor-category-ceiling.mjs', import.meta.url), 'utf8');
assert.match(ui, /GROUP_RELOAD_DEBOUNCE_MS = 700/);
assert.match(ui, /function queueGroupReload\(\)/);
assert.match(ui, /clearTimeout\(groupReloadTimer\)/);
assert.match(ui, /reportRequestController\.abort\(\)/);
assert.match(ui, /signal: controller\.signal/);
assert.match(ui, /renderGroupSelector\(\);\s+queueGroupReload\(\);/);
assert.match(ui, /if \(reportRequestController === controller\) reportRequestController = null/);
assert.match(ui, /if \(requestId !== activeRequest\) return/);
assert.match(api, /supervisor_category_ceiling_report_v4/);
assert.match(api, /READ_TIMEOUT_MS = 9000/); // no server timeout modification
console.log('PASS: UI coalescing/abort guard, V4 RPC intact, no server timeout changes');
