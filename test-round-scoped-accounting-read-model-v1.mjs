import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260912013000_add_round_scoped_accounting_read_model.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== DR1D-D1B1A Round-scoped Accounting Read Model =====",
);

// ------------------------------------------------------------
// D1B1A-01 — additive Round scope exists
// ------------------------------------------------------------

assert.match(
  migration,
  /create or replace function\s+public\.accounting_round_scope\s*\(\s*p_session_id uuid,\s*p_round_ids uuid\[\]/is,
);

assert.match(
  migration,
  /r\.business_date/is,
);

assert.match(
  migration,
  /r\.daily_round_no/is,
);

console.log(
  "PASS D1B1A-01: explicit Accounting Round scope exists",
);

// ------------------------------------------------------------
// D1B1A-02 — fail closed on invalid/mixed Round context
// ------------------------------------------------------------

for (const token of [
  "ACCOUNTING_SESSION_REQUIRED",
  "ACCOUNTING_ROUND_ID_REQUIRED",
  "ACCOUNTING_DUPLICATE_ROUND_ID",
  "ACCOUNTING_ROUND_SCOPE_INVALID",
  "ACCOUNTING_MULTIPLE_ROUNDS_PER_SUMMARY_GROUP",
  "ACCOUNTING_ROUND_ARCHIVED",
  "ACCOUNTING_ROUND_NOT_CURRENT",
]) {
  assert.ok(
    migration.includes(token),
    `missing fail-closed guard ${token}`,
  );
}

assert.match(
  migration,
  /settlement_summary_group_round_snapshots/is,
);

assert.match(
  migration,
  /newer\.round_no\s*>\s*selected\.round_no/is,
);

assert.match(
  migration,
  /newer\.settlement_session_id\s*=\s*selected\.settlement_session_id/is,
);

console.log(
  "PASS D1B1A-02: Accounting Round scope fails closed",
);

console.log(
  "PASS D1B1A-02B: newer-Round detection cannot leak across parent settlements",
);

// ------------------------------------------------------------
// D1B1A-03 — old effective-truth functions are not replaced
// ------------------------------------------------------------

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.accounting_effective_order_items\s*\(\s*p_session_id uuid,\s*p_line_group_ids/is,
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.accounting_effective_order_messages\s*\(\s*p_session_id uuid,\s*p_line_group_ids/is,
);

console.log(
  "PASS D1B1A-03: historical effective-truth RPCs remain untouched",
);

// ------------------------------------------------------------
// D1B1A-04 — additive Round-scoped item function
// ------------------------------------------------------------

assert.match(
  migration,
  /public\.accounting_effective_order_items_rounds\s*\(/is,
);

assert.match(
  migration,
  /public\.accounting_effective_order_items\(\s*p_session_id,\s*p_line_group_ids/is,
);

console.log(
  "PASS D1B1A-04: additive Round-scoped effective items exist",
);

// ------------------------------------------------------------
// D1B1A-05 — durable Post-close truth is Round-owned
// ------------------------------------------------------------

assert.match(
  migration,
  /post_close_review_archive[\s\S]*archive\.round_id/is,
);

assert.match(
  migration,
  /archive\.source_message_record_id/is,
);

console.log(
  "PASS D1B1A-05: Post-close Human Truth constrained by Round",
);

// ------------------------------------------------------------
// D1B1A-06 — durable Verification truth is Round-owned
// ------------------------------------------------------------

assert.match(
  migration,
  /message_verifications[\s\S]*verification\.summary_group_round_id/is,
);

assert.match(
  migration,
  /verification\.message_record_id/is,
);

console.log(
  "PASS D1B1A-06: Verification Human Truth constrained by Round",
);

// ------------------------------------------------------------
// D1B1A-07 — canonical items are Round-owned
// ------------------------------------------------------------

assert.match(
  migration,
  /public\.order_items[\s\S]*item\.summary_group_round_id/is,
);

console.log(
  "PASS D1B1A-07: canonical Accounting truth constrained by Round",
);

// ------------------------------------------------------------
// D1B1A-08 — message metadata cannot escape selected Round truth
// ------------------------------------------------------------

assert.match(
  migration,
  /public\.accounting_effective_order_messages_rounds\s*\(/is,
);

assert.match(
  migration,
  /accounting_effective_order_items_rounds[\s\S]*selected_effective_messages/is,
);

assert.match(
  migration,
  /public\.accounting_effective_order_messages\(\s*p_session_id,\s*p_line_group_ids/is,
);

console.log(
  "PASS D1B1A-08: effective message metadata follows Round-scoped items",
);

// ------------------------------------------------------------
// D1B1A-09 — Point / Promotion context uses exact current Round
// ------------------------------------------------------------

assert.match(
  migration,
  /public\.accounting_round_point_context\s*\(/is,
);

assert.match(
  migration,
  /settlement_summary_group_point_promotions_current/is,
);

assert.match(
  migration,
  /promotion\.round_id/is,
);

assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes_current/is,
);

assert.match(
  migration,
  /actual\.round_id/is,
);

console.log(
  "PASS D1B1A-09: Point and Promotion are explicitly Round-owned",
);

// ------------------------------------------------------------
// D1B1A-10 — no legacy Point/Promotion fallback in new context
// ------------------------------------------------------------

assert.doesNotMatch(
  migration,
  /from\s+public\.settlement_point_promotions\b/is,
);

assert.doesNotMatch(
  migration,
  /from\s+public\.settlement_summary_group_actual_special_point_codes\b/is,
);

assert.doesNotMatch(
  migration,
  /session_summary_group_actual_point_status/is,
);

console.log(
  "PASS D1B1A-10: no legacy Point/Promotion fallback exists",
);

// ------------------------------------------------------------
// D1B1A-11 — base category profile remains configuration only
// ------------------------------------------------------------

assert.match(
  migration,
  /public\.settlement_point_profiles profile/is,
);

assert.match(
  migration,
  /profile\.settlement_session_id\s*=\s*p_session_id/is,
);

console.log(
  "PASS D1B1A-11: base Point profile remains session policy snapshot",
);

// ------------------------------------------------------------
// D1B1A-12 — public clients cannot call internal read-model RPCs
// ------------------------------------------------------------

for (const fn of [
  "accounting_round_scope",
  "accounting_effective_order_items_rounds",
  "accounting_effective_order_messages_rounds",
  "accounting_round_point_context",
]) {
  assert.match(
    migration,
    new RegExp(
      `grant execute\\s+on function\\s+public\\.${fn}\\s*\\(`,
      "i",
    ),
  );
}

assert.match(
  migration,
  /to service_role/is,
);

assert.match(
  migration,
  /from public,\s*anon,\s*authenticated/is,
);

console.log(
  "PASS D1B1A-12: internal Accounting RPC privilege boundary retained",
);

console.log(
  "PASS: DR1D-D1B1A Round-scoped Accounting contract",
);
