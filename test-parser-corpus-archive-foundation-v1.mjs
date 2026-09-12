"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20260911154500_add_parser_corpus_archive_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );


console.log(
  "===== Parser Corpus Archive Foundation v1 =====",
);


// C1-01
assert.match(
  sql,
  /create table if not exists\s+public\.parser_corpus_archive/i,
);

assert.match(
  sql,
  /source_message_record_id uuid not null/i,
);

assert.match(
  sql,
  /unique\s*\(\s*source_message_record_id\s*\)/i,
);

console.log(
  "PASS C1-01: one durable corpus row per source message",
);


// C1-02
assert.doesNotMatch(
  sql,
  /source_message_record_id[\s\S]{0,100}references\s+public\.messages/i,
);

console.log(
  "PASS C1-02: corpus identity has no FK to operational messages",
);


// C1-03
for (
  const column of [
    "message_snapshot",
    "order_items_snapshot",
    "review_snapshot",
    "review_resolution_events_snapshot",
    "unsend_events_snapshot",
    "verification_snapshot",
  ]
) {
  assert.match(
    sql,
    new RegExp(
      `\\b${column}\\b`,
      "i",
    ),
  );
}

console.log(
  "PASS C1-03: parser, Review, UNSEND and Human Truth snapshots exist",
);


// C1-04
assert.match(
  sql,
  /to_jsonb\(\s*v_message\s*\)/i,
);

assert.match(
  sql,
  /jsonb_agg\([\s\S]*to_jsonb\(item\)[\s\S]*public\.order_items/i,
);

console.log(
  "PASS C1-04: full message and canonical parser output are captured",
);


// C1-05
assert.match(
  sql,
  /public\.message_verifications[\s\S]*verification\.message_record_id/i,
);

console.log(
  "PASS C1-05: existing durable Human Verification is snapshotted",
);


// C1-06
assert.match(
  sql,
  /round\.business_date/i,
);

assert.match(
  sql,
  /round\.daily_round_no/i,
);

assert.match(
  sql,
  /round\.round_no/i,
);

console.log(
  "PASS C1-06: internal and user-facing Round identity are retained",
);


// C1-07
assert.match(
  sql,
  /review_resolution_parser_corpus_before_delete_trg[\s\S]*before delete[\s\S]*on public\.review_resolution_events/i,
);

assert.match(
  sql,
  /unsend_parser_corpus_before_delete_trg[\s\S]*before delete[\s\S]*on public\.unsend_events/i,
);

assert.match(
  sql,
  /messages_parser_corpus_before_delete_trg[\s\S]*before delete[\s\S]*on public\.messages/i,
);

console.log(
  "PASS C1-07: corpus capture precedes every destructive message-reset boundary",
);


// C1-08
assert.match(
  sql,
  /settlement_round_storage_cleanup_queue[\s\S]*status\s*=\s*'PENDING'[\s\S]*storage_bucket\s*=\s*'review-images'[\s\S]*storage_path\s*=\s*v_message\.image_storage_path/i,
);

console.log(
  "PASS C1-08: archived OCR/image evidence is removed from pending Storage cleanup",
);


// C1-09
assert.match(
  sql,
  /on conflict\s*\(\s*source_message_record_id\s*\)\s*do nothing/i,
);

console.log(
  "PASS C1-09: repeated delete hooks cannot overwrite the first complete snapshot",
);


// C1-10
assert.match(
  sql,
  /revoke\s+update,\s*delete[\s\S]*parser_corpus_archive[\s\S]*from service_role/i,
);

console.log(
  "PASS C1-10: parser corpus is append-only to ordinary service-role code",
);


// C1-11
assert.doesNotMatch(
  sql,
  /delete\s+from\s+public\.messages/i,
);

assert.doesNotMatch(
  sql,
  /delete\s+from\s+public\.order_items/i,
);

assert.doesNotMatch(
  sql,
  /delete\s+from\s+public\.review_items/i,
);

assert.doesNotMatch(
  sql,
  /truncate\s+/i,
);

console.log(
  "PASS C1-11: DR1C-A performs no operational-data purge",
);


// C1-12
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.set_settlement_summary_group_accepting/i,
);

assert.doesNotMatch(
  sql,
  /update\s+public\.settlement_sessions/i,
);

console.log(
  "PASS C1-12: authoritative OPEN_GROUP/CLOSE_GROUP lifecycle remains unchanged",
);


// C1-13
for (
  const forbidden of [
    "settlement_transfer_batches",
    "settlement_distribution_runs",
    "settlement_allocation_confirmations",
    "session_overall_risk_state",
  ]
) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      `\\b${forbidden}\\b`,
      "i",
    ),
  );
}

console.log(
  "PASS C1-13: allocation/risk/distribution state is excluded from parser corpus",
);


// C1-14
assert.doesNotMatch(
  sql,
  /\bparser_issues\b/i,
);

console.log(
  "PASS C1-14: no nonexistent parser_issues table dependency is invented",
);


console.log(
  "PASS: Parser Corpus Archive Foundation v1",
);
