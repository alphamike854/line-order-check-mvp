import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('./netlify/functions/supervisor-category-ceiling.mjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./public/supervisor-category-ceiling.js', import.meta.url), 'utf8');
assert.match(api, /const READ_TIMEOUT_MS = 9000/); // Group selection retains bounded short deadline.
assert.match(api, /const REFRESH_READ_TIMEOUT_MS = 20000/);
assert.match(api, /readTimeoutMs = queryParams\.get\('refresh'\) === '1'/);
assert.match(api, /readReport\(bangkokToday\(\), requested\.length \? requested : null, readTimeoutMs\)/);
assert.match(api, /setTimeout\(\(\) => controller\.abort\(\), readTimeoutMs\)/);
for (const label of ['enabled_groups','round_cursors','accounting_rpc','round_details','point_profiles']) {
  assert.ok(api.includes(`'${label}'`), `missing stage ${label}`);
}
assert.match(api, /if \(elapsedMs >= 5000\) console\.warn/);
assert.match(ui, /async function load\(manualRefresh = false\)/);
assert.match(ui, /if \(manualRefresh\) params\.set\('refresh', '1'\)/);
assert.match(ui, /const preservePrevious = manualRefresh && Boolean\(snapshot\)/);
assert.match(ui, /\$\('copy'\)\.disabled = snapshotStale \|\| !notice/);
assert.match(ui, /if \(preservePrevious\) \{\s+\/\/ Keep last successfully fetched totals visible/);
assert.match(ui, /\$\('refresh'\)\.addEventListener\('click', \(\) => load\(true\)\)/);
assert.match(ui, /reportRequestController\.abort\(\)/); // Existing coalescing unaffected.
assert.match(api, /supervisor_category_ceiling_report_v4/); // Accounting unchanged.
assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
console.log('PASS: only manual refresh has 20s deadline; all group reads remain 9s');
console.log('PASS: named stage timing / stale totals preserved / stale copy blocked');
console.log('SOURCE_MUTATION=NO; DB_MUTATION=NO; LINE_SEND=NO');
