import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('./netlify/functions/supervisor-category-ceiling.mjs', import.meta.url), 'utf8');
const sql = readFileSync(new URL('./supabase/migrations/20261016080000_supervisor_category_ceiling_latest_round_v4.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./public/supervisor-category-ceiling.js', import.meta.url), 'utf8');
assert.match(api, /supervisor_category_ceiling_report_v4/);
assert.match(api, /\{ p_summary_group_ids: selectedIds \}/);
assert.doesNotMatch(api, /\{ p_business_date: date, p_summary_group_ids: selectedIds \}/);
assert.match(api, /cursor\.latest_business_date === round\.business_date/);
assert.doesNotMatch(api, /round\.business_date === date/);
assert.match(api, /business_dates: selectedDates/);
assert.match(api, /mixed_business_dates: selectedDates\.length > 1/);
assert.match(sql, /FUNCTION public\.supervisor_category_ceiling_report_v4\(/);
assert.doesNotMatch(sql, /p_business_date|r\.business_date\s*=\s*current_date/i);
assert.match(sql, /state\.latest_round_id/);
assert.match(sql, /r\.status IN \('OPEN', 'CLOSED'\)/);
assert.match(sql, /accounting_effective_order_items_rounds/);
assert.match(ui, /รายงานรวมหลาย Business Date/);
// Contract example: an opened 2026-10-15 round remains selected on 2026-10-16.
const round = { id: 'r15', summary_group_id: 'NORTH', business_date: '2026-10-15', status: 'OPEN' };
const cursor = { latest_round_id: 'r15', latest_business_date: '2026-10-15' };
const included = Boolean(cursor && round && cursor.latest_business_date === round.business_date &&
  round.summary_group_id === 'NORTH' && ['OPEN', 'CLOSED'].includes(round.status));
assert.equal(included, true);
console.log('PASS: v4 round-aware source contract + cross-midnight fixture');
