import fs from "node:fs";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  "supabase/migrations/" +
  "20260901030000_scope_actual_points_by_summary_group.sql",
  "utf8",
);

console.log(
  "===== Summary Group Actual Point Foundation v9.20 =====",
);


// A1-01
assert.match(
  migration,
  /create table if not exists\s+public\.settlement_summary_group_actual_special_point_codes/i,
);

assert.match(
  migration,
  /primary key\s*\(\s*settlement_session_id,\s*summary_group_id,\s*category,\s*code\s*\)/is,
);

console.log(
  "PASS A1-01 Summary Group Actual Point identity",
);


// A1-02
assert.match(
  migration,
  /insert into\s+public\.settlement_summary_group_actual_special_point_codes[\s\S]*settlement_actual_special_point_codes[\s\S]*settlement_line_group_config/is,
);

console.log(
  "PASS A1-02 legacy Actual Point compatibility backfill",
);


// A1-03
assert.match(
  migration,
  /sync_legacy_actual_point_to_summary_groups/,
);

assert.match(
  migration,
  /after insert or delete[\s\S]*settlement_actual_special_point_codes/is,
);

console.log(
  "PASS A1-03 legacy Point writes mirror to parallel source",
);


// A1-04
assert.match(
  migration,
  /replace_settlement_summary_group_actual_special_codes/,
);

assert.match(
  migration,
  /status not in \('OPEN','CLOSED'\)/,
);

assert.match(
  migration,
  /summary_group_id\s*=\s*v_summary/,
);

console.log(
  "PASS A1-04 group-scoped Point remains editable after CLOSE",
);


// A1-05
assert.match(
  migration,
  /session_summary_group_actual_point_status/,
);

assert.match(
  migration,
  /group by\s+settlement_session_id,\s*summary_group_id/is,
);

console.log(
  "PASS A1-05 Point readiness isolated by Summary Group",
);


// A1-06
assert.doesNotMatch(
  migration,
  /alter table\s+public\.settlement_actual_special_point_codes\s+add column/is,
);

assert.doesNotMatch(
  migration,
  /drop constraint if exists\s+settlement_actual_special_point_codes_pkey/is,
);

console.log(
  "PASS A1-06 legacy Actual Point schema remains unchanged",
);


// A1-07
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

console.log(
  "PASS A1-07 active Risk views are not cut over in foundation phase",
);


// A1-08
assert.match(
  migration,
  /enable row level security/i,
);

assert.match(
  migration,
  /to service_role/i,
);

console.log(
  "PASS A1-08 new source follows service-role security boundary",
);


console.log(
  "PASS: Summary Group Actual Point Foundation v9.20",
);
