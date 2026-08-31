import assert from "node:assert/strict";
import fs from "node:fs";

const dashboardApi = fs.readFileSync(
  "src/lib/dashboard-api.mjs",
  "utf8"
);

const app = fs.readFileSync(
  "public/app.js",
  "utf8"
);

const reviewFunction =
  dashboardApi.match(
    /export async function fetchOpenReviews[\s\S]*?export async function fetchUnsends/
  )?.[0] ?? "";

assert.ok(
  reviewFunction,
  "fetchOpenReviews must exist"
);

assert.doesNotMatch(
  reviewFunction,
  /\.limit\(\s*250\s*\)/,
  "Review loading must not globally truncate OPEN reviews at 250 before session filtering"
);

assert.match(
  reviewFunction,
  /\.eq\(\s*"business_date"\s*,\s*businessDate\s*\)/,
  "Review messages must be scoped by business date before Review lookup"
);

assert.match(
  reviewFunction,
  /settlement_session_id/,
  "Review messages must support settlement-session scoping"
);

assert.match(
  reviewFunction,
  /summary_group_id/,
  "Review messages must support summary-group scoping"
);

assert.match(
  reviewFunction,
  /\.range\(/,
  "Review message lookup must page instead of relying on one capped response"
);

assert.match(
  reviewFunction,
  /REVIEW_MESSAGE_CHUNK_SIZE/,
  "Review lookup must chunk message ids"
);

assert.match(
  reviewFunction,
  /parser_version/,
  "Review read model must include the original parser version"
);

assert.match(
  app,
  /Parser เดิม \$\{escapeHtml\(item\.parser_version \|\| "ไม่ระบุ"\)\}/,
  "Review card must show the original parser version"
);

assert.match(
  app,
  /preview\.parser_version/,
  "Review preview must show the parser version used for the new parse"
);

assert.match(
  app,
  /Review #\$\{escapeHtml\(item\.id\)\}/,
  "Review card must show the Review ID"
);

assert.match(
  app,
  /item\.parse_status/,
  "Review card must show the original parse status"
);

assert.match(
  app,
  /const itemCount = previewItems\.length/,
  "Review preview must calculate item count"
);

assert.match(
  app,
  /const totalQuantity = previewItems\.reduce/,
  "Review preview must calculate total quantity"
);

assert.match(
  app,
  /"ยอดรวม"/,
  "Fully parsed Review preview must label the complete total"
);

assert.match(
  app,
  /"ยอดที่อ่านได้"/,
  "Incomplete Review preview must label only the readable total"
);

assert.match(
  app,
  /function removeCompletedReviewCard\(card\)/,
  "Completed Review must be removable locally without rebuilding the workbench"
);

assert.match(
  app,
  /preserveReviewWorkbench = false/,
  "Dashboard refresh must support preserving the Review workbench"
);

assert.match(
  app,
  /!preserveReviewWorkbench/,
  "Review list reload must be suppressible during post-resolution refresh"
);

assert.match(
  app,
  /async function applyReview\(card\)[\s\S]{0,2600}?preserveReviewWorkbench:\s*true/,
  "CORRECT must preserve the Review workbench"
);

assert.match(
  app,
  /async function ignoreReview\(event\)[\s\S]{0,2200}?preserveReviewWorkbench:\s*true/,
  "IGNORE must preserve the Review workbench"
);

const localRemoveCalls =
  app.match(
    /removeCompletedReviewCard\(card\);/g
  ) || [];

assert.equal(
  localRemoveCalls.length,
  2,
  "CORRECT and IGNORE must both remove only their completed card"
);

assert.doesNotMatch(
  app,
  /await loadDashboard\(\);\s*await loadReviews\(\);/,
  "Review actions must not trigger duplicate dashboard + Review reloads"
);

assert.match(
  app,
  /\/api\/review-preview/,
  "Review must continue using the existing preview endpoint"
);

assert.match(
  app,
  /\/api\/review-resolve/,
  "Review must continue using the existing audited resolve endpoint"
);

console.log(
  "PASS: stale Review visibility + parser context v9.13"
);
