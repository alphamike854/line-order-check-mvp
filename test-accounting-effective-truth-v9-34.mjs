import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "./supabase/migrations/20260908113000_add_accounting_effective_truth_read_model.sql";

const reportPath =
  "./netlify/functions/accounting-report.mjs";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const report =
  fs.readFileSync(
    reportPath,
    "utf8",
  );

console.log(
  "===== Accounting Effective Truth v9.34 =====",
);

assert.match(
  migration,
  /accounting_effective_order_items/,
  "effective accounting item function is required",
);

assert.match(
  migration,
  /source_event_timestamp/,
  "verification Human Truth must preserve original event timestamp",
);

assert.match(
  migration,
  /new\.source_event_timestamp\s*:=\s*v_message\.event_timestamp/,
  "verification insert trigger must snapshot original event timestamp",
);

const legacyVerificationEventTimes =
  new Map([
    [
      "09e7f802-c6f8-49bf-88bd-7eb46965c806",
      "2026-09-07 09:05:21.179+00",
    ],
    [
      "26c8441f-0588-461a-8863-0b8c2596b462",
      "2026-09-07 09:22:32.370+00",
    ],
    [
      "713ab863-84a4-455f-ad2e-5da23db13e56",
      "2026-09-07 09:27:34.906+00",
    ],
    [
      "c80c78ac-c1f3-42e9-8f7a-468124bc1fc8",
      "2026-09-07 09:44:07.990+00",
    ],
  ]);

assert.match(
  migration,
  /legacy_verification_event_timestamp/,
  "legacy Human Verification timestamps require an explicit one-time recovery source",
);

for (
  const [
    messageId,
    eventTimestamp,
  ] of legacyVerificationEventTimes
) {
  assert.ok(
    migration.includes(messageId),
    `legacy timestamp recovery must include ${messageId}`,
  );

  assert.ok(
    migration.includes(eventTimestamp),
    `legacy timestamp recovery must preserve original event time for ${messageId}`,
  );
}

assert.doesNotMatch(
  migration,
  /source_event_timestamp\s*=\s*(?:verification\.)?verified_at/,
  "verified_at must never substitute for original event timestamp",
);

const effectiveFunctionStart =
  migration.indexOf(
    "public.accounting_effective_order_items("
  );

const effectiveFunctionEnd =
  migration.indexOf(
    "revoke all",
    effectiveFunctionStart,
  );

assert.ok(
  effectiveFunctionStart >= 0 &&
  effectiveFunctionEnd >
    effectiveFunctionStart,
  "effective accounting function body must be locatable",
);

const effectiveFunction =
  migration.slice(
    effectiveFunctionStart,
    effectiveFunctionEnd,
  );

assert.doesNotMatch(
  effectiveFunction,
  /from public\.messages|join public\.messages/,
  "effective accounting items must survive operational message purge",
);

assert.match(
  effectiveFunction,
  /from public\.post_close_review_archive/,
  "post-close archive must be a durable effective source",
);

assert.match(
  effectiveFunction,
  /from public\.message_verifications/,
  "verification snapshot must be a durable effective source",
);

assert.match(
  effectiveFunction,
  /from public\.order_items/,
  "canonical fallback must come directly from order_items",
);

assert.match(
  migration,
  /POST_CLOSE_CORRECTED/,
  "resolved post-close corrected truth must be represented",
);

assert.match(
  migration,
  /post_close_resolution_type\s*=\s*[\r\n\s]*'CORRECTED'/,
  "only CORRECTED post-close rows emit effective items",
);

assert.match(
  migration,
  /jsonb_array_elements\([\s\S]*post_close\.post_close_items/,
  "post-close corrected items must be expanded",
);

assert.match(
  migration,
  /jsonb_array_elements\([\s\S]*verification\.verified_order_items/,
  "verification Human Truth must be expanded",
);

assert.match(
  migration,
  /VERIFICATION_/,
  "verification source must remain auditable",
);

assert.match(
  migration,
  /not exists\s*\([\s\S]*resolved_post_close/,
  "resolved post-close truth must suppress lower precedence",
);

assert.match(
  migration,
  /not exists\s*\([\s\S]*verification_truth/,
  "verification truth must suppress canonical fallback",
);

assert.match(
  migration,
  /from public\.accounting_effective_order_items\(/,
  "summary fast path must consume effective accounting truth",
);

assert.doesNotMatch(
  migration,
  /session_code_risk_state|session_category_risk_state|settlement_transfer_batches/,
  "reporting migration must not alter operational risk/transfer state",
);

assert.match(
  report,
  /\.rpc\(\s*"accounting_effective_order_items"/,
  "full accounting ledger must consume effective truth RPC",
);

assert.match(
  migration,
  /accounting_effective_order_messages/,
  "durable accounting message projection is required",
);

assert.match(
  migration,
  /verification\.source_event_timestamp/,
  "verification ledger metadata must use original event timestamp",
);

assert.match(
  migration,
  /post_close\.event_timestamp/,
  "post-close ledger metadata must use archived original timestamp",
);

assert.match(
  migration,
  /verification\.verified_first_order_code/,
  "verification first-code Human Truth must remain durable",
);

assert.match(
  report,
  /\.rpc\(\s*"accounting_effective_order_messages"/,
  "full accounting ledger must consume durable effective messages",
);

assert.doesNotMatch(
  report,
  /\.from\("messages"\)/,
  "accounting report must not depend directly on operational messages",
);

assert.doesNotMatch(
  report,
  /\.from\("order_items"\)/,
  "full accounting ledger must no longer read order_items directly",
);

assert.match(
  report,
  /truth_source/,
  "ledger must retain effective truth source metadata",
);

assert.doesNotMatch(
  report,
  /hasHumanTruth/,
  "effective message projection already resolves first-code precedence",
);

assert.match(
  report,
  /message\.first_order_code\|\|firstLedgerCode\(msgItems,sourceText\)\|\|""/,
  "ledger must trust projected first_order_code before deriving from effective items",
);

console.log(
  "PASS: accounting effective Human Truth v9.34",
);
