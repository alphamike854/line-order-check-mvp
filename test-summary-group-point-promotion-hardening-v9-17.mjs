import fs from "node:fs";
import assert from "node:assert/strict";

const sql = fs.readFileSync(
  "supabase/migrations/" +
  "20260831205000_harden_point_promotion_concurrency.sql",
  "utf8",
);

console.log(
  "===== Point Promotion Concurrency Hardening v9.17 =====",
);

function extract(name) {
  const pattern = new RegExp(
    String.raw`create\s+or\s+replace\s+function\s+public\.${name}\s*\([\s\S]*?\n\$\$;`,
    "i",
  );

  const match = sql.match(pattern);

  assert.ok(
    match,
    `${name} missing`,
  );

  return match[0];
}

for (const [label, name] of [
  [
    "SET",
    "set_settlement_summary_group_point_promotion",
  ],
  [
    "DELETE",
    "delete_settlement_summary_group_point_promotion",
  ],
]) {
  const fn = extract(name);

  const globalPos =
    fn.indexOf(
      "LINE_ORDER_SETTLEMENT_OPEN_CLOSE",
    );

  const groupPos =
    fn.indexOf(
      "p_settlement_session_id::text",
      globalPos,
    );

  const codePos =
    fn.indexOf(
      "SETTLEMENT_POINT_PROMOTION",
      groupPos,
    );

  assert.ok(
    globalPos >= 0,
    `${label} global lock missing`,
  );

  assert.ok(
    groupPos > globalPos,
    `${label} Summary Group lock missing/order invalid`,
  );

  assert.ok(
    codePos > groupPos,
    `${label} code lock missing/order invalid`,
  );
}

const functionCount =
  (
    sql.match(
      /create\s+or\s+replace\s+function/gi,
    ) || []
  ).length;

assert.equal(
  functionCount,
  2,
  "hardening migration must contain exactly two functions",
);

assert.match(sql, /^begin;/m);
assert.match(sql, /^commit;/m);

assert.doesNotMatch(
  sql,
  /\balter\s+table\b/i,
);

assert.doesNotMatch(
  sql,
  /\bcreate\s+table\b/i,
);

assert.doesNotMatch(
  sql,
  /\bcreate\s+(?:or\s+replace\s+)?view\b/i,
);

console.log(
  "PASS PH-01 SET uses global -> group -> code",
);

console.log(
  "PASS PH-02 DELETE uses global -> group -> code",
);

console.log(
  "PASS PH-03 migration replaces two RPCs only",
);

console.log(
  "PASS: Point Promotion Concurrency Hardening v9.17",
);
