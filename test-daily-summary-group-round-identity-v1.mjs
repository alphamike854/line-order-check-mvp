import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20260911153000_add_daily_summary_group_round_identity.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== Daily Summary Group Round Identity v1 =====",
);


// DR1A-01:
// New business identity is additive.
assert.match(
  sql,
  /alter table[\s\S]*settlement_summary_group_rounds[\s\S]*add column if not exists[\s\S]*business_date date/i,
);

assert.match(
  sql,
  /alter table[\s\S]*settlement_summary_group_rounds[\s\S]*add column if not exists[\s\S]*daily_round_no integer/i,
);

console.log(
  "PASS DR1A-01: Round gains additive business_date and daily_round_no",
);


// DR1A-02:
// Existing internal round_no must not be rewritten.
assert.doesNotMatch(
  sql,
  /update[\s\S]*settlement_summary_group_rounds[\s\S]*set[\s\S]*\bround_no\s*=/i,
);

console.log(
  "PASS DR1A-02: existing internal round_no is preserved",
);


// DR1A-03:
// Historical business dates come from opened_at in Bangkok time.
assert.match(
  sql,
  /opened_at[\s\S]*at time zone 'Asia\/Bangkok'[\s\S]*::date/i,
);

console.log(
  "PASS DR1A-03: historical business date derives from Bangkok opened_at",
);


// DR1A-04:
// Historical daily numbering is per Summary Group + Bangkok date.
assert.match(
  sql,
  /row_number\(\)[\s\S]*partition by[\s\S]*summary_group_id[\s\S]*opened_at[\s\S]*Asia\/Bangkok/is,
);

console.log(
  "PASS DR1A-04: historical daily numbering is per group and date",
);


// DR1A-05:
// User-facing identity does not depend on compatibility settlement.
assert.match(
  sql,
  /create unique index if not exists[\s\S]*daily_identity_uidx[\s\S]*summary_group_id[\s\S]*business_date[\s\S]*daily_round_no/is,
);

assert.doesNotMatch(
  sql.match(
    /create unique index if not exists[\s\S]*?daily_identity_uidx[\s\S]*?\);/is,
  )?.[0] ?? "",
  /settlement_session_id/i,
);

console.log(
  "PASS DR1A-05: business identity is Summary Group + date + daily round",
);


// DR1A-06:
// Future business date is server-derived, never supplied by browser.
assert.match(
  sql,
  /new\.business_date[\s\S]*v_opened_at[\s\S]*at time zone 'Asia\/Bangkok'/is,
);

console.log(
  "PASS DR1A-06: future business date is derived server-side",
);


// DR1A-07:
// Concurrent openings cannot allocate the same daily number.
assert.match(
  sql,
  /pg_advisory_xact_lock[\s\S]*SUMMARY_GROUP_DAILY_ROUND[\s\S]*new\.summary_group_id[\s\S]*new\.business_date/is,
);

assert.match(
  sql,
  /max\(r\.daily_round_no\)[\s\S]*\+\s*1/is,
);

console.log(
  "PASS DR1A-07: daily round allocation is serialized",
);


// DR1A-08:
// Crossing midnight must not mutate an existing Round.
assert.doesNotMatch(
  sql,
  /update[\s\S]*settlement_summary_group_rounds[\s\S]*business_date[\s\S]*current_date/i,
);

assert.doesNotMatch(
  sql,
  /date_trunc[\s\S]*update[\s\S]*settlement_summary_group_rounds/i,
);

console.log(
  "PASS DR1A-08: no midnight rollover mutates an existing Round",
);


// DR1A-09:
// This phase must not delete operational/parser corpus.
assert.doesNotMatch(
  sql,
  /delete\s+from\s+public\.(messages|order_items|review_items|review_resolution_events|unsend_events|parser_issues|message_verifications)/i,
);

assert.doesNotMatch(
  sql,
  /truncate/i,
);

console.log(
  "PASS DR1A-09: migration performs no operational-data purge",
);


// DR1A-10:
// No parent settlement lifecycle change.
assert.doesNotMatch(
  sql,
  /update\s+public\.settlement_sessions/i,
);

assert.doesNotMatch(
  sql,
  /close_settlement_session/i,
);

assert.doesNotMatch(
  sql,
  /open_settlement_session/i,
);

console.log(
  "PASS DR1A-10: parent settlement lifecycle remains unchanged",
);


console.log(
  "PASS: Daily Summary Group Round Identity v1",
);
