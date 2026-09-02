import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const migration =
  await readFile(
    "supabase/migrations/20260902170000_add_staff_review_resolution_guard.sql",
    "utf8",
  );


assert.match(
  migration,
  /assert_staff_review_resolution_claim/,
  "R2D2C-01 shared atomic Staff resolution guard exists",
);

assert.match(
  migration,
  /resolve_staff_review_with_preview/,
  "R2D2C-02 Staff CORRECT wrapper exists",
);

assert.match(
  migration,
  /ignore_staff_review/,
  "R2D2C-03 Staff IGNORE wrapper exists",
);

assert.match(
  migration,
  /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
  "R2D2C-04 lifecycle global settlement boundary is shared",
);


assert.match(
  migration,
  /SETTLEMENT_SUMMARY_GROUP_CONTROL/,
  "R2D2C-05 lifecycle Summary Group boundary is shared",
);


assert.match(
  migration,
  /pg_advisory_xact_lock[\s\S]*?'staff-work-claim:'[\s\S]*?v_message_id/,
  "R2D2C-06 resolution shares Claim/Release advisory-lock namespace",
);


const globalLifecycleLock =
  migration.indexOf(
    "'LINE_ORDER_SETTLEMENT_OPEN_CLOSE'",
  );

const groupLifecycleLock =
  migration.indexOf(
    "'SETTLEMENT_SUMMARY_GROUP_CONTROL'",
  );

const messageClaimLock =
  migration.indexOf(
    "'staff-work-claim:'",
  );


assert.ok(
  globalLifecycleLock >= 0,
  "R2D2C-07 global lifecycle lock exists",
);

assert.ok(
  groupLifecycleLock >
    globalLifecycleLock,
  "R2D2C-08 Summary Group lock follows global boundary",
);

assert.ok(
  messageClaimLock >
    groupLifecycleLock,
  "R2D2C-09 message Claim lock follows lifecycle boundaries",
);


assert.match(
  migration,
  /v_lock_summary_group_id[\s\S]*?v_message\.summary_group_id[\s\S]*?MESSAGE_ROUND_NOT_CURRENT/,
  "R2D2C-10 locked Message must still match lifecycle Summary Group",
);

assert.match(
  migration,
  /from public\.review_items[\s\S]*?for update[\s\S]*?from public\.messages[\s\S]*?for update/,
  "R2D2C-05 row-lock order is Review then Message",
);

assert.match(
  migration,
  /p_expected_lease_version is null[\s\S]*?LEASE_VERSION_REQUIRED/,
  "R2D2C-06 expected lease version is mandatory",
);

assert.match(
  migration,
  /staff_message_work_claims[\s\S]*?for update/,
  "R2D2C-07 claim row is locked before mutation",
);

assert.match(
  migration,
  /claim_expires_at[\s\S]*?CLAIM_EXPIRED/,
  "R2D2C-08 expired claim cannot resolve",
);

assert.match(
  migration,
  /v_claim\.staff_id[\s\S]*?p_staff_id[\s\S]*?CLAIM_OWNED_BY_OTHER/,
  "R2D2C-09 another Staff owner cannot resolve",
);

assert.match(
  migration,
  /v_claim\.lease_version[\s\S]*?p_expected_lease_version[\s\S]*?STALE_CLAIM_VERSION/,
  "R2D2C-10 stale same-Staff tab is rejected",
);

assert.match(
  migration,
  /MESSAGE_OUTSIDE_CURRENT_SETTLEMENT/,
  "R2D2C-11 historical Settlement message is rejected",
);

assert.match(
  migration,
  /settlement_line_group_config/,
  "R2D2C-12 settlement LINE Group snapshot is authoritative",
);

assert.match(
  migration,
  /settlement_summary_group_rounds[\s\S]*?round_no desc[\s\S]*?MESSAGE_ROUND_NOT_CURRENT/,
  "R2D2C-13 latest Summary Group Round is rechecked",
);

assert.match(
  migration,
  /line_group_staff_assignments[\s\S]*?enabled = true[\s\S]*?for share/,
  "R2D2C-14 current Staff assignment is rechecked and held",
);

assert.match(
  migration,
  /staff_accounts[\s\S]*?enabled = true[\s\S]*?for share/,
  "R2D2C-15 Staff active state is rechecked and held",
);

assert.match(
  migration,
  /resolve_staff_review_with_preview[\s\S]*?assert_staff_review_resolution_claim[\s\S]*?resolve_review_with_preview[\s\S]*?delete from[\s\S]*?staff_message_work_claims/,
  "R2D2C-16 CORRECT guard, mutation and claim cleanup share one transaction",
);

assert.match(
  migration,
  /ignore_staff_review[\s\S]*?assert_staff_review_resolution_claim[\s\S]*?ignore_review[\s\S]*?delete from[\s\S]*?staff_message_work_claims/,
  "R2D2C-17 IGNORE guard, mutation and claim cleanup share one transaction",
);

assert.match(
  migration,
  /CLAIM_RELEASE_FAILED/,
  "R2D2C-18 claim cleanup failure rolls transaction back",
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.resolve_review_with_preview\s*\(/,
  "R2D2C-19 legacy Dashboard resolve RPC is not replaced",
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.ignore_review\s*\(/,
  "R2D2C-20 legacy Dashboard ignore RPC is not replaced",
);

assert.match(
  migration,
  /resolve_staff_review_with_preview[\s\S]*?from public, anon, authenticated[\s\S]*?to service_role/,
  "R2D2C-21 Staff CORRECT wrapper is service-role only",
);

assert.match(
  migration,
  /ignore_staff_review[\s\S]*?from public, anon, authenticated[\s\S]*?to service_role/,
  "R2D2C-22 Staff IGNORE wrapper is service-role only",
);


console.log(
  "PASS: R2D2C Atomic Staff Review Resolution Guard",
);
