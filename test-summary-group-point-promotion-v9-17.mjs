import fs from "node:fs";
import assert from "node:assert/strict";

const migrationPath =
  "supabase/migrations/" +
  "20260831204000_scope_point_promotions_by_summary_group.sql";

const sql = fs.readFileSync(
  migrationPath,
  "utf8",
);

console.log(
  "===== Summary Group Point Promotion P1 v9.17 =====",
);

// P1-01: schema is Summary-Group scoped.
assert.match(
  sql,
  /add column summary_group_id text/i,
);

assert.match(
  sql,
  /add primary key\s*\(\s*settlement_session_id,\s*summary_group_id,\s*category,\s*code\s*\)/i,
);

console.log(
  "PASS P1-01 Promotion key includes Summary Group",
);


// P1-02: migration must never guess the scope of
// unexpected legacy Promotion rows.
assert.doesNotMatch(
  sql,
  /_legacy_settlement_point_promotions/,
);

assert.match(
  sql,
  /LEGACY_POINT_PROMOTIONS_EXIST/,
);

assert.match(
  sql,
  /if exists\s*\(\s*select 1\s+from public\.settlement_point_promotions\s*\)/is,
);

console.log(
  "PASS P1-02 unexpected legacy Promotion rows fail closed",
);


// P1-03: every direct Promotion risk join must include
// Summary Group isolation.
const promotionJoins =
  [
    ...sql.matchAll(
      /left join public\.settlement_point_promotions pm[\s\S]{0,360}?pm\.code\s*=\s*cb\.code/gi,
    ),
  ];

assert.equal(
  promotionJoins.length,
  2,
  "expected exactly two direct Promotion risk joins",
);

for (const match of promotionJoins) {
  assert.match(
    match[0],
    /pm\.summary_group_id\s*=\s*cb\.summary_group_id/i,
  );
}

console.log(
  "PASS P1-03 Summary and LINE Group risk cannot leak Promotion across groups",
);


// P1-04: live edit RPCs exist.
assert.match(
  sql,
  /set_settlement_summary_group_point_promotion/,
);

assert.match(
  sql,
  /delete_settlement_summary_group_point_promotion/,
);

assert.match(
  sql,
  /SETTLEMENT_POINT_PROMOTION/,
);

console.log(
  "PASS P1-04 live set/delete Promotion RPCs are serialized",
);


// P1-05: changes are allowed only while settlement is OPEN.
const openGuards =
  sql.match(
    /v_session\.status\s*<>\s*'OPEN'/gi,
  ) ?? [];

assert.ok(
  openGuards.length >= 2,
  "set/delete Promotion must both require OPEN settlement",
);

console.log(
  "PASS P1-05 live Promotion editing is OPEN-settlement only",
);


// P1-06: audit is permanent and constrained.
assert.match(
  sql,
  /create table\s+public\.settlement_point_promotion_events/i,
);

assert.match(
  sql,
  /action in \('ADD','UPDATE','DELETE'\)/i,
);

assert.match(
  sql,
  /previous_point_factor_pct[\s\S]{0,180}previous_point_factor_pct <= 100/i,
);

assert.match(
  sql,
  /new_point_factor_pct[\s\S]{0,180}new_point_factor_pct <= 100/i,
);

console.log(
  "PASS P1-06 Promotion changes have constrained audit history",
);


// P1-07: new OPEN payload supports Summary Group.
assert.match(
  sql,
  /v_item->>'summary_group_id'/,
);

assert.match(
  sql,
  /on conflict\s*\(\s*settlement_session_id,\s*summary_group_id,\s*category,\s*code\s*\)/i,
);

console.log(
  "PASS P1-07 new settlement Promotion drafts support Summary Group",
);


// P1-08: backward compatibility for an old deployed UI.
// Old drafts without summary_group_id retain former global
// behavior temporarily by expanding into every group.
assert.match(
  sql,
  /if v_summary is not null then/i,
);

assert.match(
  sql,
  /Backward compatibility during deployment/i,
);

assert.match(
  sql,
  /select distinct\s+v_id,\s*cfg\.summary_group_id,\s*v_category,\s*v_code,\s*v_factor/is,
);

console.log(
  "PASS P1-08 old deployed OPEN requests remain compatible",
);


// P1-09: migration is atomic.
assert.match(
  sql.trimStart(),
  /^-- P1A[\s\S]*\bbegin;/i,
);

assert.match(
  sql.trimEnd(),
  /commit;$/i,
);

console.log(
  "PASS P1-09 schema/risk migration is atomic",
);

console.log(
  "PASS: Summary Group Point Promotion P1 v9.17",
);
