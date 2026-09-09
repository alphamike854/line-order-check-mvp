import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/" +
  "20260909130000_add_round_scoped_point_configuration_foundation.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== Round-scoped Point Configuration Foundation v1 =====",
);

assert.match(
  sql,
  /create table if not exists\s+public\.settlement_round_point_promotions/i,
);
assert.match(
  sql,
  /round_id uuid not null[\s\S]*references public\.settlement_summary_group_rounds\(id\)/i,
);
assert.match(
  sql,
  /create table if not exists\s+public\.settlement_round_actual_special_point_codes/i,
);
console.log(
  "PASS F1-01 Round identity owns Promotion and Actual Point",
);

const pointTable =
  sql.match(
    /create table if not exists\s+public\.settlement_round_actual_special_point_codes[\s\S]*?\n  \);/,
  )?.[0] ?? "";

assert.doesNotMatch(
  pointTable,
  /line_group_id/i,
);
assert.match(
  pointTable,
  /primary key\s*\(\s*round_id,\s*category,\s*code\s*\)/i,
);
console.log(
  "PASS F1-02 Actual Point has no LINE Group scope",
);

assert.match(
  sql,
  /target_scope in \('ALL','SELECTED'\)/i,
);
assert.match(
  sql,
  /create table if not exists\s+public\.settlement_round_point_promotion_line_groups/i,
);
assert.match(
  sql,
  /primary key\s*\(\s*promotion_id,\s*line_group_id\s*\)/i,
);
console.log(
  "PASS F1-03 Promotion supports ALL or SELECTED LINE Groups",
);

assert.match(
  sql,
  /unique\s*\(\s*round_id,\s*category,\s*code\s*\)/i,
);
console.log(
  "PASS F1-04 one Promotion rule per Round code",
);

assert.match(
  sql,
  /settlement_round_point_promotion_events/i,
);
assert.match(
  sql,
  /previous_line_group_ids jsonb/i,
);
assert.match(
  sql,
  /new_line_group_ids jsonb/i,
);
assert.match(
  sql,
  /settlement_round_actual_special_point_events/i,
);
assert.match(
  sql,
  /previous_codes jsonb not null/i,
);
assert.match(
  sql,
  /new_codes jsonb not null/i,
);
console.log(
  "PASS F1-05 durable config audit foundations exist",
);

const promotionBackfill =
  sql.match(
    /insert into\s+public\.settlement_round_point_promotions[\s\S]*?do nothing;/i,
  )?.[0] ?? "";

assert.match(
  promotionBackfill,
  /pm\.point_factor_pct,\s*'ALL',/i,
);
assert.match(
  promotionBackfill,
  /from public\.settlement_point_promotions pm/i,
);
console.log(
  "PASS F1-06 legacy Summary Group Promotion backfills as ALL",
);

const latestRoundMatches =
  sql.match(
    /order by r\.round_no desc\s+limit 1/gi,
  ) ?? [];

assert.equal(
  latestRoundMatches.length,
  2,
  "Promotion and Actual Point must each backfill latest Round only",
);
assert.doesNotMatch(
  sql,
  /cross join\s+public\.settlement_summary_group_rounds/i,
);
console.log(
  "PASS F1-07 migration does not invent older Round config history",
);

// F1-07B: compatibility backfill must fail closed if any current
// config row cannot resolve to a real Summary Group Round.
assert.match(
  sql,
  /ROUND_CONFIG_PROMOTION_UNMAPPED/,
);
assert.match(
  sql,
  /ROUND_CONFIG_ACTUAL_POINT_UNMAPPED/,
);

const failClosedGuard =
  sql.match(
    /do \$\$[\s\S]*?ROUND_CONFIG_PROMOTION_UNMAPPED[\s\S]*?ROUND_CONFIG_ACTUAL_POINT_UNMAPPED[\s\S]*?\$\$;/i,
  )?.[0] ?? "";

assert.match(
  failClosedGuard,
  /from public\.settlement_point_promotions pm[\s\S]*?where not exists[\s\S]*?public\.settlement_summary_group_rounds r/i,
);
assert.match(
  failClosedGuard,
  /from public\.settlement_summary_group_actual_special_point_codes sp[\s\S]*?where not exists[\s\S]*?public\.settlement_summary_group_rounds r/i,
);

console.log(
  "PASS F1-07B unmapped current config aborts migration",
);

assert.doesNotMatch(
  sql,
  /alter table\s+public\.settlement_point_promotions/i,
);
assert.doesNotMatch(
  sql,
  /delete from\s+public\.settlement_point_promotions/i,
);
assert.doesNotMatch(
  sql,
  /alter table\s+public\.settlement_summary_group_actual_special_point_codes/i,
);
assert.doesNotMatch(
  sql,
  /delete from\s+public\.settlement_summary_group_actual_special_point_codes/i,
);
console.log(
  "PASS F1-08 legacy active sources remain untouched",
);

assert.doesNotMatch(
  sql,
  /create or replace view\s+public\.session_(code|category|risk|overall)/i,
);
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.replace_settlement_summary_group_actual_special_codes/i,
);
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.set_settlement_summary_group_point_promotion/i,
);
console.log(
  "PASS F1-09 no active read-model or mutation cutover",
);

const rlsMatches =
  sql.match(
    /enable row level security/gi,
  ) ?? [];

assert.ok(
  rlsMatches.length >= 5,
);
assert.match(
  sql,
  /from public, anon, authenticated/i,
);
assert.match(
  sql,
  /to service_role/i,
);
console.log(
  "PASS F1-10 service-role security boundary preserved",
);

console.log(
  "PASS: Round-scoped Point Configuration Foundation v1",
);
