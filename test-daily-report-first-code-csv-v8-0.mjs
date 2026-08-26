import fs from 'node:fs';
import assert from 'node:assert/strict';
import { firstLedgerCode } from './src/lib/report-ledger.mjs';

assert.equal(firstLedgerCode([
  {id:1,category:'A',code:'03'},
  {id:2,category:'A',code:'04'},
  {id:3,category:'A',code:'05'},
], '05//06//15//16\n03//04//13//14\n=25 บลก'), '05');

assert.equal(firstLedgerCode([
  {id:1,category:'E',code:'899'},
  {id:2,category:'E',code:'989'},
  {id:3,category:'E',code:'998'},
], '998=100 ทุกกลับ'), '998');

assert.equal(firstLedgerCode([
  {id:1,category:'H',code:'1'},
  {id:2,category:'H',code:'3'},
], 'วิ่งบน 1 3=500'), 'H1');

assert.equal(firstLedgerCode([
  {id:10,category:'B',code:'01'},
  {id:11,category:'B',code:'02'},
], ''), '01');

const app = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const reportFn = fs.readFileSync(new URL('./netlify/functions/accounting-report.mjs', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('./supabase/migrations/202608260020_add_message_first_order_code.sql', import.meta.url), 'utf8');

assert.match(html, /id="exportReportCsvButton"/);
assert.match(app, /<th>รหัสแรก<\/th>/);
assert.match(app, /function buildDailyReportCsv\(/);
assert.match(app, /\\uFEFF/);
assert.match(app, /daily-report-\$\{payload\.session\.business_date/);
assert.match(reportFn, /first_code:firstCode/);
assert.match(reportFn, /raw_text,normalized_text,ocr_text,first_order_code/);
assert.match(migration, /add column if not exists first_order_code text/);
assert.doesNotMatch(migration, /update public\.messages/);

console.log('PASS: daily report first-code column + CSV export v8.0 smoke tests');
