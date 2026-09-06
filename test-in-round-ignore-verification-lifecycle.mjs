import assert from "node:assert/strict";
import fs from "node:fs";

const webhook =
  fs.readFileSync(
    "netlify/functions/line-webhook.mjs",
    "utf8",
  );

const migration =
  fs.readFileSync(
    "supabase/migrations/"
      + "20260907040000_harden_in_round_ignore_verification_lifecycle.sql",
    "utf8",
  );


// Retry completeness: IGNORE now requires Review evidence.
assert.doesNotMatch(
  webhook,
  /if\s*\(\s*message\.parse_status === "IGNORE"\s*\)\s*\{\s*return true;/,
);

assert.match(
  webhook,
  /\["REVIEW", "PARTIAL", "IGNORE"\][\s\S]*message\.parse_status/,
);


// Future parser IGNORE must create Review evidence.
assert.match(
  webhook,
  /\["REVIEW", "PARTIAL", "IGNORE"\][\s\S]*result\.status/,
);

assert.match(
  webhook,
  /PARSER_IGNORE_REQUIRES_HUMAN/,
);

assert.match(
  webhook,
  /await saveReview\(/,
);


// Human disposition is corrected by the follow-up
// post-close lifecycle migration. This test remains focused
// on future webhook IGNORE -> Review evidence and safe backfill.


// Existing actionable IGNORE rows receive Review evidence.
assert.match(
  migration,
  /insert into public\.review_items/i,
);

assert.match(
  migration,
  /m\.parse_status\s*=\s*'IGNORE'/i,
);

assert.match(
  migration,
  /s\.status\s*=\s*'OPEN'/i,
);

assert.match(
  migration,
  /r\.round_no desc/i,
);

assert.match(
  migration,
  /m\.unsent\s*=\s*false/i,
);

assert.match(
  migration,
  /left join public\.message_verifications/i,
);

assert.match(
  migration,
  /not exists[\s\S]*existing_review/i,
);


// Machine interpretation semantics must not be rewritten.
assert.doesNotMatch(
  migration,
  /update\s+public\.messages/i,
);

assert.doesNotMatch(
  migration,
  /update\s+public\.order_items/i,
);

console.log(
  "PASS: In-round IGNORE Human Verification lifecycle",
);
