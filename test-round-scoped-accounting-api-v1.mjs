import assert from "node:assert/strict";
import fs from "node:fs";

const api =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

console.log(
  "===== DR1D-D1B1B2A Accounting API Round Cutover =====",
);


// A01 — shared current-Round resolver
assert.match(
  api,
  /loadDashboardRoundContext/,
);

assert.match(
  api,
  /settlementSessionId:\s*session\.id/,
);

console.log(
  "PASS B2A-01: Accounting API resolves current Round context",
);


// A02 — explicit Round IDs passed to Point context
assert.match(
  api,
  /"accounting_round_point_context"[\s\S]*?p_round_ids:\s*roundIds/,
);

assert.match(
  api,
  /"accounting_round_point_status"[\s\S]*?p_round_ids:\s*roundIds/,
);

console.log(
  "PASS B2A-02: Point metadata/readiness use selected Round IDs",
);


// A03 — no legacy Point/status reads
assert.doesNotMatch(
  api,
  /\.from\(\s*"settlement_point_promotions"\s*\)/,
);

assert.doesNotMatch(
  api,
  /\.from\(\s*"settlement_summary_group_actual_special_point_codes"\s*\)/,
);

assert.doesNotMatch(
  api,
  /\.from\(\s*"session_summary_group_actual_point_status"\s*\)/,
);

console.log(
  "PASS B2A-03: Accounting API removed legacy Point/Promotion/status reads",
);


// A04 — summary uses Round RPC
assert.match(
  api,
  /"accounting_report_line_group_summary_rounds"[\s\S]*?p_round_ids:\s*roundIds/,
);

console.log(
  "PASS B2A-04: summary path consumes Round-scoped fast path",
);


// A05 — full ledger uses Round RPCs
assert.match(
  api,
  /"accounting_effective_order_messages_rounds"[\s\S]*?p_round_ids:\s*roundIds/,
);

assert.match(
  api,
  /"accounting_effective_order_items_rounds"[\s\S]*?p_round_ids:\s*roundIds/,
);

console.log(
  "PASS B2A-05: full ledger consumes Round-scoped Human Truth",
);


// A06 — pagination retained
assert.match(
  api,
  /const REPORT_PAGE_SIZE = 500;/,
);

assert.match(
  api,
  /\.range\(\s*from,\s*from \+ REPORT_PAGE_SIZE - 1,/s,
);

assert.match(
  api,
  /fetchAllPages\(/,
);

console.log(
  "PASS B2A-06: bounded ledger pagination retained",
);


// A07 — LINE Group-targeted Promotion semantics
assert.match(
  api,
  /promotionAppliesToLineGroup/,
);

assert.match(
  api,
  /promotion\?\.target_scope[\s\S]*?!== "SELECTED"/,
);

assert.match(
  api,
  /promotion\.line_group_ids[\s\S]*?includes\(\s*lineGroupId/,
);

assert.match(
  api,
  /promotionMap\.get\([\s\S]*?\.find\([\s\S]*?promotionAppliesToLineGroup/,
);

console.log(
  "PASS B2A-07: full ledger respects SELECTED Promotion targets",
);


// A08 — exact Round identity emitted
assert.match(
  api,
  /round_id:\s*row\.round_id/,
);

assert.match(
  api,
  /business_date:\s*row\.business_date/,
);

assert.match(
  api,
  /daily_round_no:/,
);

assert.match(
  api,
  /round_status:/,
);

console.log(
  "PASS B2A-08: summary/full payload carries exact Round identity",
);


// A09 — parent session date is not API report authority
assert.match(
  api,
  /business_date:\s*roundContext\.businessDate/,
);

assert.match(
  api,
  /business_dates:\s*roundContext\.businessDates/,
);

assert.match(
  api,
  /current_rounds:\s*roundContext\.rounds/,
);

console.log(
  "PASS B2A-09: report-level date context derives from Rounds",
);


// A10 — final revalidation
const revalidateOccurrences =
  (
    api.match(
      /revalidateRoundContext\(\{/g,
    )
    ?? []
  ).length;

assert.ok(
  revalidateOccurrences >= 4,
  `expected repeated Round revalidation; found ${revalidateOccurrences}`,
);

assert.match(
  api,
  /ACCOUNTING_ROUND_CONTEXT_CHANGED/,
);

assert.match(
  api,
  /isRoundConflict/,
);

console.log(
  "PASS B2A-10: report fails closed if Round context changes during read",
);


// A11 — one-group requests do not depend on unrelated groups
assert.match(
  api,
  /configuredSummaryIds\.length === 1[\s\S]*?configuredSummaryIds\[0\]/,
);

assert.match(
  api,
  /roundScopeSummaryGroup/,
);

console.log(
  "PASS B2A-11: one-group report isolates Round revalidation scope",
);


// A12 — operational tables remain behind durable effective truth
assert.doesNotMatch(
  api,
  /\.from\(\s*"messages"\s*\)/,
);

assert.doesNotMatch(
  api,
  /\.from\(\s*"order_items"\s*\)/,
);

assert.match(
  api,
  /truth_source/,
);

assert.match(
  api,
  /message_truth_source/,
);

console.log(
  "PASS B2A-12: durable Human Truth boundary retained",
);


console.log(
  "PASS: DR1D-D1B1B2A Accounting API Round Cutover",
);
