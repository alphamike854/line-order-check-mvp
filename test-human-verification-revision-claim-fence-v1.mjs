import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint =
  fs.readFileSync(
    "netlify/functions/staff-verification-claim.mjs",
    "utf8",
  );

const helper =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const sql =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261005134500_fix_revision_claim_stale_fence.sql",
    "utf8",
  );

function extractFunction(
  source,
  name,
) {
  const start =
    source.indexOf(
      `export async function ${name}(`,
    );

  assert.ok(
    start >= 0,
    `${name} missing`,
  );

  let end =
    source.indexOf(
      "\nexport async function ",
      start + 30,
    );

  if (end < 0) {
    end = source.length;
  }

  return source.slice(start, end);
}

const claimHelper =
  extractFunction(
    helper,
    "claimStaffMessageVerificationRevisionWork",
  );

console.log(
  "===== Human Verification Revision Claim Fence v1 =====",
);

assert.match(
  endpoint,
  /normalizeVerificationRevisionNo/,
);

assert.match(
  endpoint,
  /revisionMode[\s\S]*?action === "CLAIM"[\s\S]*?body\?\.revision_no/,
);

assert.match(
  endpoint,
  /REVISION_NO_REQUIRED/,
);

console.log(
  "PASS RCF-01: revision CLAIM requires revision_no",
);

assert.match(
  endpoint,
  /expectedRevisionNo:\s*revisionNo/,
);

console.log(
  "PASS RCF-02: endpoint forwards expected revision",
);

assert.match(
  claimHelper,
  /expectedRevisionNo/,
);

assert.match(
  claimHelper,
  /p_expected_revision_no:[\s\S]*?normalizeVerificationRevisionNo\([\s\S]*?expectedRevisionNo/,
);

console.log(
  "PASS RCF-03: helper binds expected revision to RPC",
);

assert.match(
  sql,
  /p_expected_revision_no bigint/i,
);

assert.match(
  sql,
  /from public\.message_verifications mv[\s\S]*?for update/i,
);

console.log(
  "PASS RCF-04: RPC locks authoritative Human Truth",
);

const stale =
  sql.indexOf(
    "'STALE_VERIFICATION_REVISION'",
  );

const delegate =
  sql.indexOf(
    "return\n    public.claim_staff_message_verification_revision_work(",
  );

assert.ok(stale >= 0);
assert.ok(delegate > stale);

assert.match(
  sql,
  /v_verification\.revision_no[\s\S]*?is distinct from[\s\S]*?p_expected_revision_no[\s\S]*?STALE_VERIFICATION_REVISION/i,
);

console.log(
  "PASS RCF-05: stale fence precedes claim mutation",
);

const legacyRevoke =
  sql.match(
    /revoke all[\s\S]*?claim_staff_message_verification_revision_work\s*\(\s*uuid,\s*uuid,\s*text\[\],\s*uuid,\s*integer\s*\)[\s\S]*?from([\s\S]*?);/i,
  );

assert.ok(
  legacyRevoke,
  "legacy privilege block must exist",
);

assert.doesNotMatch(
  legacyRevoke[1],
  /service_role/i,
);

assert.match(
  sql,
  /grant execute[\s\S]*?claim_staff_message_verification_revision_work\s*\(\s*uuid,\s*uuid,\s*text\[\],\s*uuid,\s*bigint,\s*integer\s*\)[\s\S]*?service_role/i,
);

console.log(
  "PASS RCF-06: rollout keeps legacy app compatible while fenced RPC is added",
);

assert.match(
  endpoint,
  /"STALE_VERIFICATION_REVISION"/,
);

assert.match(
  endpoint,
  /"REVISION_OPEN_ROUND_ONLY"/,
);

console.log(
  "PASS RCF-07: revision claim conflicts map as client conflicts",
);

assert.match(
  endpoint,
  /revisionMode[\s\S]*?claimStaffMessageVerificationRevisionWork[\s\S]*?claimStaffMessageVerificationWork/,
);

assert.match(
  endpoint,
  /releaseStaffMessageVerificationWork/,
);

console.log(
  "PASS RCF-08: first-pass claim + shared release retained",
);

console.log(
  "PASS: Human Verification Revision Claim Fence v1",
);
