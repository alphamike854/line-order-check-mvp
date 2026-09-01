import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  "supabase/migrations/20260901032000_scope_actual_point_readiness_by_risk_pool.sql",
  "utf8",
);

console.log(
  "===== Actual Point Risk Pool Readiness v9.20 =====",
);

assert.match(
  migration,
  /pool_readiness as\s*\(/i,
);
console.log(
  "PASS A2C-01 independent Risk Pool readiness exists",
);

assert.match(
  migration,
  /d\.risk_pool/,
);

assert.match(
  migration,
  /c\.category in \('A','B','E'\)/,
);

assert.match(
  migration,
  /c\.category in \('G','H','L'\)/,
);

assert.match(
  migration,
  /c\.category = 'F'/,
);

console.log(
  "PASS A2C-02 readiness preserves category rules",
);

assert.match(
  migration,
  /pr\.risk_pool\s*=\s*p\.risk_pool/,
);

console.log(
  "PASS A2C-03 readiness cannot leak across pools",
);

assert.match(
  migration,
  /coalesce\(pr\.actual_codes_ready,true\)/,
);

console.log(
  "PASS A2C-04 empty Risk Pools remain ready",
);

assert.doesNotMatch(
  migration,
  /session_summary_group_actual_point_status st/,
);

console.log(
  "PASS A2C-05 Risk Pool no longer consumes whole-group readiness",
);

assert.doesNotMatch(
  migration,
  /settlement_actual_special_point_codes/,
);

assert.doesNotMatch(
  migration,
  /session_actual_point_status/,
);

console.log(
  "PASS A2C-06 no legacy Actual Point dependency",
);

assert.doesNotMatch(
  migration,
  /create or replace function public\.confirm_/i,
);

assert.doesNotMatch(
  migration,
  /insert into public\.settlement_transfer_batches/i,
);

assert.doesNotMatch(
  migration,
  /update public\.settlement_transfer_batches/i,
);

assert.doesNotMatch(
  migration,
  /delete from public\.settlement_transfer_batches/i,
);

console.log(
  "PASS A2C-07 operational mutation boundary untouched",
);

console.log(
  "PASS: Actual Point Risk Pool Readiness v9.20",
);
