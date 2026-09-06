import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260906170000_harden_message_verification_privileges.sql";

const sql =
  fs.readFileSync(path, "utf8");

assert.match(
  sql,
  /revoke all[\s\S]*on public\.message_verifications[\s\S]*from public, anon, authenticated, service_role/i,
);

assert.match(
  sql,
  /grant select[\s\S]*on public\.message_verifications[\s\S]*to service_role/i,
);

assert.doesNotMatch(
  sql,
  /grant\s+(insert|update|delete|all)/i,
);

assert.match(
  sql,
  /claim_staff_message_verification_work[\s\S]*grant execute/i,
);

assert.match(
  sql,
  /verify_staff_message_order[\s\S]*grant execute/i,
);

assert.match(
  sql,
  /from public, anon, authenticated/i,
);

console.log(
  "PASS: Human Verification privilege hardening contract",
);
