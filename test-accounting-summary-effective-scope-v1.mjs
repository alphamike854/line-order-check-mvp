import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20261002003000_scope_accounting_summary_effective_items.sql",
    "utf8",
  );

console.log(
  "===== Accounting Summary Effective Scope v1 =====",
);

assert.match(
  migration,
  /public\.accounting_report_line_group_summary_rounds\s*\(/i,
);

console.log(
  "PASS ASE-01: round-scoped summary function retained",
);

assert.match(
  migration,
  /accounting_effective_order_items_rounds\s*\([\s\S]*?p_session_id[\s\S]*?p_round_ids[\s\S]*?array\s*\([\s\S]*?select distinct[\s\S]*?scoped\.line_group_id[\s\S]*?from configured_groups scoped[\s\S]*?\)::text\[\]/i,
);

console.log(
  "PASS ASE-02: effective items receive configured LINE Group scope",
);

const functionStart =
  migration.search(
    /CREATE OR REPLACE FUNCTION\s+public\.accounting_report_line_group_summary_rounds\s*\(/i,
  );

assert.ok(
  functionStart >= 0,
  "summary function body must exist",
);

const functionSql =
  migration.slice(functionStart);

assert.doesNotMatch(
  functionSql,
  /accounting_effective_order_items_rounds\s*\([\s\S]*?p_session_id[\s\S]*?p_round_ids[\s\S]*?null::text\[\]/i,
);

console.log(
  "PASS ASE-03: broad null LINE Group scope removed",
);

assert.match(
  functionSql,
  /p_summary_group_id is null[\s\S]*?round_scope\.summary_group_id\s*=\s*p_summary_group_id/i,
);

assert.match(
  functionSql,
  /settlement_line_group_round_config\s+cfg[\s\S]*?cfg\.round_id\s*=\s*round_scope\.round_id/i,
);

console.log(
  "PASS ASE-04: Summary Group filter retains Round-lineage semantics",
);

assert.match(
  migration,
  /settlement_summary_group_point_promotions_current/i,
);

assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes_current/i,
);

console.log(
  "PASS ASE-05: Point + Promotion semantics retained",
);

assert.doesNotMatch(
  migration,
  /\b(insert|update|delete|truncate)\b/i,
);

console.log(
  "PASS ASE-06: no operational data mutation",
);

console.log(
  "PASS: Accounting Summary Effective Scope v1",
);
