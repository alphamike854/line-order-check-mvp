import fs from "node:fs";
import assert from "node:assert/strict";
import { parseOrder } from "./src/lib/order-parser.mjs";

const webhook = fs.readFileSync(
  new URL("./netlify/functions/line-webhook.mjs", import.meta.url),
  "utf8"
);

const migration = fs.readFileSync(
  new URL(
    "./supabase/migrations/20260826233000_allow_close_with_open_reviews.sql",
    import.meta.url
  ),
  "utf8"
);

// Parser may still produce useful tentative items while classifying as PARTIAL.
{
  const result = parseOrder(`05=20
397 349
=foo`);

  assert.equal(result.status, "PARTIAL");
  assert.ok(result.items.length > 0);
}

// But tentative PARTIAL items must never enter canonical order_items.
assert.match(
  webhook,
  /result\.status === "PARSED"[\s\S]*persist_parsed_message_atomic/
);

// Review remains created for both REVIEW and PARTIAL.
assert.match(
  webhook,
  /\["REVIEW", "PARTIAL"\]\.includes\(result\.status\)/
);

// Migration cleans tentative canonical rows created before v8.3.
assert.match(
  migration,
  /delete from public\.order_items oi[\s\S]*r\.status = 'OPEN'[\s\S]*m\.parse_status in \('PARTIAL','REVIEW'\)/
);

// Closing no longer blocks on Review.
assert.doesNotMatch(
  migration,
  /SETTLEMENT_HAS_OPEN_REVIEW/
);

// Pending Review is explicitly audited rather than silently discarded.
assert.match(
  migration,
  /resolution_type in \('CORRECTED','IGNORED','DEFERRED'\)/
);

assert.match(
  migration,
  /action in \('CORRECTED','IGNORED','DEFERRED'\)/
);

assert.match(
  migration,
  /'DEFERRED'/
);

assert.match(
  migration,
  /deferred_review_count/
);

console.log(
  "PASS: PARTIAL stays Review-only + canonical order_items + deferred close v8.3"
);
