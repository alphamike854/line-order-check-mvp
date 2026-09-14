import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const packageJson =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

const staffResolutionGuard =
  fs.readFileSync(
    "supabase/migrations/"
    + "20260902170000_add_staff_review_resolution_guard.sql",
    "utf8",
  );

function section(
  text,
  startToken,
  endToken,
) {
  const start =
    text.indexOf(startToken);

  assert.notEqual(
    start,
    -1,
    `missing ${startToken}`,
  );

  const end =
    text.indexOf(
      endToken,
      start + startToken.length,
    );

  assert.notEqual(
    end,
    -1,
    `missing ${endToken}`,
  );

  return text.slice(
    start,
    end,
  );
}

const applyReview =
  section(
    app,
    "async function applyReview(card)",
    "async function ignoreReview(event)",
  );

const ignoreReview =
  section(
    app,
    "async function ignoreReview(event)",
    "// ============================================================\n// C3B-3 Human Verification Correction Browser",
  );

const localCompletion =
  section(
    app,
    "function completeReviewResolutionLocally(",
    "const REVIEW_RESOLUTION_CLAIM_CONFLICTS",
  );


const continuity =
  section(
    app,
    "async function reloadStaffVerificationQueuePreservingPosition(",
    "/* Review Timeline v1 */",
  );


// UI11-01
assert.ok(
  packageJson.includes(
    "test-review-post-resolution-refresh-v11.mjs",
  ),
  "UI-11 contract must join npm test",
);


// UI11-02 — CORRECT captures canonical message identity.
assert.match(
  applyReview,
  /const messageRecordId\s*=[\s\S]*staffVerificationMessageRecordId\([\s\S]*card/,
);


// UI11-03 — CORRECT completes the resolved item locally.

assert.match(
  applyReview,
  /completeReviewResolutionLocally\(\s*card,\s*messageRecordId,\s*\)/,
);

assert.doesNotMatch(
  applyReview,
  /reloadStaffVerificationQueuePreservingPosition\(/,
);

const applyResolve =
  applyReview.indexOf(
    '"/api/review-resolve"',
  );

const applyLocal =
  applyReview.indexOf(
    "completeReviewResolutionLocally(",
  );

const applyDashboard =
  applyReview.indexOf(
    "await loadDashboard({",
    applyLocal,
  );

assert.ok(
  applyResolve >= 0
    && applyLocal > applyResolve
    && applyDashboard > applyLocal,
  "CORRECT order must be resolve -> local completion -> dashboard",
);


// UI11-04 — local completion updates only browser state.

for (const token of [
  "_verificationWorkbenchItems",
  "_verificationHighTotalIds",
  "staffVerificationRenderTimeline",
  "selectStaffVerificationWorkbenchItem",
  "card?.remove?.()",
]) {
  assert.ok(
    localCompletion.includes(token),
    `local completion helper missing ${token}`,
  );
}

assert.doesNotMatch(
  localCompletion,
  /\bremoveCompletedReviewCard\s*\(|\breleaseReviewClaimAfterCompletion\s*\(/,
);


// UI11-05 — IGNORE captures canonical message identity.
assert.match(
  ignoreReview,
  /const messageRecordId\s*=[\s\S]*staffVerificationMessageRecordId\([\s\S]*card/,
);


// UI11-06 — IGNORE uses the same local completion path.

assert.match(
  ignoreReview,
  /completeReviewResolutionLocally\(\s*card,\s*messageRecordId,\s*\)/,
);

assert.doesNotMatch(
  ignoreReview,
  /reloadStaffVerificationQueuePreservingPosition\(/,
);

const ignoreResolve =
  ignoreReview.indexOf(
    '"/api/review-resolve"',
  );

const ignoreLocal =
  ignoreReview.indexOf(
    "completeReviewResolutionLocally(",
  );

const ignoreDashboard =
  ignoreReview.indexOf(
    "await loadDashboard({",
    ignoreLocal,
  );

assert.ok(
  ignoreResolve >= 0
    && ignoreLocal > ignoreResolve
    && ignoreDashboard > ignoreLocal,
  "IGNORE order must be resolve -> local completion -> dashboard",
);


// UI11-07 — authoritative continuity reload remains available for conflict/fallback paths.
for (const token of [
  "staffVerificationCaptureContinuity",
  "reloadStaffVerificationQueue",
  "staffVerificationRestoreContinuity",
]) {
  assert.ok(
    continuity.includes(token),
    `continuity helper missing ${token}`,
  );
}


// UI11-08 — helper keeps both arguments.
assert.match(
  continuity,
  /root[\s\S]*messageRecordId/,
);


// UI11-09 — no hard browser reload.
assert.doesNotMatch(
  applyReview,
  /location\.reload|window\.location|history\.go/,
);

assert.doesNotMatch(
  ignoreReview,
  /location\.reload|window\.location|history\.go/,
);


// UI11-10 — dashboard refresh remains non-destructive.
assert.match(
  applyReview,
  /preserveReviewWorkbench:\s*true/,
);

assert.match(
  ignoreReview,
  /preserveReviewWorkbench:\s*true/,
);


// UI11-11 — Staff completion releases the claim atomically in DB.
// Browser must not depend on a second post-resolution RELEASE request.
const claimReleaseFailures =
  staffResolutionGuard.match(
    /CLAIM_RELEASE_FAILED/g,
  ) || [];

assert.ok(
  claimReleaseFailures.length >= 2,
  "Staff CORRECT and IGNORE wrappers must retain atomic claim release guards",
);

assert.match(
  staffResolutionGuard,
  /delete\s+from[\s\S]*public\.staff_message_work_claims/i,
);

assert.match(
  staffResolutionGuard,
  /lease_version\s*=\s*p_expected_lease_version/i,
);


console.log(
  "PASS UI11-01: post-resolution refresh contract registered",
);

console.log(
  "PASS UI11-02: CORRECT captures stable message identity",
);

console.log(
  "PASS UI11-03: CORRECT completes resolved item locally",
);

console.log(
  "PASS UI11-04: local completion updates browser Workbench state",
);

console.log(
  "PASS UI11-05: IGNORE captures stable message identity",
);

console.log(
  "PASS UI11-06: IGNORE completes resolved item locally",
);

console.log(
  "PASS UI11-07: authoritative reload remains available for conflict/fallback",
);

console.log(
  "PASS UI11-08: continuity helper receives root + message identity",
);

console.log(
  "PASS UI11-09: no full-page reload introduced",
);

console.log(
  "PASS UI11-10: dashboard refresh preserves refreshed Workbench",
);

console.log(
  "PASS UI11-11: Staff resolution retains atomic DB claim release",
);

console.log(
  "PASS: Review Post-Resolution Authoritative Refresh v11",
);
