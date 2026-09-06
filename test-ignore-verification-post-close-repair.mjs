import assert from "node:assert/strict";
import fs from "node:fs";

const path =
  "supabase/migrations/"
  + "20260907043000_repair_ignore_verification_post_close_lifecycle.sql";

const sql =
  fs.readFileSync(path, "utf8");


// Correct Human IGNORE disposition.
assert.match(
  sql,
  /human_ignore\.resolution_type\s*=\s*'IGNORED'/i,
);

assert.match(
  sql,
  /human_ignore\.status\s+in\s*\(\s*'IGNORED',\s*'RESOLVED'\s*\)/i,
);

assert.match(
  sql,
  /not exists[\s\S]*human_ignore/i,
);


// Repair only the known marker population.
assert.match(
  sql,
  /message\.parse_status\s*=\s*'IGNORE'/i,
);

assert.match(
  sql,
  /review\.status\s*=\s*'OPEN'/i,
);

assert.match(
  sql,
  /round_state\.status\s*=\s*'CLOSED'/i,
);

assert.match(
  sql,
  /PARSER_IGNORE_REQUIRES_HUMAN/,
);


// Must reuse authoritative archive function.
assert.match(
  sql,
  /public\.archive_post_close_review_message\(/i,
);

assert.match(
  sql,
  /not exists[\s\S]*public\.post_close_review_archive/i,
);


// No direct archive mutation.
assert.doesNotMatch(
  sql,
  /insert into\s+public\.post_close_review_archive/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.post_close_review_archive/i,
);


// No canonical/parser mutation.
assert.doesNotMatch(
  sql,
  /update\s+public\.messages/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.order_items/i,
);

assert.doesNotMatch(
  sql,
  /delete from\s+public\.review_items/i,
);

console.log(
  "PASS: IGNORE Verification post-close lifecycle repair",
);
