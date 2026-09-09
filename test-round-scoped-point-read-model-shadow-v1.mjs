import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/" +
  "20260909140000_add_round_scoped_point_read_model_shadow.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== Round-scoped Point Read Model Shadow v1 =====",
);

// C1-01: shadow views exist and production views are not replaced.
for (const name of [
  "session_round_line_group_code_risk_shadow",
  "session_round_code_risk_shadow",
  "session_round_category_risk_shadow",
]) {
  assert.match(
    sql,
    new RegExp(
      `create or replace view\\s+public\\.${name}`,
      "i",
    ),
  );
}

for (const productionName of [
  "session_line_group_code_risk_state",
  "session_code_risk_state",
  "session_category_risk_state",
  "session_risk_pool_state",
  "session_overall_risk_state",
]) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      `create or replace view\\s+public\\.${productionName}\\s+as`,
      "i",
    ),
  );
}

console.log(
  "PASS C1-01 shadow-only read model; production views untouched",
);

// C1-02: latest Round is authoritative and archived Round is excluded.
assert.match(
  sql,
  /row_number\(\)\s+over\s*\([\s\S]*partition by[\s\S]*r\.settlement_session_id,[\s\S]*r\.summary_group_id[\s\S]*order by[\s\S]*r\.round_no desc/is,
);
assert.match(
  sql,
  /rr\.latest_rank\s*=\s*1/i,
);
assert.match(
  sql,
  /settlement_summary_group_round_snapshots/i,
);
assert.match(
  sql,
  /s\.round_id\s*=\s*rr\.id/i,
);

console.log(
  "PASS C1-02 latest non-archived Round boundary",
);

// C1-03: canonical order ownership is matched by round_id.
assert.match(
  sql,
  /ar\.round_id\s*=\s*oi\.summary_group_round_id/i,
);
assert.match(
  sql,
  /ar\.settlement_session_id\s*=\s*oi\.settlement_session_id/i,
);
assert.match(
  sql,
  /cfg\.summary_group_id\s*=\s*ar\.summary_group_id/i,
);

console.log(
  "PASS C1-03 order_items remain canonical and Round-owned",
);

// C1-04: Promotion is resolved while LINE Group provenance exists.
const promotionBlock =
  sql.match(
    /promotion_resolved as\s*\([\s\S]*?\n\),\ncalculated as/i,
  )?.[0] ?? "";

assert.match(
  promotionBlock,
  /settlement_round_point_promotions rp/i,
);
assert.match(
  promotionBlock,
  /rp\.round_id\s*=\s*cb\.round_id/i,
);
assert.match(
  promotionBlock,
  /rp\.target_scope\s*=\s*'ALL'/i,
);
assert.match(
  promotionBlock,
  /rp\.target_scope\s*=\s*'SELECTED'/i,
);
assert.match(
  promotionBlock,
  /settlement_round_point_promotion_line_groups/i,
);
assert.match(
  promotionBlock,
  /plg\.line_group_id\s*=\s*cb\.line_group_id/i,
);
assert.match(
  promotionBlock,
  /else 100::numeric/i,
);

console.log(
  "PASS C1-04 ALL/SELECTED Promotion resolves before aggregation",
);

// C1-05: confirmed cuts preserve LINE Group provenance.
const cutBlock =
  sql.match(
    /line_cuts as\s*\([\s\S]*?\n\),\npromotion_resolved as/i,
  )?.[0] ?? "";

assert.match(
  cutBlock,
  /settlement_transfer_batch_items i/i,
);
assert.match(
  cutBlock,
  /i\.line_group_id/i,
);
assert.match(
  cutBlock,
  /group by[\s\S]*i\.line_group_id[\s\S]*i\.category[\s\S]*i\.code/is,
);
assert.match(
  promotionBlock,
  /lc\.line_group_id\s*=\s*cb\.line_group_id/i,
);

console.log(
  "PASS C1-05 cut provenance remains LINE Group-scoped",
);

// C1-06: Summary Group roll-up happens from already-promoted LINE rows.
const summaryView =
  sql.match(
    /create or replace view\s+public\.session_round_code_risk_shadow[\s\S]*?create or replace view\s+public\.session_round_category_risk_shadow/i,
  )?.[0] ?? "";

assert.match(
  summaryView,
  /from\s+public\.session_round_line_group_code_risk_shadow lg/i,
);
assert.match(
  summaryView,
  /sum\(lg\.point_exposure_raw\)/i,
);
assert.match(
  summaryView,
  /sum\(lg\.retained_point_exposure_raw\)/i,
);
assert.match(
  summaryView,
  /lg\.order_total::numeric\s*\*\s*lg\.promotion_factor_pct/i,
);

console.log(
  "PASS C1-06 Summary roll-up preserves mixed Promotion factors",
);

// C1-07: Actual/Special Point is Round-scoped and applied after roll-up.
assert.match(
  summaryView,
  /settlement_round_actual_special_point_codes sp/i,
);
assert.match(
  summaryView,
  /sp\.round_id\s*=\s*r\.round_id/i,
);
assert.match(
  summaryView,
  /sp\.category\s*=\s*r\.category/i,
);
assert.match(
  summaryView,
  /sp\.code\s*=\s*r\.code/i,
);
assert.doesNotMatch(
  summaryView,
  /sp\.line_group_id/i,
);

console.log(
  "PASS C1-07 Actual Point remains Round × Summary Group × code",
);

// C1-08: category shadow consumes the new Round code shadow only.
const categoryView =
  sql.match(
    /create or replace view\s+public\.session_round_category_risk_shadow[\s\S]*?-- ============================================================\n-- 4\./i,
  )?.[0] ?? "";

assert.match(
  categoryView,
  /from\s+public\.session_round_code_risk_shadow c/i,
);
assert.match(
  categoryView,
  /settlement_round_actual_special_point_codes sp/i,
);
assert.match(
  categoryView,
  /ac\.round_id\s*=\s*c\.round_id/i,
);

console.log(
  "PASS C1-08 category shadow stays Round-scoped",
);

// C1-09: no legacy Point/Promotion source participates in shadow truth.
for (const legacy of [
  "settlement_point_promotions",
  "settlement_summary_group_actual_special_point_codes",
  "settlement_actual_special_point_codes",
]) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      `public\\.${legacy}(?![a-z_])`,
      "i",
    ),
  );
}

console.log(
  "PASS C1-09 shadow truth has no legacy config dependency",
);

// C1-10: security boundary is service-role only.
for (const name of [
  "session_round_line_group_code_risk_shadow",
  "session_round_code_risk_shadow",
  "session_round_category_risk_shadow",
]) {
  assert.match(
    sql,
    new RegExp(
      `revoke all[\\s\\S]*?public\\.${name}[\\s\\S]*?from public, anon, authenticated`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      `grant select[\\s\\S]*?public\\.${name}[\\s\\S]*?to service_role`,
      "i",
    ),
  );
}

console.log(
  "PASS C1-10 service-role shadow boundary",
);

// C1-11: no API, RPC mutation or parser cutover in this migration.
assert.doesNotMatch(
  sql,
  /create or replace function/i,
);
assert.doesNotMatch(
  sql,
  /alter table/i,
);
assert.doesNotMatch(
  sql,
  /insert into\s+public\.settlement_round_point_promotions/i,
);
assert.doesNotMatch(
  sql,
  /delete from\s+public\.settlement_round_point_promotions/i,
);
assert.doesNotMatch(
  sql,
  /parser_version|order-parser/i,
);

console.log(
  "PASS C1-11 no mutation/API/parser cutover",
);

assert.match(
  sql.trimStart(),
  /^-- Phase 2C1[\s\S]*\bbegin;/i,
);
assert.match(
  sql.trimEnd(),
  /commit;$/i,
);

console.log(
  "PASS: Round-scoped Point Read Model Shadow v1",
);
