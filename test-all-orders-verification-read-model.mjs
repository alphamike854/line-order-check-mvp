import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260907033000_add_all_orders_verification_read_model.sql";

const sql =
  fs.readFileSync(path, "utf8");

assert.match(
  sql,
  /staff_workbench_pending_verifications/i,
);

assert.match(
  sql,
  /from public\.messages m/i,
);

assert.doesNotMatch(
  sql,
  /from public\.review_items review/i,
);

assert.match(
  sql,
  /left join public\.message_verifications verification/i,
);

assert.match(
  sql,
  /verification\.message_record_id\s+is null/i,
);

assert.match(
  sql,
  /m\.unsent\s*=\s*false/i,
);

assert.match(
  sql,
  /join latest_round round_state[\s\S]*m\.summary_group_round_id/i,
);

assert.match(
  sql,
  /left join lateral[\s\S]*from public\.review_items r/i,
);

assert.match(
  sql,
  /r\.status\s*=\s*'OPEN'/i,
);

assert.match(
  sql,
  /m\.parse_status\s+is distinct from 'PARSED'/i,
);

assert.match(
  sql,
  /'PENDING'::text[\s\S]*verification_status/i,
);

assert.match(
  sql,
  /'RECENT'[\s\S]*'PRIORITY'/i,
);

assert.match(
  sql,
  /needs_interpretation[\s\S]*message_order_total/i,
);

assert.match(
  sql,
  /security definer/i,
);

assert.match(
  sql,
  /from public, anon, authenticated/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*to service_role/i,
);

// Existing parser/review lifecycle must remain untouched.
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.staff_workbench_open_reviews/i,
);

assert.doesNotMatch(
  sql,
  /alter table\s+public\.review_items/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.messages/i,
);

assert.doesNotMatch(
  sql,
  /insert into\s+public\.message_verifications/i,
);

console.log(
  "PASS: All Orders Human Verification read model contract",
);
