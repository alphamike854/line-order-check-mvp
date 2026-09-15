import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL(
    "./supabase/migrations/"
      + "20260915050000_"
      + "cut_historical_read_attribution_to_round_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);

const accounting = fs.readFileSync(
  new URL(
    "./netlify/functions/accounting-report.mjs",
    import.meta.url,
  ),
  "utf8",
);

const special = fs.readFileSync(
  new URL(
    "./netlify/functions/special-points.mjs",
    import.meta.url,
  ),
  "utf8",
);

const webhook = fs.readFileSync(
  new URL(
    "./netlify/functions/line-webhook.mjs",
    import.meta.url,
  ),
  "utf8",
);

const settlement = fs.readFileSync(
  new URL(
    "./netlify/functions/settlement.mjs",
    import.meta.url,
  ),
  "utf8",
);

console.log(
  "===== V14B2C1 Historical Round Attribution =====",
);

assert.match(
  migration,
  /create or replace view\s+public\.settlement_line_group_round_config_working_context/i,
);

assert.match(
  migration,
  /settlement_line_group_round_config\s+cfg[\s\S]*?settlement_summary_group_rounds\s+r[\s\S]*?r\.id\s*=\s*cfg\.round_id/i,
);

console.log(
  "PASS C1-01: Accounting context derives from Round lineage",
);

assert.match(
  migration,
  /accounting_report_line_group_summary_rounds\s*\(/i,
);

assert.match(
  migration,
  /selected_rounds\s+round_scope[\s\S]*?settlement_line_group_round_config\s+cfg[\s\S]*?cfg\.round_id\s*=\s*round_scope\.round_id/i,
);

console.log(
  "PASS C1-02: Round Accounting config uses immutable lineage",
);

assert.match(
  migration,
  /source_message\.id\s*=\s*item\.message_record_id[\s\S]*?source_message\.summary_group_round_id\s*=\s*cfg\.round_id/i,
);

console.log(
  "PASS C1-03: effective items bind to exact message Round",
);

assert.match(
  migration,
  /create or replace view\s+public\.session_round_line_group_code_risk_shadow/i,
);

assert.match(
  migration,
  /settlement_line_group_round_config\s+cfg[\s\S]*?cfg\.round_id\s*=\s*ar\.round_id[\s\S]*?cfg\.line_group_id\s*=\s*oi\.line_group_id/i,
);

console.log(
  "PASS C1-04: Round risk shadow uses lineage",
);

const currentRouteCount =
  (
    migration.match(
      /\bsettlement_line_group_config\b/g,
    )
    ?? []
  ).length;

assert.equal(
  currentRouteCount,
  3,
);

console.log(
  "PASS C1-05: Dashboard retains exactly three operational current-route dependencies",
);

assert.match(
  migration,
  /canonical_line_code as materialized[\s\S]*?settlement_line_group_round_config\s+cfg/i,
);

assert.match(
  migration,
  /risk_pool as materialized[\s\S]*?settlement_line_group_config/i,
);

assert.match(
  migration,
  /retention as materialized[\s\S]*?settlement_line_group_config/i,
);

assert.match(
  migration,
  /risk_band as materialized[\s\S]*?settlement_line_group_config/i,
);

console.log(
  "PASS C1-06: Dashboard cuts only Round-owned attribution",
);

for (const forbidden of [
  /update\s+public\.messages/i,
  /update\s+public\.order_items/i,
  /save_line_group_live/i,
  /confirm_line_group_distribution_run/i,
  /set_settlement_summary_group_accepting/i,
]) {
  assert.doesNotMatch(
    migration,
    forbidden,
  );
}

console.log(
  "PASS C1-07: operational mutation authority untouched",
);

assert.match(
  accounting,
  /"settlement_line_group_round_config_working_context"/,
);

assert.match(
  accounting,
  /configSource\s*=\s*"ROUND_LINEAGE"/,
);

assert.match(
  accounting,
  /"LEGACY_CURRENT_ROUTE"/,
);

assert.match(
  accounting,
  /roundIds\.includes\(\s*row\.round_id\s*,?\s*\)/,
);

assert.match(
  accounting,
  /"accounting_round_point_context"/,
);

assert.match(
  accounting,
  /pointContext\.promotions/,
);

assert.match(
  accounting,
  /pointContext\.actual_special_point_codes/,
);

console.log(
  "PASS C1-08: Accounting lineage cutover preserves Round Point/Promotion context",
);

assert.match(
  special,
  /useRoundRead[\s\S]*?"settlement_line_group_round_config"[\s\S]*?roundRead\.round\.id/,
);

console.log(
  "PASS C1-09: Special Point Round read uses exact Round lineage",
);

assert.match(
  webhook,
  /"settlement_line_group_config"/,
);

assert.doesNotMatch(
  webhook,
  /"settlement_line_group_round_config"/,
);

console.log(
  "PASS C1-10: admission remains current-route owned",
);

assert.match(
  settlement,
  /"settlement_line_group_config"/,
);

assert.doesNotMatch(
  settlement,
  /"settlement_line_group_round_config"/,
);

console.log(
  "PASS C1-11: lifecycle/current registry remains current-route owned",
);

assert.doesNotMatch(
  migration,
  /create or replace function\s+public\.accounting_report_line_group_summary\s*\(\s*p_session_id\s+uuid\s*,\s*p_summary_group_id/i,
);

console.log(
  "PASS C1-12: legacy Accounting compatibility RPC untouched",
);

const functionDollarQuoteCount =
  (
    migration.match(
      /\$function\$/g,
    )
    ?? []
  ).length;

const terminatedFunctionCount =
  (
    migration.match(
      /\$function\$;/g,
    )
    ?? []
  ).length;

assert.equal(
  functionDollarQuoteCount,
  4,
);

assert.equal(
  terminatedFunctionCount,
  2,
);

assert.doesNotMatch(
  migration,
  /\$function\$\s*CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
);

assert.match(
  migration,
  /\$function\$;\s*$/,
);

console.log(
  "PASS C1-13: generated SQL terminates both function definitions",
);


console.log(
  "PASS: V14B2C1 Historical Round Attribution",
);
