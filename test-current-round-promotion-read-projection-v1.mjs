import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/" +
  "20260910140000_add_current_round_promotion_read_projection.sql";

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const specialPoints =
  fs.readFileSync(
    "netlify/functions/special-points.mjs",
    "utf8",
  );

const settlement =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const accounting =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

console.log(
  "===== Current Round Promotion Read Projection v1 =====",
);

assert.match(
  migration,
  /create or replace view\s+public\.settlement_summary_group_point_promotions_current/i,
);

assert.match(
  migration,
  /security_invoker\s*=\s*true/i,
);

console.log(
  "PASS PRC-01 dedicated security-invoker current Round Promotion projection",
);

assert.match(
  migration,
  /row_number\(\)\s+over\s*\([\s\S]*partition by[\s\S]*settlement_session_id[\s\S]*summary_group_id[\s\S]*order by[\s\S]*round_no desc/i,
);

assert.match(
  migration,
  /r\.rn\s*=\s*1/i,
);

assert.match(
  migration,
  /settlement_summary_group_round_snapshots/i,
);

assert.match(
  migration,
  /not exists/i,
);

console.log(
  "PASS PRC-02 latest non-archived Round owns projection",
);

assert.match(
  migration,
  /join public\.settlement_round_point_promotions p[\s\S]*p\.round_id\s*=\s*r\.id/i,
);

assert.doesNotMatch(
  migration,
  /settlement_point_promotions/,
);

console.log(
  "PASS PRC-03 projection has no legacy Promotion dependency",
);

for (const token of [
  "settlement_session_id",
  "summary_group_id",
  "round_id",
  "round_no",
  "round_status",
  "promotion_id",
  "category",
  "code",
  "point_factor_pct",
  "target_scope",
  "line_group_ids",
  "updated_at",
  "updated_by",
]) {
  assert.match(
    migration,
    new RegExp(token),
  );
}

console.log(
  "PASS PRC-04 projection exposes Round identity and Promotion target contract",
);

assert.match(
  migration,
  /settlement_round_point_promotion_line_groups/i,
);

assert.match(
  migration,
  /jsonb_agg\([\s\S]*line_group_id[\s\S]*order by\s+t\.line_group_id/i,
);

assert.match(
  migration,
  /coalesce\([\s\S]*line_group_ids[\s\S]*'\[\]'::jsonb/i,
);

console.log(
  "PASS PRC-05 SELECTED target IDs are deterministic and empty target sets remain explicit",
);

assert.match(
  migration,
  /revoke all on[\s\S]*settlement_summary_group_point_promotions_current[\s\S]*public,[\s\S]*anon,[\s\S]*authenticated,[\s\S]*service_role/i,
);

assert.match(
  migration,
  /grant select on[\s\S]*settlement_summary_group_point_promotions_current[\s\S]*to service_role/i,
);

console.log(
  "PASS PRC-06 projection is service-role SELECT only",
);

assert.match(
  specialPoints,
  /const promotionSource = useRoundRead[\s\S]*settlement_summary_group_point_promotions_current[\s\S]*settlement_point_promotions/,
);

assert.match(
  specialPoints,
  /const promotionSelect = useRoundRead[\s\S]*target_scope[\s\S]*line_group_ids/,
);

console.log(
  "PASS PRC-07 Special Point GET switches Promotion source with existing Round resolver",
);

assert.match(
  specialPoints,
  /mode:\s*"LEGACY_NO_ROUND"/,
);

assert.match(
  specialPoints,
  /CURRENT_ROUND_ARCHIVED/,
);

assert.match(
  specialPoints,
  /\.from\(promotionSource\)/,
);

console.log(
  "PASS PRC-08 no-Round read fallback and archived-Round fail-closed behavior remain intact",
);

assert.match(
  specialPoints,
  /ROUND_PROMOTION_PROJECTION_MISMATCH/,
);

assert.match(
  specialPoints,
  /ROUND_PROMOTION_TARGET_MISMATCH/,
);

assert.match(
  specialPoints,
  /targetScope === "ALL"[\s\S]*lineGroupIds\.length !== 0/,
);

assert.match(
  specialPoints,
  /targetScope === "SELECTED"[\s\S]*lineGroupIds\.length === 0/,
);

console.log(
  "PASS PRC-09 Round identity and ALL/SELECTED target invariants fail closed",
);

assert.match(
  specialPoints,
  /promotions:\s*promoResult\.data\s*\?\?\s*\[\]/,
);

console.log(
  "PASS PRC-10 existing promotions payload key remains backward compatible",
);

for (const source of [
  settlement,
  dashboard,
  accounting,
]) {
  assert.match(
    source,
    /settlement_point_promotions/,
  );

  assert.doesNotMatch(
    source,
    /settlement_summary_group_point_promotions_current/,
  );
}

console.log(
  "PASS PRC-11 Settlement/Dashboard/Accounting remain outside 2C2P2A",
);

assert.match(
  settlement,
  /"set_settlement_summary_group_point_promotion"/,
);

assert.match(
  settlement,
  /"delete_settlement_summary_group_point_promotion"/,
);

assert.doesNotMatch(
  specialPoints,
  /set_settlement_round_point_promotion/,
);

assert.doesNotMatch(
  specialPoints,
  /delete_settlement_round_point_promotion/,
);

console.log(
  "PASS PRC-12 mutation boundary is unchanged",
);

assert.match(
  migration,
  /^\s*begin;/i,
);

assert.match(
  migration,
  /commit;\s*$/i,
);

console.log(
  "PASS PRC-13 migration is transactional",
);

console.log(
  "PASS: Current Round Promotion Read Projection v1",
);
