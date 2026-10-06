import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(
  fileURLToPath(import.meta.url)
);

const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20261006135000_scope_dashboard_risk_snapshot_inputs.sql"
);

const source = fs.readFileSync(
  migrationPath,
  "utf8"
);

function pass(label) {
  console.log(`PASS: ${label}`);
}

function mustMatch(
  pattern,
  label
) {
  assert.match(
    source,
    pattern,
    label
  );

  pass(label);
}

function mustNotMatch(
  pattern,
  label
) {
  assert.doesNotMatch(
    source,
    pattern,
    label
  );

  pass(label);
}


mustMatch(
  /20260916222511_reuse_line_code_risk_in_dashboard_risk_band\.sql/,
  "candidate declares latest function base"
);


mustMatch(
  /create or replace function\s+public\.dashboard_risk_snapshot\s*\(/i,
  "candidate replaces Dashboard Risk Snapshot"
);


mustMatch(
  /round_ranked as \([\s\S]*?r\.status in \('OPEN','CLOSED'\)[\s\S]*?r\.settlement_session_id\s*=\s*p_settlement_session_id[\s\S]*?p_summary_group_id is null[\s\S]*?r\.summary_group_id\s*=\s*p_summary_group_id[\s\S]*?\),\s*active_rounds as \(/,
  "Round discovery is request-scoped before ranking"
);


mustMatch(
  /missing_lineage_cut_totals as \([\s\S]*?b\.settlement_session_id\s*=\s*p_settlement_session_id[\s\S]*?p_summary_group_id is null[\s\S]*?b\.summary_group_id\s*=\s*p_summary_group_id[\s\S]*?group by/,
  "missing-lineage transfer totals are request-scoped"
);


mustMatch(
  /resolved_line_cut_items as \([\s\S]*?where\s+b\.settlement_session_id\s*=\s*p_settlement_session_id[\s\S]*?p_summary_group_id is null[\s\S]*?b\.summary_group_id\s*=\s*p_summary_group_id[\s\S]*?\),\s*line_cuts as \(/,
  "resolved transfer rows are request-scoped"
);


mustMatch(
  /public\.settlement_line_group_round_config/,
  "immutable Round config lineage is preserved"
);


mustNotMatch(
  /join\s+public\.settlement_line_group_config\s+cfg\s+on\s+cfg\.settlement_session_id\s*=\s*oi\.settlement_session_id/i,
  "stale canonical live-config join is not reintroduced"
);


const riskStart = source.indexOf(
  "risk_band as materialized ("
);

const riskEnd = source.indexOf(
  "line_group_risk as materialized (",
  riskStart
);

assert.ok(
  riskStart >= 0 &&
  riskEnd > riskStart,
  "risk_band block must resolve"
);

const riskBand = source.slice(
  riskStart,
  riskEnd
);

assert.match(
  riskBand,
  /from\s+line_code_risk\s+c/i,
  "risk_band must reuse line_code_risk"
);

pass(
  "risk_band reuses materialized line_code_risk"
);

assert.doesNotMatch(
  riskBand,
  /public\.order_items/i,
  "risk_band must not directly re-read order_items"
);

pass(
  "risk_band direct order_items scan remains removed"
);


for (const key of [
  "risk_codes",
  "category_risk",
  "overall_risk",
  "risk_pools",
  "line_group_risk",
  "line_group_risk_codes",
]) {
  mustMatch(
    new RegExp(`'${key}'`),
    `output contract retains ${key}`
  );
}


mustMatch(
  /line_code_risk as materialized \(/,
  "line_code_risk remains materialized"
);

mustMatch(
  /retention as materialized \(/,
  "retention remains materialized"
);

mustMatch(
  /risk_band as materialized \(/,
  "risk_band remains materialized"
);

mustMatch(
  /line_group_risk as materialized \(/,
  "line_group_risk remains materialized"
);


mustNotMatch(
  /\bsecurity\s+definer\b/i,
  "RPC remains invoker-security semantics"
);

mustNotMatch(
  /\bcreate\s+(unique\s+)?index\b/i,
  "no index mutation"
);

mustNotMatch(
  /\balter\s+table\b/i,
  "no table mutation"
);

mustNotMatch(
  /\bdrop\s+table\b/i,
  "no table removal"
);


const definitions =
  source.match(
    /create or replace function\s+public\.dashboard_risk_snapshot\s*\(/gi
  ) ?? [];

assert.equal(
  definitions.length,
  1,
  "candidate must replace exactly one RPC"
);

pass(
  "exactly one Dashboard Risk Snapshot replacement"
);

console.log(
  "PASS: rebased Dashboard Risk Snapshot scope contract"
);
