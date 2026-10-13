import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261013100000_add_line_qstash_ingress_ledger_guard.sql','utf8');
const gateway = fs.readFileSync('netlify/functions/line-webhook.mjs','utf8');
const worker = fs.readFileSync('netlify/functions/line-webhook-qstash.mjs','utf8');

assert.match(migration,/create table if not exists public\.line_qstash_ingress_ledger/i);
assert.match(migration,/references public\.settlement_summary_group_rounds\(id\) on delete cascade/i);
assert.match(migration,/completed_at is null/i);
assert.match(migration,/create or replace function public\.reserve_line_qstash_ingress_event/i);
assert.match(migration,/create or replace function public\.complete_line_qstash_ingress_event/i);
assert.match(migration,/pg_advisory_xact_lock\([\s\S]*?LINE_ORDER_SETTLEMENT_OPEN_CLOSE/i);
assert.match(migration,/summary_group_round_runtime_state state[\s\S]*?state\.latest_round_id/i);
assert.match(migration,/lineage\.line_group_id = p_line_group_id/i);
assert.match(migration,/QSTASH_INGRESS_RESERVATION_IDENTITY_MISMATCH/i);
assert.match(migration,/retention_round_has_inflight_work[\s\S]*?line_qstash_ingress_ledger ledger[\s\S]*?ledger\.completed_at is null/i);
assert.match(migration,/grant execute on function public\.reserve_line_qstash_ingress_event[\s\S]*?to service_role/i);
assert.match(migration,/commit;\s*$/i);

const reserveCall = gateway.indexOf('await reserveLineQStashIngressEvent(event, admission.round_id, destination);');
const selectEvent = gateway.indexOf('selected.push(event);', reserveCall);
const publication = gateway.indexOf('qstash.publishJSON({');
assert.ok(reserveCall !== -1 && selectEvent > reserveCall && publication > reserveCall,
  'reserve before publication');
assert.match(gateway,/if \(isLineQStashIngressLedgerEnabled\(\)\) throw error;/);
assert.match(gateway,/QSTASH_INGRESS_LEDGER_UNAVAILABLE" \}, 503\)/);
assert.match(gateway,/LINE_QSTASH_INGRESS_LEDGER_ENABLED/);
const result = worker.indexOf('const result =');
const completed = worker.search(/await completeLineQStashIngressEvent\(\s*event, admission, result, ledgerEnrolled,\s*\)/);
const acknowledge = worker.indexOf('return json({\n      ok: true,\n    });', completed);
assert.ok(result >= 0 && completed > result && acknowledge > completed,
  'acknowledge only after completing ledger');
assert.match(gateway,/QSTASH_INGRESS_RESERVED_EVENT_NOT_APPLIED/);
assert.match(worker,/EVENT_IN_FLIGHT_RETRY/);
console.log('PASS: atomic ingress reservation + Round guard contract');
console.log('PASS: fail closed when ledger enabled, original fallback retained');
console.log('PASS: completion before QStash HTTP 200, retry on failure');
console.log('DB_RUNTIME_CONCURRENCY_TEST=NOT_RUN');
