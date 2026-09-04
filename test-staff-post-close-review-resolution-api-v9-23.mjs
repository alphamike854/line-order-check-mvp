import assert from "node:assert/strict";

import {
  existsSync,
} from "node:fs";

import {
  readFile,
} from "node:fs/promises";


console.log(
  "===== Staff Post-close Review Preview + Resolve API v9.23 =====",
);


const previewPath =
  "netlify/functions/staff-post-close-review-preview.mjs";

const resolvePath =
  "netlify/functions/staff-post-close-review-resolve.mjs";

const readModelPath =
  "src/lib/staff-post-close-review.mjs";

const safetyPath =
  "src/lib/staff-post-close-review-resolution.mjs";


// ============================================================
// B2-01 — dedicated post-close endpoints exist.
// ============================================================

assert.equal(
  existsSync(previewPath),
  true,
  `missing endpoint ${previewPath}`,
);

assert.equal(
  existsSync(resolvePath),
  true,
  `missing endpoint ${resolvePath}`,
);


const [
  preview,
  resolve,
  readModel,
  safety,
] =
  await Promise.all([
    readFile(
      previewPath,
      "utf8",
    ),

    readFile(
      resolvePath,
      "utf8",
    ),

    readFile(
      readModelPath,
      "utf8",
    ),

    readFile(
      safetyPath,
      "utf8",
    ),
  ]);


console.log(
  "PASS R2D3D1B2-01: Preview and Resolve use dedicated post-close endpoints",
);


// ============================================================
// B2-02 — endpoint paths are separate from live Review.
// ============================================================

assert.match(
  preview,
  /\/api\/staff-post-close-review-preview/,
);

assert.match(
  resolve,
  /\/api\/staff-post-close-review-resolve/,
);

assert.doesNotMatch(
  preview,
  /path:\s*["']\/api\/review-preview["']/,
);

assert.doesNotMatch(
  resolve,
  /path:\s*["']\/api\/review-resolve["']/,
);

console.log(
  "PASS R2D3D1B2-02: post-close API paths are lifecycle-specific",
);


// ============================================================
// B2-03 — both endpoints are real-Staff only.
// ============================================================

for (
  const [
    name,
    source,
  ]
  of [
    [
      "Preview",
      preview,
    ],
    [
      "Resolve",
      resolve,
    ],
  ]
) {
  assert.match(
    source,
    /authenticateWorkbenchActor/,
    `${name} must authenticate Workbench actor`,
  );

  assert.match(
    source,
    /auth\.actor\.staff_id/,
    `${name} must require Staff identity`,
  );

  assert.match(
    source,
    /STAFF_IDENTITY_REQUIRED/,
    `${name} must reject shared Dashboard identity`,
  );

  assert.doesNotMatch(
    source,
    /requireDashboardAccess/,
    `${name} must not inherit Dashboard Review auth`,
  );
}

console.log(
  "PASS R2D3D1B2-03: post-close mutation APIs are Staff-only",
);


// ============================================================
// B2-04 — current Staff assignment is the authorization scope.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.match(
    source,
    /loadWorkbenchActorLineGroups/,
  );

  assert.match(
    source,
    /allowedLineGroupIds/,
  );
}

console.log(
  "PASS R2D3D1B2-04: current Staff LINE Group assignments are resolved server-side",
);


// ============================================================
// B2-05 — browser supplies durable identity + lease only.
//
// Browser may also provide:
//   corrected_text
//   preview_token
//   action
//
// It must never select trusted actor/parser/scope/evidence.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.match(
    source,
    /body\??\.archive_id/,
  );

  assert.match(
    source,
    /body\??\.lease_version/,
  );

  assert.doesNotMatch(
    source,
    /body\??\.(?:staff_id|line_group_id|summary_group_id|normalized_text|parser_version|items|preview_fingerprint|previewed_at)/,
  );

  assert.doesNotMatch(
    source,
    /body\??\.(?:source_review_id|source_message_record_id|settlement_session_id|round_id)/,
  );
}

console.log(
  "PASS R2D3D1B2-05: browser cannot choose trusted post-close resolution context",
);


// ============================================================
// B2-06 — archive UUID and exact lease are normalized.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.match(
    source,
    /normalizePostCloseArchiveId/,
  );

  assert.match(
    source,
    /normalizePostCloseLeaseVersion/,
  );

  assert.match(
    source,
    /LEASE_VERSION_REQUIRED/,
  );

  assert.match(
    source,
    /428/,
  );
}

console.log(
  "PASS R2D3D1B2-06: post-close Preview and Resolve require exact observed lease",
);


// ============================================================
// B2-07 — both APIs reuse B1 targeted access boundary.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.match(
    source,
    /loadStaffPostCloseReviewResolutionAccess/,
  );
}

assert.match(
  safety,
  /\.is\(\s*"post_close_resolution_type"\s*,\s*null\s*,?\s*\)/,
);

console.log(
  "PASS R2D3D1B2-07: APIs target one unresolved archive with exact ownership",
);


// ============================================================
// B2-08 — post-close APIs must not inherit live lifecycle.
// ============================================================

for (
  const [
    name,
    source,
  ]
  of [
    [
      "Preview",
      preview,
    ],
    [
      "Resolve",
      resolve,
    ],
  ]
) {
  for (
    const forbidden
    of [
      "fetchOpenSettlementSession",
      "loadActorSessionLineGroupIds",
      "staff_message_work_claims",
      "staff_workbench_claim_state",
      "review_items",
      "settlement_summary_group_rounds",
      "MESSAGE_ROUND_NOT_CURRENT",
      "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
      "SETTLEMENT_NOT_OPEN",
    ]
  ) {
    assert.equal(
      source.includes(
        forbidden,
      ),
      false,
      `${name} inherited forbidden live lifecycle dependency: ${forbidden}`,
    );
  }
}

console.log(
  "PASS R2D3D1B2-08: post-close APIs are independent of OPEN Settlement/current Round",
);


// ============================================================
// B2-09 — Preview parser work happens on server.
// ============================================================

assert.match(
  preview,
  /loadParserConfig/,
);

assert.match(
  preview,
  /parseOrder/,
);

assert.match(
  preview,
  /correctedText/,
);

assert.match(
  preview,
  /result\.normalized_text/,
);

assert.match(
  preview,
  /result\.parser_version/,
);

assert.match(
  preview,
  /result\.items/,
);

console.log(
  "PASS R2D3D1B2-09: Preview parses correction server-side",
);


// ============================================================
// B2-10 — only parseable Preview gets signed.
// ============================================================

assert.match(
  preview,
  /canApply/,
);

assert.match(
  preview,
  /result\.status[\s\S]*?PARSED/,
);

assert.match(
  preview,
  /result\.items[\s\S]*?length/,
);

assert.match(
  preview,
  /postCloseReviewPreviewFingerprint/,
);

assert.match(
  preview,
  /createPostCloseReviewPreviewToken/,
);

assert.match(
  preview,
  /preview_token/,
);

assert.match(
  preview,
  /can_apply/,
);

console.log(
  "PASS R2D3D1B2-10: parseable Preview is fingerprinted and signed",
);


// ============================================================
// B2-11 — Preview fingerprint carries authoritative ownership.
// ============================================================

for (
  const required
  of [
    "archiveId",
    "staffId",
    "leaseVersion",
    "correctedText",
    "normalizedText",
    "parserVersion",
    "items",
    "parserConfig",
    "summaryGroupId",
  ]
) {
  assert.equal(
    preview.includes(
      required,
    ),
    true,
    `Preview fingerprint context missing ${required}`,
  );
}

console.log(
  "PASS R2D3D1B2-11: Preview carries exact B1 fingerprint context",
);


// ============================================================
// B2-12 — Resolve action is bounded.
// ============================================================

assert.match(
  resolve,
  /action/,
);

assert.match(
  resolve,
  /CORRECT/,
);

assert.match(
  resolve,
  /IGNORE/,
);

assert.match(
  resolve,
  /INVALID_(?:POST_CLOSE_)?REVIEW_ACTION|INVALID_ACTION/,
);

console.log(
  "PASS R2D3D1B2-12: Resolve action is bounded to CORRECT or IGNORE",
);


// ============================================================
// B2-13 — CORRECT requires correction + signed Preview.
// ============================================================

assert.match(
  resolve,
  /CORRECTED_TEXT_REQUIRED/,
);

assert.match(
  resolve,
  /body\??\.corrected_text/,
);

assert.match(
  resolve,
  /body\??\.preview_token/,
);

assert.match(
  resolve,
  /PREVIEW_REQUIRED/,
);

assert.match(
  resolve,
  /428/,
);

console.log(
  "PASS R2D3D1B2-13: CORRECT requires exact text and signed Preview",
);


// ============================================================
// B2-14 — CORRECT is reparsed at Resolve time.
// ============================================================

assert.match(
  resolve,
  /loadParserConfig/,
);

assert.match(
  resolve,
  /parseOrder/,
);

assert.match(
  resolve,
  /CORRECTION_NOT_PARSEABLE/,
);

assert.match(
  resolve,
  /result\.normalized_text/,
);

assert.match(
  resolve,
  /result\.parser_version/,
);

assert.match(
  resolve,
  /result\.items/,
);

console.log(
  "PASS R2D3D1B2-14: Resolve reparses correction using current server parser context",
);


// ============================================================
// B2-15 — Resolve rebuilds and verifies exact B1 fingerprint.
// ============================================================

assert.match(
  resolve,
  /postCloseReviewPreviewFingerprint/,
);

assert.match(
  resolve,
  /verifyPostCloseReviewPreviewToken/,
);

assert.match(
  resolve,
  /expectedFingerprint/,
);

assert.match(
  resolve,
  /verified\.fingerprint/,
);

assert.match(
  resolve,
  /verified\.issued_at/,
);

console.log(
  "PASS R2D3D1B2-15: Resolve verifies signed Preview against freshly rebuilt fingerprint",
);


// ============================================================
// B2-16 — one dedicated atomic archive-only RPC.
// ============================================================

assert.match(
  resolve,
  /resolve_staff_post_close_review/,
);

for (
  const forbiddenRpc
  of [
    "resolve_staff_review_with_preview",
    "ignore_staff_review",
    "resolve_review_with_preview",
    "ignore_review",
  ]
) {
  assert.equal(
    resolve.includes(
      forbiddenRpc,
    ),
    false,
    `post-close Resolve must not call live RPC ${forbiddenRpc}`,
  );
}

console.log(
  "PASS R2D3D1B2-16: CORRECT and IGNORE use D1A archive-only RPC",
);


// ============================================================
// B2-17 — trusted D1A RPC identity/scope/lease are server values.
// ============================================================

for (
  const required
  of [
    "p_archive_id",
    "p_staff_id",
    "p_allowed_line_group_ids",
    "p_expected_lease_version",
    "p_action",
  ]
) {
  assert.equal(
    resolve.includes(
      required,
    ),
    true,
    `D1A RPC argument missing ${required}`,
  );
}

assert.match(
  resolve,
  /p_staff_id\s*:[\s\S]*?auth\.actor\.staff_id/,
);

assert.match(
  resolve,
  /p_allowed_line_group_ids\s*:[\s\S]*?allowedLineGroupIds/,
);

assert.match(
  resolve,
  /p_expected_lease_version\s*:[\s\S]*?expectedLeaseVersion/,
);

console.log(
  "PASS R2D3D1B2-17: actor, scope and lease are injected server-side",
);


// ============================================================
// B2-18 — CORRECT sends durable parser + Preview evidence.
// ============================================================

for (
  const required
  of [
    "p_corrected_text",
    "p_normalized_text",
    "p_parser_version",
    "p_items",
    "p_preview_fingerprint",
    "p_previewed_at",
  ]
) {
  assert.equal(
    resolve.includes(
      required,
    ),
    true,
    `CORRECT RPC evidence missing ${required}`,
  );
}

assert.match(
  resolve,
  /p_corrected_text\s*:\s*correctedText/,
);

assert.match(
  resolve,
  /p_normalized_text\s*:\s*result\.normalized_text/,
);

assert.match(
  resolve,
  /p_parser_version\s*:\s*result\.parser_version/,
);

assert.match(
  resolve,
  /p_items\s*:\s*result\.items/,
);

assert.match(
  resolve,
  /p_preview_fingerprint\s*:\s*verified\.fingerprint/,
);

assert.match(
  resolve,
  /p_previewed_at\s*:\s*verified\.issued_at/,
);

console.log(
  "PASS R2D3D1B2-18: CORRECT persists exact edited text plus verified parser evidence",
);


// ============================================================
// B2-19 — IGNORE requires ownership but no Preview/parser evidence.
// ============================================================

assert.match(
  resolve,
  /action\s*===\s*"IGNORE"[\s\S]*?resolve_staff_post_close_review/,
);

const ignoreStart =
  resolve.search(
    /action\s*===\s*"IGNORE"/,
  );

const correctStart =
  resolve.search(
    /action\s*===\s*"CORRECT"/,
  );

assert.notEqual(
  ignoreStart,
  -1,
  "IGNORE branch missing",
);

const ignoreSection =
  resolve.slice(
    ignoreStart,
    correctStart > ignoreStart
      ? correctStart
      : undefined,
  );

for (
  const nullEvidence
  of [
    "p_corrected_text",
    "p_normalized_text",
    "p_parser_version",
    "p_items",
    "p_preview_fingerprint",
    "p_previewed_at",
  ]
) {
  assert.match(
    ignoreSection,
    new RegExp(
      `${nullEvidence}\\s*:\\s*null`,
    ),
    `IGNORE must clear ${nullEvidence}`,
  );
}

console.log(
  "PASS R2D3D1B2-19: IGNORE bypasses Preview while retaining exact ownership guard",
);


// ============================================================
// B2-20 — claim conflicts are explicit.
// ============================================================

for (
  const code
  of [
    "CLAIM_REQUIRED",
    "CLAIM_EXPIRED",
    "CLAIM_OWNED_BY_OTHER",
    "STALE_CLAIM_VERSION",
    "CLAIM_RELEASE_FAILED",
  ]
) {
  assert.equal(
    resolve.includes(
      code,
    ),
    true,
    `Resolve error mapping missing ${code}`,
  );
}

assert.match(
  resolve,
  /claim_conflict/,
);

console.log(
  "PASS R2D3D1B2-20: ownership races are explicit API conflicts",
);


// ============================================================
// B2-21 — Preview errors preserve retry semantics.
// ============================================================

for (
  const code
  of [
    "PREVIEW_REQUIRED",
    "PREVIEW_EXPIRED",
    "PREVIEW_STALE",
    "PREVIEW_TOKEN_INVALID",
  ]
) {
  assert.equal(
    resolve.includes(
      code,
    ),
    true,
    `Preview error mapping missing ${code}`,
  );
}

assert.match(
  resolve,
  /requires_preview/,
);

console.log(
  "PASS R2D3D1B2-21: Preview expiry/staleness/tamper remain explicit",
);


// ============================================================
// B2-22 — expected HTTP semantics.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.match(
    source,
    /POST_CLOSE_REVIEW_NOT_FOUND/,
  );

  assert.match(
    source,
    /404/,
  );
}

assert.match(
  preview,
  /POST_CLOSE_REVIEW_PREVIEW_SIGNING_KEY_NOT_CONFIGURED/,
);

assert.match(
  preview,
  /503/,
);

assert.match(
  resolve,
  /PREVIEW_REQUIRED[\s\S]*?428/,
);

assert.match(
  resolve,
  /PREVIEW_(?:EXPIRED|STALE)[\s\S]*?409|409[\s\S]*?PREVIEW_(?:EXPIRED|STALE)/,
);

assert.match(
  resolve,
  /PREVIEW_TOKEN_INVALID[\s\S]*?400|400[\s\S]*?PREVIEW_TOKEN_INVALID/,
);

console.log(
  "PASS R2D3D1B2-22: post-close API status mapping is explicit",
);


// ============================================================
// B2-23 — application layer cannot mutate live canonical data.
// ============================================================

for (
  const forbidden
  of [
    '"review_items"',
    '"messages"',
    '"order_items"',
    "staff_message_work_claims",
  ]
) {
  assert.equal(
    resolve.includes(
      forbidden,
    ),
    false,
    `Resolve contains forbidden canonical dependency ${forbidden}`,
  );
}

assert.doesNotMatch(
  resolve,
  /\.from\(\s*"post_close_review_archive"[\s\S]*?\.(?:update|delete|insert)\(/,
);

console.log(
  "PASS R2D3D1B2-23: application mutation is RPC-only and archive-only",
);


// ============================================================
// B2-24 — active queue hides resolved durable archives.
//
// Resolution is durable history; queue visibility is a filter,
// never DELETE.
// ============================================================

assert.match(
  readModel,
  /\.is\(\s*"post_close_resolution_type"\s*,\s*null\s*,?\s*\)/,
);

assert.doesNotMatch(
  readModel,
  /\.delete\(/,
);

console.log(
  "PASS R2D3D1B2-24: resolved archives leave active queue without deleting history",
);


// ============================================================
// B2-25 — live Preview token primitive is not used by post-close API.
// ============================================================

for (
  const source
  of [
    preview,
    resolve,
  ]
) {
  assert.doesNotMatch(
    source,
    /\bcreateReviewPreviewToken\b/,
  );

  assert.doesNotMatch(
    source,
    /\bverifyReviewPreviewToken\b/,
  );

  assert.doesNotMatch(
    source,
    /\breviewPreviewFingerprint\b/,
  );
}

console.log(
  "PASS R2D3D1B2-25: post-close API cannot fall back to live Preview token namespace",
);


// ============================================================
// B2-26 — success returns durable archive resolution result.
// ============================================================

assert.match(
  resolve,
  /resolution/,
);

assert.match(
  resolve,
  /archive_id/,
);

console.log(
  "PASS R2D3D1B2-26: Resolve returns durable post-close resolution result",
);


console.log(
  "PASS: Staff Post-close Review Preview + Resolve API v9.23",
);
