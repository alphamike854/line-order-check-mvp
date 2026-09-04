import assert from "node:assert/strict";

import {
  existsSync,
} from "node:fs";

import {
  readFile,
} from "node:fs/promises";

import {
  createReviewPreviewToken,
  REVIEW_PREVIEW_TOKEN_VERSION,
  verifyReviewPreviewToken,
} from "./src/lib/review-safety.mjs";


console.log(
  "===== Staff Post-close Review Preview Safety v9.23 =====",
);


const helperPath =
  "src/lib/staff-post-close-review-resolution.mjs";


assert.equal(
  existsSync(helperPath),
  true,
  `missing helper ${helperPath}`,
);


const {
  POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
  POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS,
  createPostCloseReviewPreviewToken,
  loadStaffPostCloseReviewResolutionAccess,
  postCloseReviewPreviewFingerprint,
  verifyPostCloseReviewPreviewToken,
} =
  await import(
    `./${helperPath}`
  );


const helper =
  await readFile(
    helperPath,
    "utf8",
  );


const key =
  "test-post-close-review-preview-key";

const nowMs =
  Date.parse(
    "2026-09-04T04:30:00.000Z",
  );


const base = {
  archiveId:
    "020b4720-eaa9-4906-b0c8-d7c81966d4e2",

  staffId:
    "fe44a5d1-458c-4444-ad3b-93d4798ceada",

  leaseVersion:
    7,

  correctedText:
    "124=20x6",

  normalizedText:
    "124=20x6",

  parserVersion:
    "1.0.0",

  items: [
    {
      category: "E",
      code: "124",
      quantity: 20,
    },
    {
      category: "E",
      code: "142",
      quantity: 20,
    },
    {
      category: "E",
      code: "214",
      quantity: 20,
    },
    {
      category: "E",
      code: "241",
      quantity: 20,
    },
    {
      category: "E",
      code: "412",
      quantity: 20,
    },
    {
      category: "E",
      code: "421",
      quantity: 20,
    },
  ],

  parserConfig: {
    aliases: {
      "น": "A",
    },

    defaultCategoryByCodeLength: {
      2: "A",
      3: "E",
    },
  },

  summaryGroupId:
    "NORTH",
};


// ============================================================
// B1-01 — dedicated post-close token namespace.
// ============================================================

assert.equal(
  typeof POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
  "string",
);

assert.notEqual(
  POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
  REVIEW_PREVIEW_TOKEN_VERSION,
);

assert.equal(
  POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS,
  15 * 60,
);

console.log(
  "PASS R2D3D1B1-01: post-close Preview has a dedicated 15-minute token namespace",
);


// ============================================================
// B1-02 — deterministic bounded fingerprint.
// ============================================================

const fingerprint =
  postCloseReviewPreviewFingerprint(
    base,
  );

assert.match(
  fingerprint,
  /^[0-9a-f]{64}$/,
);

assert.equal(
  postCloseReviewPreviewFingerprint(
    base,
  ),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-02: post-close Preview fingerprint is deterministic SHA-256",
);


// ============================================================
// B1-03 — archive identity is part of fingerprint.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,

    archiveId:
      "028252b3-f3b6-49aa-8d47-8ef9bddc2f36",
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-03: durable archive UUID is bound to Preview",
);


// ============================================================
// B1-04 — Staff identity is part of fingerprint.
//
// A released claim may later be acquired by another Staff.
// Staff identity prevents an old owner's Preview from crossing
// ownership even if a lease number is reused.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,

    staffId:
      "11111111-1111-4111-8111-111111111111",
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-04: Staff identity is bound to Preview ownership",
);


// ============================================================
// B1-05 — exact lease version is part of fingerprint.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,
    leaseVersion: 8,
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-05: exact post-close lease version is bound to Preview",
);


// ============================================================
// B1-06 — exact edited text is bound.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,
    correctedText:
      "124=20x6 ",
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-06: exact corrected text invalidates stale Preview",
);


// ============================================================
// B1-07 — parser result is bound.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,

    items:
      base.items.map(
        (item, index) =>
          index === 0
            ? {
                ...item,
                quantity: 30,
              }
            : item,
      ),
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-07: parsed item result is bound to Preview",
);


// ============================================================
// B1-08 — parser configuration is bound.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,

    parserConfig: {
      ...base.parserConfig,

      aliases: {
        "น": "B",
      },
    },
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-08: parser configuration is bound to Preview",
);


// ============================================================
// B1-09 — Summary Group is bound.
// ============================================================

assert.notEqual(
  postCloseReviewPreviewFingerprint({
    ...base,
    summaryGroupId:
      "SOUTH",
  }),
  fingerprint,
);

console.log(
  "PASS R2D3D1B1-09: archived Summary Group identity is bound to Preview",
);


// ============================================================
// B1-10 — valid signed Preview verifies.
// ============================================================

const signed =
  createPostCloseReviewPreviewToken({
    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    fingerprint,

    nowMs,

    ttlSeconds:
      POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS,

    key,
  });


const verified =
  verifyPostCloseReviewPreviewToken({
    token:
      signed.token,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  });


assert.equal(
  verified.ok,
  true,
);

assert.equal(
  verified.fingerprint,
  fingerprint,
);

assert.equal(
  typeof verified.issued_at,
  "string",
);

assert.equal(
  typeof verified.expires_at,
  "string",
);

console.log(
  "PASS R2D3D1B1-10: valid post-close Preview token verifies",
);


// ============================================================
// B1-11 — Staff / lease change makes token stale.
// ============================================================

assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      signed.token,

    archiveId:
      base.archiveId,

    staffId:
      "11111111-1111-4111-8111-111111111111",

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_STALE",
);


assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      signed.token,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion + 1,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_STALE",
);

console.log(
  "PASS R2D3D1B1-11: owner or lease changes invalidate Preview token",
);


// ============================================================
// B1-12 — fingerprint change makes token stale.
// ============================================================

const changedFingerprint =
  postCloseReviewPreviewFingerprint({
    ...base,
    correctedText:
      "124=30x6",
  });


assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      signed.token,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      changedFingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_STALE",
);

console.log(
  "PASS R2D3D1B1-12: changed correction invalidates Preview token",
);


// ============================================================
// B1-13 — expiration / tamper / missing token.
// ============================================================

assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      signed.token,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs
      + (
        POST_CLOSE_REVIEW_PREVIEW_TTL_SECONDS
        + 1
      ) * 1000,

    key,
  }).error,
  "PREVIEW_EXPIRED",
);


const tampered =
  signed.token.slice(
    0,
    -1,
  )
  + (
    signed.token.endsWith("a")
      ? "b"
      : "a"
  );


assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      tampered,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_TOKEN_INVALID",
);


assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      "",

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs,

    key,
  }).error,
  "PREVIEW_REQUIRED",
);

console.log(
  "PASS R2D3D1B1-13: expired, tampered and missing Preview tokens fail closed",
);


// ============================================================
// B1-14 — live and post-close tokens are not interchangeable.
// ============================================================

const liveToken =
  createReviewPreviewToken({
    reviewId: 77,

    messageRecordId:
      "791dd70e-4627-43fe-81d8-b4d5c9d6cede",

    fingerprint,

    nowMs,

    key,
  });


assert.equal(
  verifyPostCloseReviewPreviewToken({
    token:
      liveToken.token,

    archiveId:
      base.archiveId,

    staffId:
      base.staffId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_TOKEN_INVALID",
);


assert.equal(
  verifyReviewPreviewToken({
    token:
      signed.token,

    reviewId: 77,

    messageRecordId:
      "791dd70e-4627-43fe-81d8-b4d5c9d6cede",

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  }).error,
  "PREVIEW_TOKEN_INVALID",
);

console.log(
  "PASS R2D3D1B1-14: live and post-close Preview tokens are cryptographically namespaced",
);


// ============================================================
// B1-15 — targeted archive + current scope + unresolved boundary.
// ============================================================

assert.equal(
  typeof loadStaffPostCloseReviewResolutionAccess,
  "function",
);

assert.match(
  helper,
  /\.from\(\s*"post_close_review_archive"\s*,?\s*\)/,
);

assert.match(
  helper,
  /\.eq\(\s*"id"[\s\S]*?safeArchiveId/,
);

assert.match(
  helper,
  /\.in\(\s*"line_group_id"[\s\S]*?safeLineGroupIds/,
);

assert.match(
  helper,
  /\.is\(\s*"post_close_resolution_type"\s*,\s*null\s*,?\s*\)/,
);

assert.match(
  helper,
  /POST_CLOSE_REVIEW_NOT_FOUND/,
);

console.log(
  "PASS R2D3D1B1-15: Preview access targets one unresolved archive inside current Staff scope",
);


// ============================================================
// B1-16 — exact active post-close ownership is required.
// ============================================================

assert.match(
  helper,
  /loadStaffPostCloseReviewClaimState/,
);

assert.match(
  helper,
  /resolveStaffPostCloseReviewClaimState/,
);

assert.match(
  helper,
  /CLAIM_REQUIRED/,
);

assert.match(
  helper,
  /CLAIM_OWNED_BY_OTHER/,
);

assert.match(
  helper,
  /STALE_CLAIM_VERSION/,
);

assert.match(
  helper,
  /normalizePostCloseLeaseVersion/,
);

console.log(
  "PASS R2D3D1B1-16: targeted Preview requires exact current post-close ownership",
);


// ============================================================
// B1-17 — post-close access must not inherit live lifecycle.
// ============================================================

for (
  const forbidden
  of [
    "fetchOpenSettlementSession",
    "loadActorSessionLineGroupIds",
    "staff_message_work_claims",
    "staff_workbench_claim_state",
    "review_items",
    'from("messages")',
    "settlement_summary_group_rounds",
    "MESSAGE_ROUND_NOT_CURRENT",
    "MESSAGE_OUTSIDE_CURRENT_SETTLEMENT",
    "SETTLEMENT_NOT_OPEN",
  ]
) {
  assert.equal(
    helper.includes(
      forbidden,
    ),
    false,
    `forbidden live lifecycle dependency: ${forbidden}`,
  );
}

console.log(
  "PASS R2D3D1B1-17: post-close Preview safety is independent of live Review lifecycle",
);


// ============================================================
// B1-18 — parser configuration fingerprint safety is reused,
//          not weakened.
// ============================================================

assert.match(
  helper,
  /parserConfigFingerprint/,
);

console.log(
  "PASS R2D3D1B1-18: post-close fingerprint preserves parser-config safety",
);


console.log(
  "PASS: Staff Post-close Review Preview Safety v9.23",
);
