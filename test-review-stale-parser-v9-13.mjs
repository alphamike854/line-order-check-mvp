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
  /\.in\(\s*"summary_group_round_id"\s*,\s*normalizedRoundIds\s*,?\s*\)/,
  "Review messages must be scoped by current Round before Review lookup"
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
  /preview(?:\?\.)?parser_version/,
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
  /const\s+itemCount\s*=\s*previewItems\.length/,
  "Review preview must calculate item count"
);

assert.match(
  app,
  /const\s+totalQuantity\s*=\s*previewItems\.reduce/,
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
  /async function reloadStaffVerificationQueuePreservingPosition\(/,
  "Completed Review must re-read the authoritative Workbench while preserving operator continuity"
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
  0,
  "CORRECT and IGNORE must not rely on stale local card removal after authoritative server resolution"
);

assert.match(
  app,
  /async function applyReview\(card\)[\s\S]{0,3400}?reloadStaffVerificationQueuePreservingPosition\(\s*card,\s*messageRecordId,/,
  "CORRECT must immediately reload the authoritative Workbench"
);

assert.match(
  app,
  /async function ignoreReview\(event\)[\s\S]{0,2800}?reloadStaffVerificationQueuePreservingPosition\(\s*card,\s*messageRecordId,/,
  "IGNORE must immediately reload the authoritative Workbench"
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
