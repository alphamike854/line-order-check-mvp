import assert from "node:assert/strict";
import fs from "node:fs";


const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );


function functionBlock(
  functionName,
) {
  const asyncMarker =
    `async function ${functionName}`;

  const syncMarker =
    `function ${functionName}`;

  let start =
    app.indexOf(
      asyncMarker,
    );

  if (start < 0) {
    start =
      app.indexOf(
        syncMarker,
      );
  }

  assert.ok(
    start >= 0,
    `missing function ${functionName}`,
  );

  const after =
    app.slice(
      start + 1,
    );

  const next =
    after.match(
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


console.log(
  "===== Staff Post-close Review Browser Queue v9.23 =====",
);


// ------------------------------------------------------------
// R2D3B2-01 — separate historical queue is loaded in Staff Review
// ------------------------------------------------------------

const loadReviews =
  functionBlock(
    "loadReviews",
  );

assert.match(
  loadReviews,
  /appendStaffPostCloseReviewQueue/,
);

assert.match(
  app,
  /\/api\/staff-post-close-reviews\?/,
);

console.log(
  "PASS R2D3B2-01: Staff Review loads separate post-close queue",
);


// ------------------------------------------------------------
// R2D3B2-02 — queue presentation is Staff-only
// ------------------------------------------------------------

const appendQueue =
  functionBlock(
    "appendStaffPostCloseReviewQueue",
  );

assert.match(
  appendQueue,
  /state\.authMode\s*!==\s*"STAFF"/,
);

assert.doesNotMatch(
  appendQueue,
  /loadDashboard/,
);

console.log(
  "PASS R2D3B2-02: post-close browser queue is Staff-only",
);


// ------------------------------------------------------------
// R2D3B2-03 — archive cards cannot enter live Review lifecycle
// ------------------------------------------------------------

const archiveCard =
  functionBlock(
    "postCloseReviewCardHtml",
  );

assert.match(
  archiveCard,
  /post-close-review-card/,
);

assert.match(
  archiveCard,
  /data-archive-id/,
);

assert.doesNotMatch(
  archiveCard,
  /data-review-id/,
);

assert.doesNotMatch(
  archiveCard,
  /class="review-card"/,
);

console.log(
  "PASS R2D3B2-03: archive cards cannot enter live Review card lifecycle",
);


// ------------------------------------------------------------
// R2D3B2-04 — historical identity/context is visible
// ------------------------------------------------------------

for (
  const field of [
    "source_review_id",
    "summary_group_id",
    "round_no",
    "line_group_name",
    "business_date",
    "archive_reason",
    "source_resolution_type",
  ]
) {
  assert.ok(
    archiveCard.includes(
      field,
    ),
    `missing historical field ${field}`,
  );
}

console.log(
  "PASS R2D3B2-04: browser exposes historical Review context",
);


// ------------------------------------------------------------
// R2D3B2-05 — image evidence remains presence-only
// ------------------------------------------------------------

assert.match(
  archiveCard,
  /has_image_evidence/,
);

assert.doesNotMatch(
  archiveCard,
  /image_evidence_url/,
);

assert.doesNotMatch(
  archiveCard,
  /image_storage_path/,
);

assert.doesNotMatch(
  archiveCard,
  /<img\b/i,
);

console.log(
  "PASS R2D3B2-05: browser does not expose post-close private image",
);


// ------------------------------------------------------------
// R2D3B2-06 — historical queue remains free of Review resolution mutations
// ------------------------------------------------------------

for (
  const forbidden of [
    "preview-review",
    "ignore-review",
    "claim-review-work",
    "renew-review-work",
    "release-review-work",
    "lease_version",
    "/api/review-resolve",
    "/api/review-preview",
    "/api/staff-work-claim",
  ]
) {
  assert.ok(
    !archiveCard.includes(
      forbidden,
    ),
    `post-close card must not contain ${forbidden}`,
  );
}

const archivePage =
  functionBlock(
    "loadStaffPostCloseReviewPage",
  );

assert.doesNotMatch(
  archivePage,
  /method:\s*["']POST["']/,
);

assert.doesNotMatch(
  archivePage,
  /\/api\/review-resolve/,
);

assert.doesNotMatch(
  archivePage,
  /\/api\/review-preview/,
);

assert.doesNotMatch(
  archivePage,
  /\/api\/staff-work-claim/,
);

console.log(
  "PASS R2D3B2-06: post-close queue allows ownership without Review resolution mutation",
);


// ------------------------------------------------------------
// R2D3B2-07 — only explicit pagination is sent
//
// Hidden Dashboard date/Summary Group values must not
// accidentally filter historical Staff work.
// ------------------------------------------------------------

const queueQuery =
  functionBlock(
    "postCloseReviewQueueQuery",
  );

assert.match(
  queueQuery,
  /new URLSearchParams\(\)/,
);

assert.match(
  queueQuery,
  /params\.set\(\s*"limit"/,
);

assert.match(
  queueQuery,
  /params\.set\(\s*"offset"/,
);

for (
  const forbidden of [
    "reviewWorkbenchQuery",
    "selectedQuery",
    "summaryGroupSelect",
    "businessDateInput",
  ]
) {
  assert.ok(
    !queueQuery.includes(
      forbidden,
    ),
    `post-close query must not inherit ${forbidden}`,
  );
}

console.log(
  "PASS R2D3B2-07: pagination does not inherit hidden Dashboard filters",
);


// ------------------------------------------------------------
// R2D3B2-08 — bounded Load More uses server pagination
// ------------------------------------------------------------

assert.match(
  archivePage,
  /limit:\s*50/,
);

assert.match(
  archivePage,
  /pagination\.has_more/,
);

assert.match(
  archivePage,
  /load-more-post-close-reviews/,
);

assert.match(
  archivePage,
  /dataset\.nextOffset/,
);

assert.match(
  archivePage,
  /append:\s*true/,
);

console.log(
  "PASS R2D3B2-08: browser consumes bounded post-close pagination",
);


// ------------------------------------------------------------
// R2D3B2-09 — archive failure cannot destroy live Review
// ------------------------------------------------------------

assert.match(
  archivePage,
  /catch\s*\(error\)/,
);

assert.match(
  archivePage,
  /งานรอบปัจจุบันยังใช้งานได้ตามปกติ/,
);

console.log(
  "PASS R2D3B2-09: archive read failure is isolated from live Review",
);


// ------------------------------------------------------------
// R2D3B2-10 — existing live Staff workflow remains intact
// ------------------------------------------------------------

for (
  const required of [
    "/api/staff-reviews?",
    "/api/staff-workbench?",
    "/api/staff-work-claim",
    "/api/review-preview",
    "/api/review-resolve",
    "reviewResolutionLeaseVersion",
  ]
) {
  assert.ok(
    app.includes(
      required,
    ),
    `live Staff Review regression: missing ${required}`,
  );
}

console.log(
  "PASS R2D3B2-10: live claim/preview/resolve flow remains intact",
);


// ------------------------------------------------------------
// R2D3B2-11 — no parallel Staff tab/shell is introduced
// ------------------------------------------------------------

assert.doesNotMatch(
  appendQueue,
  /selectTabUi/,
);

assert.doesNotMatch(
  appendQueue,
  /activateTab/,
);

assert.match(
  appendQueue,
  /postCloseReviewQueue/,
);

console.log(
  "PASS R2D3B2-11: historical queue stays inside existing Review shell",
);


console.log(
  "PASS: Staff Post-close Review Browser Queue v9.23",
);
