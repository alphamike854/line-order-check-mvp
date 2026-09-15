import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260915030000_add_round_line_group_config_lineage.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const oldRemap =
  fs.readFileSync(
    "supabase/migrations/20260827053000_live_summary_group_remap.sql",
    "utf8",
  );


// Remove SQL comments so executable-SQL isolation tests do not
// treat architecture documentation as executable behavior.

const executableSql =
  migration
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(
      /--.*$/gm,
      "",
    );


// V14B1-01

assert.match(
  migration,
  /create table if not exists[\s\S]*public\.settlement_line_group_round_config/,
);

assert.match(
  migration,
  /primary key\s*\(\s*round_id,\s*line_group_id\s*\)/,
);

assert.match(
  migration,
  /round_id uuid not null[\s\S]*references[\s\S]*public\.settlement_summary_group_rounds\(id\)/,
);

console.log(
  "PASS V14B1-01: Round LINE Group lineage table exists",
);


// V14B1-02
// Session/Summary identity is owned by the referenced Round.

const tableDefinition =
  migration.match(
    /create table if not exists\s+public\.settlement_line_group_round_config\s*\(([\s\S]*?)\n\s*\);/,
  )?.[1] || "";

assert.ok(
  tableDefinition,
  "lineage table definition missing",
);

assert.doesNotMatch(
  tableDefinition,
  /\bsettlement_session_id\b/,
);

assert.doesNotMatch(
  tableDefinition,
  /\bsummary_group_id\b/,
);

console.log(
  "PASS V14B1-02: lineage identity derives from immutable Round",
);


// V14B1-03

assert.match(
  migration,
  /create or replace function[\s\S]*capture_settlement_line_group_round_config/,
);

assert.match(
  migration,
  /cfg\.settlement_session_id\s*=\s*new\.settlement_session_id[\s\S]*cfg\.summary_group_id\s*=\s*new\.summary_group_id[\s\S]*cfg\.enabled = true/,
);

assert.match(
  migration,
  /create trigger[\s\S]*settlement_round_capture_line_group_config_trg[\s\S]*after insert[\s\S]*settlement_summary_group_rounds[\s\S]*when \(new\.status = 'OPEN'\)/,
);

console.log(
  "PASS V14B1-03: OPEN Round snapshots enabled route atomically",
);


// V14B1-04

assert.match(
  migration,
  /ROUND_LINE_GROUP_CONFIG_REQUIRED/,
);

console.log(
  "PASS V14B1-04: missing Round lineage fails closed",
);


// V14B1-05

assert.match(
  migration,
  /BACKFILL_OPEN_ROUTE/,
);

assert.match(
  migration,
  /r\.status = 'OPEN'[\s\S]*cfg\.enabled = true/,
);

console.log(
  "PASS V14B1-05: existing OPEN Round backfill is route-based",
);


// V14B1-06

assert.match(
  migration,
  /BACKFILL_OBSERVED/,
);

assert.match(
  migration,
  /m\.summary_group_round_id = r\.id/,
);

assert.match(
  migration,
  /oi\.summary_group_round_id = r\.id/,
);

console.log(
  "PASS V14B1-06: existing CLOSED Round backfill is observation-based",
);


// V14B1-07

for (const marker of [
  "ROUND_LINE_GROUP_BACKFILL_MESSAGE_OWNERSHIP_MISMATCH",
  "ROUND_LINE_GROUP_BACKFILL_ITEM_OWNERSHIP_MISMATCH",
  "ROUND_LINE_GROUP_BACKFILL_MESSAGE_ROUTE_AMBIGUOUS",
  "ROUND_LINE_GROUP_BACKFILL_ITEM_ROUTE_AMBIGUOUS",
  "ROUND_LINE_GROUP_BACKFILL_OPEN_ROUTE_REQUIRED",
  "ROUND_LINE_GROUP_BACKFILL_OPEN_OBSERVED_ROUTE_DISABLED",
]) {
  assert.ok(
    migration.includes(marker),
    `missing fail-closed marker: ${marker}`,
  );
}

assert.match(
  migration,
  /open_observed[\s\S]*cfg\.enabled = true[\s\S]*ROUND_LINE_GROUP_BACKFILL_OPEN_OBSERVED_ROUTE_DISABLED/,
);

console.log(
  "PASS V14B1-07: contradictory backfill fails closed",
);


// V14B1-08

assert.match(
  migration,
  /revoke all[\s\S]*settlement_line_group_round_config[\s\S]*service_role/,
);

assert.match(
  migration,
  /grant select[\s\S]*settlement_line_group_round_config[\s\S]*to service_role/,
);

assert.match(
  migration,
  /revoke all[\s\S]*capture_settlement_line_group_round_config\(\)[\s\S]*service_role/,
);

console.log(
  "PASS V14B1-08: lineage mutation boundary remains DB-owned",
);


// V14B1-09

assert.doesNotMatch(
  executableSql,
  /\bupdate\s+(?:public\.)?messages\b/i,
);

assert.doesNotMatch(
  executableSql,
  /\bupdate\s+(?:public\.)?order_items\b/i,
);

assert.doesNotMatch(
  executableSql,
  /\bdelete\s+from\s+(?:public\.)?messages\b/i,
);

assert.doesNotMatch(
  executableSql,
  /\bdelete\s+from\s+(?:public\.)?order_items\b/i,
);

console.log(
  "PASS V14B1-09: accepted message/item ownership remains untouched",
);


// V14B1-10
//
// Documentation may name save_line_group_live.
// Executable SQL must not reference or redefine it.

assert.match(
  oldRemap,
  /create or replace function public\.save_line_group_live/,
);

assert.match(
  oldRemap,
  /update public\.messages/,
);

assert.match(
  oldRemap,
  /update public\.order_items/,
);

assert.doesNotMatch(
  executableSql,
  /\bsave_line_group_live\b/i,
);

console.log(
  "PASS V14B1-10: executable SQL does not alter legacy remap",
);


// V14B1-11

assert.doesNotMatch(
  executableSql,
  /\b(EAST|WEST|CENTRAL|NORTH|SOUTH)\b/,
);

console.log(
  "PASS V14B1-11: lineage foundation remains group-generic",
);


console.log(
  "PASS: V14B1 Round LINE Group config lineage foundation contract",
);
