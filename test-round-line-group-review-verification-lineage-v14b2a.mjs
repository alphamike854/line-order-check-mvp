import assert from "node:assert/strict";
import fs from "node:fs";

const review =
  fs.readFileSync(
    "src/lib/staff-review-access.mjs",
    "utf8",
  );

const verification =
  fs.readFileSync(
    "src/lib/staff-message-verification.mjs",
    "utf8",
  );

const legacyCorrectionTest =
  fs.readFileSync(
    "test-human-verification-correction-api.mjs",
    "utf8",
  );


// V14B2A-01
assert.match(
  review,
  /\.from\(\s*"settlement_line_group_round_config",?\s*\)/,
);

assert.match(
  verification,
  /\.from\(\s*"settlement_line_group_round_config",?\s*\)/,
);

console.log(
  "PASS V14B2A-01: Review and Verification use Round lineage",
);


// V14B2A-02
assert.match(
  review,
  /\.eq\(\s*"round_id",\s*message\.summary_group_round_id,?\s*\)/,
);

assert.match(
  verification,
  /\.eq\(\s*"round_id",\s*message\.summary_group_round_id,?\s*\)/,
);

console.log(
  "PASS V14B2A-02: lineage lookup binds immutable message Round",
);


// V14B2A-03
assert.match(
  review,
  /\.eq\(\s*"line_group_id",\s*message\.line_group_id,?\s*\)/,
);

assert.match(
  verification,
  /\.eq\(\s*"line_group_id",\s*message\.line_group_id,?\s*\)/,
);

console.log(
  "PASS V14B2A-03: lineage lookup binds immutable LINE Group",
);


// V14B2A-04
assert.doesNotMatch(
  review,
  /\.from\(\s*"settlement_line_group_config",?\s*\)/,
);

assert.doesNotMatch(
  verification,
  /\.from\(\s*"settlement_line_group_config",?\s*\)/,
);

console.log(
  "PASS V14B2A-04: accepted-message access no longer depends on current route",
);


// V14B2A-05
assert.match(
  review,
  /MESSAGE_LINE_GROUP_CONFIG_MISMATCH/,
);

assert.match(
  verification,
  /MESSAGE_LINE_GROUP_CONFIG_MISMATCH/,
);

console.log(
  "PASS V14B2A-05: external application error contract retained",
);


// V14B2A-06
assert.match(
  review,
  /latestRound\.id[\s\S]*message\.summary_group_round_id/,
);

assert.match(
  verification,
  /latestRound\.id[\s\S]*message\.summary_group_round_id/,
);

assert.match(
  verification,
  /"OPEN",[\s\S]*"CLOSED",/,
);

console.log(
  "PASS V14B2A-06: latest Working Round lifecycle guard retained",
);


// V14B2A-07
assert.match(
  legacyCorrectionTest,
  /settlement_line_group_round_config/,
);

assert.doesNotMatch(
  legacyCorrectionTest,
  /(["'])settlement_line_group_config\1/,
);

console.log(
  "PASS V14B2A-07: legacy correction test follows immutable lineage boundary",
);


// V14B2A-08
for (const source of [
  review,
  verification,
]) {
  assert.doesNotMatch(
    source,
    /\b(EAST|WEST|CENTRAL|NORTH|SOUTH)\b/,
  );
}

console.log(
  "PASS V14B2A-08: cutover remains Summary-Group generic",
);


// V14B2A-09
for (const source of [
  review,
  verification,
]) {
  assert.doesNotMatch(
    source,
    /\.from\(\s*"messages"\s*\)[\s\S]{0,300}\.(?:update|delete|insert|upsert)\(/,
  );

  assert.doesNotMatch(
    source,
    /\.from\(\s*"order_items"\s*\)[\s\S]{0,300}\.(?:update|delete|insert|upsert)\(/,
  );
}

console.log(
  "PASS V14B2A-09: access cutover introduces no canonical ownership mutation",
);


console.log(
  "PASS: V14B2A Review/Verification Round-lineage access contract",
);
