import assert from "node:assert/strict";
import fs from "node:fs";

const helper =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const claimEndpoint =
  fs.readFileSync(
    "netlify/functions/staff-verification-claim.mjs",
    "utf8",
  );

const verifyEndpoint =
  fs.readFileSync(
    "netlify/functions/staff-verification-verify.mjs",
    "utf8",
  );


// Dedicated Verification claim boundary.
assert.match(
  helper,
  /claim_staff_message_verification_work/,
);

assert.doesNotMatch(
  helper,
  /claim_staff_review_work/,
);


// RELEASE intentionally reuses the generic,
// authoritative four-argument message release RPC.
assert.match(
  helper,
  /release_staff_review_work/,
);

assert.match(
  helper,
  /p_settlement_session_id/,
);

assert.match(
  helper,
  /p_expected_lease_version/,
);


// Atomic exact-snapshot verification.
assert.match(
  helper,
  /verify_staff_message_order/,
);

for (const field of [
  "p_expected_lease_version",
  "p_expected_parser_version",
  "p_expected_normalized_text",
  "p_expected_order_items",
]) {
  assert.match(
    helper,
    new RegExp(field),
  );
}


// Browser cannot supply trusted actor/scope/session.
for (const endpoint of [
  claimEndpoint,
  verifyEndpoint,
]) {
  assert.match(
    endpoint,
    /authenticateWorkbenchActor/,
  );

  assert.match(
    endpoint,
    /loadActorSessionLineGroupIds/,
  );

  assert.match(
    endpoint,
    /fetchOpenSettlementSession/,
  );

  assert.doesNotMatch(
    endpoint,
    /body\?\.staff_id/,
  );

  assert.doesNotMatch(
    endpoint,
    /body\?\.allowed_line_group_ids/,
  );

  assert.doesNotMatch(
    endpoint,
    /body\?\.settlement_session_id/,
  );
}


// Verification RELEASE is fenced by exact observed lease.
assert.match(
  claimEndpoint,
  /action === "RELEASE"/,
);

assert.match(
  claimEndpoint,
  /LEASE_VERSION_REQUIRED/,
);


// Verification endpoint requires exact browser-observed
// representation rather than reparsing.
assert.match(
  verifyEndpoint,
  /body\?\.parser_version/,
);

assert.match(
  verifyEndpoint,
  /body\?\.normalized_text/,
);

assert.match(
  verifyEndpoint,
  /body\?\.items/,
);

assert.doesNotMatch(
  verifyEndpoint,
  /parseOrder|order-parser/,
);


// Missing/stale message identity is an explicit
// client-side verification conflict, not HTTP 500.
assert.match(
  verifyEndpoint,
  /"MESSAGE_NOT_FOUND"/,
);


// Lifecycle-specific routes.
assert.match(
  claimEndpoint,
  /\/api\/staff-verification-claim/,
);

assert.match(
  verifyEndpoint,
  /\/api\/staff-verification-verify/,
);


// Review endpoint is not modified or imported.
assert.doesNotMatch(
  claimEndpoint,
  /claimStaffReviewWork/,
);

assert.doesNotMatch(
  verifyEndpoint,
  /resolve_staff_review/,
);

console.log(
  "PASS: Human Verification application boundary",
);
