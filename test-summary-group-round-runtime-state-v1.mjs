"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20261006152000_add_summary_group_round_runtime_state.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );


// R1-01: foundation is one row per Summary Group.
assert.match(
  migration,
  /create table if not exists\s+public\.summary_group_round_runtime_state/i,
);

assert.match(
  migration,
  /summary_group_id text primary key[\s\S]*references public\.summary_groups\(id\)/i,
);

console.log(
  "PASS R1-01 one runtime cursor per Summary Group",
);


// R1-02: latest Round identity is global across settlement sessions.
assert.match(
  migration,
  /row_number\(\) over\s*\(\s*partition by\s+r\.summary_group_id[\s\S]*order by\s+r\.opened_at desc/i,
);

assert.doesNotMatch(
  migration,
  /partition by[\s\S]{0,180}settlement_session_id/i,
);

console.log(
  "PASS R1-02 latest Round backfill crosses settlement-session boundaries",
);


// R1-03: cursor preserves both internal/session and daily identity.
for (const token of [
  "latest_round_id",
  "latest_settlement_session_id",
  "latest_round_no",
  "latest_business_date",
  "latest_daily_round_no",
  "latest_opened_at",
  "generation",
]) {
  assert.match(
    migration,
    new RegExp(`\\b${token}\\b`),
  );
}

console.log(
  "PASS R1-03 cursor preserves required Round numbering state",
);


// R1-04: latest Round/session cannot be deleted while still current.
assert.match(
  migration,
  /latest_round_id uuid not null[\s\S]*references public\.settlement_summary_group_rounds\(id\)[\s\S]*on delete restrict/i,
);

assert.match(
  migration,
  /latest_settlement_session_id uuid not null[\s\S]*references public\.settlement_sessions\(id\)[\s\S]*on delete restrict/i,
);

console.log(
  "PASS R1-04 runtime cursor fails closed on accidental latest-Round deletion",
);


// R1-05: future Round inserts update the cursor additively.
assert.match(
  migration,
  /create or replace function\s+public\.sync_summary_group_round_runtime_state\(\)/i,
);

assert.match(
  migration,
  /create trigger\s+settlement_summary_group_round_runtime_state_trg[\s\S]*after insert[\s\S]*on public\.settlement_summary_group_rounds/i,
);

assert.match(
  migration,
  /generation\s*=\s*state\.generation\s*\+\s*1/i,
);

console.log(
  "PASS R1-05 future Round creation advances runtime generation",
);


// R1-06: an older/backdated insert must not replace a newer cursor.
assert.match(
  migration,
  /where\s+excluded\.latest_opened_at\s*>=\s*state\.latest_opened_at/i,
);

console.log(
  "PASS R1-06 stale historical insert cannot move cursor backward",
);


// R1-07: R1 is additive and contains no destructive business-data purge.
assert.doesNotMatch(
  migration,
  /\bdelete\s+from\b/i,
);

for (const table of [
  "messages",
  "order_items",
  "review_items",
  "unsend_events",
  "parser_corpus_archive",
  "post_close_review_archive",
  "webhook_events",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(
      `(?:truncate|drop\\s+table)\\s+(?:public\\.)?${table}\\b`,
      "i",
    ),
  );
}

console.log(
  "PASS R1-07 foundation performs no destructive retention cutover",
);


// R1-08: existing OPEN/CLOSE lifecycle and daily identity functions are untouched.
assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.set_settlement_summary_group_accepting/i,
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.assign_summary_group_round_daily_identity/i,
);

assert.doesNotMatch(
  migration,
  /drop trigger[\s\S]*settlement_summary_group_round_daily_identity_trg/i,
);

console.log(
  "PASS R1-08 existing OPEN/CLOSE and daily-round behavior are untouched",
);


// R1-09: no webhook admission/claim/UNSEND cutover is introduced in R1.
for (const token of [
  "line_webhook_ingress_admission",
  "claim_webhook_event",
  "handleUnsend",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(token, "i"),
  );
}

console.log(
  "PASS R1-09 webhook/UNSEND behavior remains unchanged",
);


// R1-10: runtime state is server-readable but not directly writable.
assert.match(
  migration,
  /revoke all[\s\S]*summary_group_round_runtime_state[\s\S]*service_role/i,
);

assert.match(
  migration,
  /grant select[\s\S]*summary_group_round_runtime_state[\s\S]*to service_role/i,
);

console.log(
  "PASS R1-10 runtime state direct mutation remains trigger-owned",
);


console.log(
  "PASS: Retention R1 Summary Group Round Runtime State Foundation",
);
