"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260901170000_add_summary_group_round_ownership.sql",
  "utf8",
);

console.log(
  "===== Summary Group Round Ownership v9.21 ====="
);


// R2B-01
assert.match(
  migration,
  /alter table public\.messages[\s\S]*summary_group_round_id uuid/i,
);

assert.match(
  migration,
  /alter table public\.order_items[\s\S]*summary_group_round_id uuid/i,
);

console.log(
  "PASS R2B-01: messages and order_items carry Round ownership",
);


// R2B-02
assert.match(
  migration,
  /messages_summary_group_round_fk/i,
);

assert.match(
  migration,
  /order_items_summary_group_round_fk/i,
);

assert.match(
  migration,
  /references[\s\S]*settlement_summary_group_rounds\(id\)/i,
);

console.log(
  "PASS R2B-02: Round ownership is FK protected",
);


// R2B-03
assert.match(
  migration,
  /update public\.messages[\s\S]*round_no = 1/i,
);

assert.match(
  migration,
  /update public\.order_items[\s\S]*m\.summary_group_round_id/i,
);

console.log(
  "PASS R2B-03: legacy message/order ownership is backfilled",
);


// R2B-04
assert.match(
  migration,
  /ensure_summary_group_round_for_config/,
);

assert.match(
  migration,
  /settlement_line_group_config_round_trg/,
);

console.log(
  "PASS R2B-04: future compatibility settlements receive round 1",
);


// R2B-05
assert.match(
  migration,
  /sync_legacy_summary_group_control_to_round/,
);

assert.match(
  migration,
  /settlement_summary_group_control_round_trg/,
);

assert.match(
  migration,
  /tg_op = 'DELETE'/i,
);

console.log(
  "PASS R2B-05: legacy group OPEN/CLOSE is mirrored into round state",
);


// R2B-06
assert.match(
  migration,
  /sync_closed_settlement_to_summary_group_rounds/,
);

assert.match(
  migration,
  /new\.status = 'CLOSED'/i,
);

console.log(
  "PASS R2B-06: parent close cannot leave mirrored OPEN rounds",
);


// R2B-07
assert.match(
  migration,
  /create or replace function[\s\S]*assign_message_to_open_settlement/,
);

assert.match(
  migration,
  /new\.summary_group_round_id\s*:=\s*v_round_id/i,
);

assert.match(
  migration,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
);

console.log(
  "PASS R2B-07: new messages receive Round ownership without changing global lock",
);


// R2B-08
assert.match(
  migration,
  /enforce_order_item_round_ownership/,
);

assert.match(
  migration,
  /new\.summary_group_round_id\s*:=\s*v_message_round_id/i,
);

assert.match(
  migration,
  /SUMMARY_GROUP_ROUND_MISMATCH/,
);

console.log(
  "PASS R2B-08: canonical items inherit authoritative message Round",
);


// R2B-09
assert.match(
  migration,
  /ROUND_SETTLEMENT_MISMATCH/,
);

assert.match(
  migration,
  /ROUND_SUMMARY_GROUP_MISMATCH/,
);

console.log(
  "PASS R2B-09: cross-settlement/group Round leakage is blocked",
);


// R2B-10
assert.doesNotMatch(
  migration,
  /delete from\s+public\.(messages|order_items|review_items|review_resolution_events|unsend_events)/i,
);

assert.doesNotMatch(
  migration,
  /truncate\s+/i,
);

console.log(
  "PASS R2B-10: ownership phase performs no Reset/Purge",
);


// R2B-11
assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.persist_parsed_message_atomic/i,
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.resolve_review_with_items/i,
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.resolve_review_with_preview/i,
);

console.log(
  "PASS R2B-11: parser/review RPC signatures remain untouched",
);


// R2B-12
assert.doesNotMatch(
  migration,
  /summary_group_round_id uuid not null/i,
);

assert.doesNotMatch(
  migration,
  /['"]POST_CLOSE['"]/,
);

console.log(
  "PASS R2B-12: ownership remains nullable before lifecycle cutover",
);


console.log(
  "PASS: Summary Group Round Ownership v9.21",
);
