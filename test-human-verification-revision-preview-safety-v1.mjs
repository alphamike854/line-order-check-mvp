import assert from "node:assert/strict";

import {
  verificationCorrectionPreviewFingerprint,
} from "./src/lib/staff-message-verification-safety.mjs";

console.log(
  "===== Human Verification Revision Preview Safety v1 — B2B1A =====",
);

const common = {
  messageRecordId:
    "11111111-1111-4111-8111-111111111111",

  staffId:
    "22222222-2222-4222-8222-222222222222",

  settlementSessionId:
    "33333333-3333-4333-8333-333333333333",

  leaseVersion:
    7,

  sourceParserVersion:
    "source-v1",

  sourceNormalizedText:
    "A 01=1",

  sourceOrderItems: [
    {
      category: "A",
      code: "01",
      quantity: 1,
    },
  ],

  correctedText:
    "A 01=2",

  correctedParserVersion:
    "corrected-v1",

  correctedNormalizedText:
    "A 01=2",

  correctedOrderItems: [
    {
      category: "A",
      code: "01",
      quantity: 2,
    },
  ],

  correctedFirstOrderCode:
    "01",

  parserConfig: {},
};


// B2B1A-01 — omitted revision remains legacy behavior.
const legacy =
  verificationCorrectionPreviewFingerprint(
    common,
  );

const explicitNull =
  verificationCorrectionPreviewFingerprint({
    ...common,
    revisionNo: null,
  });

assert.equal(
  explicitNull,
  legacy,
);

console.log(
  "PASS B2B1A-01: first-pass fingerprint compatibility retained",
);


// B2B1A-02 — revision identity changes fingerprint.
const revision1 =
  verificationCorrectionPreviewFingerprint({
    ...common,
    revisionNo: 1,
  });

const revision2 =
  verificationCorrectionPreviewFingerprint({
    ...common,
    revisionNo: 2,
  });

assert.notEqual(
  revision1,
  legacy,
);

assert.notEqual(
  revision1,
  revision2,
);

console.log(
  "PASS B2B1A-02: revision_no fences Preview fingerprint",
);


// B2B1A-03 — invalid revision fails closed.
assert.throws(
  () =>
    verificationCorrectionPreviewFingerprint({
      ...common,
      revisionNo: 0,
    }),
  /REVISION_NO_REQUIRED/,
);

assert.throws(
  () =>
    verificationCorrectionPreviewFingerprint({
      ...common,
      revisionNo: 1.5,
    }),
  /REVISION_NO_REQUIRED/,
);

console.log(
  "PASS B2B1A-03: invalid revision_no fails closed",
);


console.log(
  "PASS: Human Verification Revision Preview Safety v1 — B2B1A",
);



// ============================================================
// B2B1B1 — Revision Claim endpoint
// ============================================================

import fs from "node:fs";

const revisionClaimSource =
  fs.readFileSync(
    "netlify/functions/staff-verification-claim.mjs",
    "utf8",
  );

assert.match(
  revisionClaimSource,
  /body\?\.revision_mode === true/,
);

assert.match(
  revisionClaimSource,
  /claimStaffMessageVerificationRevisionWork/,
);

assert.match(
  revisionClaimSource,
  /const claimWork =[\s\S]*revisionMode[\s\S]*claimStaffMessageVerificationRevisionWork[\s\S]*claimStaffMessageVerificationWork/,
);

assert.match(
  revisionClaimSource,
  /\? await claimWork\(/,
);

assert.match(
  revisionClaimSource,
  /releaseStaffMessageVerificationWork\(/,
);

assert.match(
  revisionClaimSource,
  /REVISION_OPEN_ROUND_ONLY/,
);

console.log(
  "PASS B2B1B1-01: revision claim uses dedicated RPC wrapper",
);

console.log(
  "PASS B2B1B1-02: first-pass claim remains available",
);

console.log(
  "PASS B2B1B1-03: RELEASE remains shared and unchanged",
);



// ============================================================
// B2B1B2 — Revision Preview endpoint
// ============================================================

const revisionPreviewSource =
  fs.readFileSync(
    "netlify/functions/staff-verification-correction-preview.mjs",
    "utf8",
  );

assert.match(
  revisionPreviewSource,
  /body\?\.revision_mode === true/,
);

assert.match(
  revisionPreviewSource,
  /body\?\.revision_no/,
);

assert.match(
  revisionPreviewSource,
  /normalizeVerificationRevisionNo/,
);

console.log(
  "PASS B2B1B2-01: revision Preview requires explicit revision identity",
);


assert.match(
  revisionPreviewSource,
  /revisionMode[\s\S]*loadStaffMessageVerificationRevisionAccess/,
);

assert.match(
  revisionPreviewSource,
  /expectedRevisionNo:[\s\S]*revisionNo/,
);

assert.match(
  revisionPreviewSource,
  /loadStaffMessageVerificationCorrectionAccess/,
);

console.log(
  "PASS B2B1B2-02: revision and first-pass Preview access stay separate",
);


assert.match(
  revisionPreviewSource,
  /revisionNo,[\s\S]*sourceParserVersion:/,
);

console.log(
  "PASS B2B1B2-03: Preview fingerprint is revision-bound",
);


assert.match(
  revisionPreviewSource,
  /revision_mode:[\s\S]*revisionMode/,
);

assert.match(
  revisionPreviewSource,
  /revision_no:[\s\S]*revisionNo/,
);

console.log(
  "PASS B2B1B2-04: Preview response returns revision identity",
);


assert.match(
  revisionPreviewSource,
  /STALE_VERIFICATION_REVISION/,
);

assert.match(
  revisionPreviewSource,
  /REVISION_OPEN_ROUND_ONLY/,
);

console.log(
  "PASS B2B1B2-05: stale or non-OPEN revision fails closed",
);



// ============================================================
// B2B1B3 — Revision Apply endpoint
// ============================================================

const revisionApplySource =
  fs.readFileSync(
    "netlify/functions/staff-verification-correct.mjs",
    "utf8",
  );

assert.match(
  revisionApplySource,
  /body\?\.revision_mode === true/,
);

assert.match(
  revisionApplySource,
  /body\?\.revision_no/,
);

assert.match(
  revisionApplySource,
  /normalizeVerificationRevisionNo/,
);

console.log(
  "PASS B2B1B3-01: revision Apply requires explicit revision identity",
);


assert.match(
  revisionApplySource,
  /revisionMode[\s\S]*loadStaffMessageVerificationRevisionAccess/,
);

assert.match(
  revisionApplySource,
  /expectedRevisionNo:[\s\S]*revisionNo/,
);

assert.match(
  revisionApplySource,
  /loadStaffMessageVerificationCorrectionAccess/,
);

console.log(
  "PASS B2B1B3-02: revision and first-pass Apply access stay separate",
);


assert.match(
  revisionApplySource,
  /revisionNo,[\s\S]*sourceParserVersion:/,
);

console.log(
  "PASS B2B1B3-03: Apply recomputes revision-bound fingerprint",
);


assert.match(
  revisionApplySource,
  /revisionMode[\s\S]*reviseStaffMessageVerificationOrder/,
);

assert.match(
  revisionApplySource,
  /correctStaffMessageVerificationOrder/,
);

console.log(
  "PASS B2B1B3-04: Apply branches to dedicated revision RPC",
);


assert.match(
  revisionApplySource,
  /revision_mode:[\s\S]*revisionMode/,
);

assert.match(
  revisionApplySource,
  /revision_no:/,
);

console.log(
  "PASS B2B1B3-05: Apply response exposes revision result",
);


assert.match(
  revisionApplySource,
  /STALE_VERIFICATION_REVISION/,
);

assert.match(
  revisionApplySource,
  /REVISION_OPEN_ROUND_ONLY/,
);

console.log(
  "PASS B2B1B3-06: stale or non-OPEN revision fails closed",
);
