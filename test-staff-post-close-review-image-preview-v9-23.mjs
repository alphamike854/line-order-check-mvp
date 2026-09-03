import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";


const imageApi =
  await readFile(
    "netlify/functions/staff-post-close-review-image.mjs",
    "utf8",
  );

const listApi =
  await readFile(
    "netlify/functions/staff-post-close-reviews.mjs",
    "utf8",
  );

const helper =
  await readFile(
    "src/lib/staff-post-close-review.mjs",
    "utf8",
  );

const app =
  await readFile(
    "public/app.js",
    "utf8",
  );


function functionBlock(
  source,
  functionName,
) {
  const asyncMarker =
    `async function ${functionName}`;

  const syncMarker =
    `function ${functionName}`;

  let start =
    source.indexOf(
      asyncMarker,
    );

  if (start < 0) {
    start =
      source.indexOf(
        syncMarker,
      );
  }

  assert.ok(
    start >= 0,
    `missing function ${functionName}`,
  );

  const after =
    source.slice(
      start + 1,
    );

  const next =
    after.match(
      /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/,
    );

  const end =
    next
      ? start + 1 + next.index
      : source.length;

  return source.slice(
    start,
    end,
  );
}


console.log(
  "===== Staff Post-close Review Private Image Preview v9.23 =====",
);


// ------------------------------------------------------------
// R2D3B3-01 — separate Staff-only image endpoint
// ------------------------------------------------------------

assert.match(
  imageApi,
  /authenticateWorkbenchActor/,
);

assert.match(
  imageApi,
  /!auth\.actor\.staff_id/,
);

assert.match(
  imageApi,
  /STAFF_IDENTITY_REQUIRED/,
);

assert.match(
  imageApi,
  /\/api\/staff-post-close-review-image/,
);

console.log(
  "PASS R2D3B3-01: post-close image has separate Staff-only endpoint",
);


// ------------------------------------------------------------
// R2D3B3-02 — browser supplies archive identity only
// ------------------------------------------------------------

assert.match(
  imageApi,
  /searchParams\.get\(\s*"archive_id"/,
);

for (
  const forbidden of [
    'searchParams.get("line_group_id"',
    'searchParams.get("staff_id"',
    'searchParams.get("settlement_session_id"',
    'searchParams.get("summary_group_id"',
    'searchParams.get("round_id"',
  ]
) {
  assert.ok(
    !imageApi.includes(
      forbidden,
    ),
    `browser must not choose trusted scope: ${forbidden}`,
  );
}

console.log(
  "PASS R2D3B3-02: browser supplies archive_id only",
);


// ------------------------------------------------------------
// R2D3B3-03 — current Staff assignments authorize access
// ------------------------------------------------------------

assert.match(
  imageApi,
  /loadWorkbenchActorLineGroups/,
);

assert.match(
  imageApi,
  /lineGroupIds/,
);

console.log(
  "PASS R2D3B3-03: current Staff assignments authorize historical image",
);


// ------------------------------------------------------------
// R2D3B3-04 — archive lookup is targeted and scope-filtered
// ------------------------------------------------------------

const imageAccess =
  functionBlock(
    helper,
    "loadStaffPostCloseReviewImageAccess",
  );

assert.match(
  imageAccess,
  /\.from\(\s*"post_close_review_archive"/,
);

assert.match(
  imageAccess,
  /\.eq\(\s*"id",[\s\S]*?safeArchiveId/,
);

assert.match(
  imageAccess,
  /\.in\(\s*"line_group_id",[\s\S]*?safeLineGroupIds/,
);

assert.match(
  imageAccess,
  /image_storage_path/,
);

assert.match(
  imageAccess,
  /image_deleted_at/,
);

console.log(
  "PASS R2D3B3-04: archive lookup scopes identity and LINE Group in one query",
);


// ------------------------------------------------------------
// R2D3B3-05 — post-close image does not inherit live lifecycle
// ------------------------------------------------------------

for (
  const source of [
    imageApi,
    imageAccess,
  ]
) {
  for (
    const forbidden of [
      "fetchOpenSettlementSession",
      "loadActorSessionLineGroupIds",
      "loadStaffWorkbenchReadModel",
      "staff_workbench_claim_state",
      "staff_message_work_claims",
      "settlement_line_group_config",
      "settlement_summary_group_rounds",
      "lease_version",
    ]
  ) {
    assert.ok(
      !source.includes(
        forbidden,
      ),
      `post-close image must not depend on ${forbidden}`,
    );
  }
}

console.log(
  "PASS R2D3B3-05: image preview is independent of OPEN settlement and claim",
);


// ------------------------------------------------------------
// R2D3B3-06 — private Storage uses short-lived signed URL
// ------------------------------------------------------------

assert.match(
  imageApi,
  /const REVIEW_IMAGE_BUCKET\s*=\s*\n?\s*"review-images";/,
);

assert.match(
  imageApi,
  /const REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS\s*=\s*\n?\s*900;/,
);

assert.match(
  imageApi,
  /\.createSignedUrl\([\s\S]*?access\.image_storage_path[\s\S]*?REVIEW_IMAGE_SIGNED_URL_TTL_SECONDS/,
);

assert.doesNotMatch(
  imageApi,
  /getPublicUrl/,
);

assert.doesNotMatch(
  imageApi,
  /publicUrl/,
);

console.log(
  "PASS R2D3B3-06: image URL is private and expires after 15 minutes",
);


// ------------------------------------------------------------
// R2D3B3-07 — storage path never leaves image response
// ------------------------------------------------------------

const successStart =
  imageApi.indexOf(
    "return json({",
    imageApi.indexOf(
      ".createSignedUrl(",
    ),
  );

assert.ok(
  successStart >= 0,
  "success response boundary must exist",
);

const successResponse =
  imageApi.slice(
    successStart,
  );

assert.match(
  successResponse,
  /image_evidence_url/,
);

assert.doesNotMatch(
  successResponse,
  /image_storage_path\s*:/,
);

console.log(
  "PASS R2D3B3-07: private object path remains server-side",
);


// ------------------------------------------------------------
// R2D3B3-08 — queue endpoint remains presence-only
// ------------------------------------------------------------

assert.doesNotMatch(
  listApi,
  /createSignedUrl/,
);

assert.doesNotMatch(
  listApi,
  /image_evidence_url/,
);

console.log(
  "PASS R2D3B3-08: historical queue does not pre-sign private images",
);


// ------------------------------------------------------------
// R2D3B3-09 — card exposes only an on-demand image action
// ------------------------------------------------------------

const archiveCard =
  functionBlock(
    app,
    "postCloseReviewCardHtml",
  );

assert.match(
  archiveCard,
  /has_image_evidence/,
);

assert.match(
  archiveCard,
  /post-close-review-image-button/,
);

assert.match(
  archiveCard,
  /post-close-review-image-preview/,
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
  "PASS R2D3B3-09: queue card requests image only on demand",
);


// ------------------------------------------------------------
// R2D3B3-10 — browser sends only archive_id to image endpoint
// ------------------------------------------------------------

const imageLoader =
  functionBlock(
    app,
    "loadPostCloseReviewImage",
  );

assert.match(
  imageLoader,
  /\/api\/staff-post-close-review-image\?archive_id=/,
);

assert.match(
  imageLoader,
  /encodeURIComponent\(\s*archiveId/,
);

for (
  const forbidden of [
    "line_group_id",
    "staff_id",
    "settlement_session_id",
    "summary_group_id",
    "round_id",
  ]
) {
  assert.ok(
    !imageLoader.includes(
      forbidden,
    ),
    `browser image request must not send ${forbidden}`,
  );
}

console.log(
  "PASS R2D3B3-10: browser cannot supply trusted historical scope",
);


// ------------------------------------------------------------
// R2D3B3-11 — signed URL rendering is escaped and safe
// ------------------------------------------------------------

const imageHtml =
  functionBlock(
    app,
    "postCloseReviewImageHtml",
  );

assert.match(
  imageHtml,
  /escapeHtml\(\s*imageEvidenceUrl/,
);

assert.match(
  imageHtml,
  /class="review-evidence-image"/,
);

assert.match(
  imageHtml,
  /loading="lazy"/,
);

assert.match(
  imageHtml,
  /target="_blank"/,
);

assert.match(
  imageHtml,
  /rel="noopener noreferrer"/,
);

console.log(
  "PASS R2D3B3-11: signed image renders through safe bounded evidence UI",
);


// ------------------------------------------------------------
// R2D3B3-12 — image preview remains read-only
// ------------------------------------------------------------

for (
  const source of [
    imageApi,
    imageLoader,
  ]
) {
  for (
    const forbidden of [
      "/api/review-resolve",
      "/api/review-preview",
      "/api/staff-work-claim",
      "CORRECT",
      "IGNORE",
      "CLAIM",
      "RENEW",
      "RELEASE",
      "lease_version",
    ]
  ) {
    assert.ok(
      !source.includes(
        forbidden,
      ),
      `B3 must remain read-only: ${forbidden}`,
    );
  }
}

assert.doesNotMatch(
  imageApi,
  /\.insert\(/,
);

assert.doesNotMatch(
  imageApi,
  /\.update\(/,
);

assert.doesNotMatch(
  imageApi,
  /\.delete\(/,
);

assert.doesNotMatch(
  imageApi,
  /\.rpc\(/,
);

console.log(
  "PASS R2D3B3-12: private image preview introduces no post-close mutation",
);


// ------------------------------------------------------------
// R2D3B3-13 — queue event delegation covers paginated cards
// ------------------------------------------------------------

const binder =
  functionBlock(
    app,
    "bindPostCloseReviewImagePreview",
  );

const appendQueue =
  functionBlock(
    app,
    "appendStaffPostCloseReviewQueue",
  );

assert.match(
  binder,
  /root\.addEventListener/,
);

assert.match(
  binder,
  /post-close-review-image-button/,
);

assert.match(
  appendQueue,
  /bindPostCloseReviewImagePreview/,
);

console.log(
  "PASS R2D3B3-13: image action also works for Load More cards",
);


console.log(
  "PASS: Staff Post-close Review Private Image Preview v9.23",
);
