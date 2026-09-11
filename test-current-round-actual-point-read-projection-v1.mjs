import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/" +
    "20260910102000_add_current_round_actual_point_read_projection.sql",
  "utf8",
);

const privilegeHardening = fs.readFileSync(
  "supabase/migrations/" +
    "20260910113000_harden_current_round_actual_point_view_privileges.sql",
  "utf8",
);

const special = fs.readFileSync(
  "netlify/functions/special-points.mjs",
  "utf8",
);

const dashboard = fs.readFileSync(
  "netlify/functions/dashboard.mjs",
  "utf8",
);

const freshness = fs.readFileSync(
  "netlify/functions/dashboard-freshness.mjs",
  "utf8",
);

const accounting = fs.readFileSync(
  "netlify/functions/accounting-report.mjs",
  "utf8",
);

console.log(
  "===== Current Round Actual Point Read Projection v1 =====",
);

assert.match(
  migration,
  /create or replace view\s+public\.settlement_summary_group_actual_special_point_codes_current/i,
);

assert.match(
  migration,
  /settlement_round_actual_special_point_codes/i,
);

console.log(
  "PASS C2C1-01 current Actual Point projection reads Round truth",
);

assert.match(
  migration,
  /row_number\(\)\s+over\s*\([\s\S]*partition by[\s\S]*settlement_session_id[\s\S]*summary_group_id[\s\S]*order by\s+r\.round_no desc/is,
);

assert.match(
  migration,
  /latest_rank\s*=\s*1/i,
);

assert.match(
  migration,
  /settlement_summary_group_round_snapshots/i,
);

console.log(
  "PASS C2C1-02 latest non-archived Round is authoritative",
);

assert.match(
  migration,
  /r\.status in\s*\('OPEN',\s*'CLOSED'\)/i,
);

console.log(
  "PASS C2C1-03 OPEN and CLOSED current Rounds remain readable",
);

assert.match(
  migration,
  /create or replace view\s+public\.session_summary_group_actual_point_status_current/i,
);

assert.match(
  migration,
  /oi\.summary_group_round_id\s*=\s*r\.id/i,
);

assert.match(
  migration,
  /a\.round_id\s*=\s*r\.id/i,
);

console.log(
  "PASS C2C1-04 readiness is Round-owned",
);

assert.match(
  migration,
  /category in\s*\('A',\s*'B',\s*'E'\)[\s\S]*selected_count\s*=\s*1/is,
);

assert.match(
  migration,
  /category in\s*\('G',\s*'H',\s*'L'\)[\s\S]*selected_count\s*=\s*max_special_codes/is,
);

assert.match(
  migration,
  /category\s*=\s*'F'[\s\S]*between\s+0\s+and\s+max_special_codes/is,
);

assert.match(
  migration,
  /when not has_orders then true/i,
);

console.log(
  "PASS C2C1-05 readiness category rules preserved",
);

assert.doesNotMatch(
  migration,
  /\bsettlement_summary_group_actual_special_point_codes\b(?!_current)/,
);

assert.doesNotMatch(
  migration,
  /\bsettlement_actual_special_point_codes\b/,
);

console.log(
  "PASS C2C1-06 Round projections have no legacy Actual Point dependency",
);

assert.match(
  migration,
  /security_invoker\s*=\s*true/i,
);

assert.match(
  migration,
  /from public,\s*anon,\s*authenticated/i,
);

assert.match(
  migration,
  /to service_role/i,
);

console.log(
  "PASS C2C1-07 service-role read boundary preserved",
);

assert.match(
  special,
  /async function resolvePointRoundRead\(/,
);

assert.match(
  special,
  /\.from\("settlement_summary_group_rounds"\)/,
);

assert.match(
  special,
  /\.in\("status",\s*\["OPEN",\s*"CLOSED"\]\)/,
);

assert.match(
  special,
  /\.order\("round_no",\s*\{\s*ascending:\s*false\s*\}\)/,
);

console.log(
  "PASS C2C1-08 Special Point resolves Round lifecycle explicitly",
);

assert.equal(
  (
    special.match(
      /mode:\s*"LEGACY_NO_ROUND"/g,
    ) ?? []
  ).length,
  1,
);

assert.match(
  special,
  /if\s*\(!data\)\s*\{[\s\S]*?mode:\s*"LEGACY_NO_ROUND"/s,
);

assert.match(
  special,
  /const useRoundRead\s*=\s*roundRead\.mode\s*===\s*"ROUND"/,
);

console.log(
  "PASS C2C1-09 legacy mode is selected only when no Round exists",
);

assert.equal(
  (
    special.match(
      /"settlement_summary_group_actual_special_point_codes_current"/g,
    ) ?? []
  ).length,
  1,
);

assert.equal(
  (
    special.match(
      /"settlement_summary_group_actual_special_point_codes"/g,
    ) ?? []
  ).length,
  1,
);

assert.equal(
  (
    special.match(
      /"session_summary_group_actual_point_status_current"/g,
    ) ?? []
  ).length,
  1,
);

assert.equal(
  (
    special.match(
      /"session_summary_group_actual_point_status"/g,
    ) ?? []
  ).length,
  1,
);

assert.match(
  special,
  /\.from\(codeSource\)/,
);

assert.match(
  special,
  /\.from\(statusSource\)/,
);

console.log(
  "PASS C2C1-10 Round and no-Round sources are explicit and isolated",
);

assert.match(
  special,
  /\.from\("settlement_summary_group_round_snapshots"\)/,
);

assert.match(
  special,
  /CURRENT_ROUND_ARCHIVED/,
);

console.log(
  "PASS C2C1-11 archived latest Round fails closed",
);

assert.match(
  special,
  /ROUND_READ_PROJECTION_MISMATCH/,
);

assert.match(
  special,
  /ROUND_CODE_PROJECTION_MISMATCH/,
);

assert.match(
  special,
  /row\.round_id\s*!==\s*expectedRoundId/,
);

console.log(
  "PASS C2C1-12 projection identity mismatch fails closed",
);

assert.match(
  special,
  /round_id:\s*roundRead\.round\?\.id\s*\?\?\s*null/,
);

assert.match(
  special,
  /round_no:\s*roundRead\.round\?\.round_no\s*\?\?\s*null/,
);

assert.match(
  special,
  /round_status:\s*roundRead\.round\?\.status\s*\?\?\s*null/,
);

console.log(
  "PASS C2C1-13 API returns Round identity or null in no-Round mode",
);

assert.match(
  special,
  /replace_settlement_summary_group_actual_special_codes/,
);

assert.doesNotMatch(
  special,
  /\.rpc\(\s*"replace_settlement_round_actual_special_codes"/s,
);

console.log(
  "PASS C2C1-14 POST remains on audited compatibility bridge",
);

assert.match(
  dashboard,
  /loadDashboardPointContext/,
);

assert.match(
  freshness,
  /loadDashboardPointContext/,
);

assert.match(
  accounting,
  /\.from\("settlement_summary_group_actual_special_point_codes"\)/,
);

assert.doesNotMatch(
  migration,
  /create or replace view\s+public\.session_code_risk_state/i,
);

assert.doesNotMatch(
  migration,
  /create or replace view\s+public\.session_category_risk_state/i,
);

assert.doesNotMatch(
  migration,
  /create or replace view\s+public\.session_risk_pool_state/i,
);

assert.doesNotMatch(
  migration,
  /create or replace view\s+public\.session_overall_risk_state/i,
);

assert.doesNotMatch(
  migration,
  /create or replace function/i,
);

console.log(
  "PASS C2C1-15 Dashboard metadata delegates to P3A2 while Risk/mutation boundaries remain unchanged",
);

assert.match(
  privilegeHardening,
  /revoke all on table[\s\S]*settlement_summary_group_actual_special_point_codes_current[\s\S]*from public,\s*anon,\s*authenticated,\s*service_role/is,
);

assert.match(
  privilegeHardening,
  /grant select on table[\s\S]*settlement_summary_group_actual_special_point_codes_current[\s\S]*to service_role/is,
);

assert.match(
  privilegeHardening,
  /revoke all on table[\s\S]*session_summary_group_actual_point_status_current[\s\S]*from public,\s*anon,\s*authenticated,\s*service_role/is,
);

assert.match(
  privilegeHardening,
  /grant select on table[\s\S]*session_summary_group_actual_point_status_current[\s\S]*to service_role/is,
);

assert.doesNotMatch(
  privilegeHardening,
  /insert into|update\s+public\.|delete from|create or replace view|create or replace function/i,
);

console.log(
  "PASS C2C1-16 effective view privileges are SELECT-only for service_role",
);

console.log(
  "PASS: Current Round Actual Point Read Projection v1",
);
