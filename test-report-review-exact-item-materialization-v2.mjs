import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/staff-verification-message.mjs",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

console.log(
  "===== Report -> Review Direct Exact Lookup v3 =====",
);

assert.match(
  endpoint,
  /req\.method !== "GET"/,
);

assert.match(
  endpoint,
  /authenticateWorkbenchActor\(/,
);

console.log(
  "PASS RRV3-01: exact endpoint is authenticated GET-only",
);

assert.match(
  endpoint,
  /fetchOpenSettlementSession\(\)/,
);

assert.match(
  endpoint,
  /loadActorSessionLineGroupIds\(/,
);

console.log(
  "PASS RRV3-02: exact endpoint retains current settlement + actor LINE Group scope",
);

assert.match(
  endpoint,
  /\.from\(\s*"messages",?\s*\)/,
);

assert.match(
  endpoint,
  /\.eq\(\s*"id",\s*messageRecordId,?\s*\)/,
);

assert.match(
  endpoint,
  /\.eq\(\s*"settlement_session_id",\s*session\.id,?\s*\)/,
);

assert.match(
  endpoint,
  /\.in\(\s*"line_group_id",\s*lineGroupIds,?\s*\)/,
);

console.log(
  "PASS RRV3-03: exact lookup is bounded by UUID + settlement + LINE Group scope",
);

assert.match(
  endpoint,
  /\.from\(\s*"settlement_summary_group_rounds",?\s*\)/,
);

assert.match(
  endpoint,
  /message\.summary_group_round_id/,
);

assert.match(
  endpoint,
  /round\.id/,
);

console.log(
  "PASS RRV3-04: latest Summary Group Round lineage is enforced",
);

assert.match(
  endpoint,
  /\.from\(\s*"review_items",?\s*\)/,
);

assert.match(
  endpoint,
  /\.from\(\s*"message_verifications",?\s*\)/,
);

assert.match(
  endpoint,
  /\.from\(\s*"order_items",?\s*\)/,
);

assert.match(
  endpoint,
  /\.from\(\s*"post_close_review_archive",?\s*\)/,
);

assert.match(
  endpoint,
  /classifyVerificationStatus\(/,
);

assert.match(
  endpoint,
  /effectiveItems\(/,
);

console.log(
  "PASS RRV3-05: exact item preserves Timeline Human Truth / Review semantics",
);

for (
  const mutationPattern
  of [
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
  ]
) {
  assert.doesNotMatch(
    endpoint,
    mutationPattern,
  );
}

const rpcNames = [
  ...endpoint.matchAll(
    /\.rpc\(\s*"([^"]+)"/g,
  ),
].map(
  (match) =>
    match[1],
);

assert.deepEqual(
  rpcNames,
  [
    "staff_workbench_claim_state",
  ],
);

console.log(
  "PASS RRV3-06: endpoint is read-only; only claim-state read RPC is used",
);

assert.match(
  endpoint,
  /addScopedWorkbenchImageEvidence\(/,
);

console.log(
  "PASS RRV3-07: exact image evidence retains scoped signing path",
);

const start =
  app.indexOf(
    "async function openReportMessageInReview(",
  );

const end =
  app.indexOf(
    "function bindReportReviewMessageBridge(",
    start,
  );

assert.ok(
  start >= 0
  && end > start,
);

const bridge =
  app.slice(
    start,
    end,
  );

assert.match(
  bridge,
  /\/api\/staff-verification-message/,
);

assert.match(
  bridge,
  /staffVerificationMergeTimelineItems\(/,
);

assert.doesNotMatch(
  bridge,
  /loadMoreStaffVerificationTimeline\(/,
);

assert.doesNotMatch(
  bridge,
  /pageGuard/,
);

console.log(
  "PASS RRV3-08: Report navigation no longer fans out through Timeline pagination",
);

const loadReviewsPos =
  bridge.indexOf(
    "await loadReviews()",
  );

assert.ok(
  loadReviewsPos >= 0,
);

const directPath =
  bridge.slice(
    loadReviewsPos,
  );

assert.doesNotMatch(
  directPath,
  /state\.authMode\s*===\s*"(?:STAFF|DASHBOARD)"/,
);

assert.match(
  bridge,
  /state\.reportPayload\?\.session\?\.status === "OPEN"/,
);

assert.match(
  bridge,
  /state\.settlement\?\.open_session\?\.id/,
);

console.log(
  "PASS RRV3-09: exact lookup remains shared by Admin/Staff while session safety stays intact",
);

const mergePos =
  bridge.indexOf(
    "staffVerificationMergeTimelineItems(",
  );

const selectPos =
  bridge.indexOf(
    "selectStaffVerificationWorkbenchItem(",
  );

const scrollPos =
  bridge.indexOf(
    "scrollIntoView(",
  );

assert.ok(
  mergePos >= 0
  && selectPos > mergePos
  && scrollPos > selectPos,
);

console.log(
  "PASS RRV3-10: exact item is materialized before selection and scroll",
);

assert.match(
  pkg,
  /node test-report-review-exact-item-materialization-v2\.mjs/,
);

console.log(
  "PASS RRV3-11: direct lookup regression remains in full npm suite",
);

console.log(
  "PASS: Report -> Review Direct Exact Lookup v3",
);
