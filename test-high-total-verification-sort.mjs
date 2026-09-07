import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260907085000_add_high_total_verification_sort.sql";

const sql =
  fs.readFileSync(
    path,
    "utf8",
  );

assert.match(
  sql,
  /create\s+or\s+replace\s+function[\s\S]*public\.staff_workbench_pending_verifications/i,
);

assert.match(
  sql,
  /'RECENT'[\s\S]*'PRIORITY'[\s\S]*'HIGH_TOTAL'/i,
);

assert.match(
  sql,
  /HIGH_TOTAL[\s\S]*needs_interpretation\s*=\s*false/i,
);

assert.match(
  sql,
  /=\s*'HIGH_TOTAL'[\s\S]*then\s+message_order_total[\s\S]*end\s+desc/i,
);

assert.match(
  sql,
  /PRIORITY[\s\S]*needs_interpretation[\s\S]*message_order_total/i,
);

assert.match(
  sql,
  /event_timestamp\s+desc[\s\S]*message_record_id\s+desc/i,
);

assert.match(
  sql,
  /security definer/i,
);

assert.match(
  sql,
  /revoke all[\s\S]*public[\s\S]*anon[\s\S]*authenticated/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*service_role/i,
);

assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function[\s\S]*staff_workbench_open_reviews/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.messages/i,
);

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.message_verifications/i,
);

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.order_items/i,
);

assert.doesNotMatch(
  sql,
  /archive_post_close_review_message/i,
);

console.log(
  "PASS: HIGH_TOTAL Human Verification sort",
);
