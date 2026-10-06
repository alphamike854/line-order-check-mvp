import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(
  "src/lib/dashboard-api.mjs",
  "utf8",
);

const dashboard = fs.readFileSync(
  "netlify/functions/dashboard.mjs",
  "utf8",
);

const reviewsEndpoint = fs.readFileSync(
  "netlify/functions/reviews.mjs",
  "utf8",
);

const migration = fs.readFileSync(
  "supabase/migrations/20261001102500_optimize_dashboard_review_unsend_reads.sql",
  "utf8",
);


// RC-01: Detailed Review Workbench loader remains.
assert.match(
  api,
  /export async function fetchOpenReviews\(/,
);

assert.match(
  reviewsEndpoint,
  /fetchOpenReviews/,
);

console.log(
  "PASS RC-01: detailed Review Workbench loader preserved",
);


// RC-02: Dashboard count helper remains.
assert.match(
  api,
  /export async function fetchOpenReviewCount\(/,
);

console.log(
  "PASS RC-02: Dashboard review count helper preserved",
);


const countStart = api.indexOf(
  "export async function fetchOpenReviewCount(",
);

const countEnd = api.indexOf(
  "export async function fetchUnsends(",
  countStart,
);

assert.ok(countStart >= 0);
assert.ok(countEnd > countStart);

const countPath = api.slice(
  countStart,
  countEnd,
);


// RC-03: Existing Round/session/group call contract remains.
assert.match(
  countPath,
  /normalizeDashboardRoundIds/,
);

assert.match(
  countPath,
  /p_round_ids:\s*[\s\S]*normalizedRoundIds/,
);

assert.match(
  countPath,
  /p_summary_group_id:\s*[\s\S]*summaryGroupId/,
);

assert.match(
  countPath,
  /p_settlement_session_id:\s*[\s\S]*settlementSessionId/,
);

console.log(
  "PASS RC-03: count scope preserves Round/session/group inputs",
);


// RC-04: Dashboard count no longer materializes message IDs.
assert.match(
  countPath,
  /supabase\.rpc\(\s*"dashboard_open_review_count"/,
);

assert.doesNotMatch(
  countPath,
  /\.from\("messages"\)/,
);

assert.doesNotMatch(
  countPath,
  /\.from\("review_items"\)/,
);

assert.doesNotMatch(
  countPath,
  /REVIEW_COUNT_CONCURRENCY/,
);

console.log(
  "PASS RC-04: review count uses one bounded DB RPC",
);


// RC-05: SQL preserves exact OPEN Review semantics.
assert.match(
  migration,
  /create or replace function[\s\S]*public\.dashboard_open_review_count/i,
);

assert.match(
  migration,
  /from\s+public\.review_items\s+review[\s\S]*join\s+public\.messages\s+message/i,
);

assert.match(
  migration,
  /review\.status\s*=\s*'OPEN'/,
);

assert.match(
  migration,
  /message\.summary_group_round_id\s*=[\s\S]*any/i,
);

assert.match(
  migration,
  /message\.settlement_session_id\s*=/,
);

assert.match(
  migration,
  /message\.summary_group_id\s*=/,
);

console.log(
  "PASS RC-05: DB count preserves OPEN + Round/session/group semantics",
);


// RC-06: UNSEND also uses one bounded Round-scoped RPC.
const unsendStart = api.indexOf(
  "export async function fetchUnsends(",
);

const unsendEnd = api.indexOf(
  "export async function loadParserConfig()",
  unsendStart,
);

assert.ok(unsendStart >= 0);
assert.ok(unsendEnd > unsendStart);

const unsendPath = api.slice(
  unsendStart,
  unsendEnd,
);

assert.match(
  unsendPath,
  /supabase\.rpc\(\s*"dashboard_round_unsends"/,
);

assert.match(
  unsendPath,
  /p_round_ids:\s*[\s\S]*normalizedRoundIds/,
);

assert.match(
  unsendPath,
  /p_summary_group_id:\s*[\s\S]*summaryGroupId/,
);

assert.match(
  unsendPath,
  /p_limit:\s*500/,
);

assert.doesNotMatch(
  unsendPath,
  /\.from\("messages"\)/,
);

assert.doesNotMatch(
  unsendPath,
  /\.from\("unsend_events"\)/,
);

assert.doesNotMatch(
  unsendPath,
  /matched_message_record_id"\s*,\s*ids/,
);

assert.doesNotMatch(
  unsendPath,
  /loadGroupConfig\(\)/,
);

assert.match(
  migration,
  /create or replace function[\s\S]*public\.dashboard_round_unsends/i,
);

assert.match(
  migration,
  /from\s+public\.unsend_events\s+unsend[\s\S]*join\s+public\.messages\s+message/i,
);

assert.match(
  migration,
  /message\.summary_group_round_id\s*=[\s\S]*any/i,
);

assert.match(
  migration,
  /limit\s+greatest\(/i,
);

console.log(
  "PASS RC-06: UNSEND fanout replaced by bounded Round RPC",
);


// RC-06B: RPC output types preserve existing UNSEND API payload.
assert.match(
  migration,
  /returns table\s*\(\s*id uuid,[\s\S]*derived_qty_total integer,/i,
);

assert.doesNotMatch(
  migration,
  /returns table\s*\(\s*id bigint,/i,
);

console.log(
  "PASS RC-06B: UNSEND RPC return types match existing schema",
);


// RC-07: Dashboard endpoint keeps the same public helper contract.
assert.match(
  dashboard,
  /fetchOpenReviewCount/,
);

assert.doesNotMatch(
  dashboard,
  /fetchOpenReviews/,
);

assert.match(
  dashboard,
  /fetchOpenReviewCount\(\s*messageRoundIds,\s*summaryGroupId,\s*session\.id\s*\)/,
);

assert.doesNotMatch(
  dashboard,
  /fetchUnsends\(/,
);

assert.match(
  dashboard,
  /review_open:Number\(reviewOpenCount\|\|0\)/,
);

console.log(
  "PASS RC-07: Dashboard keeps Review count path without restoring UNSEND bootstrap",
);

console.log(
  "PASS: Dashboard review/UNSEND DB fast path V1",
);
