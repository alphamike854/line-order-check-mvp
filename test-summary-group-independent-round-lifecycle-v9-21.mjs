"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260902043000_add_independent_summary_group_round_lifecycle.sql",
  "utf8",
);

const settlementApi = fs.readFileSync(
  "netlify/functions/settlement.mjs",
  "utf8",
);

const app = fs.readFileSync(
  "public/app.js",
  "utf8",
);

console.log(
  "===== Independent Summary Group Round Lifecycle v9.21 =====",
);


// R2C-01
assert.match(
  migration,
  /settlement_summary_group_round_snapshots/,
);

assert.match(
  migration,
  /round_id uuid primary key/i,
);

console.log(
  "PASS R2C-01: closed Round retains compact final snapshot",
);


// R2C-02
assert.match(
  migration,
  /settlement_round_storage_cleanup_queue/,
);

assert.match(
  migration,
  /'PENDING'[\s\S]*'DELETED'[\s\S]*'FAILED'/,
);

console.log(
  "PASS R2C-02: Review evidence cleanup is retry-safe",
);


// R2C-03
assert.match(
  migration,
  /drop trigger if exists[\s\S]*settlement_summary_group_control_round_trg/i,
);

assert.match(
  migration,
  /drop trigger if exists[\s\S]*settlement_line_group_config_round_trg/i,
);

console.log(
  "PASS R2C-03: compatibility triggers cannot auto-open or reopen Round 1",
);


// R2C-04
const acceptingFunction =
  migration.match(
    /create or replace function\s+public\.is_settlement_summary_group_accepting[\s\S]*?\$\$;/i,
  )?.[0] ?? "";

assert.match(
  acceptingFunction,
  /settlement_summary_group_rounds/,
);

assert.match(
  acceptingFunction,
  /r\.status = 'OPEN'/,
);

assert.doesNotMatch(
  acceptingFunction,
  /settlement_summary_group_controls/,
);

console.log(
  "PASS R2C-04: Round state is authoritative accepting state",
);


// R2C-05
const lifecycleFunction =
  migration.match(
    /create or replace function\s+public\.set_settlement_summary_group_accepting[\s\S]*?end;\s*\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  lifecycleFunction,
  "Round lifecycle RPC must exist",
);

assert.match(
  lifecycleFunction,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
);

assert.match(
  lifecycleFunction,
  /SETTLEMENT_SUMMARY_GROUP_CONTROL/,
);

console.log(
  "PASS R2C-05: lifecycle transition uses global then group boundary",
);


// R2C-06
assert.match(
  lifecycleFunction,
  /status = 'CLOSED'[\s\S]*closed_at = v_changed_at/,
);

assert.doesNotMatch(
  lifecycleFunction,
  /update\s+public\.settlement_sessions[\s\S]*status\s*=\s*'CLOSED'/i,
);

console.log(
  "PASS R2C-06: CLOSE_GROUP closes only Summary Group Round",
);


// R2C-07
assert.match(
  lifecycleFunction,
  /v_next_round_no[\s\S]*coalesce\([\s\S]*v_previous_round_no[\s\S]*0[\s\S]*\)\s*\+\s*1/,
);

assert.match(
  lifecycleFunction,
  /insert into[\s\S]*settlement_summary_group_rounds[\s\S]*'OPEN'/,
);

console.log(
  "PASS R2C-07: reopening creates next numbered Round",
);


// R2C-08
assert.match(
  lifecycleFunction,
  /m\.summary_group_round_id\s*=\s*v_previous_round_id/,
);

assert.match(
  lifecycleFunction,
  /m\.settlement_session_id\s*=\s*p_settlement_session_id/,
);

assert.match(
  lifecycleFunction,
  /m\.summary_group_id\s*=\s*p_summary_group_id/,
);

console.log(
  "PASS R2C-08: message reset is scoped to previous Round and parent/group",
);


// R2C-09
const reviewDelete =
  lifecycleFunction.indexOf(
    "delete from\n      public.review_resolution_events",
  );

const unsendDelete =
  lifecycleFunction.indexOf(
    "delete from\n      public.unsend_events",
  );

const messageDelete =
  lifecycleFunction.indexOf(
    "delete from public.messages",
  );

assert.ok(
  reviewDelete >= 0
  && unsendDelete > reviewDelete
  && messageDelete > unsendDelete,
  "FK-safe purge order must precede messages delete",
);

console.log(
  "PASS R2C-09: NO ACTION Review/Unsend FKs are cleared first",
);


// R2C-10
for (const table of [
  "settlement_transfer_batches",
  "settlement_distribution_runs",
  "settlement_allocation_confirmations",
  "allocation_confirmation_events",
  "settlement_summary_group_actual_special_point_codes",
]) {
  assert.match(
    lifecycleFunction,
    new RegExp(
      `delete from\\s+public\\.${table}`,
      "i",
    ),
  );
}

console.log(
  "PASS R2C-10: round operational state resets before reopen",
);


// R2C-11
assert.doesNotMatch(
  lifecycleFunction,
  /delete from\s+public\.settlement_point_promotions/i,
);

assert.doesNotMatch(
  lifecycleFunction,
  /delete from\s+public\.settlement_point_promotion_events/i,
);

assert.doesNotMatch(
  lifecycleFunction,
  /delete from\s+public\.settlement_allocation_rules/i,
);

assert.doesNotMatch(
  lifecycleFunction,
  /delete from\s+public\.settlement_line_group_config/i,
);

console.log(
  "PASS R2C-11: Promotion and compatibility config are preserved",
);


// R2C-12
assert.match(
  lifecycleFunction,
  /settlement_summary_group_control_events/,
);

assert.match(
  lifecycleFunction,
  /previous_accepting_orders/,
);

assert.match(
  lifecycleFunction,
  /new_accepting_orders/,
);

console.log(
  "PASS R2C-12: existing lifecycle audit contract remains",
);


// R2C-13
assert.doesNotMatch(
  lifecycleFunction,
  /delete from\s+public\.settlement_summary_group_rounds/i,
);

assert.match(
  lifecycleFunction,
  /settlement_summary_group_round_snapshots/,
);

console.log(
  "PASS R2C-13: historical Round identity survives operational purge",
);


// R2C-14
assert.match(
  settlementApi,
  /settlement_round_storage_cleanup_queue/,
);

assert.match(
  settlementApi,
  /\.from\(bucket\)[\s\S]*\.remove\(cleanupPaths\)/,
);

assert.match(
  settlementApi,
  /status:\s*"FAILED"/,
);

assert.match(
  settlementApi,
  /status:\s*"DELETED"/,
);

console.log(
  "PASS R2C-14: API performs best-effort Storage cleanup after DB reset",
);


// R2C-15
assert.match(
  app,
  /เปิดรอบใหม่ \$\{label\}/,
);

assert.match(
  app,
  /ล้างข้อมูลปฏิบัติการ/,
);

assert.match(
  app,
  /กลุ่มอื่นจะไม่ถูกกระทบ/,
);

console.log(
  "PASS R2C-15: UI explicitly confirms destructive per-group reset",
);


// R2C-16
assert.doesNotMatch(
  migration,
  /['"]POST_CLOSE['"]/,
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.resolve_review_with_items/i,
);

console.log(
  "PASS R2C-16: POST_CLOSE and closed-round Review remain outside this phase",
);


// R2C-17
assert.match(
  settlementApi,
  /settlement_summary_group_rounds/,
);

assert.doesNotMatch(
  settlementApi.match(
    /async function loadSummaryGroupStates[\s\S]*?async function getPayload/,
  )?.[0] ?? "",
  /settlement_summary_group_controls/,
);

assert.match(
  settlementApi,
  /has_previous_round/,
);

assert.match(
  settlementApi,
  /"NOT_STARTED"/,
);

console.log(
  "PASS R2C-17: settlement API derives group state from Round ownership",
);


// R2C-18
assert.match(
  lifecycleFunction,
  /v_next_round_no[\s\S]*coalesce\([\s\S]*v_previous_round_no[\s\S]*0[\s\S]*\)\s*\+\s*1/,
);

assert.match(
  lifecycleFunction,
  /if v_previous_round_id is not null then[\s\S]*settlement_summary_group_round_snapshots/,
);

console.log(
  "PASS R2C-18: first OPEN creates round 1 without previous-round reset",
);


// R2C-19
assert.match(
  app,
  /เปิดรอบแรก \$\{label\}/,
);

assert.match(
  app,
  /data-has-previous-round/,
);

assert.match(
  app,
  /ยังไม่เปิดรอบ/,
);

console.log(
  "PASS R2C-19: UI distinguishes NOT_STARTED from CLOSED Round",
);


// R2C-20
assert.match(
  app,
  /กลุ่มอื่นจะยังไม่เปิดจนกว่าจะสั่งเปิดแยก/,
);

console.log(
  "PASS R2C-20: initial Summary Group opening is explicitly independent",
);


console.log(
  "PASS: Independent Summary Group Round Lifecycle v9.21",
);
