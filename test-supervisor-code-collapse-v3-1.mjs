import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CODE_ROW_LIMIT, selectCodeRows } from './public/supervisor-code-collapse.js';

const rows = Object.freeze(Array.from({ length: 487 }, (_, idx) => Object.freeze({
  code: String(idx).padStart(3, '0'),
  reached: idx < 12,
  near: idx >= 12 && idx < 19,
  total: idx + 1,
})));
assert.equal(CODE_ROW_LIMIT, 20);
for (const [filter, expected] of [['all',487],['over',12],['near',19]]) {
  const collapsed = selectCodeRows(rows, filter, false);
  const expanded = selectCodeRows(rows, filter, true);
  assert.equal(collapsed.visible.length, Math.min(expected,20));
  assert.equal(expanded.visible.length, expected);
  assert.equal(collapsed.matched.length, expected);
  assert.equal(collapsed.hasMore, expected > 20);
  assert.deepEqual(collapsed.visible, expanded.visible.slice(0, 20));
}
assert.deepEqual(selectCodeRows(rows, 'over', false).visible.map(x => x.code), rows.slice(0,12).map(x => x.code));
assert.equal(selectCodeRows(rows.slice(0,20), 'all', false).hasMore, false);
assert.equal(selectCodeRows(rows.slice(0,21), 'all', false).hasMore, true);
assert.equal(selectCodeRows(rows.slice(0,19), 'all', false).visible.length, 19);
assert.equal(selectCodeRows([], 'all', false).visible.length, 0);
assert.equal(selectCodeRows(rows, 'near', true).matched.length, 19);
const highRisk = rows.map((r,i)=>({...r,reached:i>=450}));
const highCollapsed = selectCodeRows(highRisk, 'over', false);
assert.equal(highCollapsed.matched.length,37);
assert.equal(highCollapsed.visible.length,20);
assert.equal(highCollapsed.hasMore,true);
assert.equal(highCollapsed.visible[0].code,'450');
assert.equal(rows.length, 487);

const ui = fs.readFileSync('public/supervisor-category-ceiling.js', 'utf8');
const html = fs.readFileSync('public/supervisor-category-ceiling.html', 'utf8');
const calc = fs.readFileSync('public/supervisor-category-ceiling-calc.js', 'utf8');
assert.match(ui, /selectCodeRows\(\s*c\.records, \$\('filter'\)\.value, expandedCodeCategories\.has\(category\)\)/);
assert.match(ui, /for \(const r of visible\)/);
assert.match(ui, /setAttribute\('aria-expanded', String\(expandedCodeCategories\.has\(category\)\)\)/);
assert.match(ui, /`ย่อเหลือ \${CODE_ROW_LIMIT} รหัส`/);
assert.match(ui, /\$\('announcement'\)\.textContent = notice/);
assert.match(ui, /buildCeilingReport\(snapshot\.rows, snapshot\.profiles, preferences\)/);
assert.match(html, /\.code-list-expanded\{max-height:440px/);
assert.match(html, /\.code-list-expanded th\{position:sticky/);
assert.doesNotMatch(ui, /\.innerHTML/);
assert.match(calc, /buildAnnouncement\(categories, date, completeScope/);
console.log('PASS: default 20 per category, full 487 expansion, filter-first collapse, 20/21 boundary');
console.log('PASS: summary/announcement full scope; per-category accessible controls; no Accounting changes');
console.log('SOURCE_MUTATION=NO; DB_QUERY=NO; LINE_SEND=NO');
