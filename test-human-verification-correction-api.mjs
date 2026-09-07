import assert from "node:assert/strict";
import fs from "node:fs";

import {
  canonicalVerificationOrderItems,
} from "./src/lib/staff-message-verification.mjs";


console.log(
  "===== Human Verification Correction API Safety =====",
);


const helper =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const preview =
  fs.readFileSync(
    "netlify/functions/staff-verification-correction-preview.mjs",
    "utf8",
  );

const apply =
  fs.readFileSync(
    "netlify/functions/staff-verification-correct.mjs",
    "utf8",
  );

const verify =
  fs.readFileSync(
    "netlify/functions/staff-verification-verify.mjs",
    "utf8",
  );


const sorted =
  canonicalVerificationOrderItems([
    {
      category: "E",
      code: "123",
      quantity: 5,
    },
    {
      category: "A",
      code: "02",
      quantity: 10,
    },
    {
      category: "A",
      code: "01",
      quantity: 20,
    },
  ]);

assert.deepEqual(
  sorted,
  [
    {
      category: "A",
      code: "01",
      quantity: 20,
    },
    {
      category: "A",
      code: "02",
      quantity: 10,
    },
    {
      category: "E",
      code: "123",
      quantity: 5,
    },
  ],
);

console.log(
  "PASS C3B2-01: correction items canonicalize to DB snapshot order",
);


for (const token of [
  '.from(\n      "messages"',
  '.from(\n      "order_items"',
  '"staff_workbench_claim_state"',
  '"settlement_summary_group_rounds"',
  '"settlement_line_group_config"',
  '"message_verifications"',
]) {
  assert.ok(
    helper.includes(token),
    `missing exact correction access boundary: ${token}`,
  );
}

console.log(
  "PASS C3B2-02: exact source, lifecycle, scope and claim state are server-read",
);


assert.match(
  helper,
  /latestRound\.id[\s\S]*message\.summary_group_round_id/i,
);

assert.match(
  helper,
  /\[\s*"OPEN",\s*"CLOSED",\s*\][\s\S]*latestRound\.status/i,
);

console.log(
  "PASS C3B2-03: latest OPEN or CLOSED Round remains eligible",
);


assert.match(
  helper,
  /claim\.staff_id[\s\S]*staffId[\s\S]*CLAIM_OWNED_BY_OTHER/i,
);

assert.match(
  helper,
  /claimLeaseVersion[\s\S]*safeLeaseVersion[\s\S]*STALE_CLAIM_VERSION/i,
);

assert.match(
  helper,
  /claimExpiresAtMs[\s\S]*CLAIM_EXPIRED/i,
);

console.log(
  "PASS C3B2-04: exact Staff claim owner, expiry and lease are enforced",
);


assert.match(
  helper,
  /correct_staff_message_verification_order/i,
);

for (const parameter of [
  "p_message_record_id",
  "p_staff_id",
  "p_allowed_line_group_ids",
  "p_settlement_session_id",
  "p_expected_lease_version",
  "p_expected_parser_version",
  "p_expected_normalized_text",
  "p_expected_order_items",
  "p_corrected_text",
  "p_corrected_parser_version",
  "p_corrected_normalized_text",
  "p_corrected_order_items",
  "p_corrected_first_order_code",
]) {
  assert.ok(
    helper.includes(parameter),
    `missing correction RPC parameter: ${parameter}`,
  );
}

console.log(
  "PASS C3B2-05: application wrapper binds complete correction RPC contract",
);


for (const source of [
  preview,
  apply,
]) {
  assert.match(
    source,
    /authenticateWorkbenchActor/,
  );

  assert.match(
    source,
    /loadActorSessionLineGroupIds/,
  );

  assert.match(
    source,
    /fetchOpenSettlementSession/,
  );

  assert.match(
    source,
    /loadStaffMessageVerificationCorrectionAccess/,
  );
}

console.log(
  "PASS C3B2-06: Preview and Apply derive Staff scope server-side",
);


assert.match(
  preview,
  /loadParserConfig/,
);

assert.match(
  preview,
  /parseOrder\s*\(/,
);

assert.match(
  preview,
  /firstLedgerCode\s*\(/,
);

assert.match(
  preview,
  /verificationCorrectionPreviewFingerprint/,
);

assert.match(
  preview,
  /createVerificationCorrectionPreviewToken/,
);

console.log(
  "PASS C3B2-07: Preview server-parses and signs exact correction proposal",
);


assert.match(
  apply,
  /loadParserConfig/,
);

assert.match(
  apply,
  /parseOrder\s*\(/,
);

assert.match(
  apply,
  /firstLedgerCode\s*\(/,
);

assert.match(
  apply,
  /verificationCorrectionPreviewFingerprint/,
);

assert.match(
  apply,
  /verifyVerificationCorrectionPreviewToken/,
);

assert.match(
  apply,
  /correctStaffMessageVerificationOrder/,
);

const parseIndex =
  apply.indexOf(
    "parseOrder(",
  );

const verifyTokenIndex =
  apply.indexOf(
    "verifyVerificationCorrectionPreviewToken({",
  );

const mutateIndex =
  apply.indexOf(
    "await correctStaffMessageVerificationOrder(",
  );

assert.ok(
  parseIndex >= 0
  && verifyTokenIndex
    > parseIndex
  && mutateIndex
    > verifyTokenIndex,
  "Apply must reparse, then verify Preview, then mutate",
);

console.log(
  "PASS C3B2-08: Apply reparses before signed-Preview verification and RPC mutation",
);


const forbiddenBrowserFields = [
  "body?.staff_id",
  "body?.settlement_session_id",
  "body?.allowed_line_group_ids",
  "body?.parser_version",
  "body?.normalized_text",
  "body?.items",
  "body?.first_order_code",
];

for (
  const source
  of [
    preview,
    apply,
  ]
) {
  for (
    const forbidden
    of forbiddenBrowserFields
  ) {
    assert.equal(
      source.includes(
        forbidden,
      ),
      false,
      `browser field must not be trusted: ${forbidden}`,
    );
  }
}

console.log(
  "PASS C3B2-09: browser cannot inject trusted source/parser/scope truth",
);


assert.match(
  apply,
  /VERIFICATION_PREVIEW_REQUIRED[\s\S]*428/,
);

for (const code of [
  "VERIFICATION_PREVIEW_TOKEN_INVALID",
  "VERIFICATION_PREVIEW_EXPIRED",
  "VERIFICATION_PREVIEW_STALE",
]) {
  assert.ok(
    apply.includes(code),
    `missing Preview conflict mapping: ${code}`,
  );
}

console.log(
  "PASS C3B2-10: missing/stale/expired/tampered Preview fails closed",
);


assert.match(
  preview,
  /canonical_mutation_if_applied[\s\S]*round_status[\s\S]*OPEN/,
);

assert.doesNotMatch(
  preview,
  /round_status[\s\S]{0,80}===\s*"OPEN"[\s\S]{0,120}(throw|return json\(\s*\{\s*ok:\s*false)/i,
);

assert.doesNotMatch(
  apply,
  /round_status[\s\S]{0,80}===\s*"OPEN"[\s\S]{0,120}(throw|return json\(\s*\{\s*ok:\s*false)/i,
);

console.log(
  "PASS C3B2-11: application layer does not reject OPEN-to-CLOSED race",
);


for (
  const source
  of [
    helper,
    preview,
    apply,
  ]
) {
  for (const forbidden of [
    "resolve_staff_review",
    "resolve_staff_post_close_review",
    "post_close_review_archive",
  ]) {
    assert.equal(
      source.includes(
        forbidden,
      ),
      false,
      `Verification correction must remain Review-independent: ${forbidden}`,
    );
  }
}

console.log(
  "PASS C3B2-12: correction lifecycle remains independent from Review resolution",
);


assert.match(
  preview,
  /\/api\/staff-verification-correction-preview/,
);

assert.match(
  apply,
  /\/api\/staff-verification-correct/,
);

console.log(
  "PASS C3B2-13: dedicated Preview and Apply routes exist",
);


assert.doesNotMatch(
  verify,
  /parseOrder/,
);

assert.doesNotMatch(
  verify,
  /correctStaffMessageVerificationOrder/,
);

assert.doesNotMatch(
  verify,
  /VerificationCorrectionPreview/,
);

console.log(
  "PASS C3B2-14: existing verification confirm endpoint remains unchanged in responsibility",
);


for (
  const source
  of [
    preview,
    apply,
  ]
) {
  assert.match(
    source,
    /CORRECTION_CONFLICTS[\s\S]*"MESSAGE_NOT_FOUND",/,
    "MESSAGE_NOT_FOUND must be a correction conflict",
  );

  assert.match(
    source,
    /CORRECTION_CONFLICTS[\s\S]*"STAFF_NOT_ACTIVE",/,
    "STAFF_NOT_ACTIVE must be a correction conflict",
  );

  assert.doesNotMatch(
    source,
    /message\s*===\s*"MESSAGE_NOT_FOUND"[\s\S]{0,120}return\s+404/,
    "MESSAGE_NOT_FOUND must not have a dedicated 404 branch",
  );
}

console.log(
  "PASS C3B2-15: correction APIs preserve existing verification conflict semantics",
);



console.log(
  "PASS: Human Verification Correction API Safety",
);
