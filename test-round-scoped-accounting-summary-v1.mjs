import assert from "node:assert/strict";
import fs from "node:fs";

const migration =
  fs.readFileSync(
    "supabase/migrations/20260912024500_add_round_scoped_accounting_summary.sql",
    "utf8",
  );

console.log(
  "===== DR1D-D1B1B1 Round-scoped Accounting Summary =====",
);


// B1B1-01
assert.match(
  migration,
  /public\.accounting_round_point_status\s*\(/i,
);

assert.match(
  migration,
  /public\.accounting_round_scope\(\s*p_session_id,\s*p_round_ids/is,
);

console.log(
  "PASS B1B1-01: Point readiness has explicit Round boundary",
);


// B1B1-02
assert.match(
  migration,
  /public\.accounting_effective_order_items_rounds\(\s*p_session_id,\s*p_round_ids/is,
);

console.log(
  "PASS B1B1-02: readiness active categories use Round-scoped effective truth",
);


// B1B1-03
assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes_current/is,
);

assert.match(
  migration,
  /actual\.round_id\s*=\s*round_scope\.round_id/is,
);

console.log(
  "PASS B1B1-03: readiness counts Actual Point only from exact Round",
);


// B1B1-04
assert.match(
  migration,
  /profile\.category in\s*\(\s*'A',\s*'B',\s*'E'\s*\)[\s\S]*?actual\.actual_count,[\s\S]*?0[\s\S]*?=\s*1/is,
);

assert.match(
  migration,
  /profile\.category in\s*\(\s*'G',\s*'H',\s*'L'\s*\)[\s\S]*?profile\.max_special_codes/is,
);

assert.match(
  migration,
  /profile\.category = 'F'[\s\S]*?actual\.actual_count,[\s\S]*?0[\s\S]*?<=/is,
);

console.log(
  "PASS B1B1-04: established Point readiness category rules preserved",
);


// B1B1-05
assert.match(
  migration,
  /public\.accounting_report_line_group_summary_rounds\s*\(/i,
);

assert.match(
  migration,
  /round_id uuid,[\s\S]*?business_date date,[\s\S]*?daily_round_no integer,[\s\S]*?round_status text/is,
);

console.log(
  "PASS B1B1-05: summary rows expose exact Round identity",
);


// B1B1-06
assert.match(
  migration,
  /accounting_effective_order_items_rounds\(\s*p_session_id,\s*p_round_ids/is,
);

console.log(
  "PASS B1B1-06: summary consumes Round-scoped Human Truth",
);


// B1B1-07
assert.match(
  migration,
  /settlement_summary_group_point_promotions_current/is,
);

assert.match(
  migration,
  /promotion\.round_id\s*=\s*cfg\.round_id/is,
);

assert.match(
  migration,
  /promotion\.target_scope\s*=\s*'SELECTED'[\s\S]*?coalesce\(\s*promotion\.line_group_ids,\s*'\[\]'::jsonb\s*\)\s*\?\s*cfg\.line_group_id/is,
);

console.log(
  "PASS B1B1-07: Promotion is exact-Round and LINE-Group-target aware",
);


// B1B1-08
assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes_current/is,
);

assert.match(
  migration,
  /actual_code\.round_id\s*=\s*cfg\.round_id/is,
);

console.log(
  "PASS B1B1-08: Actual Point is exact-Round scoped",
);


// B1B1-09
assert.doesNotMatch(
  migration,
  /from\s+public\.settlement_point_promotions\b/is,
);

assert.doesNotMatch(
  migration,
  /join\s+public\.settlement_point_promotions\b/is,
);

assert.doesNotMatch(
  migration,
  /settlement_summary_group_actual_special_point_codes\b(?!_current)/is,
);

assert.doesNotMatch(
  migration,
  /session_summary_group_actual_point_status/is,
);

console.log(
  "PASS B1B1-09: summary/readiness has no legacy cross-Round fallback",
);


// B1B1-10
assert.match(
  migration,
  /received_total[\s\S]*?after_reduction[\s\S]*?reduction_amount[\s\S]*?special_point_total[\s\S]*?reconciliation_total/is,
);

assert.match(
  migration,
  /reduced\.after_reduction\s*-\s*reduced\.special_point_total/is,
);

console.log(
  "PASS B1B1-10: Accounting summary arithmetic contract preserved",
);


// B1B1-11
assert.match(
  migration,
  /grant execute[\s\S]*?public\.accounting_round_point_status[\s\S]*?to service_role/is,
);

assert.match(
  migration,
  /grant execute[\s\S]*?public\.accounting_report_line_group_summary_rounds[\s\S]*?to service_role/is,
);

console.log(
  "PASS B1B1-11: internal service-role privilege boundary exists",
);



const roundSummaryMigrationTypeSafety=
  fs.readFileSync(
    new URL(
      "./supabase/migrations/20260912024500_add_round_scoped_accounting_summary.sql",
      import.meta.url,
    ),
    "utf8",
  );

assert.match(
  roundSummaryMigrationTypeSafety,
  /coalesce\(\s*promotion\.line_group_ids,\s*'\[\]'::jsonb\s*\)\s*\?\s*cfg\.line_group_id/s,
);

assert.doesNotMatch(
  roundSummaryMigrationTypeSafety,
  /promotion\.line_group_ids[\s\S]{0,120}'\{\}'::text\[\]/,
);

console.log(
  "PASS B1B1-12: SELECTED Promotion target membership is JSONB type-safe",
);


console.log(
  "PASS: DR1D-D1B1B1 Round-scoped Accounting Summary contract",
);
