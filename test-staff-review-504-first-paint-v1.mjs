import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint =
  fs.readFileSync(
    "netlify/functions/staff-reviews.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

console.log(
  "===== STAFF REVIEW 504 FIRST PAINT V1 =====",
);

assert.doesNotMatch(
  endpoint,
  /await loadStaffWorkbenchReadModel\(/,
);

assert.match(
  endpoint,
  /staff_workbench_open_reviews/,
);

assert.match(
  endpoint,
  /staff_workbench_claim_state/,
);

assert.match(
  endpoint,
  /resolveWorkbenchClaimState/,
);

assert.match(
  endpoint,
  /claimed_by_staff_id/,
);

assert.match(
  endpoint,
  /lease_version/,
);

console.log(
  "PASS H504-01: staff-reviews detached from full Workbench",
);

const start =
  app.indexOf(
    "async function loadReviews()",
  );

const end =
  app.indexOf(
    "async function loadUnsends()",
    start,
  );

assert.ok(
  start >= 0
  && end > start,
);

const reviews =
  app.slice(
    start,
    end,
  );

assert.match(
  reviews,
  /Staff Review First Paint Hotfix V1/,
);

assert.match(
  reviews,
  /reviewPayload\s*=[\s\S]*?await api\([\s\S]*?reviewReadPath/,
);

assert.match(
  reviews,
  /work_items:[\s\S]*?reviewPayload\.items/,
);

assert.match(
  reviews,
  /first_paint_only/,
);

console.log(
  "PASS H504-02: current Review renders independently",
);

assert.match(
  app,
  /async function appendStaffVerificationQueueFailSoft\(/,
);

assert.match(
  app,
  /staff verification secondary load failed/,
);

assert.match(
  app,
  /รายการ Review ปัจจุบันยังใช้งานได้/,
);

assert.equal(
  (
    reviews.match(
      /appendStaffVerificationQueueFailSoft\(/g,
    )
    || []
  ).length,
  2,
);

console.log(
  "PASS H504-03: heavy Workbench is secondary and fail-soft",
);

const mutateStart =
  app.indexOf(
    "function reviewCardCanMutate(",
  );

const mutateEnd =
  app.indexOf(
    "function bindReviewClaimButtons(",
    mutateStart,
  );

assert.ok(
  mutateStart >= 0
  && mutateEnd > mutateStart,
);

const mutate =
  app.slice(
    mutateStart,
    mutateEnd,
  );

assert.match(
  mutate,
  /staff_id/,
);

assert.match(
  mutate,
  /claim_state[\s\S]*?MINE/,
);

console.log(
  "PASS H504-04: mutation remains claim-gated",
);

// ------------------------------------------------------------
// 5. Stale secondary Workbench responses must fail closed.
// ------------------------------------------------------------

const beginStart =
  app.indexOf(
    "function beginStaffVerificationSecondaryGeneration(",
  );

const currentStart =
  app.indexOf(
    "function staffVerificationSecondaryGenerationIsCurrent(",
    beginStart,
  );

const failSoftStart =
  app.indexOf(
    "async function appendStaffVerificationQueueFailSoft(",
    currentStart,
  );

assert.ok(
  beginStart >= 0
  && currentStart > beginStart
  && failSoftStart > currentStart,
  "generation helpers must be structurally ordered",
);

const beginSource =
  app
    .slice(
      beginStart,
      currentStart,
    )
    .trim();

const currentSource =
  app
    .slice(
      currentStart,
      failSoftStart,
    )
    .trim();

const beginGeneration =
  new Function(
    `return (${beginSource});`,
  )();

const generationState = {
  authMode:
    "STAFF",
};

const isCurrent =
  new Function(
    "state",
    `return (${currentSource});`,
  )(
    generationState,
  );

const generationHost = {};

const firstGeneration =
  beginGeneration(
    generationHost,
  );

assert.equal(
  isCurrent(
    generationHost,
    firstGeneration,
  ),
  true,
  "first generation must initially be current",
);

const secondGeneration =
  beginGeneration(
    generationHost,
  );

assert.ok(
  secondGeneration
    > firstGeneration,
  "new Review load must advance generation",
);

assert.equal(
  isCurrent(
    generationHost,
    firstGeneration,
  ),
  false,
  "older secondary response must become stale immediately",
);

assert.equal(
  isCurrent(
    generationHost,
    secondGeneration,
  ),
  true,
  "latest secondary response remains eligible to render",
);

generationState.authMode =
  "DASHBOARD";

assert.equal(
  isCurrent(
    generationHost,
    secondGeneration,
  ),
  false,
  "leaving Staff mode must invalidate secondary rendering",
);

const patchedReviewsStart =
  app.indexOf(
    "async function loadReviews()",
  );

const patchedReviewsEnd =
  app.indexOf(
    "async function loadUnsends()",
    patchedReviewsStart,
  );

const patchedReviews =
  app.slice(
    patchedReviewsStart,
    patchedReviewsEnd,
  );

assert.match(
  patchedReviews,
  /beginStaffVerificationSecondaryGeneration\([\s\S]*?list/,
);

assert.equal(
  (
    patchedReviews.match(
      /appendStaffVerificationQueueFailSoft\([\s\S]*?staffVerificationSecondaryGeneration,[\s\S]*?\);/g,
    )
    || []
  ).length,
  2,
);

const failSoftBlock =
  app.slice(
    failSoftStart,
    patchedReviewsStart,
  );

assert.doesNotMatch(
  failSoftBlock,
  /_staffVerificationSecondaryLoading/,
);

assert.match(
  failSoftBlock,
  /const payload\s*=[\s\S]*?await api\(/,
);

const payloadPosition =
  failSoftBlock.indexOf(
    "const payload",
  );

const renderPosition =
  failSoftBlock.indexOf(
    "appendStaffVerificationQueue(",
    payloadPosition,
  );

const staleSuccessGuard =
  failSoftBlock.indexOf(
    "staffVerificationSecondaryGenerationIsCurrent(",
    payloadPosition,
  );

assert.ok(
  payloadPosition >= 0
  && staleSuccessGuard > payloadPosition
  && renderPosition > staleSuccessGuard,
  "stale success must be discarded before DOM render",
);

const catchPosition =
  failSoftBlock.indexOf(
    "} catch (error)",
  );

const staleErrorGuard =
  failSoftBlock.indexOf(
    "staffVerificationSecondaryGenerationIsCurrent(",
    catchPosition,
  );

const warningPosition =
  failSoftBlock.indexOf(
    "staffVerificationLoadWarning",
    catchPosition,
  );

assert.ok(
  catchPosition >= 0
  && staleErrorGuard > catchPosition
  && warningPosition > staleErrorGuard,
  "stale error must be discarded before warning render",
);

console.log(
  "PASS H504-05: stale secondary Workbench responses cannot mutate current Review",
);


console.log(
  "PASS: STAFF REVIEW 504 FIRST PAINT V1",
);
