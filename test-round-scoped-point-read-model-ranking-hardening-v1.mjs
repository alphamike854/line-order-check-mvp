import assert from "node:assert/strict";
import fs from "node:fs";

const basePath =
  "supabase/migrations/" +
  "20260909140000_add_round_scoped_point_read_model_shadow.sql";

const hardeningPath =
  "supabase/migrations/" +
  "20260909141500_harden_round_scoped_point_shadow_ranking.sql";

const base = fs.readFileSync(basePath, "utf8");
const sql = fs.readFileSync(hardeningPath, "utf8");

console.log(
  "===== Round-scoped Point Shadow Ranking Hardening v1 =====",
);

// C1H-01: the already-applied migration remains immutable.
assert.match(
  base,
  /coalesce\(\s*c\.point_exposure_raw,\s*0\s*\)\s*desc/i,
);
assert.match(
  base,
  /coalesce\(\s*e\.retained_point_exposure_raw,\s*0\s*\)\s*desc/i,
);
console.log(
  "PASS C1H-01 applied Phase 2C1 migration remains unchanged",
);

// C1H-02: only the two ranking-bearing shadow views are replaced.
for (const name of [
  "session_round_line_group_code_risk_shadow",
  "session_round_code_risk_shadow",
]) {
  assert.match(
    sql,
    new RegExp(
      `create or replace view\\s+public\\.${name}`,
      "i",
    ),
  );
}

assert.doesNotMatch(
  sql,
  /create or replace view\s+public\.session_round_category_risk_shadow/i,
);

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
  "PASS C1H-02 hardening remains shadow-only",
);

// C1H-03: LINE Group reserve ranking uses displayed production precision.
assert.match(
  sql,
  /order by\s+coalesce\(\s*round\(\s*c\.point_exposure_raw,\s*2\s*\),\s*0\s*\)\s*desc,\s*c\.order_total desc,\s*c\.code asc/is,
);

console.log(
  "PASS C1H-03 LINE Group ranking uses rounded 2-decimal exposure",
);

// C1H-04: Summary Group reserve ranking uses displayed production precision.
assert.match(
  sql,
  /order by\s+coalesce\(\s*round\(\s*e\.retained_point_exposure_raw,\s*2\s*\),\s*0\s*\)\s*desc,\s*e\.retained_quantity desc,\s*e\.code asc/is,
);

console.log(
  "PASS C1H-04 Summary Group ranking uses rounded retained exposure",
);

// C1H-05: raw values remain available for exact mixed-factor roll-up.
assert.match(sql, /as point_exposure_raw/i);
assert.match(sql, /as retained_point_exposure_raw/i);
assert.match(sql, /sum\(lg\.point_exposure_raw\)/i);
assert.match(sql, /sum\(lg\.retained_point_exposure_raw\)/i);

console.log(
  "PASS C1H-05 raw arithmetic remains exact; only ranking precision changes",
);

// C1H-06: no operational or mutation boundary is changed.
assert.doesNotMatch(sql, /create or replace function/i);
assert.doesNotMatch(sql, /alter table/i);
assert.doesNotMatch(sql, /insert into/i);
assert.doesNotMatch(sql, /delete from/i);
assert.doesNotMatch(sql, /update\s+public\./i);
assert.doesNotMatch(sql, /parser_version|order-parser/i);

console.log(
  "PASS C1H-06 no mutation/API/parser cutover",
);

assert.match(
  sql.trimStart(),
  /^-- Phase 2C1 hardening[\s\S]*\bbegin;/i,
);
assert.match(
  sql.trimEnd(),
  /commit;$/i,
);

console.log(
  "PASS: Round-scoped Point Shadow Ranking Hardening v1",
);
