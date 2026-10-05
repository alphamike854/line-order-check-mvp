import assert from "node:assert/strict";
import fs from "node:fs";

const sql =
  fs.readFileSync(
    "supabase/migrations/"
      + "20261005143000_harden_revision_claim_rpc.sql",
    "utf8",
  );

const helper =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const endpoint =
  fs.readFileSync(
    "netlify/functions/staff-verification-claim.mjs",
    "utf8",
  );

console.log(
  "===== Human Verification Revision Claim Final Hardening v1 =====",
);

assert.match(
  sql,
  /revoke all[\s\S]*?claim_staff_message_verification_revision_work\s*\(\s*uuid,\s*uuid,\s*text\[\],\s*uuid,\s*integer\s*\)[\s\S]*?service_role/i,
);

console.log(
  "PASS RCH-01: legacy 5-arg RPC is revoked from service_role",
);

assert.match(
  sql,
  /grant execute[\s\S]*?claim_staff_message_verification_revision_work\s*\(\s*uuid,\s*uuid,\s*text\[\],\s*uuid,\s*bigint,\s*integer\s*\)[\s\S]*?to service_role/i,
);

console.log(
  "PASS RCH-02: fenced 6-arg RPC remains service-role callable",
);

assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function/i,
);

assert.doesNotMatch(
  sql,
  /\b(insert|update|delete)\b/i,
);

console.log(
  "PASS RCH-03: hardening migration changes privileges only",
);

const start =
  helper.indexOf(
    "export async function "
      + "claimStaffMessageVerificationRevisionWork(",
  );

assert.ok(
  start >= 0,
  "revision claim helper missing",
);

let end =
  helper.indexOf(
    "\nexport async function ",
    start + 30,
  );

if (end < 0) {
  end = helper.length;
}

const claimHelper =
  helper.slice(start, end);

assert.match(
  claimHelper,
  /p_expected_revision_no:/,
);

assert.match(
  claimHelper,
  /expectedRevisionNo/,
);

console.log(
  "PASS RCH-04: deployed helper uses fenced expected revision",
);

assert.match(
  endpoint,
  /expectedRevisionNo:\s*revisionNo/,
);

assert.match(
  endpoint,
  /STALE_VERIFICATION_REVISION/,
);

console.log(
  "PASS RCH-05: deployed endpoint remains revision-fenced",
);

console.log(
  "PASS: Human Verification Revision Claim Final Hardening v1",
);
