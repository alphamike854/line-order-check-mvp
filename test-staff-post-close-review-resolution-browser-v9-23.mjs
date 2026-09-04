import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const app =
  await readFile(
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
  "===== Staff Post-close Review Browser Resolution v9.23 =====",
);


// ============================================================
// D2-01 — dedicated post-close resolution renderer exists.
// ============================================================

const resolutionHtml =
  functionBlock(
    "postCloseReviewResolutionHtml",
  );

console.log(
  "PASS R2D3D2-01: dedicated post-close resolution renderer exists",
);


// ============================================================
// D2-02 — only MINE ownership exposes resolution controls.
// ============================================================

assert.match(
  resolutionHtml,
  /claim_state/,
);

assert.match(
  resolutionHtml,
  /"MINE"/,
);

assert.match(
  resolutionHtml,
  /post-close-review-correction/,
);

assert.match(
  resolutionHtml,
  /preview-post-close-resolution/,
);

assert.match(
  resolutionHtml,
  /apply-post-close-resolution/,
);

assert.match(
  resolutionHtml,
  /ignore-post-close-resolution/,
);

console.log(
  "PASS R2D3D2-02: resolution controls are gated by MINE ownership",
);


// ============================================================
// D2-03 — archive card integrates dedicated resolution root.
//
// Do not convert archive card into a live .review-card.
// ============================================================

const archiveCard =
  functionBlock(
    "postCloseReviewCardHtml",
  );

assert.match(
  archiveCard,
  /postCloseReviewResolutionHtml/,
);

assert.doesNotMatch(
  archiveCard,
  /class="review-card"/,
);

assert.doesNotMatch(
  archiveCard,
  /data-review-id/,
);

console.log(
  "PASS R2D3D2-03: archive card gains resolution UI without entering live Review lifecycle",
);


// ============================================================
// D2-04 — claim-state sync also refreshes resolution UI.
//
// Claim -> MINE must expose editor.
// Renew must invalidate lease-bound Preview.
// Release must remove resolution controls.
// ============================================================

const syncClaim =
  functionBlock(
    "syncPostCloseReviewClaimUi",
  );

const syncResolution =
  functionBlock(
    "syncPostCloseReviewResolutionUi",
  );

assert.match(
  syncClaim,
  /syncPostCloseReviewResolutionUi/,
);

assert.match(
  syncResolution,
  /post-close-review-resolution/,
);

assert.match(
  syncResolution,
  /postCloseReviewResolutionHtml/,
);

console.log(
  "PASS R2D3D2-04: claim-state changes synchronize resolution UI",
);


// ============================================================
// D2-05 — exact observed post-close lease has one resolver.
// ============================================================

const leaseResolver =
  functionBlock(
    "postCloseReviewResolutionLeaseVersion",
  );

assert.match(
  leaseResolver,
  /dataset\.leaseVersion|lease_version/,
);

console.log(
  "PASS R2D3D2-05: browser resolution uses exact observed post-close lease",
);


// ============================================================
// D2-06 — browser mutation guard requires Staff + MINE + lease.
// ============================================================

const canResolve =
  functionBlock(
    "postCloseReviewCanResolve",
  );

assert.match(
  canResolve,
  /state\.authMode/,
);

assert.match(
  canResolve,
  /"STAFF"/,
);

assert.match(
  canResolve,
  /claim_state/,
);

assert.match(
  canResolve,
  /"MINE"/,
);

assert.match(
  canResolve,
  /postCloseReviewResolutionLeaseVersion/,
);

console.log(
  "PASS R2D3D2-06: post-close mutation guard requires Staff ownership and exact lease",
);


// ============================================================
// D2-07 — post-close Preview state is lifecycle-specific.
// ============================================================

const clearPreview =
  functionBlock(
    "clearPostCloseReviewPreview",
  );

assert.match(
  clearPreview,
  /_postCloseReviewPreview/,
);

assert.match(
  clearPreview,
  /post-close-review-preview/,
);

assert.doesNotMatch(
  clearPreview,
  /\bclearReviewPreview\b/,
);

console.log(
  "PASS R2D3D2-07: post-close Preview state is isolated from live Review",
);


// ============================================================
// D2-08 — Preview calls dedicated B2 endpoint.
// ============================================================

const preview =
  functionBlock(
    "previewPostCloseReview",
  );

assert.match(
  preview,
  /\/api\/staff-post-close-review-preview/,
);

assert.match(
  preview,
  /archive_id/,
);

assert.match(
  preview,
  /lease_version/,
);

assert.match(
  preview,
  /corrected_text/,
);

assert.match(
  preview,
  /preview_token/,
);

assert.match(
  preview,
  /preview\?\.can_apply|preview\.can_apply/,
);

console.log(
  "PASS R2D3D2-08: browser Preview uses dedicated post-close API",
);


// ============================================================
// D2-09 — browser stores signed Preview with exact input + lease.
// ============================================================

assert.match(
  preview,
  /_postCloseReviewPreview/,
);

assert.match(
  preview,
  /correctedText/,
);

assert.match(
  preview,
  /leaseVersion/,
);

assert.match(
  preview,
  /preview_token/,
);

console.log(
  "PASS R2D3D2-09: signed Preview is bound to browser-observed text and lease",
);


// ============================================================
// D2-10 — CORRECT uses dedicated Resolve endpoint.
// ============================================================

const apply =
  functionBlock(
    "applyPostCloseReview",
  );

assert.match(
  apply,
  /\/api\/staff-post-close-review-resolve/,
);

assert.match(
  apply,
  /action[\s\S]*?"CORRECT"/,
);

assert.match(
  apply,
  /archive_id/,
);

assert.match(
  apply,
  /lease_version/,
);

assert.match(
  apply,
  /corrected_text/,
);

assert.match(
  apply,
  /preview_token/,
);

console.log(
  "PASS R2D3D2-10: CORRECT uses dedicated post-close Resolve endpoint",
);


// ============================================================
// D2-11 — CORRECT refuses stale local Preview.
// ============================================================

assert.match(
  apply,
  /_postCloseReviewPreview/,
);

assert.match(
  apply,
  /correctedText/,
);

assert.match(
  apply,
  /leaseVersion/,
);

assert.match(
  apply,
  /clearPostCloseReviewPreview/,
);

console.log(
  "PASS R2D3D2-11: changed text or lease cannot reuse stale Preview",
);


// ============================================================
// D2-12 — IGNORE uses same dedicated Resolve endpoint.
// ============================================================

const ignore =
  functionBlock(
    "ignorePostCloseReview",
  );

assert.match(
  ignore,
  /\/api\/staff-post-close-review-resolve/,
);

assert.match(
  ignore,
  /action[\s\S]*?"IGNORE"/,
);

assert.match(
  ignore,
  /archive_id/,
);

assert.match(
  ignore,
  /lease_version/,
);

console.log(
  "PASS R2D3D2-12: IGNORE uses exact post-close archive ownership",
);


// ============================================================
// D2-13 — IGNORE does not require correction/parser/Preview.
// ============================================================

assert.doesNotMatch(
  ignore,
  /preview_token\s*:/,
);

assert.doesNotMatch(
  ignore,
  /corrected_text\s*:/,
);

assert.doesNotMatch(
  ignore,
  /normalized_text\s*:/,
);

assert.doesNotMatch(
  ignore,
  /parser_version\s*:/,
);

assert.doesNotMatch(
  ignore,
  /\bitems\s*:/,
);

console.log(
  "PASS R2D3D2-13: IGNORE does not manufacture Preview/parser evidence",
);


// ============================================================
// D2-14 — browser cannot choose trusted server context.
// ============================================================

const mutationSurface =
  [
    preview,
    apply,
    ignore,
  ].join("\n");

for (
  const forbidden
  of [
    "staff_id:",
    "allowed_line_group_ids:",
    "line_group_id:",
    "summary_group_id:",
    "round_id:",
    "settlement_session_id:",
    "source_review_id:",
    "source_message_record_id:",
    "normalized_text:",
    "parser_version:",
    "items:",
    "preview_fingerprint:",
    "previewed_at:",
  ]
) {
  assert.equal(
    mutationSurface.includes(
      forbidden,
    ),
    false,
    `browser must not send trusted field ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D2-14: Staff/scope/parser evidence remains server-resolved",
);


// ============================================================
// D2-15 — post-close resolution cannot call live endpoints.
// ============================================================

for (
  const forbidden
  of [
    '"/api/review-preview"',
    '"/api/review-resolve"',
    '"/api/staff-work-claim"',
  ]
) {
  assert.equal(
    mutationSurface.includes(
      forbidden,
    ),
    false,
    `post-close resolution must not use live endpoint ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D2-15: browser resolution is isolated from live API lifecycle",
);


// ============================================================
// D2-16 — post-close code cannot call live card helpers.
// ============================================================

for (
  const forbidden
  of [
    "reviewCardCanMutate",
    "withReviewResolutionLease",
    "clearReviewPreview",
    "removeCompletedReviewCard",
    "releaseReviewClaimAfterCompletion",
    "refreshReviewClaimState",
    "mutateReviewClaim",
  ]
) {
  assert.equal(
    mutationSurface.includes(
      forbidden,
    ),
    false,
    `post-close resolution must not reuse live helper ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D2-16: post-close card lifecycle remains separate from live Review",
);


// ============================================================
// D2-17 — success reloads authoritative post-close queue.
//
// Do not only hide/remove the local card.
// ============================================================

assert.match(
  apply,
  /reloadPostCloseReviewQueue/,
);

assert.match(
  ignore,
  /reloadPostCloseReviewQueue/,
);

assert.doesNotMatch(
  apply,
  /removeCompletedReviewCard/,
);

assert.doesNotMatch(
  ignore,
  /removeCompletedReviewCard/,
);

console.log(
  "PASS R2D3D2-17: successful resolution re-reads server-authoritative queue",
);


// ============================================================
// D2-18 — claim/race conflicts are recognized explicitly.
// ============================================================

const conflictClassifier =
  functionBlock(
    "isPostCloseReviewResolutionConflict",
  );

for (
  const code
  of [
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
    "CLAIM_RELEASE_FAILED",
    "POST_CLOSE_REVIEW_NOT_FOUND",
    "POST_CLOSE_REVIEW_ALREADY_RESOLVED",
  ]
) {
  assert.ok(
    conflictClassifier.includes(
      code,
    ),
    `missing post-close resolution conflict ${code}`,
  );
}

console.log(
  "PASS R2D3D2-18: ownership/race conflicts have explicit browser semantics",
);


// ============================================================
// D2-19 — mutation conflicts refresh authoritative queue.
// ============================================================

assert.match(
  apply,
  /isPostCloseReviewResolutionConflict/,
);

assert.match(
  ignore,
  /isPostCloseReviewResolutionConflict/,
);

assert.match(
  apply,
  /reloadPostCloseReviewQueue/,
);

assert.match(
  ignore,
  /reloadPostCloseReviewQueue/,
);

console.log(
  "PASS R2D3D2-19: stale tabs re-read post-close ownership and visibility",
);


// ============================================================
// D2-20 — Preview expiry/staleness requires a fresh Preview.
// ============================================================

assert.match(
  apply,
  /requires_preview/,
);

assert.match(
  apply,
  /clearPostCloseReviewPreview/,
);

console.log(
  "PASS R2D3D2-20: stale or expired Preview cannot be silently retried",
);


// ============================================================
// D2-21 — delegated resolution binding supports Load More cards.
// ============================================================

const bind =
  functionBlock(
    "bindPostCloseReviewResolutionActions",
  );

assert.match(
  bind,
  /root\.addEventListener/,
);

assert.match(
  bind,
  /event\.target\.closest/,
);

assert.match(
  bind,
  /preview-post-close-resolution/,
);

assert.match(
  bind,
  /apply-post-close-resolution/,
);

assert.match(
  bind,
  /ignore-post-close-resolution/,
);

console.log(
  "PASS R2D3D2-21: delegated handler covers appended post-close cards",
);


// ============================================================
// D2-22 — editing after Preview invalidates local token.
// ============================================================

assert.match(
  bind,
  /post-close-review-correction/,
);

assert.match(
  bind,
  /clearPostCloseReviewPreview/,
);

console.log(
  "PASS R2D3D2-22: correction edits invalidate browser Preview immediately",
);


// ============================================================
// D2-23 — queue binds image + claim + resolution handlers.
// ============================================================

const appendQueue =
  functionBlock(
    "appendStaffPostCloseReviewQueue",
  );

assert.match(
  appendQueue,
  /bindPostCloseReviewImagePreview/,
);

assert.match(
  appendQueue,
  /bindPostCloseReviewClaimActions/,
);

assert.match(
  appendQueue,
  /bindPostCloseReviewResolutionActions/,
);

console.log(
  "PASS R2D3D2-23: resolution coexists with existing claim/image actions",
);


// ============================================================
// D2-24 — exact claim state remains authoritative.
//
// The resolution UI must consume _postCloseReviewItem rather
// than create a second ownership model.
// ============================================================

for (
  const source
  of [
    canResolve,
    leaseResolver,
    syncResolution,
  ]
) {
  assert.match(
    source,
    /_postCloseReviewItem|dataset\.leaseVersion/,
  );
}

console.log(
  "PASS R2D3D2-24: browser resolution reuses authoritative post-close claim payload",
);


// ============================================================
// D2-25 — existing server queue reload contract remains.
// ============================================================

const reloadQueue =
  functionBlock(
    "reloadPostCloseReviewQueue",
  );

assert.match(
  reloadQueue,
  /loadStaffPostCloseReviewPage/,
);

assert.match(
  reloadQueue,
  /offset:\s*0/,
);

assert.match(
  reloadQueue,
  /append:\s*false/,
);

console.log(
  "PASS R2D3D2-25: resolution refresh uses existing bounded queue reload",
);


// ============================================================
// D2-26 — no direct browser persistence/mutation of archive.
//
// All mutation goes through B2 endpoint.
// ============================================================

assert.doesNotMatch(
  mutationSurface,
  /supabase/i,
);

assert.doesNotMatch(
  mutationSurface,
  /post_close_review_archive/,
);

console.log(
  "PASS R2D3D2-26: browser does not directly mutate durable archive",
);


// ============================================================
// D2-27 — live Review flow remains intact.
// ============================================================

for (
  const required
  of [
    "async function previewReview",
    "async function applyReview",
    "async function ignoreReview",
    "/api/review-preview",
    "/api/review-resolve",
    "reviewResolutionLeaseVersion",
  ]
) {
  assert.ok(
    app.includes(
      required,
    ),
    `live Review regression: missing ${required}`,
  );
}

console.log(
  "PASS R2D3D2-27: live Review Preview/CORRECT/IGNORE flow remains intact",
);


// ============================================================
// D2-28 — archive identity remains distinct from live Review ID.
// ============================================================

assert.match(
  archiveCard,
  /data-archive-id/,
);

assert.doesNotMatch(
  resolutionHtml,
  /review_id\s*:/,
);

assert.doesNotMatch(
  mutationSurface,
  /review_id\s*:/,
);

console.log(
  "PASS R2D3D2-28: post-close resolution continues to use durable archive identity",
);


// ============================================================
// D2-29 — no second tab or parallel workbench shell.
// ============================================================

assert.doesNotMatch(
  resolutionHtml,
  /selectTabUi|activateTab/,
);

assert.doesNotMatch(
  bind,
  /selectTabUi|activateTab/,
);

console.log(
  "PASS R2D3D2-29: resolution stays inside existing historical Review queue",
);


// ============================================================
// D2-30 — browser resolution endpoints are exactly B2 endpoints.
// ============================================================

assert.ok(
  app.includes(
    "/api/staff-post-close-review-preview",
  ),
);

assert.ok(
  app.includes(
    "/api/staff-post-close-review-resolve",
  ),
);

console.log(
  "PASS R2D3D2-30: browser integrates the dedicated B2 API boundary",
);


console.log(
  "PASS: Staff Post-close Review Browser Resolution v9.23",
);
