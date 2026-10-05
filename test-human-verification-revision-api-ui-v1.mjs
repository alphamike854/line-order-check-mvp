import assert from "node:assert/strict";
import fs from "node:fs";

const helper =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const messageApi =
  fs.readFileSync(
    "netlify/functions/staff-verification-message.mjs",
    "utf8",
  );

console.log(
  "===== Human Verification Revision API/UI v1 — B2A =====",
);


// B2A-01 — revision RPC claim is a separate application helper.
assert.match(
  helper,
  /export async function\s+claimStaffMessageVerificationRevisionWork/i,
);

assert.match(
  helper,
  /"claim_staff_message_verification_revision_work"/,
);

console.log(
  "PASS B2A-01: separate revision claim helper",
);


// B2A-02 — revision apply is separate from first-pass correction.
assert.match(
  helper,
  /export async function\s+reviseStaffMessageVerificationOrder/i,
);

assert.match(
  helper,
  /"revise_staff_message_verification_order"/,
);

console.log(
  "PASS B2A-02: separate revision apply helper",
);


// B2A-03 — optimistic revision fencing is explicit.
assert.match(
  helper,
  /normalizeVerificationRevisionNo/,
);

assert.match(
  helper,
  /p_expected_revision_no:/,
);

assert.match(
  helper,
  /STALE_VERIFICATION_REVISION/,
);

console.log(
  "PASS B2A-03: revision_no fencing reaches application boundary",
);


// B2A-04 — revision access is also lease fenced.
assert.match(
  helper,
  /loadStaffMessageVerificationRevisionAccess/,
);

assert.match(
  helper,
  /staff_message_work_claims/,
);

assert.match(
  helper,
  /STALE_CLAIM_VERSION/,
);

assert.match(
  helper,
  /CLAIM_EXPIRED/,
);

console.log(
  "PASS B2A-04: revision access requires exact live lease",
);


// B2A-05 — edit-again starts from current Human Truth,
// never blindly from the original parser proposal.
assert.match(
  helper,
  /verification\.corrected_text[\s\S]*verified_normalized_text[\s\S]*source_normalized_text/,
);

assert.match(
  helper,
  /current_items:[\s\S]*currentItems/,
);

console.log(
  "PASS B2A-05: revision editor source is current Human Truth",
);


// B2A-06 — first-pass RPC helpers are retained unchanged in surface.
for (const rpc of [
  "claim_staff_message_verification_work",
  "verify_staff_message_order",
  "correct_staff_message_verification_order",
]) {
  assert.match(
    helper,
    new RegExp(
      `"${rpc}"`,
    ),
  );
}

assert.match(
  helper,
  /MESSAGE_ALREADY_VERIFIED/,
);

console.log(
  "PASS B2A-06: first-pass one-way semantics remain present",
);


// B2A-07 — message read model now carries revision metadata.
for (const field of [
  "revision_no",
  "corrected_text",
  "verified_first_order_code",
  "canonical_mutation_applied",
  "source_parser_version",
  "source_normalized_text",
  "source_order_items",
  "last_revised_at",
  "last_revised_by_staff_id",
  "last_revised_by_staff_code",
  "last_revised_by_display_name",
]) {
  assert.match(
    messageApi,
    new RegExp(
      `"${field}"`,
    ),
  );
}

console.log(
  "PASS B2A-07: message read model carries revision context",
);


// B2A-08 — status classification remains the existing
// HUMAN_VERIFIED/HUMAN_CORRECTED model.
assert.match(
  messageApi,
  /return "HUMAN_VERIFIED"/,
);

assert.match(
  messageApi,
  /return "HUMAN_CORRECTED"/,
);

assert.match(
  messageApi,
  /return "UNSENT"/,
);

console.log(
  "PASS B2A-08: existing completed/unsent classification retained",
);


console.log(
  "PASS: Human Verification Revision API/UI v1 — B2A",
);



// ============================================================
// B2B1C — exact-message revision context
// ============================================================

{
  const source =
    fs.readFileSync(
      "netlify/functions/staff-verification-message.mjs",
      "utf8",
    );

  assert.match(
    source,
    /Exact Human Truth revision context v1/,
  );

  assert.match(
    source,
    /revision_no:[\s\S]*verification[\s\S]*\.revision_no/,
  );

  assert.match(
    source,
    /corrected_text:[\s\S]*verification[\s\S]*\.corrected_text/,
  );

  assert.match(
    source,
    /verified_normalized_text:[\s\S]*verification[\s\S]*\.verified_normalized_text/,
  );

  assert.match(
    source,
    /verified_order_items:[\s\S]*verification[\s\S]*\.verified_order_items/,
  );

  assert.match(
    source,
    /verified_first_order_code:[\s\S]*verification[\s\S]*\.verified_first_order_code/,
  );

  assert.match(
    source,
    /last_revised_at:[\s\S]*verification[\s\S]*\.last_revised_at/,
  );

  console.log(
    "PASS B2B1C-01: exact-message API exposes current revision_no",
  );

  console.log(
    "PASS B2B1C-02: exact-message API exposes current Human Truth",
  );

  console.log(
    "PASS B2B1C-03: exact-message API exposes last revision metadata",
  );
}



// ============================================================
// B2B2A — Edit Again UI + revision start
// ============================================================

{
  const app =
    fs.readFileSync(
      "public/app.js",
      "utf8",
    );

  assert.match(
    app,
    /Human Verification Revision Browser v1/,
  );

  assert.match(
    app,
    /function staffVerificationCanRevise\(/,
  );

  assert.match(
    app,
    /function staffVerificationCanMutate\([\s\S]*?=== "PENDING"/,
  );

  console.log(
    "PASS B2B2A-01: revision eligibility remains separate from PENDING first-pass",
  );


  assert.match(
    app,
    /HUMAN_VERIFIED/,
  );

  assert.match(
    app,
    /HUMAN_CORRECTED/,
  );

  assert.match(
    app,
    /start-staff-verification-revision/,
  );

  assert.match(
    app,
    /แก้ไขอีกครั้ง/,
  );

  console.log(
    "PASS B2B2A-02: completed OPEN verification exposes Edit Again",
  );


  assert.match(
    app,
    /async function startStaffVerificationRevision\([\s\S]*?\/api\/staff-verification-message\?/,
  );

  assert.match(
    app,
    /startStaffVerificationRevision\([\s\S]*?revision_mode:[\s\S]*?true/,
  );

  console.log(
    "PASS B2B2A-03: Edit Again fetches exact Human Truth then revision-claims",
  );


  assert.match(
    app,
    /item\?\.corrected_text[\s\S]*?item\?\.verified_normalized_text[\s\S]*?staffVerificationFullSourceText/,
  );

  console.log(
    "PASS B2B2A-04: revision editor starts from current Human Truth",
  );


  assert.match(
    app,
    /_revision_editing:[\s\S]*?true/,
  );

  assert.match(
    app,
    /lease_version:[\s\S]*?leaseVersion/,
  );

  console.log(
    "PASS B2B2A-05: revision editor retains exact claimed lease",
  );


  assert.match(
    app,
    /confirm-staff-verification/,
  );

  assert.match(
    app,
    /\/api\/staff-verification-verify/,
  );

  console.log(
    "PASS B2B2A-06: original first-pass Confirm flow remains present",
  );
}



// ============================================================
// B2B2B1 — Revision browser payload + cache fence
// ============================================================

{
  const app =
    fs.readFileSync(
      "public/app.js",
      "utf8",
    );

  const previewStart =
    app.indexOf(
      "async function previewStaffVerificationCorrection(",
    );

  const applyStart =
    app.indexOf(
      "async function applyStaffVerificationCorrection(",
      previewStart,
    );

  const bindStart =
    app.indexOf(
      "function bindStaffVerificationActions(",
      applyStart,
    );

  assert.ok(
    previewStart >= 0
    && applyStart > previewStart
    && bindStart > applyStart,
  );

  const preview =
    app.slice(
      previewStart,
      applyStart,
    );

  const apply =
    app.slice(
      applyStart,
      bindStart,
    );


  assert.match(
    preview,
    /revisionMode[\s\S]*staffVerificationCanRevise/,
  );

  assert.match(
    preview,
    /staffVerificationCanMutate/,
  );

  assert.match(
    apply,
    /revisionMode[\s\S]*staffVerificationCanRevise/,
  );

  assert.match(
    apply,
    /staffVerificationCanMutate/,
  );

  console.log(
    "PASS B2B2B1-01: Preview/Apply separate revision eligibility from first-pass",
  );


  assert.match(
    preview,
    /revision_mode:[\s\S]*true[\s\S]*revision_no:[\s\S]*revisionNo/,
  );

  assert.match(
    apply,
    /revision_mode:[\s\S]*true[\s\S]*revision_no:[\s\S]*revisionNo/,
  );

  console.log(
    "PASS B2B2B1-02: Preview/Apply send revision_mode + revision_no",
  );


  assert.match(
    preview,
    /card\._staffVerificationPreview = \{[\s\S]*revisionMode,[\s\S]*revisionNo,/,
  );

  assert.match(
    apply,
    /preview\.revisionMode[\s\S]*revisionMode/,
  );

  assert.match(
    apply,
    /preview\.revisionNo[\s\S]*revisionNo/,
  );

  console.log(
    "PASS B2B2B1-03: browser Preview cache is revision-fenced",
  );


  assert.match(
    preview,
    /payload\?\.revision_mode[\s\S]*payload\?\.revision_no/,
  );

  console.log(
    "PASS B2B2B1-04: Preview response must echo exact revision identity",
  );


  assert.match(
    apply,
    /nextRevisionNo[\s\S]*<= revisionNo[\s\S]*STALE_VERIFICATION_REVISION/,
  );

  console.log(
    "PASS B2B2B1-05: Apply requires monotonic revision advance",
  );


  assert.match(
    app,
    /confirm-staff-verification/,
  );

  assert.match(
    app,
    /\/api\/staff-verification-verify/,
  );

  console.log(
    "PASS B2B2B1-06: original first-pass Confirm flow remains present",
  );
}
