import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );


function between(
  startMarker,
  endMarker,
) {
  const start =
    app.indexOf(startMarker);

  assert.ok(
    start >= 0,
    `missing ${startMarker}`,
  );

  const end =
    app.indexOf(
      endMarker,
      start + startMarker.length,
    );

  assert.ok(
    end > start,
    `missing ${endMarker}`,
  );

  return app.slice(
    start,
    end,
  );
}


function functionBlock(
  functionName,
) {
  const asyncMarker =
    `async function ${functionName}`;

  const syncMarker =
    `function ${functionName}`;

  let start =
    app.indexOf(asyncMarker);

  if (start < 0) {
    start =
      app.indexOf(syncMarker);
  }

  assert.ok(
    start >= 0,
    `missing function ${functionName}`,
  );

  const afterStart =
    app.slice(
      start + 1,
    );

  const next =
    afterStart.match(
      /\n(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/,
    );

  const end =
    next
      ? start + 1 + next.index
      : app.length;

  return app.slice(
    start,
    end,
  );
}


function assertNoTrustedScope(
  block,
  label,
) {
  for (
    const field of [
      "staff_id",
      "settlement_session_id",
      "allowed_line_group_ids",
    ]
  ) {
    const pattern =
      new RegExp(
        `\\b${field}\\s*:`,
      );

    assert.doesNotMatch(
      block,
      pattern,
      `${label} must not send trusted ${field}`,
    );
  }
}


// ============================================================
// R2D2D-4-01 — Staff Review read is server scoped.
// ============================================================

const loadReviews =
  functionBlock(
    "loadReviews",
  );

assert.ok(
  loadReviews.includes(
    "/api/staff-reviews?",
  ),
  "Staff Review must use secure staff-reviews endpoint",
);

assert.ok(
  loadReviews.includes(
    "/api/staff-workbench?",
  ),
  "Review must load authoritative workbench/claim state",
);

assert.ok(
  loadReviews.includes(
    "/api/reviews?",
  ),
  "Dashboard legacy Review path must remain available",
);


// ============================================================
// R2D2D-4-02 — Real Staff mutation requires owned claim.
// ============================================================

const canMutate =
  functionBlock(
    "reviewCardCanMutate",
  );

assert.ok(
  canMutate.includes(
    "staff_id",
  ),
  "claim mutation guard must distinguish real Staff",
);

assert.ok(
  canMutate.includes(
    '"MINE"',
  ),
  "real Staff must own claim before Review mutation",
);


// ============================================================
// R2D2D-4-03 — Claim/Renew use Staff claim endpoint.
// RELEASE may live in the dedicated cleanup helper.
// ============================================================

const mutateClaim =
  functionBlock(
    "mutateReviewClaim",
  );

assert.ok(
  mutateClaim.includes(
    "/api/staff-work-claim",
  ),
  "claim mutations must use staff-work-claim endpoint",
);

for (
  const action of [
    "CLAIM",
    "RENEW",
  ]
) {
  assert.ok(
    mutateClaim.includes(
      action,
    ),
    `missing Staff claim action ${action}`,
  );
}

const releaseClaim =
  functionBlock(
    "releaseReviewClaimAfterCompletion",
  );

assert.ok(
  releaseClaim.includes(
    "RELEASE",
  )
    || /mutateReviewClaim\(\s*card\s*,\s*["']RELEASE["']/.test(
      app,
    ),
  "Review completion must retain RELEASE claim cleanup",
);


// ============================================================
// R2D2D-4-04 — Claim mutation cannot supply trusted identity.
// ============================================================

assertNoTrustedScope(
  mutateClaim,
  "Staff claim mutation",
);

assertNoTrustedScope(
  releaseClaim,
  "Staff claim release",
);


// ============================================================
// R2D2D-4-05 — Preview uses protected Review endpoint.
// ============================================================

assert.ok(
  app.includes(
    "/api/review-preview",
  ),
  "Review preview endpoint must remain integrated",
);


// ============================================================
// R2D2D-4-06 — Staff resolution forwards exact lease version.
// ============================================================

assert.ok(
  app.includes(
    "function reviewResolutionLeaseVersion",
  ),
  "lease-version resolver must exist",
);

const leasePayload =
  functionBlock(
    "withReviewResolutionLease",
  );

assert.ok(
  leasePayload.includes(
    "lease_version",
  ),
  "Staff resolution must forward lease_version",
);


// ============================================================
// R2D2D-4-07 — CORRECT and IGNORE remain protected mutations.
// ============================================================

const applyReview =
  functionBlock(
    "applyReview",
  );

const ignoreReview =
  functionBlock(
    "ignoreReview",
  );

assert.ok(
  applyReview.includes(
    "/api/review-resolve",
  ),
  "CORRECT must use review-resolve",
);

assert.ok(
  ignoreReview.includes(
    "/api/review-resolve",
  ),
  "IGNORE must use review-resolve",
);

assert.ok(
  applyReview.includes(
    "withReviewResolutionLease",
  ),
  "CORRECT must attach Staff lease when required",
);

assert.ok(
  ignoreReview.includes(
    "withReviewResolutionLease",
  ),
  "IGNORE must attach Staff lease when required",
);


// ============================================================
// R2D2D-4-08 — Review resolution cannot submit trusted scope.
// lease_version is allowed; Staff/session/scope are not.
// ============================================================

assertNoTrustedScope(
  applyReview,
  "Staff CORRECT",
);

assertNoTrustedScope(
  ignoreReview,
  "Staff IGNORE",
);


// ============================================================
// R2D2D-4-09 — stale-tab conflicts re-read authoritative state.
// ============================================================

assert.ok(
  app.includes(
    "function isReviewResolutionClaimConflict",
  ),
  "claim-conflict classifier must exist",
);

const conflictRefresh =
  functionBlock(
    "refreshReviewAfterResolutionConflict",
  );

assert.ok(
  conflictRefresh.includes(
    "refreshReviewClaimState",
  )
    || conflictRefresh.includes(
      "loadReviews",
    ),
  "claim conflict must refresh authoritative state",
);


// ============================================================
// R2D2D-4-10 — Successful completion keeps cleanup/removal.
// ============================================================

assert.ok(
  app.includes(
    "releaseReviewClaimAfterCompletion",
  ),
  "completion must retain best-effort claim release",
);

assert.ok(
  app.includes(
    "removeCompletedReviewCard",
  ),
  "completed Review card removal must remain",
);


// ============================================================
// R2D2D-4-11 — Mode-aware API sends exactly one credential.
// ============================================================

const api =
  between(
    "async function api(",
    "function showLogin",
  );

assert.ok(
  api.includes(
    'state.authMode === "DASHBOARD"',
  ),
  "API must support Dashboard mode",
);

assert.ok(
  api.includes(
    'state.authMode === "STAFF"',
  ),
  "API must support Staff mode",
);

assert.ok(
  /headers\.set\(\s*["']x-dashboard-key["']/.test(
    api,
  ),
  "Dashboard mode must set Dashboard credential",
);

assert.ok(
  /headers\.delete\(\s*["']x-staff-key["']/.test(
    api,
  ),
  "Dashboard mode must remove Staff credential",
);

assert.ok(
  /headers\.set\(\s*["']x-staff-key["']/.test(
    api,
  ),
  "Staff mode must set Staff credential",
);

assert.ok(
  /headers\.delete\(\s*["']x-dashboard-key["']/.test(
    api,
  ),
  "Staff mode must remove Dashboard credential",
);


// ============================================================
// R2D2D-4-12 — Staff entry remains Dashboard-free.
// ============================================================

const staffEntry =
  between(
    "async function enterStaffSession",
    "async function enterDashboardSession",
  );

for (
  const forbidden of [
    "loadDashboard(",
    "startFreshnessPolling",
    "/api/dashboard",
  ]
) {
  assert.ok(
    !staffEntry.includes(
      forbidden,
    ),
    `Staff entry must not contain ${forbidden}`,
  );
}


// ============================================================
// R2D2D-4-13 — Dashboard settlement fields remain legitimate.
//
// settlement_session_id elsewhere in app.js is intentionally
// allowed for Dashboard settlement / Point / Promotion flows.
// The security boundary above is specifically Staff Review.
// ============================================================

assert.ok(
  app.includes(
    "settlement_session_id",
  ),
  "existing Dashboard settlement contract must remain intact",
);


console.log(
  "PASS: R2D2D-4 Staff Browser Review Full Flow",
);
