import fs from "node:fs";
import assert from "node:assert/strict";

const path =
  "supabase/migrations/" +
  "20260909143000_harden_round_scoped_point_shadow_historical_cut_lineage.sql";

const sql = fs.readFileSync(path, "utf8");

const has = (re, msg) => assert.match(sql, re, msg);
const lacks = (re, msg) => assert.doesNotMatch(sql, re, msg);

const views = [
  ...sql.matchAll(
    /create or replace view\s+public\.([a-z0-9_]+)/gi
  ),
].map((m) => m[1]);

assert.deepEqual(
  views,
  [
    "session_round_line_group_code_risk_shadow",
    "session_round_code_risk_shadow",
  ],
  "C1L-01: only ranking-bearing shadow views may be replaced"
);
console.log("PASS C1L-01 shadow-only view replacement");

has(
  /when\s+i\.line_group_id\s+is\s+not\s+null\s+then\s+i\.line_group_id/is,
  "C1L-02: explicit item lineage must win"
);
console.log("PASS C1L-02 item lineage authoritative");

has(
  /when\s+b\.line_group_id\s+is\s+not\s+null\s+then\s+b\.line_group_id/is,
  "C1L-03: batch fallback required"
);
console.log("PASS C1L-03 batch lineage fallback");

has(
  /source_line_group_count\s*=\s*1/is,
  "C1L-04: unique-source guard required"
);

has(
  /missing_cut_quantity[\s\S]*<=\s*sgr\.source_order_total/is,
  "C1L-04: missing cut must not exceed source quantity"
);

has(
  /then\s+sgr\.unique_line_group_id/is,
  "C1L-04: unique source must resolve lineage"
);
console.log("PASS C1L-04 deterministic unique-source recovery");

has(
  /else\s+null[\s\S]*resolved_line_group_id/is,
  "C1L-05: ambiguous lineage must stay unresolved"
);

has(
  /resolved_line_group_id\s+is\s+not\s+null/is,
  "C1L-05: unresolved cuts must be excluded"
);
console.log("PASS C1L-05 ambiguous/no-source fails closed");

has(
  /lc\.line_group_id\s*=\s*cb\.line_group_id/i,
  "C1L-06: resolved cut must join code base by LINE Group"
);
console.log("PASS C1L-06 cut remains LINE Group scoped");

has(
  /rp\.target_scope\s*=\s*'SELECTED'/i,
  "C1L-07: SELECTED promotion semantics missing"
);

has(
  /plg\.line_group_id\s*=\s*cb\.line_group_id/i,
  "C1L-07: SELECTED target must resolve at LINE Group"
);
console.log("PASS C1L-07 SELECTED Promotion preserved");

has(
  /round\(\s*c\.point_exposure_raw,\s*2\s*\)/is,
  "C1L-08: LINE Group ranking precision regressed"
);

has(
  /round\(\s*e\.retained_point_exposure_raw,\s*2\s*\)/is,
  "C1L-08: Summary Group ranking precision regressed"
);
console.log("PASS C1L-08 ranking hardening preserved");

lacks(
  /create or replace view\s+public\.session_category_risk_state/i,
  "production category view must not be replaced"
);

lacks(
  /create or replace view\s+public\.session_code_risk_state/i,
  "production code view must not be replaced"
);

lacks(
  /create or replace view\s+public\.session_round_category_risk_shadow/i,
  "round category shadow should not need replacement"
);

lacks(
  /\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+public\./i,
  "migration must not mutate business rows"
);

console.log("PASS C1L-09 no production/business-data mutation");
console.log(
  "PASS: Phase 2C1 historical cut lineage hardening contract"
);
