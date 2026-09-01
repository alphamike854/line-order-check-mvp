"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260901164000_add_summary_group_round_foundation.sql",
    "utf8",
  );

const legacyControl =
  fs.readFileSync(
    "supabase/migrations/20260831020000_add_summary_group_settlement_controls.sql",
    "utf8",
  );

console.log(
  "===== Summary Group Round Foundation v9.21 ====="
);


// R2A-01: real Round identity exists.
assert.match(
  migration,
  /create table if not exists\s+public\.settlement_summary_group_rounds/i,
);

assert.match(
  migration,
  /id uuid primary key[\s\S]*default gen_random_uuid\(\)/i,
);

console.log(
  "PASS R2A-01: Summary Group Round has independent identity",
);


// R2A-02: round still belongs to compatibility settlement.
assert.match(
  migration,
  /settlement_session_id uuid not null[\s\S]*references public\.settlement_sessions\(id\)/i,
);

assert.match(
  migration,
  /summary_group_id text not null[\s\S]*references public\.summary_groups\(id\)/i,
);

console.log(
  "PASS R2A-02: Round is scoped to settlement container and Summary Group",
);


// R2A-03: multiple rounds are representable.
assert.match(
  migration,
  /round_no integer not null[\s\S]*check\s*\(\s*round_no\s*>\s*0\s*\)/i,
);

assert.match(
  migration,
  /unique\s*\(\s*settlement_session_id,\s*summary_group_id,\s*round_no\s*\)/i,
);

console.log(
  "PASS R2A-03: same Summary Group can have multiple numbered rounds",
);


// R2A-04: only one active round per Summary Group.
assert.match(
  migration,
  /create unique index[\s\S]*settlement_summary_group_rounds_one_open_uidx[\s\S]*summary_group_id[\s\S]*where status\s*=\s*'OPEN'/i,
);

console.log(
  "PASS R2A-04: only one OPEN round per Summary Group is allowed",
);


// R2A-05: lifecycle is explicit.
assert.match(
  migration,
  /status text not null[\s\S]*'OPEN'[\s\S]*'CLOSED'/i,
);

assert.match(
  migration,
  /opened_at timestamptz not null/i,
);

assert.match(
  migration,
  /closed_at timestamptz/i,
);

console.log(
  "PASS R2A-05: Round lifecycle has explicit OPEN/CLOSED timestamps",
);


// R2A-06: legacy state is backfilled without changing meaning.
assert.match(
  migration,
  /insert into[\s\S]*settlement_summary_group_rounds/i,
);

assert.match(
  migration,
  /settlement_line_group_config/i,
);

assert.match(
  migration,
  /coalesce\([\s\S]*ctrl\.accepting_orders[\s\S]*true[\s\S]*\)/i,
);

assert.match(
  migration,
  /when s\.status\s*=\s*'CLOSED'[\s\S]*then 'CLOSED'/i,
);

console.log(
  "PASS R2A-06: existing group state backfills as round 1",
);


// R2A-07: foundation must not purge live data.
assert.doesNotMatch(
  migration,
  /delete from\s+public\.(messages|order_items|review_items|review_resolution_events|unsend_events)/i,
);

assert.doesNotMatch(
  migration,
  /truncate\s+/i,
);

console.log(
  "PASS R2A-07: foundation performs no operational purge",
);


// R2A-08: no ownership cutover yet.
assert.doesNotMatch(
  migration,
  /alter table\s+public\.messages/i,
);

assert.doesNotMatch(
  migration,
  /alter table\s+public\.order_items/i,
);

console.log(
  "PASS R2A-08: messages/order_items ownership remains unchanged in foundation",
);


// R2A-09: old OPEN_GROUP RPC is intentionally untouched.
assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.set_settlement_summary_group_accepting/i,
);

assert.match(
  legacyControl,
  /v_session\.status\s*<>\s*'OPEN'/,
);

console.log(
  "PASS R2A-09: legacy Summary Group control remains intact until cutover",
);


// R2A-10: service-role boundary remains consistent.
assert.match(
  migration,
  /enable row level security/i,
);

assert.match(
  migration,
  /revoke all[\s\S]*from public,\s*anon,\s*authenticated/i,
);

assert.match(
  migration,
  /grant[\s\S]*select,[\s\S]*insert,[\s\S]*update,[\s\S]*delete[\s\S]*to service_role/i,
);

console.log(
  "PASS R2A-10: Round table follows service-role security boundary",
);


console.log(
  "PASS: Summary Group Round Foundation v9.21",
);
