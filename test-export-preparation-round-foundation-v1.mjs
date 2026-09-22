import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/"
  + "20260922072000_add_export_preparation_round_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

console.log(
  "===== Export Preparation Round Foundation v1 =====",
);

assert.match(
  sql,
  /create table if not exists\s+public\.settlement_export_cycles/i,
);
console.log(
  "PASS EXP1-01: export cycle foundation exists",
);

assert.match(
  sql,
  /summary_group_round_id uuid not null[\s\S]*references[\s\S]*public\.settlement_summary_group_rounds\s*\(id\)/i,
);
console.log(
  "PASS EXP1-02: cycle ownership is immutable Round identity",
);

assert.match(
  sql,
  /unique\s*\(\s*summary_group_round_id\s*,\s*cycle_no\s*\)/i,
);
console.log(
  "PASS EXP1-03: cycle numbering is Round-scoped",
);

assert.match(
  sql,
  /status in\s*\(\s*'DRAFT'\s*,\s*'READY'\s*,\s*'SENT'\s*\)/i,
);
console.log(
  "PASS EXP1-04: DRAFT READY SENT lifecycle exists",
);

assert.match(
  sql,
  /create table if not exists\s+public\.settlement_export_items/i,
);
console.log(
  "PASS EXP1-05: per-code export item foundation exists",
);

assert.match(
  sql,
  /current_effective_quantity bigint not null/i,
);

assert.match(
  sql,
  /prior_sent_quantity bigint not null/i,
);

assert.match(
  sql,
  /available_quantity bigint not null/i,
);

assert.match(
  sql,
  /selected_send_quantity bigint not null/i,
);

console.log(
  "PASS EXP1-06: current/prior/available/operator-selected quantities are explicit",
);

assert.match(
  sql,
  /available_quantity\s*=\s*greatest\s*\(\s*current_effective_quantity\s*-\s*prior_sent_quantity\s*,\s*0\s*\)/i,
);
console.log(
  "PASS EXP1-07: available quantity is current minus prior SENT cumulative",
);

assert.match(
  sql,
  /selected_send_quantity\s*<=\s*available_quantity/i,
);
console.log(
  "PASS EXP1-08: operator selection cannot exceed prepared availability",
);

assert.match(
  sql,
  /create or replace view\s+public\.settlement_export_sent_totals/i,
);

assert.match(
  sql,
  /where\s+c\.status\s*=\s*'SENT'/i,
);

assert.match(
  sql,
  /sum\s*\(\s*i\.selected_send_quantity\s*\)/i,
);

console.log(
  "PASS EXP1-09: only SENT cycles contribute to cumulative export",
);

assert.match(
  sql,
  /create or replace function\s+public\.purge_export_preparation_on_new_round/i,
);

assert.match(
  sql,
  /delete from\s+public\.settlement_export_cycles\s+c[\s\S]*using\s+public\.settlement_summary_group_rounds\s+old_round[\s\S]*old_round\.summary_group_id\s*=\s*new\.summary_group_id[\s\S]*old_round\.id\s*<>\s*new\.id/i,
);

console.log(
  "PASS EXP1-10: new Round purges old Export Preparation for same Summary Group",
);

assert.match(
  sql,
  /create trigger\s+settlement_export_purge_on_new_round_trg[\s\S]*after insert[\s\S]*public\.settlement_summary_group_rounds/i,
);

console.log(
  "PASS EXP1-11: purge executes atomically at Round creation boundary",
);

assert.match(
  sql,
  /alter table\s+public\.settlement_export_cycles\s+enable row level security/i,
);

assert.match(
  sql,
  /alter table\s+public\.settlement_export_items\s+enable row level security/i,
);

assert.match(
  sql,
  /grant[\s\S]*select[\s\S]*insert[\s\S]*update[\s\S]*delete[\s\S]*settlement_export_cycles[\s\S]*service_role/i,
);

console.log(
  "PASS EXP1-12: export working state is service-role controlled",
);

assert.doesNotMatch(
  sql,
  /settlement_transfer_batches/i,
);

assert.doesNotMatch(
  sql,
  /settlement_transfer_batch_items/i,
);

assert.doesNotMatch(
  sql,
  /confirmed_cut_total/i,
);

console.log(
  "PASS EXP1-13: Allocation / confirmed-cut storage remains isolated",
);

assert.doesNotMatch(
  sql,
  /LINE_MESSAGE_MIRROR_ENABLED/i,
);

assert.doesNotMatch(
  sql,
  /api\.line\.me/i,
);

assert.doesNotMatch(
  sql,
  /pushMessage/i,
);

console.log(
  "PASS EXP1-14: foundation has no LINE transport path",
);

assert.doesNotMatch(
  sql,
  /selected_send_quantity[\s\S]{0,120}%\s*500/i,
);

console.log(
  "PASS EXP1-15: foundation does not prematurely lock a 500-unit rule",
);

assert.match(
  pkg,
  /test-export-preparation-round-foundation-v1\.mjs/,
);

console.log(
  "PASS EXP1-16: regression contract is registered in full suite",
);

console.log(
  "PASS: Export Preparation Round Foundation v1",
);
