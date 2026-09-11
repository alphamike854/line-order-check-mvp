import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260911003000_optimize_line_group_retention_state.sql";

const sql = fs.readFileSync(
  migrationPath,
  "utf8"
);

assert.match(
  sql,
  /create or replace view public\.session_line_group_code_retention_state as/i
);

assert.match(
  sql,
  /from public\.session_line_group_code_risk_state c/i
);

assert.match(
  sql,
  /join public\.settlement_line_group_config cfg/i
);

assert.match(
  sql,
  /sum\(c\.order_total\) over[\s\S]*partition by[\s\S]*c\.settlement_session_id,[\s\S]*c\.line_group_id/i
);

assert.match(
  sql,
  /floor\([\s\S]*gross_received[\s\S]*100000[\s\S]*\* 100000/i
);

assert.match(
  sql,
  /round\([\s\S]*100::numeric - b\.reduction_pct[\s\S]*3[\s\S]*\)::numeric\(7,3\)/i
);

assert.match(
  sql,
  /b\.calculation_band::numeric[\s\S]*100::numeric - b\.reduction_pct[\s\S]*100\.0/i
);

assert.match(
  sql,
  /when b\.calculation_band = 0[\s\S]*WAITING_FIRST_BAND[\s\S]*else 'READY'/i
);

assert.match(
  sql,
  /when b\.category in \('A','B'\)[\s\S]*then 2[\s\S]*else b\.max_special_codes/i
);

assert.match(
  sql,
  /from public\.settlement_transfer_batches tb[\s\S]*join public\.settlement_transfer_batch_items i/i
);

assert.match(
  sql,
  /tb\.risk_model[\s\S]*CATEGORY_RETENTION/i
);

assert.match(
  sql,
  /confirmed_cut_exceeds_order_total/i
);

assert.match(
  sql,
  /DATA_INTEGRITY_ERROR/i
);

assert.match(
  sql,
  /CUT_REQUIRED/i
);

assert.match(
  sql,
  /projected_point_exposure/i
);

assert.match(
  sql,
  /recommended_point_reduction/i
);

assert.match(
  sql,
  /l\.special_multiplier::numeric\(12,3\)/i
);

assert.match(
  sql,
  /l\.promotion_factor_pct::numeric\(7,3\)/i
);

assert.match(
  sql,
  /l\.effective_multiplier::numeric\(12,3\)/i
);

assert.match(
  sql,
  /l\.risk_budget_pct::numeric\(7,3\)/i
);

assert.match(
  sql,
  /l\.risk_budget::numeric\(18,2\)/i
);

assert.match(
  sql,
  /l\.last_confirmed_at::timestamptz/i
);

assert.match(
  sql,
  /revoke all[\s\S]*session_line_group_code_retention_state[\s\S]*from public, anon, authenticated/i
);

assert.match(
  sql,
  /grant select[\s\S]*session_line_group_code_retention_state[\s\S]*to service_role/i
);

assert.doesNotMatch(
  sql,
  /create or replace view public\.session_line_group_risk_band_state/i
);

assert.doesNotMatch(
  sql,
  /create or replace view public\.session_line_group_code_risk_state/i
);

assert.doesNotMatch(
  sql,
  /create or replace view public\.session_line_group_risk_state/i
);

assert.doesNotMatch(
  sql,
  /create or replace view public\.session_line_group_category_retention_state/i
);

const viewBody =
  sql.match(
    /create or replace view public\.session_line_group_code_retention_state as([\s\S]*?);\s*\n\s*revoke all/i
  )?.[1] ?? "";

assert.ok(
  viewBody.length > 0,
  "retention view body not found"
);

assert.doesNotMatch(
  viewBody,
  /session_line_group_risk_band_state/i
);

assert.doesNotMatch(
  viewBody,
  /from public\.order_items/i
);

console.log(
  "PASS: LINE-group retention performance rewrite contract"
);
