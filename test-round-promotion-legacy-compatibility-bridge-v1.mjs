import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/" +
  "20260910123000_bridge_legacy_promotion_writes_to_round.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const settlementApp =
  fs.readFileSync(
    "netlify/functions/settlement.mjs",
    "utf8",
  );

const readers = [
  fs.readFileSync(
    "netlify/functions/special-points.mjs",
    "utf8",
  ),
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  ),
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  ),
];

console.log(
  "===== Round Promotion Legacy Compatibility Bridge v1 =====",
);

function functionSlice(
  name,
  nextName = "",
) {
  const marker =
    `public.${name}(`;

  const start =
    sql.indexOf(marker);

  assert.ok(
    start >= 0,
    `${name} missing`,
  );

  const end =
    nextName
      ? sql.indexOf(
          `public.${nextName}(`,
          start + marker.length,
        )
      : sql.indexOf(
          "revoke all on function",
          start + marker.length,
        );

  return sql.slice(
    start,
    end > start
      ? end
      : sql.length,
  );
}

const setBridge =
  functionSlice(
    "set_settlement_summary_group_point_promotion",
    "delete_settlement_summary_group_point_promotion",
  );

const deleteBridge =
  functionSlice(
    "delete_settlement_summary_group_point_promotion",
  );

const guard =
  sql.slice(
    0,
    sql.indexOf(
      "create or replace function",
    ),
  );

assert.match(
  guard,
  /PROMOTION_COMPAT_BRIDGE_REQUIRES_ZERO_CURRENT_CONFIG/,
);

for (const table of [
  "settlement_point_promotions",
  "settlement_round_point_promotions",
  "settlement_round_point_promotion_line_groups",
]) {
  assert.match(
    guard,
    new RegExp(table),
  );
}

console.log(
  "PASS PBR-01 migration fails closed if current Promotion config appears before apply",
);

assert.match(
  setBridge,
  /p_settlement_session_id uuid[\s\S]*p_summary_group_id text[\s\S]*p_category text[\s\S]*p_code text[\s\S]*p_point_factor_pct numeric[\s\S]*p_changed_by text default 'DASHBOARD'/i,
);

assert.match(
  deleteBridge,
  /p_settlement_session_id uuid[\s\S]*p_summary_group_id text[\s\S]*p_category text[\s\S]*p_code text[\s\S]*p_changed_by text default 'DASHBOARD'/i,
);

assert.match(
  setBridge,
  /returns jsonb/i,
);

assert.match(
  deleteBridge,
  /returns jsonb/i,
);

console.log(
  "PASS PBR-02 legacy RPC identities and jsonb contracts are preserved",
);

for (const body of [
  setBridge,
  deleteBridge,
]) {
  assert.match(
    body,
    /order by\s+r\.round_no desc[\s\S]*limit 1/i,
  );

  assert.match(
    body,
    /settlement_summary_group_round_snapshots/i,
  );

  assert.match(
    body,
    /ROUND_NOT_FOUND/,
  );

  assert.match(
    body,
    /ROUND_CONFIG_ARCHIVED/,
  );

  assert.doesNotMatch(
    body,
    /SETTLEMENT_NOT_OPEN/,
  );
}

console.log(
  "PASS PBR-03 latest Round is authoritative and CLOSED remains editable until archive",
);

assert.match(
  setBridge,
  /public\.set_settlement_round_point_promotion\s*\(/i,
);

assert.match(
  setBridge,
  /p_target_scope\s*=>\s*'ALL'/i,
);

assert.match(
  setBridge,
  /p_line_group_ids\s*=>\s*'\[\]'::jsonb/i,
);

assert.match(
  setBridge,
  /p_changed_by\s*=>\s*p_changed_by/i,
);

console.log(
  "PASS PBR-04 legacy SET is explicitly mapped to Round scope ALL",
);

const roundSetPosition =
  setBridge.indexOf(
    "public.set_settlement_round_point_promotion(",
  );

const legacySetMirrorPosition =
  setBridge.indexOf(
    "public.settlement_point_promotions (",
  );

assert.ok(
  roundSetPosition >= 0
    && legacySetMirrorPosition >
      roundSetPosition,
);

assert.doesNotMatch(
  setBridge,
  /insert into\s+public\.settlement_round_point_promotions/i,
);

assert.doesNotMatch(
  setBridge,
  /update\s+public\.settlement_round_point_promotions/i,
);

console.log(
  "PASS PBR-05 Round RPC mutates first and legacy SET is mirror-only",
);

assert.match(
  setBridge,
  /v_rule\.target_scope\s*<>\s*'ALL'/i,
);

assert.match(
  setBridge,
  /settlement_round_point_promotion_line_groups/i,
);

assert.match(
  setBridge,
  /PROMOTION_COMPAT_ROUND_RESULT_MISMATCH/,
);

console.log(
  "PASS PBR-06 ALL compatibility mirror verifies factor, scope and empty target set",
);

assert.match(
  deleteBridge,
  /public\.delete_settlement_round_point_promotion\s*\(/i,
);

const roundDeletePosition =
  deleteBridge.indexOf(
    "public.delete_settlement_round_point_promotion(",
  );

const legacyDeleteMirrorPosition =
  deleteBridge.indexOf(
    "delete from\n    public.settlement_point_promotions",
  );

assert.ok(
  roundDeletePosition >= 0
    && legacyDeleteMirrorPosition >
      roundDeletePosition,
);

assert.doesNotMatch(
  deleteBridge,
  /delete from\s+public\.settlement_round_point_promotions/i,
);

console.log(
  "PASS PBR-07 Round DELETE is authoritative and legacy DELETE follows as mirror cleanup",
);

assert.doesNotMatch(
  sql,
  /insert into\s+public\.settlement_point_promotion_events/i,
);

assert.match(
  setBridge,
  /v_round_result[\s\S]*'changed'[\s\S]*'action'/i,
);

assert.match(
  deleteBridge,
  /v_round_result[\s\S]*'changed'[\s\S]*'action'/i,
);

console.log(
  "PASS PBR-08 legacy duplicate audit is not written; Round audit result controls compatibility response",
);

for (const token of [
  "'settlement_session_id'",
  "'summary_group_id'",
  "'category'",
  "'code'",
]) {
  assert.match(
    setBridge,
    new RegExp(token),
  );

  assert.match(
    deleteBridge,
    new RegExp(token),
  );
}

assert.match(
  setBridge,
  /'point_factor_pct'/,
);

assert.match(
  deleteBridge,
  /'previous_point_factor_pct'/,
);

console.log(
  "PASS PBR-09 legacy response shape remains available to existing application callers",
);

const securityDefiners =
  sql.match(
    /security definer/gi,
  ) ?? [];

assert.equal(
  securityDefiners.length,
  2,
);

assert.match(
  sql,
  /revoke all on function[\s\S]*set_settlement_summary_group_point_promotion[\s\S]*from[\s\S]*public,[\s\S]*anon,[\s\S]*authenticated,[\s\S]*service_role/i,
);

assert.match(
  sql,
  /grant execute on function[\s\S]*set_settlement_summary_group_point_promotion[\s\S]*to service_role/i,
);

assert.match(
  sql,
  /revoke all on function[\s\S]*delete_settlement_summary_group_point_promotion[\s\S]*from[\s\S]*public,[\s\S]*anon,[\s\S]*authenticated,[\s\S]*service_role/i,
);

assert.match(
  sql,
  /grant execute on function[\s\S]*delete_settlement_summary_group_point_promotion[\s\S]*to service_role/i,
);

console.log(
  "PASS PBR-10 SECURITY DEFINER boundary remains service-role only",
);

assert.match(
  settlementApp,
  /"set_settlement_summary_group_point_promotion"/,
);

assert.match(
  settlementApp,
  /"delete_settlement_summary_group_point_promotion"/,
);

assert.match(
  settlementApp,
  /"set_settlement_round_point_promotion"/,
);

assert.match(
  settlementApp,
  /"delete_settlement_round_point_promotion"/,
);

for (const app of readers) {
  assert.match(
    app,
    /settlement_point_promotions/,
  );

  assert.doesNotMatch(
    app,
    /settlement_round_point_promotions/,
  );
}

console.log(
  "PASS PBR-11 legacy compatibility remains available alongside explicit Round mutation capability in 2C2P2B1",
);

assert.match(
  sql,
  /^\s*begin;/i,
);

assert.match(
  sql,
  /commit;\s*$/i,
);

console.log(
  "PASS PBR-12 migration is transactional",
);

console.log(
  "PASS: Round Promotion Legacy Compatibility Bridge v1",
);
