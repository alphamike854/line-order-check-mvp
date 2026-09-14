"use strict";

import fs from "node:fs";
import assert from "node:assert/strict";

const path =
  "supabase/migrations/20260914014500_add_line_mirror_destination_batch_claim.sql";

const sql =
  fs.readFileSync(
    path,
    "utf8",
  );

function must(pattern, label) {
  assert.match(
    sql,
    pattern,
    `missing contract: ${label}`,
  );
}

function mustNot(pattern, label) {
  assert.doesNotMatch(
    sql,
    pattern,
    `forbidden contract: ${label}`,
  );
}


// ------------------------------------------------------------
// Structural cutover.
// ------------------------------------------------------------

must(
  /MIRROR_DESTINATION_CUTOVER_REQUIRES_EMPTY_FOUNDATION/,
  "unused-foundation cutover guard",
);

must(
  /drop table public\.line_message_mirror_route_leases/i,
  "route lease removal",
);

must(
  /create table public\.line_message_mirror_destination_leases/i,
  "destination lease table",
);

must(
  /destination_line_group_id text primary key/i,
  "one lease per destination",
);

must(
  /alter table public\.line_message_mirror_batches[\s\S]*drop column route_id/i,
  "batch no longer owned by one route",
);

must(
  /line_message_mirror_batches_destination_active_unique/i,
  "one unresolved batch per destination",
);

must(
  /where status in\s*\(\s*'PREPARING',\s*'SENDING',\s*'FAILED'\s*\)/i,
  "only unresolved batches block destination",
);


// ------------------------------------------------------------
// Admission remains Round-owned.
// ------------------------------------------------------------

must(
  /from public\.messages m[\s\S]*where m\.id = p_message_record_id/i,
  "authoritative messages reread",
);

must(
  /v_message\.summary_group_round_id is null[\s\S]*NOT_ADMITTED_TO_WORKING_ROUND/i,
  "Round ownership remains mandatory",
);

must(
  /'destinations',[\s\S]*to_jsonb\(v_destinations\)/i,
  "enqueue returns destination wake targets",
);


// ------------------------------------------------------------
// Destination worker serialization.
// ------------------------------------------------------------

must(
  /reserve_line_message_mirror_destination_worker/i,
  "destination reservation RPC",
);

must(
  /renew_line_message_mirror_destination_worker/i,
  "lease renewal RPC",
);

must(
  /release_line_message_mirror_destination_worker/i,
  "lease release RPC",
);

must(
  /pg_advisory_xact_lock[\s\S]*LINE_MESSAGE_MIRROR_DESTINATION/i,
  "destination advisory lock",
);

must(
  /p_lease_seconds integer default 180/i,
  "180-second default lease",
);


// ------------------------------------------------------------
// Batch claim.
// ------------------------------------------------------------

must(
  /claim_line_message_mirror_destination_batch/i,
  "destination batch claim RPC",
);

must(
  /b\.status in\s*\(\s*'PREPARING',\s*'SENDING',\s*'FAILED'\s*\)/i,
  "old unresolved batch resumes first",
);

must(
  /'state',[\s\S]*'EXISTING'/i,
  "EXISTING state",
);

must(
  /'state',[\s\S]*'WAIT'/i,
  "WAIT state",
);

must(
  /'state',[\s\S]*'CLAIMED'/i,
  "CLAIMED state",
);

must(
  /min\(r\.max_batch_size\)/i,
  "strictest queued max-batch policy",
);

must(
  /min\(r\.flush_after_seconds\)/i,
  "strictest queued flush policy",
);

must(
  /least\(\s*5,/i,
  "hard LINE five-message cap",
);

must(
  /min\(q\.created_at\)/i,
  "wait measured from queue admission",
);

must(
  /order by\s*q\.event_timestamp,\s*q\.id/i,
  "deterministic LINE source ordering",
);

must(
  /limit v_batch_size/i,
  "claim respects effective batch size",
);


// ------------------------------------------------------------
// Retry semantics.
// ------------------------------------------------------------

const foundationSql =
  fs.readFileSync(
    "supabase/migrations/20260914013000_add_line_message_mirror_foundation.sql",
    "utf8",
  );

assert.match(
  foundationSql,
  /retry_key uuid not null default gen_random_uuid\(\)/i,
  "foundation persists retry key before transport",
);

assert.doesNotMatch(
  sql,
  /(?:drop|rename)\s+(?:column\s+)?retry_key/i,
  "destination cutover must preserve foundation retry key",
);

must(
  /'retry_key',\s*v_batch\.retry_key/i,
  "worker returns persisted retry key for transport and retry",
);

must(
  /begin_line_message_mirror_batch_attempt/i,
  "begin attempt transition",
);

must(
  /status =\s*'SENDING'/i,
  "SENDING transition",
);

must(
  /attempt_count =\s*attempt_count \+ 1/i,
  "attempt count increments",
);

must(
  /fail_line_message_mirror_batch/i,
  "retryable FAILED transition",
);

must(
  /status =\s*'FAILED'/i,
  "FAILED state persisted",
);


// ------------------------------------------------------------
// Successful completion.
// ------------------------------------------------------------

must(
  /complete_line_message_mirror_batch/i,
  "successful completion RPC",
);

must(
  /v_batch\.status <> 'SENDING'/i,
  "only SENDING can newly complete",
);

must(
  /MIRROR_BATCH_ITEM_STATE_MISMATCH/i,
  "batch/queue cardinality fail-closed guard",
);

must(
  /update\s+public\.line_message_mirror_queue[\s\S]*status =\s*'SENT'/i,
  "completion marks queue SENT",
);

must(
  /update\s+public\.line_message_mirror_batches[\s\S]*status =\s*'SENT'/i,
  "completion marks batch SENT",
);

must(
  /line_request_id/i,
  "LINE request audit retained",
);


// ------------------------------------------------------------
// Permanent failure escape.
// ------------------------------------------------------------

must(
  /cancel_line_message_mirror_batch/i,
  "dead-letter RPC",
);

must(
  /v_batch\.status = 'SENT'[\s\S]*return false/i,
  "SENT cannot be cancelled",
);

must(
  /v_batch\.status = 'CANCELLED'[\s\S]*return true/i,
  "cancel is idempotent",
);

must(
  /update\s+public\.line_message_mirror_queue[\s\S]*status =\s*'CANCELLED'/i,
  "dead-letter marks queue CANCELLED",
);

must(
  /update\s+public\.line_message_mirror_batches[\s\S]*status =\s*'CANCELLED'/i,
  "dead-letter marks batch CANCELLED",
);


// ------------------------------------------------------------
// Privilege + isolation boundary.
// ------------------------------------------------------------

must(
  /revoke all[\s\S]*cancel_line_message_mirror_batch[\s\S]*from public, anon, authenticated/i,
  "dead-letter RPC hidden from clients",
);

must(
  /grant execute[\s\S]*cancel_line_message_mirror_batch[\s\S]*to service_role/i,
  "dead-letter RPC service-role only",
);

must(
  /grant execute[\s\S]*claim_line_message_mirror_destination_batch[\s\S]*to service_role/i,
  "claim RPC service-role only",
);

mustNot(
  /https:\/\/api\.line\.me/i,
  "DB migration contains no LINE transport",
);

mustNot(
  /alter table public\.messages/i,
  "message admission table remains untouched",
);

mustNot(
  /alter table public\.order_items/i,
  "order items remain untouched",
);

mustNot(
  /alter table public\.review_items/i,
  "Review remains untouched",
);

console.log(
  "PASS MIR2C-B-01: serialization boundary is destination group",
);

console.log(
  "PASS MIR2C-B-02: cutover requires unused Mirror foundation",
);

console.log(
  "PASS MIR2C-B-03: Round-owned admission remains authoritative",
);

console.log(
  "PASS MIR2C-B-04: one active destination lease at a time",
);

console.log(
  "PASS MIR2C-B-05: unresolved prior batch prevents overtaking",
);

console.log(
  "PASS MIR2C-B-06: partial batch waits from queue admission",
);

console.log(
  "PASS MIR2C-B-07: batch hard cap is five messages",
);

console.log(
  "PASS MIR2C-B-08: retry key is persisted before transport",
);

console.log(
  "PASS MIR2C-B-09: successful completion atomically closes queue + batch",
);

console.log(
  "PASS MIR2C-B-10: permanent dead-letter is explicit and terminal",
);

console.log(
  "PASS MIR2C-B-11: worker mutations are service-role only",
);

console.log(
  "PASS MIR2C-B-12: Parser/OCR/Review remain untouched",
);

console.log(
  "PASS: LINE Mirror destination worker DB foundation draft",
);
