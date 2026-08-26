import fs from 'node:fs';
import assert from 'node:assert/strict';
const css = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');
assert.match(css, /v7\.9: comfortable inner gutters/);
assert.match(css, /\.board-code-row\{padding-left:16px;padding-right:16px\}/);
assert.match(css, /\.board-column-head\{padding-left:16px;padding-right:16px\}/);
assert.match(css, /\.one-digit-code\{padding-left:12px;padding-right:12px\}/);
assert.match(css, /\.g-code\{padding-left:12px;padding-right:12px\}/);
console.log('PASS: code column inner gutters v7.9 smoke tests');
