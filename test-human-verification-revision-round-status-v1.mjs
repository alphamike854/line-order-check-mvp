import assert from "node:assert/strict";
import fs from "node:fs";

const helperSource =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const previewSource =
  fs.readFileSync(
    "netlify/functions/"
      + "staff-verification-correction-preview.mjs",
    "utf8",
  );

const functionStart =
  helperSource.indexOf(
    "export async function "
      + "loadStaffMessageVerificationRevisionAccess(",
  );

const functionEnd =
  helperSource.indexOf(
    "\n\nexport async function "
      + "reviseStaffMessageVerificationOrder(",
    functionStart,
  );

assert.ok(
  functionStart >= 0
  && functionEnd > functionStart,
  "revision access function must exist",
);

const revisionAccess =
  helperSource.slice(
    functionStart,
    functionEnd,
  );

console.log(
  "===== Human Verification Revision "
    + "Round Status Contract v1 =====",
);

assert.match(
  revisionAccess,
  /\.from\(\s*"settlement_summary_group_rounds"\s*,?\s*\)/,
);
console.log(
  "PASS RSC-01: revision access reads authoritative Round",
);

assert.match(
  revisionAccess,
  /\.eq\(\s*"settlement_session_id"\s*,\s*settlementSessionId\s*,?\s*\)/,
);

assert.match(
  revisionAccess,
  /\.eq\(\s*"summary_group_id"\s*,\s*verification\.summary_group_id\s*,?\s*\)/,
);

assert.match(
  revisionAccess,
  /\.order\(\s*"round_no"\s*,\s*\{[\s\S]*?ascending:\s*false[\s\S]*?\}\s*,?\s*\)/,
);

console.log(
  "PASS RSC-02: latest Round lookup is settlement/group scoped",
);

assert.match(
  revisionAccess,
  /latestRound\.id[\s\S]*?verification[\s\S]*?\.summary_group_round_id/,
);

assert.match(
  revisionAccess,
  /latestRound\.status[\s\S]*?!==\s*"OPEN"/,
);

assert.match(
  revisionAccess,
  /throw new Error\(\s*"REVISION_OPEN_ROUND_ONLY"\s*,?\s*\)/,
);

console.log(
  "PASS RSC-03: revision access fails closed outside latest OPEN Round",
);

assert.match(
  revisionAccess,
  /round_no:\s*latestRound\.round_no/,
);

assert.match(
  revisionAccess,
  /round_status:\s*latestRound\.status/,
);

console.log(
  "PASS RSC-04: revision access exposes authoritative Round state",
);

assert.match(
  previewSource,
  /round_status:\s*access\.round_status/,
);

assert.match(
  previewSource,
  /canonical_mutation_if_applied:[\s\S]*?access\.round_status[\s\S]*?===\s*"OPEN"/,
);

console.log(
  "PASS RSC-05: Preview consumes authoritative revision Round state",
);

assert.match(
  previewSource,
  /revisionMode[\s\S]*?loadStaffMessageVerificationRevisionAccess/,
);

console.log(
  "PASS RSC-06: revision Preview remains on dedicated access path",
);

console.log(
  "PASS: Human Verification Revision "
    + "Round Status Contract v1",
);
