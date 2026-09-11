import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(
  fileURLToPath(import.meta.url)
);

const migrationPath = path.join(
  here,
  "supabase",
  "migrations",
  "20260911054000_add_dashboard_risk_snapshot_rpc.sql"
);

const sql = fs.readFileSync(
  migrationPath,
  "utf8"
);

function mustContain(pattern, label) {
  assert.match(
    sql,
    pattern,
    `missing contract: ${label}`
  );

  console.log(`PASS: ${label}`);
}

mustContain(
  /create\s+or\s+replace\s+function\s+public\.dashboard_risk_snapshot\s*\(/i,
  "RPC exists"
);

mustContain(
  /returns\s+jsonb/i,
  "RPC returns JSONB"
);

mustContain(
  /language\s+sql/i,
  "RPC is SQL"
);

mustContain(
  /stable/i,
  "RPC is STABLE"
);

mustContain(
  /security\s+invoker/i,
  "RPC uses invoker security"
);

mustContain(
  /canonical_line_code\s+as\s+materialized/i,
  "canonical Round base is materialized"
);

for (const cte of [
  "line_code_risk",
  "code_risk",
  "category_risk",
  "risk_pool",
  "overall_risk",
  "retention",
  "risk_band",
  "line_group_risk",
]) {
  mustContain(
    new RegExp(
      `${cte}\\s+as\\s+materialized`,
      "i"
    ),
    `${cte} is materialized`
  );
}

for (const key of [
  "risk_codes",
  "category_risk",
  "overall_risk",
  "risk_pools",
  "line_group_risk",
  "line_group_risk_codes",
]) {
  mustContain(
    new RegExp(
      `'${key}'\\s*,`,
      "i"
    ),
    `JSON key ${key}`
  );
}

for (const forbiddenView of [
  "session_code_risk_state",
  "session_category_risk_state",
  "session_risk_pool_state",
  "session_overall_risk_state",
  "session_line_group_code_retention_state",
  "session_line_group_risk_state",
]) {
  const directRead = new RegExp(
    String.raw`\bfrom\s+(?:public\.)?${forbiddenView}\b`,
    "i"
  );

  assert.equal(
    directRead.test(sql),
    false,
    `RPC must not directly reopen ${forbiddenView}`
  );

  console.log(
    `PASS: no direct read of ${forbiddenView}`
  );
}

assert.equal(
  /create\s+(?:or\s+replace\s+)?view\s+public\./i.test(sql),
  false,
  "migration must not replace authoritative views"
);

console.log(
  "PASS: no authoritative VIEW mutation"
);

mustContain(
  /revoke\s+all[\s\S]*dashboard_risk_snapshot\(uuid,text\)[\s\S]*from\s+public,\s*anon,\s*authenticated/i,
  "RPC is revoked from public/anon/authenticated"
);

mustContain(
  /grant\s+execute[\s\S]*dashboard_risk_snapshot\(uuid,text\)[\s\S]*to\s+service_role/i,
  "RPC execute granted to service_role"
);

const materializedCount = (
  sql.match(
    /\bas\s+materialized\s*\(/gi
  ) ?? []
).length;

assert.ok(
  materializedCount >= 9,
  `expected >=9 MATERIALIZED CTEs, got ${materializedCount}`
);

console.log(
  `PASS: MATERIALIZED_CTE_COUNT=${materializedCount}`
);

console.log(
  "PASS: Dashboard Risk Snapshot static contract"
);
