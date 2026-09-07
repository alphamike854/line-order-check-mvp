import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260907100000_add_message_verification_correction_foundation.sql",
    "utf8",
  );


// ============================================================
// 1. Durable Human Truth
// ============================================================

assert.match(
  migration,
  /verification_mode text not null[\s\S]*default 'CONFIRMED'/i,
);

assert.match(
  migration,
  /verification_mode in\s*\(\s*'CONFIRMED'\s*,\s*'CORRECTED'/i,
);

for (const column of [
  "settlement_session_id",
  "summary_group_id",
  "summary_group_round_id",
  "line_group_id",
  "business_date",
  "source_parser_version",
  "source_normalized_text",
  "source_order_items",
  "corrected_text",
  "verified_first_order_code",
  "canonical_mutation_applied",
]) {
  assert.match(
    migration,
    new RegExp(column),
    `missing durable verification field: ${column}`,
  );
}


assert.match(
  migration,
  /drop constraint if exists[\s\S]*message_verifications_message_record_id_fkey/i,
);

assert.match(
  migration,
  /MESSAGE_VERIFICATION_DURABLE_CONTEXT_BACKFILL_FAILED/,
);

assert.match(
  migration,
  /populate_message_verification_durable_context/,
);

assert.match(
  migration,
  /before insert[\s\S]*public\.message_verifications/i,
);

assert.match(
  migration,
  /new\.settlement_session_id[\s\S]*v_message\.settlement_session_id/i,
);

assert.match(
  migration,
  /new\.summary_group_round_id[\s\S]*v_message\.summary_group_round_id/i,
);

assert.match(
  migration,
  /new\.verified_first_order_code is null[\s\S]*v_message\.first_order_code/i,
);


// ============================================================
// 2. Dedicated Verification correction boundary
// ============================================================

const correctionFunction =
  migration.match(
    /create or replace function\s+public\.correct_staff_message_verification_order[\s\S]*?\n\$\$;/i,
  )?.[0] ?? "";

assert.ok(
  correctionFunction,
  "correction RPC must exist",
);

assert.doesNotMatch(
  correctionFunction,
  /public\.review_items/i,
);

assert.doesNotMatch(
  correctionFunction,
  /resolve_review/i,
);


// ============================================================
// 3. Lifecycle + claim serialization
// ============================================================

for (const token of [
  "LINE_ORDER_SETTLEMENT_OPEN_CLOSE",
  "SETTLEMENT_SUMMARY_GROUP_CONTROL",
  "staff-work-claim:",
]) {
  assert.match(
    correctionFunction,
    new RegExp(token),
  );
}


assert.match(
  correctionFunction,
  /select[\s\S]*r\.id[\s\S]*r\.status[\s\S]*into[\s\S]*v_latest_round_id[\s\S]*v_latest_round_status/i,
);

assert.match(
  correctionFunction,
  /order by[\s\S]*r\.round_no desc[\s\S]*limit 1/i,
);

assert.match(
  correctionFunction,
  /v_message\.summary_group_round_id[\s\S]*is distinct from[\s\S]*v_latest_round_id/i,
);


// ============================================================
// 4. Staff/scope + original proposal fences
// ============================================================

for (const token of [
  "p_allowed_line_group_ids",
  "line_group_staff_assignments",
  "MESSAGE_OUTSIDE_STAFF_SCOPE",
  "p_expected_parser_version",
  "p_expected_normalized_text",
  "p_expected_order_items",
  "VERIFICATION_SOURCE_CHANGED",
  "p_expected_lease_version",
  "STALE_CLAIM_VERSION",
]) {
  assert.match(
    correctionFunction,
    new RegExp(token),
  );
}


// ============================================================
// 5. Corrected proposal validation
// ============================================================

for (const check of [
  "CORRECTED_TEXT_REQUIRED",
  "CORRECTED_PARSER_VERSION_REQUIRED",
  "CORRECTED_NORMALIZED_TEXT_REQUIRED",
  "CORRECTED_ORDER_ITEMS_REQUIRED",
  "CORRECTED_FIRST_ORDER_CODE_REQUIRED",
  "DUPLICATE_CORRECTED_ITEM",
]) {
  assert.match(
    correctionFunction,
    new RegExp(check),
  );
}


// ============================================================
// 6. OPEN vs CLOSED canonical behavior
// ============================================================

const branchMatch =
  correctionFunction.match(
    /if\s+v_latest_round_status\s*=\s*'OPEN'\s+then([\s\S]*?)elsif\s+v_latest_round_status\s*=\s*'CLOSED'\s+then([\s\S]*?)else\s+raise exception\s+'MESSAGE_ROUND_NOT_CURRENT'/i,
  );

assert.ok(
  branchMatch,
  "OPEN/CLOSED correction branch must be explicit",
);

const openBranch =
  branchMatch[1];

const closedBranch =
  branchMatch[2];


// OPEN correction may replace operational canonical truth.
assert.match(
  openBranch,
  /delete from[\s\S]*public\.order_items/i,
);

assert.match(
  openBranch,
  /insert into public\.order_items/i,
);

assert.match(
  openBranch,
  /update public\.messages[\s\S]*normalized_text[\s\S]*parser_version[\s\S]*first_order_code/i,
);

assert.match(
  openBranch,
  /v_canonical_mutation_applied\s*:=\s*true/i,
);


// CLOSED correction must never rewrite closed canonical rows.
assert.doesNotMatch(
  closedBranch,
  /delete from[\s\S]*public\.order_items/i,
);

assert.doesNotMatch(
  closedBranch,
  /insert into[\s\S]*public\.order_items/i,
);

assert.doesNotMatch(
  closedBranch,
  /update[\s\S]*public\.messages/i,
);

assert.match(
  closedBranch,
  /v_corrected_order_items\s*:=\s*p_corrected_order_items/i,
);

assert.match(
  closedBranch,
  /v_canonical_mutation_applied\s*:=\s*false/i,
);


// ============================================================
// 7. Round ownership remains DB-trigger authoritative
// ============================================================

assert.match(
  openBranch,
  /order_items_round_ownership_trg/,
);

const orderItemInsertMatches = [
  ...openBranch.matchAll(
    /insert into public\.order_items\s*\(([^)]*)\)\s*values\s*\(/gi,
  ),
];

assert.ok(
  orderItemInsertMatches.length > 0,
  "expected canonical INSERT in OPEN branch",
);

for (const match of orderItemInsertMatches) {
  assert.doesNotMatch(
    match[1],
    /summary_group_round_id/i,
    "OPEN canonical INSERT must delegate Round ownership to DB trigger",
  );
}


// ============================================================
// 8. Source proposal + final Human Truth
// ============================================================

assert.match(
  correctionFunction,
  /insert into[\s\S]*public\.message_verifications/i,
);

for (const field of [
  "settlement_session_id",
  "summary_group_id",
  "summary_group_round_id",
  "line_group_id",
  "business_date",
  "verification_mode",
  "source_parser_version",
  "source_normalized_text",
  "source_order_items",
  "corrected_text",
  "verified_first_order_code",
  "canonical_mutation_applied",
]) {
  assert.match(
    correctionFunction,
    new RegExp(field),
    `correction evidence must include ${field}`,
  );
}


assert.match(
  correctionFunction,
  /v_message\.parser_version[\s\S]*v_message\.normalized_text[\s\S]*v_current_order_items/i,
);

assert.match(
  correctionFunction,
  /p_corrected_parser_version[\s\S]*p_corrected_normalized_text[\s\S]*v_corrected_order_items/i,
);


// ============================================================
// 9. Claim release remains atomic
// ============================================================

assert.match(
  correctionFunction,
  /delete from[\s\S]*public\.staff_message_work_claims[\s\S]*p_expected_lease_version/i,
);

assert.match(
  correctionFunction,
  /CLAIM_RELEASE_FAILED/,
);


// ============================================================
// 10. Additive result tells caller whether canonical mutation happened
// ============================================================

assert.match(
  correctionFunction,
  /'round_status'[\s\S]*v_latest_round_status/i,
);

assert.match(
  correctionFunction,
  /'canonical_mutation_applied'[\s\S]*v_canonical_mutation_applied/i,
);


// ============================================================
// 11. Service-role-only mutation boundary
// ============================================================

assert.match(
  migration,
  /revoke all[\s\S]*correct_staff_message_verification_order[\s\S]*from public, anon, authenticated/i,
);

assert.match(
  migration,
  /grant execute[\s\S]*correct_staff_message_verification_order[\s\S]*to service_role/i,
);


console.log(
  "PASS: Human Verification durable correction foundation",
);
