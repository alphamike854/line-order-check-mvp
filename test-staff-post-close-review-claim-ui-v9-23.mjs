import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";


const app =
  await readFile(
    "public/app.js",
    "utf8",
  );

const claimApi =
  await readFile(
    "netlify/functions/staff-post-close-review-claim.mjs",
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
  "===== Staff Post-close Review Claim UI v9.23 =====",
);


// ============================================================
// C2B-01 — dedicated post-close claim-state renderer.
// ============================================================

const claimStatus =
  functionBlock(
    "postCloseReviewClaimStatusHtml",
  );

assert.match(
  claimStatus,
  /claim_state/,
);

console.log(
  "PASS R2D3C2B-01: dedicated post-close claim renderer exists",
);


// ============================================================
// C2B-02 — AVAILABLE exposes Claim.
// ============================================================

assert.match(
  claimStatus,
  /"AVAILABLE"/,
);

assert.match(
  claimStatus,
  /รับรายการ/,
);

assert.match(
  claimStatus,
  /claim-post-close-review-work/,
);

console.log(
  "PASS R2D3C2B-02: AVAILABLE exposes post-close Claim",
);


// ============================================================
// C2B-03 — MINE exposes Renew + Release.
// ============================================================

assert.match(
  claimStatus,
  /"MINE"/,
);

assert.match(
  claimStatus,
  /ต่อเวลา/,
);

assert.match(
  claimStatus,
  /คืนรายการ/,
);

assert.match(
  claimStatus,
  /renew-post-close-review-work/,
);

assert.match(
  claimStatus,
  /release-post-close-review-work/,
);

console.log(
  "PASS R2D3C2B-03: MINE exposes Renew and Release",
);


// ============================================================
// C2B-04 — OTHER is display-only.
// ============================================================

assert.match(
  claimStatus,
  /"OTHER"/,
);

assert.match(
  claimStatus,
  /claimed_by_display_name/,
);

assert.match(
  claimStatus,
  /claimed_by_staff_code/,
);

console.log(
  "PASS R2D3C2B-04: OTHER exposes safe holder display",
);


// ============================================================
// C2B-05 — archive card contains dedicated claim-state root.
// ============================================================

const archiveCard =
  functionBlock(
    "postCloseReviewCardHtml",
  );

assert.match(
  archiveCard,
  /post-close-review-claim-state/,
);

assert.match(
  archiveCard,
  /postCloseReviewClaimStatusHtml/,
);

console.log(
  "PASS R2D3C2B-05: archive card renders post-close claim state",
);


// ============================================================
// C2B-06 — no live Review card lifecycle reuse.
// ============================================================

for (
  const forbidden
  of [
    "reviewCardCanMutate",
    "mutateReviewClaim",
    "refreshReviewClaimState",
    "syncReviewCardClaimUi",
    "releaseReviewClaimAfterCompletion",
    "claim-review-work",
    "renew-review-work",
    "release-review-work",
  ]
) {
  assert.equal(
    archiveCard.includes(
      forbidden,
    ),
    false,
    `archive card must not reuse ${forbidden}`,
  );
}

console.log(
  "PASS R2D3C2B-06: archive claim UI remains separate from live Review lifecycle",
);


// ============================================================
// C2B-07 — card hydration stores C2A item state locally.
// ============================================================

const hydrate =
  functionBlock(
    "hydratePostCloseReviewClaimCards",
  );

assert.match(
  hydrate,
  /_postCloseReviewItem/,
);

assert.match(
  hydrate,
  /dataset\.archiveId/,
);

console.log(
  "PASS R2D3C2B-07: loaded archive cards retain authoritative C2A claim payload",
);


// ============================================================
// C2B-08 — local claim UI sync uses exact lease version.
// ============================================================

const syncClaim =
  functionBlock(
    "syncPostCloseReviewClaimUi",
  );

assert.match(
  syncClaim,
  /lease_version/,
);

assert.match(
  syncClaim,
  /dataset\.leaseVersion/,
);

console.log(
  "PASS R2D3C2B-08: card tracks exact observed lease version",
);


// ============================================================
// C2B-09 — mutation uses dedicated endpoint.
// ============================================================

const mutate =
  functionBlock(
    "mutatePostCloseReviewClaim",
  );

assert.match(
  mutate,
  /\/api\/staff-post-close-review-claim/,
);

assert.match(
  mutate,
  /archive_id/,
);

console.log(
  "PASS R2D3C2B-09: browser uses dedicated post-close claim endpoint",
);


// ============================================================
// C2B-10 — browser cannot choose trusted Staff/scope.
// ============================================================

for (
  const forbidden
  of [
    "staff_id:",
    "allowed_line_group_ids:",
    "line_group_id:",
    "summary_group_id:",
    "round_id:",
    "settlement_session_id:",
  ]
) {
  assert.equal(
    mutate.includes(
      forbidden,
    ),
    false,
    `mutation must not send ${forbidden}`,
  );
}

console.log(
  "PASS R2D3C2B-10: browser sends durable archive identity only",
);


// ============================================================
// C2B-11 — Claim and Renew use server CLAIM semantic.
// ============================================================

assert.match(
  mutate,
  /action/,
);

assert.match(
  mutate,
  /"CLAIM"/,
);

assert.match(
  mutate,
  /lease_seconds\s*=\s*300/,
);

console.log(
  "PASS R2D3C2B-11: Claim/Renew use bounded server CLAIM lease",
);


// ============================================================
// C2B-12 — Release forwards exact observed lease version.
// ============================================================

assert.match(
  mutate,
  /lease_version/,
);

assert.match(
  mutate,
  /dataset\.leaseVersion|item\?\.lease_version/,
);

console.log(
  "PASS R2D3C2B-12: Release forwards observed lease version",
);


// ============================================================
// C2B-13 — success updates local claim state.
// ============================================================

assert.match(
  mutate,
  /claim_state:[\s\S]*?"MINE"/,
);

assert.match(
  mutate,
  /claim_state:[\s\S]*?"AVAILABLE"/,
);

assert.match(
  mutate,
  /syncPostCloseReviewClaimUi/,
);

console.log(
  "PASS R2D3C2B-13: successful ownership mutation updates card locally",
);


// ============================================================
// C2B-14 — ownership conflicts are explicit.
// ============================================================

const conflictClassifier =
  functionBlock(
    "isPostCloseReviewClaimConflict",
  );

for (
  const conflict
  of [
    "BUSY",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
  ]
) {
  assert.ok(
    conflictClassifier.includes(
      conflict,
    ),
    `missing conflict classifier ${conflict}`,
  );
}

assert.match(
  mutate,
  /isPostCloseReviewClaimConflict/,
);

console.log(
  "PASS R2D3C2B-14: ownership conflicts are handled explicitly",
);


// ============================================================
// C2B-15 — conflict re-reads authoritative queue.
// ============================================================

assert.match(
  mutate,
  /reloadPostCloseReviewQueue/,
);

const reload =
  functionBlock(
    "reloadPostCloseReviewQueue",
  );

assert.match(
  reload,
  /loadStaffPostCloseReviewPage/,
);

assert.match(
  reload,
  /offset:\s*0/,
);

assert.match(
  reload,
  /append:\s*false/,
);

console.log(
  "PASS R2D3C2B-15: conflicts re-read authoritative post-close queue",
);


// ============================================================
// C2B-16 — delegated binding supports Load More cards.
// ============================================================

const bind =
  functionBlock(
    "bindPostCloseReviewClaimActions",
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
  /claim-post-close-review-work/,
);

assert.match(
  bind,
  /renew-post-close-review-work/,
);

assert.match(
  bind,
  /release-post-close-review-work/,
);

console.log(
  "PASS R2D3C2B-16: delegated claim handler covers Load More cards",
);


// ============================================================
// C2B-17 — queue binds claim and image handlers once.
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

console.log(
  "PASS R2D3C2B-17: claim integration coexists with private image binding",
);


// ============================================================
// C2B-18 — page hydration happens for initial + appended items.
// ============================================================

const page =
  functionBlock(
    "loadStaffPostCloseReviewPage",
  );

assert.match(
  page,
  /hydratePostCloseReviewClaimCards/,
);

assert.match(
  page,
  /insertAdjacentHTML/,
);

assert.match(
  page,
  /append:\s*true/,
);

console.log(
  "PASS R2D3C2B-18: initial and Load More cards receive claim state",
);


// ============================================================
// C2B-19 — post-close ownership remains non-resolution.
// ============================================================

for (
  const forbidden
  of [
    "/api/review-preview",
    "/api/review-resolve",
    "preview-review",
    "ignore-review",
    "apply-review",
  ]
) {
  assert.equal(
    mutate.includes(
      forbidden,
    ),
    false,
    `claim mutation must not enter Review resolution via ${forbidden}`,
  );
}

console.log(
  "PASS R2D3C2B-19: ownership UI introduces no Resolve/Ignore mutation",
);


// ============================================================
// C2B-20 — endpoint retains server-trusted authorization.
// ============================================================

assert.match(
  claimApi,
  /authenticateWorkbenchActor/,
);

assert.match(
  claimApi,
  /loadWorkbenchActorLineGroups/,
);

assert.match(
  claimApi,
  /auth\.actor\.staff_id/,
);

assert.doesNotMatch(
  claimApi,
  /body\?\.staff_id/,
);

assert.doesNotMatch(
  claimApi,
  /body\?\.allowed_line_group_ids/,
);

console.log(
  "PASS R2D3C2B-20: Staff owner and LINE Group scope remain server-resolved",
);


// ============================================================
// C2B-21 — server enforces exact Release lease version.
// ============================================================

assert.match(
  claimApi,
  /action === "RELEASE"[\s\S]*?body\?\.lease_version/,
);

assert.match(
  claimApi,
  /INVALID_LEASE_VERSION/,
);

console.log(
  "PASS R2D3C2B-21: server still requires exact Release lease version",
);


// ============================================================
// C2B-22 — no live claim endpoint in post-close mutation.
// ============================================================

assert.doesNotMatch(
  mutate,
  /\/api\/staff-work-claim/,
);

console.log(
  "PASS R2D3C2B-22: historical ownership never uses live Workbench claim endpoint",
);


console.log(
  "PASS: Staff Post-close Review Claim UI v9.23",
);
