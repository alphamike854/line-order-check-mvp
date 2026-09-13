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


// UI11-03 — CORRECT refreshes authoritative Timeline.
assert.match(
  applyReview,
  /reloadStaffVerificationQueuePreservingPosition\(\s*card,\s*messageRecordId,\s*\)/,
);

const applyResolve =
  applyReview.indexOf(
    '"/api/review-resolve"',
  );

const applyRefresh =
  applyReview.indexOf(
    "reloadStaffVerificationQueuePreservingPosition(",
  );

const applyDashboard =
  applyReview.indexOf(
    "await loadDashboard({",
    applyRefresh,
  );

assert.ok(
  applyResolve >= 0
    && applyRefresh > applyResolve
    && applyDashboard > applyRefresh,
  "CORRECT order must be resolve -> Workbench refresh -> dashboard",
);


// UI11-04 — stale-DOM deletion is no longer the success mechanism.
assert.doesNotMatch(
  applyReview.slice(
    applyResolve,
    applyDashboard,
  ),
  /removeCompletedReviewCard\(/,
);


// UI11-05 — IGNORE captures canonical message identity.
assert.match(
  ignoreReview,
  /const messageRecordId\s*=[\s\S]*staffVerificationMessageRecordId\([\s\S]*card/,
);


// UI11-06 — IGNORE also refreshes authoritative Timeline.
assert.match(
  ignoreReview,
  /reloadStaffVerificationQueuePreservingPosition\(\s*card,\s*messageRecordId,\s*\)/,
);

const ignoreResolve =
  ignoreReview.indexOf(
    '"/api/review-resolve"',
  );

const ignoreRefresh =
  ignoreReview.indexOf(
    "reloadStaffVerificationQueuePreservingPosition(",
  );

const ignoreDashboard =
  ignoreReview.indexOf(
    "await loadDashboard({",
    ignoreRefresh,
  );

assert.ok(
  ignoreResolve >= 0
    && ignoreRefresh > ignoreResolve
    && ignoreDashboard > ignoreRefresh,
  "IGNORE order must be resolve -> Workbench refresh -> dashboard",
);

assert.doesNotMatch(
  ignoreReview.slice(
    ignoreResolve,
    ignoreDashboard,
  ),
  /removeCompletedReviewCard\(/,
);


// UI11-07 — continuity remains server-refresh based.
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
  "PASS UI11-03: CORRECT reloads authoritative Workbench immediately",
);

console.log(
  "PASS UI11-04: CORRECT no longer relies on stale Review DOM removal",
);

console.log(
  "PASS UI11-05: IGNORE captures stable message identity",
);

console.log(
  "PASS UI11-06: IGNORE reloads authoritative Workbench immediately",
);

console.log(
  "PASS UI11-07: continuity remains capture -> reload -> restore",
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
