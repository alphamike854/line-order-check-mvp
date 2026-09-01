import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  "supabase/migrations/" +
  "20260901031000_cutover_actual_point_risk_by_summary_group.sql",
  "utf8",
);

console.log(
  "===== Summary Group Actual Point Risk Cutover v9.20 =====",
);


// ---------------------------------------------------------
// A2B-01 Code Risk
// ---------------------------------------------------------

assert.match(
  migration,
  /create or replace view public\.session_code_risk_state as/i,
);

assert.match(
  migration,
  /settlement_summary_group_actual_special_point_codes sp/,
);

assert.match(
  migration,
  /sp\.summary_group_id\s*=\s*cb\.summary_group_id/,
);

console.log(
  "PASS A2B-01 Code Risk Actual Point is Summary-Group scoped",
);


// ---------------------------------------------------------
// A2B-02 Category Risk
// ---------------------------------------------------------

assert.match(
  migration,
  /create or replace view public\.session_category_risk_state as/i,
);

assert.match(
  migration,
  /select\s+settlement_session_id,\s*summary_group_id,\s*category,\s*count\(\*\)::integer as actual_selected_count/is,
);

assert.match(
  migration,
  /group by\s+settlement_session_id,\s*summary_group_id,\s*category/is,
);

assert.match(
  migration,
  /ac\.summary_group_id\s*=\s*c\.summary_group_id/,
);

console.log(
  "PASS A2B-02 Category selected counts cannot leak across Summary Groups",
);


// ---------------------------------------------------------
// A2B-03 Risk Pool readiness
// ---------------------------------------------------------

assert.match(
  migration,
  /create or replace view public\.session_risk_pool_state as/i,
);

assert.match(
  migration,
  /session_summary_group_actual_point_status st/,
);

assert.match(
  migration,
  /st\.summary_group_id\s*=\s*g\.summary_group_id/,
);

console.log(
  "PASS A2B-03 Risk Pool readiness is Summary-Group scoped",
);


// ---------------------------------------------------------
// A2B-04 No active legacy Actual Point source
// ---------------------------------------------------------

assert.doesNotMatch(
  migration,
  /public\.settlement_actual_special_point_codes/,
);

assert.doesNotMatch(
  migration,
  /public\.session_actual_point_status/,
);

console.log(
  "PASS A2B-04 active Risk cutover has no legacy Actual Point dependency",
);


// ---------------------------------------------------------
// A2B-05 Preserve operational mutation boundary
// ---------------------------------------------------------

assert.doesNotMatch(
  migration,
  /create or replace function public\.confirm_/i,
);

assert.doesNotMatch(
  migration,
  /insert into public\.settlement_transfer_batches/i,
);

assert.doesNotMatch(
  migration,
  /delete from public\.settlement_transfer_batches/i,
);

assert.doesNotMatch(
  migration,
  /update public\.settlement_transfer_batches/i,
);

console.log(
  "PASS A2B-05 Cut/Transfer mutation logic remains untouched",
);


// ---------------------------------------------------------
// A2B-06 LINE Group operational ranking unchanged
// ---------------------------------------------------------

assert.doesNotMatch(
  migration,
  /create or replace view public\.session_line_group_code_risk_state/i,
);

console.log(
  "PASS A2B-06 LINE Group reserve ranking remains unchanged",
);


// ---------------------------------------------------------
// A2B-07 Overall Risk inherits Risk Pool
// ---------------------------------------------------------

assert.doesNotMatch(
  migration,
  /create or replace view public\.session_overall_risk_state/i,
);

console.log(
  "PASS A2B-07 Overall Risk contract is not unnecessarily redefined",
);


// ---------------------------------------------------------
// A2B-08 No schema mutation
// ---------------------------------------------------------

assert.doesNotMatch(
  migration,
  /alter table/i,
);

assert.doesNotMatch(
  migration,
  /drop table/i,
);

assert.doesNotMatch(
  migration,
  /create table/i,
);

console.log(
  "PASS A2B-08 Risk cutover is read-model only",
);


console.log(
  "PASS: Summary Group Actual Point Risk Cutover v9.20",
);
