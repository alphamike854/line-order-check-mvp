import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import {
  REVIEW_PREVIEW_TOKEN_VERSION,
} from "./src/lib/review-safety.mjs";

import {
  POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
} from "./src/lib/staff-post-close-review-resolution.mjs";

import {
  VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION,
  VERIFICATION_CORRECTION_PREVIEW_TTL_SECONDS,
  createVerificationCorrectionPreviewToken,
  verificationCorrectionPreviewFingerprint,
  verifyVerificationCorrectionPreviewToken,
} from "./src/lib/staff-message-verification-safety.mjs";


console.log(
  "===== Human Verification Correction Preview Safety =====",
);


const nowMs =
  Date.UTC(
    2026,
    8,
    7,
    12,
    0,
    0,
  );

const key =
  "test-human-verification-preview-key";

const base = {
  messageRecordId:
    "11111111-1111-4111-8111-111111111111",

  staffId:
    "22222222-2222-4222-8222-222222222222",

  settlementSessionId:
    "33333333-3333-4333-8333-333333333333",

  leaseVersion:
    7,

  sourceParserVersion:
    "1.7.19",

  sourceNormalizedText:
    "01=20",

  sourceOrderItems: [
    {
      category: "A",
      code: "01",
      quantity: 20,
    },
  ],

  correctedText:
    "01=25",

  correctedParserVersion:
    "1.7.19",

  correctedNormalizedText:
    "01=25",

  correctedOrderItems: [
    {
      category: "A",
      code: "01",
      quantity: 25,
    },
  ],

  correctedFirstOrderCode:
    "01",

  parserConfig: {
    aliases: {
      "น": "A",
    },
    defaultCategoryByCodeLength: {
      2: "A",
      3: "E",
    },
  },
};


assert.equal(
  VERIFICATION_CORRECTION_PREVIEW_TTL_SECONDS,
  15 * 60,
);

console.log(
  "PASS C3B1-01: Preview TTL is 15 minutes",
);


assert.notEqual(
  VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION,
  REVIEW_PREVIEW_TOKEN_VERSION,
);

assert.notEqual(
  VERIFICATION_CORRECTION_PREVIEW_TOKEN_VERSION,
  POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
);

console.log(
  "PASS C3B1-02: Human Verification has a dedicated token namespace",
);


const fingerprint =
  verificationCorrectionPreviewFingerprint(
    base,
  );

assert.match(
  fingerprint,
  /^[0-9a-f]{64}$/u,
);

assert.equal(
  verificationCorrectionPreviewFingerprint(
    base,
  ),
  fingerprint,
);

console.log(
  "PASS C3B1-03: fingerprint is deterministic SHA-256",
);


const changedContexts = [
  {
    ...base,
    messageRecordId:
      "44444444-4444-4444-8444-444444444444",
  },
  {
    ...base,
    staffId:
      "55555555-5555-4555-8555-555555555555",
  },
  {
    ...base,
    settlementSessionId:
      "66666666-6666-4666-8666-666666666666",
  },
  {
    ...base,
    leaseVersion:
      8,
  },
  {
    ...base,
    sourceParserVersion:
      "1.7.20",
  },
  {
    ...base,
    sourceNormalizedText:
      "01=21",
  },
  {
    ...base,
    sourceOrderItems: [
      {
        category: "A",
        code: "01",
        quantity: 21,
      },
    ],
  },
  {
    ...base,
    correctedText:
      "01=26",
  },
  {
    ...base,
    correctedParserVersion:
      "1.7.20",
  },
  {
    ...base,
    correctedNormalizedText:
      "01=26",
  },
  {
    ...base,
    correctedOrderItems: [
      {
        category: "A",
        code: "01",
        quantity: 26,
      },
    ],
  },
  {
    ...base,
    correctedFirstOrderCode:
      "02",
  },
  {
    ...base,
    parserConfig: {
      aliases: {
        "น": "B",
      },
      defaultCategoryByCodeLength: {
        2: "A",
        3: "E",
      },
    },
  },
];

for (
  const changed
  of changedContexts
) {
  assert.notEqual(
    verificationCorrectionPreviewFingerprint(
      changed,
    ),
    fingerprint,
  );
}

console.log(
  "PASS C3B1-04: identity, lease, source, correction and parser config are fingerprint-bound",
);


const signed =
  createVerificationCorrectionPreviewToken({
    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    fingerprint,

    nowMs,
    key,
  });

assert.match(
  signed.token,
  /^verification-correction-v1\./u,
);

console.log(
  "PASS C3B1-05: signed Preview uses dedicated namespace",
);


const verified =
  verifyVerificationCorrectionPreviewToken({
    token:
      signed.token,

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

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

console.log(
  "PASS C3B1-06: valid exact Preview verifies",
);


for (
  const mismatch
  of [
    {
      messageRecordId:
        "99999999-9999-4999-8999-999999999999",
    },
    {
      staffId:
        "77777777-7777-4777-8777-777777777777",
    },
    {
      settlementSessionId:
        "88888888-8888-4888-8888-888888888888",
    },
    {
      leaseVersion:
        8,
    },
    {
      expectedFingerprint:
        verificationCorrectionPreviewFingerprint({
          ...base,
          correctedText:
            "01=99",
        }),
    },
  ]
) {
  const result =
    verifyVerificationCorrectionPreviewToken({
      token:
        signed.token,

      messageRecordId:
        base.messageRecordId,

      staffId:
        base.staffId,

      settlementSessionId:
        base.settlementSessionId,

      leaseVersion:
        base.leaseVersion,

      expectedFingerprint:
        fingerprint,

      nowMs:
        nowMs + 60_000,

      key,

      ...mismatch,
    });

  assert.equal(
    result.ok,
    false,
  );

  assert.equal(
    result.error,
    "VERIFICATION_PREVIEW_STALE",
  );
}

console.log(
  "PASS C3B1-07: owner/session/lease/correction changes invalidate Preview",
);


const expired =
  verifyVerificationCorrectionPreviewToken({
    token:
      signed.token,

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs
      + (
        VERIFICATION_CORRECTION_PREVIEW_TTL_SECONDS
        + 1
      ) * 1000,

    key,
  });

assert.deepEqual(
  expired,
  {
    ok: false,
    error:
      "VERIFICATION_PREVIEW_EXPIRED",
  },
);

console.log(
  "PASS C3B1-08: expired Preview fails closed",
);


const tamperedToken =
  signed.token.slice(
    0,
    -1,
  )
  + (
    signed.token.endsWith("a")
      ? "b"
      : "a"
  );

const tampered =
  verifyVerificationCorrectionPreviewToken({
    token:
      tamperedToken,

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs:
      nowMs + 60_000,

    key,
  });

assert.deepEqual(
  tampered,
  {
    ok: false,
    error:
      "VERIFICATION_PREVIEW_TOKEN_INVALID",
  },
);

console.log(
  "PASS C3B1-09: tampered Preview fails closed",
);


assert.deepEqual(
  verifyVerificationCorrectionPreviewToken({
    token:
      "",

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs,
    key,
  }),
  {
    ok: false,
    error:
      "VERIFICATION_PREVIEW_REQUIRED",
  },
);

console.log(
  "PASS C3B1-10: missing Preview fails closed",
);


assert.throws(
  () =>
    createVerificationCorrectionPreviewToken({
      messageRecordId:
        base.messageRecordId,

      staffId:
        base.staffId,

      settlementSessionId:
        base.settlementSessionId,

      leaseVersion:
        base.leaseVersion,

      fingerprint,

      nowMs,

      key:
        "",
    }),
  /VERIFICATION_CORRECTION_PREVIEW_SIGNING_KEY_NOT_CONFIGURED/u,
);

console.log(
  "PASS C3B1-11: signing key absence fails closed",
);


const helper =
  await readFile(
    "src/lib/staff-message-verification-safety.mjs",
    "utf8",
  );

assert.match(
  helper,
  /parserConfigFingerprint/u,
);

console.log(
  "PASS C3B1-12: parser-config fingerprint safety is reused",
);


for (
  const forbidden
  of [
    "resolve_staff_review",
    "resolve_staff_post_close_review",
    "review_items",
    "post_close_review_archive",
    'from("messages")',
  ]
) {
  assert.equal(
    helper.includes(
      forbidden,
    ),
    false,
    `forbidden lifecycle dependency: ${forbidden}`,
  );
}

console.log(
  "PASS C3B1-13: safety helper is lifecycle-independent",
);


const liveLookingToken =
  signed.token.replace(
    /^verification-correction-v1/u,
    REVIEW_PREVIEW_TOKEN_VERSION,
  );

assert.equal(
  verifyVerificationCorrectionPreviewToken({
    token:
      liveLookingToken,

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs,
    key,
  }).error,
  "VERIFICATION_PREVIEW_TOKEN_INVALID",
);

console.log(
  "PASS C3B1-14: live Review namespace cannot be substituted",
);


const postCloseLookingToken =
  signed.token.replace(
    /^verification-correction-v1/u,
    POST_CLOSE_REVIEW_PREVIEW_TOKEN_VERSION,
  );

assert.equal(
  verifyVerificationCorrectionPreviewToken({
    token:
      postCloseLookingToken,

    messageRecordId:
      base.messageRecordId,

    staffId:
      base.staffId,

    settlementSessionId:
      base.settlementSessionId,

    leaseVersion:
      base.leaseVersion,

    expectedFingerprint:
      fingerprint,

    nowMs,
    key,
  }).error,
  "VERIFICATION_PREVIEW_TOKEN_INVALID",
);

console.log(
  "PASS C3B1-15: post-close Review namespace cannot be substituted",
);


console.log(
  "PASS: Human Verification Correction Preview Safety",
);
