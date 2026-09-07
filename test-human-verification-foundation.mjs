import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/20260906163000_add_message_human_verification_foundation.sql";

const sql =
  fs.readFileSync(path, "utf8");

assert.match(
  sql,
  /create table if not exists\s+public\.message_verifications/i,
);

assert.match(
  sql,
  /message_record_id uuid primary key/i,
);

const durableVerificationSql =
  fs.readFileSync(
    "supabase/migrations/20260907100000_add_message_verification_correction_foundation.sql",
    "utf8",
  );

assert.match(
  durableVerificationSql,
  /drop constraint if exists[\s\S]*message_verifications_message_record_id_fkey/i,
);

assert.match(
  durableVerificationSql,
  /message_record_id remains the immutable historical source identity[\s\S]*detached from public\.messages/i,
);

for (const column of [
  "settlement_session_id",
  "summary_group_id",
  "summary_group_round_id",
  "line_group_id",
  "business_date",
]) {
  assert.match(
    durableVerificationSql,
    new RegExp(
      `alter column ${column}\\s+set not null`,
      "i",
    ),
  );
}

assert.match(
  durableVerificationSql,
  /populate_message_verification_durable_context/i,
);

assert.match(
  sql,
  /absence means PENDING; presence means VERIFIED/i,
);

assert.match(
  sql,
  /create or replace function\s+public\.claim_staff_message_verification_work/i,
);

assert.match(
  sql,
  /create or replace function\s+public\.verify_staff_message_order/i,
);

assert.match(
  sql,
  /v_message\.summary_group_round_id is null/i,
);

assert.match(
  sql,
  /order by\s+r\.round_no desc[\s\S]*limit 1/i,
);

assert.match(
  sql,
  /MESSAGE_OUTSIDE_STAFF_SCOPE/,
);

assert.match(
  sql,
  /MESSAGE_ALREADY_UNSENT/,
);

assert.match(
  sql,
  /v_message\.parse_status <> 'PARSED'/,
);

assert.match(
  sql,
  /MESSAGE_HAS_NO_ORDER_ITEMS/,
);

assert.match(
  sql,
  /VERIFICATION_SOURCE_CHANGED/,
);

assert.match(
  sql,
  /CLAIM_REQUIRED/,
);

assert.match(
  sql,
  /CLAIM_EXPIRED/,
);

assert.match(
  sql,
  /STALE_CLAIM_VERSION/,
);

assert.match(
  sql,
  /insert into\s+public\.message_verifications/i,
);

assert.match(
  sql,
  /delete from\s+public\.staff_message_work_claims/i,
);

assert.match(
  sql,
  /verified_by_staff_code/,
);

assert.match(
  sql,
  /verified_by_display_name/,
);

assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.claim_staff_review_work/i,
);

assert.doesNotMatch(
  sql,
  /alter table\s+public\.review_items/i,
);

console.log(
  "PASS: Human Verification foundation contract",
);

// Claim incarnation must never restart from a reusable small version.
assert.match(
  sql,
  /verification_claim_version bigint[\s\S]*default 0/i,
);

assert.match(
  sql,
  /messages_verification_claim_version_check/i,
);

assert.match(
  sql,
  /verification_claim_version \+ 1/,
);

assert.match(
  sql,
  /extract\([\s\S]*epoch from clock_timestamp\(\)[\s\S]*1000000/i,
);

assert.match(
  sql,
  /lease_version =\s*v_claim_version/i,
);

// Human truth must bind the exact canonical items Staff observed.
assert.match(
  sql,
  /verified_order_items jsonb not null/i,
);

assert.match(
  sql,
  /p_expected_order_items jsonb/i,
);

assert.match(
  sql,
  /jsonb_agg\([\s\S]*oi\.category[\s\S]*oi\.code[\s\S]*oi\.quantity/i,
);

assert.match(
  sql,
  /v_current_order_items[\s\S]*is distinct from[\s\S]*p_expected_order_items/i,
);

assert.match(
  sql,
  /verified_order_items[\s\S]*v_current_order_items/i,
);

console.log(
  "PASS: Human Verification claim incarnation + exact-item binding",
);
