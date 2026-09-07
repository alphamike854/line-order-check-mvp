import assert from "node:assert/strict";
import fs from "node:fs";


console.log(
  "===== Human Verification Correction Browser =====",
);


const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );


function between(
  start,
  end,
) {
  const startIndex =
    app.indexOf(start);

  const endIndex =
    app.indexOf(
      end,
      startIndex + start.length,
    );

  assert.ok(
    startIndex >= 0,
    `missing start marker: ${start}`,
  );

  assert.ok(
    endIndex > startIndex,
    `missing end marker: ${end}`,
  );

  return app.slice(
    startIndex,
    endIndex,
  );
}


const browser =
  between(
    "// C3B-3 Human Verification Correction Browser",
    "// R2D3B-2 Staff-scoped Post-close Review Queue",
  );


assert.match(
  browser,
  /verification_limit/,
);

assert.match(
  browser,
  /verification_offset/,
);

console.log(
  "PASS C3B3-01: Human Verification uses bounded Workbench pagination",
);


assert.match(
  browser,
  /verification_items/,
);

assert.match(
  browser,
  /verification_pagination/,
);

assert.match(
  browser,
  /staff-verification-card/,
);

console.log(
  "PASS C3B3-02: browser renders dedicated Human Verification feed",
);


assert.match(
  browser,
  /claim_state\s*===\s*"MINE"|claim_state\s*!==\s*"MINE"/,
);

assert.match(
  browser,
  /staffVerificationLeaseVersion/,
);

assert.match(
  browser,
  /staffVerificationCanMutate/,
);

console.log(
  "PASS C3B3-03: mutations require owned claim and exact lease",
);


assert.match(
  browser,
  /\/api\/staff-verification-claim/,
);

console.log(
  "PASS C3B3-04: dedicated verification claim endpoint is used",
);


const confirmFlow =
  between(
    "async function confirmStaffVerification",
    "async function previewStaffVerificationCorrection",
  );

assert.match(
  confirmFlow,
  /\/api\/staff-verification-verify/,
);

for (const field of [
  "message_record_id",
  "lease_version",
  "parser_version",
  "normalized_text",
  "items",
]) {
  assert.ok(
    confirmFlow.includes(field),
    `Confirm missing ${field}`,
  );
}

console.log(
  "PASS C3B3-05: Confirm as-is preserves exact verification source contract",
);


const previewFlow =
  between(
    "async function previewStaffVerificationCorrection",
    "async function applyStaffVerificationCorrection",
  );

assert.match(
  previewFlow,
  /\/api\/staff-verification-correction-preview/,
);

for (const field of [
  "message_record_id",
  "lease_version",
  "corrected_text",
]) {
  assert.ok(
    previewFlow.includes(field),
    `Preview missing ${field}`,
  );
}

console.log(
  "PASS C3B3-06: correction Preview uses C3B-2 boundary",
);


const applyFlow =
  between(
    "async function applyStaffVerificationCorrection",
    "function bindStaffVerificationActions",
  );

assert.match(
  applyFlow,
  /\/api\/staff-verification-correct/,
);

for (const field of [
  "message_record_id",
  "lease_version",
  "corrected_text",
  "preview_token",
]) {
  assert.ok(
    applyFlow.includes(field),
    `Apply missing ${field}`,
  );
}

console.log(
  "PASS C3B3-07: correction Apply uses signed Preview contract",
);


assert.match(
  applyFlow,
  /preview\.correctedText[\s\S]*correctedText/,
);

assert.match(
  applyFlow,
  /preview\.leaseVersion[\s\S]*leaseVersion/,
);

console.log(
  "PASS C3B3-08: Apply binds exact previewed text and lease",
);


assert.match(
  browser,
  /"input"[\s\S]*staff-verification-correction/,
);

assert.match(
  browser,
  /ข้อความถูกแก้หลังจากตรวจผลแล้ว/,
);

console.log(
  "PASS C3B3-09: editing after Preview invalidates token",
);


for (const forbidden of [
  "staff_id:",
  "allowed_line_group_ids:",
  "settlement_session_id:",
  "corrected_parser_version:",
  "corrected_normalized_text:",
  "corrected_order_items:",
  "corrected_first_order_code:",
]) {
  assert.equal(
    previewFlow.includes(forbidden),
    false,
    `Preview cannot send ${forbidden}`,
  );

  assert.equal(
    applyFlow.includes(forbidden),
    false,
    `Apply cannot send ${forbidden}`,
  );
}

console.log(
  "PASS C3B3-10: browser cannot inject trusted correction truth",
);


assert.match(
  browser,
  /round_status\s*===\s*"CLOSED"/,
);

assert.match(
  browser,
  /Human Truth/,
);

assert.match(
  browser,
  /canonical/,
);

console.log(
  "PASS C3B3-11: CLOSED Round immutable-canonical semantics are visible",
);


assert.match(
  applyFlow,
  /canonical_mutation_applied/,
);

assert.match(
  applyFlow,
  /reloadStaffVerificationQueue/,
);

assert.doesNotMatch(
  applyFlow,
  /loadDashboard/,
);

console.log(
  "PASS C3B3-12: successful Apply reports mutation mode and refreshes Staff queue only",
);


assert.match(
  browser,
  /STAFF_VERIFICATION_STATE_CONFLICTS/,
);

assert.match(
  browser,
  /reloadStaffVerificationQueue/,
);

console.log(
  "PASS C3B3-13: lifecycle and claim races reload authoritative queue",
);


for (const code of [
  "VERIFICATION_PREVIEW_REQUIRED",
  "VERIFICATION_PREVIEW_EXPIRED",
  "VERIFICATION_PREVIEW_STALE",
  "VERIFICATION_PREVIEW_TOKEN_INVALID",
]) {
  assert.ok(
    browser.includes(code),
    `missing Preview failure ${code}`,
  );
}

console.log(
  "PASS C3B3-14: stale/expired/tampered Preview fails closed in browser",
);


assert.match(
  browser,
  /load-more-staff-verifications/,
);

assert.match(
  browser,
  /append:\s*true/,
);

console.log(
  "PASS C3B3-15: verification queue supports bounded Load More",
);


const appendCalls =
  app.match(
    /appendStaffVerificationQueue\(/g,
  )
  ?? [];

assert.equal(
  appendCalls.length,
  3,
  "expected one definition plus two loadReviews integration calls",
);

console.log(
  "PASS C3B3-16: Human Verification renders with or without live Review items",
);


assert.doesNotMatch(
  browser,
  /\/api\/review-preview/,
);

assert.doesNotMatch(
  browser,
  /\/api\/review-resolve/,
);

assert.doesNotMatch(
  browser,
  /\/api\/staff-post-close-review-preview/,
);

assert.doesNotMatch(
  browser,
  /\/api\/staff-post-close-review-resolve/,
);

console.log(
  "PASS C3B3-17: Human Verification is isolated from Review lifecycles",
);


assert.match(
  app,
  /async function previewReview/,
);

assert.match(
  app,
  /\/api\/review-preview/,
);

assert.match(
  app,
  /\/api\/review-resolve/,
);

console.log(
  "PASS C3B3-18: existing live Review flow remains present",
);


assert.match(
  app,
  /postCloseReviewResolutionHtml/,
);

assert.match(
  app,
  /\/api\/staff-post-close-review-preview/,
);

assert.match(
  app,
  /\/api\/staff-post-close-review-resolve/,
);

console.log(
  "PASS C3B3-19: existing post-close Review flow remains present",
);


console.log(
  "PASS: Human Verification Correction Browser",
);
