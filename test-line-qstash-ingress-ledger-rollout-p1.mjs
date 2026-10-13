import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pub = fs.readFileSync('netlify/functions/line-webhook.mjs', 'utf8');
const con = fs.readFileSync('netlify/functions/line-webhook-qstash.mjs', 'utf8');
const start = pub.indexOf('export async function completeLineQStashIngressEvent(');
const end = pub.indexOf('\nasync function selectQStashIngressEvents(', start);
assert.ok(start >= 0 && end > start, 'exact completion function exists');
const section = pub.slice(start, end);
assert.doesNotMatch(section, /isLineQStashIngressLedgerEnabled\s*\(/);
assert.match(section, /if \(ledgerEnrolled !== true\) return;/);
assert.match(section, /QSTASH_INGRESS_LEDGER_HINT_MISSING/);
assert.match(section, /QSTASH_INGRESS_RESERVED_EVENT_NOT_APPLIED/);
assert.match(pub, /ingress_ledger_v1:\s*isLineQStashIngressLedgerEnabled\(\)\s*&& isLineOrderIngressMessage\(event\)/);
assert.match(con, /ledgerEnrolled\s*=\s*payload\?\.ingress_ledger_v1 === true/);
assert.match(con, /completeLineQStashIngressEvent\(\s*event, admission, result, ledgerEnrolled,/);

let calls = [];
let failDB = false;
const scope = {
  isLineOrderIngressMessage: (e) => e?.type === 'message' && e?.message?.type === 'image',
  validTemporalAdmissionHint: (hint) => hint?.round_id ? hint : null,
  supabase: {rpc: async (...a) => {calls.push(a); return {error: failDB ? {message:'DOWN'} : null};}},
};
vm.createContext(scope);
vm.runInContext(section.replace('export async function ', 'async function ') + '\nthis.complete = completeLineQStashIngressEvent;', scope);
const test = scope.complete;
const event = {type:'message',message:{type:'image'},webhookEventId:'ev-1'};
const hint = {round_id:'round-1'};

await test(event, null, {status:'PENDING'}, false); // Legacy unmarked job on enabled deployment.
assert.equal(calls.length, 0, 'legacy job does not require ledger');
await test(event, hint, {status:'PENDING'}, true); // Flagged job on normal or rollback deployment.
assert.equal(calls.length, 1, 'enrolled job completes once');
assert.equal(calls[0][0], 'complete_line_qstash_ingress_event');
assert.equal(calls[0][1].p_webhook_event_id, 'ev-1');
assert.equal(calls[0][1].p_summary_group_round_id, 'round-1');
await assert.rejects(test(event, null, {status:'PENDING'}, true), /HINT_MISSING/);
await assert.rejects(test(event, hint, {status:'IGNORED'}, true), /RESERVED_EVENT_NOT_APPLIED/);
await assert.rejects(test({...event, type:'unsend'}, hint, {}, true), /EVENT_TYPE_MISMATCH/);
failDB = true;
await assert.rejects(test(event, hint, {status:'PENDING'}, true), /COMPLETE_FAILED/);

console.log('PASS: legacy QStash job does not require ledger');
console.log('PASS: enrolled job completes independently of runtime flag');
console.log('PASS: fail-closed for missing hint, rejected application, bad event or DB failure');
console.log('PASS: source publication and consumer marker are consistent');
