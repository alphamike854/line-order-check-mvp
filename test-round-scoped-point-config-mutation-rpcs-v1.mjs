import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/" +
  "20260909133000_add_round_scoped_point_config_mutation_rpcs.sql";

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

console.log(
  "===== Round-scoped Point Config Mutation RPCs v1 =====",
);

function functionSlice(name, nextName = "") {
  const marker =
    `public.${name}(`;
  const start =
    sql.indexOf(marker);

  assert.ok(
    start >= 0,
    `${name} missing`,
  );

  const end =
    nextName
      ? sql.indexOf(
          `public.${nextName}(`,
          start + marker.length,
        )
      : sql.indexOf(
          "-- ============================================================",
          start + marker.length,
        );

  return sql.slice(
    start,
    end > start ? end : sql.length,
  );
}

const setPromotion =
  functionSlice(
    "set_settlement_round_point_promotion",
    "delete_settlement_round_point_promotion",
  );

const deletePromotion =
  functionSlice(
    "delete_settlement_round_point_promotion",
    "replace_settlement_round_actual_special_codes",
  );

const replacePoint =
  functionSlice(
    "replace_settlement_round_actual_special_codes",
  );

// M2B-01: dedicated Round-scoped mutation RPCs exist.
assert.match(
  setPromotion,
  /p_round_id uuid/,
);
assert.match(
  deletePromotion,
  /p_round_id uuid/,
);
assert.match(
  replacePoint,
  /p_round_id uuid/,
);
console.log(
  "PASS M2B-01 dedicated Round-scoped RPC identity",
);

// M2B-02: OPEN and CLOSED are editable, but archived/reset Rounds fail closed.
for (const body of [
  setPromotion,
  deletePromotion,
  replacePoint,
]) {
  assert.match(
    body,
    /v_round\.status not in \('OPEN','CLOSED'\)/i,
  );
  assert.match(
    body,
    /settlement_summary_group_round_snapshots/i,
  );
  assert.match(
    body,
    /ROUND_CONFIG_ARCHIVED/,
  );
  assert.doesNotMatch(
    body,
    /SETTLEMENT_NOT_OPEN/,
  );
}
console.log(
  "PASS M2B-02 OPEN/CLOSED editable until Round archive",
);

// M2B-03: Promotion supports ALL or SELECTED targets.
assert.match(
  setPromotion,
  /v_scope not in \('ALL','SELECTED'\)/i,
);
assert.match(
  setPromotion,
  /PROMOTION_SELECTED_GROUPS_REQUIRED/,
);
assert.match(
  setPromotion,
  /PROMOTION_ALL_WITH_SELECTED_GROUPS/,
);
assert.match(
  setPromotion,
  /settlement_round_point_promotion_line_groups/,
);
console.log(
  "PASS M2B-03 Promotion target scope contract",
);

// M2B-04: SELECTED groups are server-validated against this
// Round's Settlement + Summary Group mapping.
assert.match(
  setPromotion,
  /cfg\.settlement_session_id\s*=\s*v_round\.settlement_session_id/i,
);
assert.match(
  setPromotion,
  /cfg\.summary_group_id\s*=\s*v_round\.summary_group_id/i,
);
assert.match(
  setPromotion,
  /cfg\.enabled\s*=\s*true/i,
);
assert.match(
  setPromotion,
  /PROMOTION_LINE_GROUP_OUT_OF_SCOPE/,
);
console.log(
  "PASS M2B-04 selected LINE Groups fail closed outside Round scope",
);

// M2B-05: Promotion audit captures factor, scope and target set.
for (const token of [
  "previous_point_factor_pct",
  "new_point_factor_pct",
  "previous_target_scope",
  "new_target_scope",
  "previous_line_group_ids",
  "new_line_group_ids",
]) {
  assert.match(
    setPromotion,
    new RegExp(token),
  );
}
assert.match(
  deletePromotion,
  /settlement_round_point_promotion_events/,
);
console.log(
  "PASS M2B-05 Promotion mutation is fully audited",
);

// M2B-06: lock order preserves global -> Summary Group -> code.
const setGlobal =
  setPromotion.indexOf(
    "'LINE_ORDER_SETTLEMENT_OPEN_CLOSE'",
  );
const setGroup =
  setPromotion.indexOf(
    "v_round.settlement_session_id::text",
    setGlobal + 1,
  );
const setCode =
  setPromotion.indexOf(
    "'SETTLEMENT_ROUND_POINT_PROMOTION'",
  );

assert.ok(
  setGlobal >= 0
  && setGroup > setGlobal
  && setCode > setGroup,
);
console.log(
  "PASS M2B-06 Promotion preserves lock hierarchy",
);

// M2B-07: Actual Point remains Round/Summary-only with no LINE Group target.
assert.match(
  replacePoint,
  /settlement_round_actual_special_point_codes/,
);
assert.doesNotMatch(
  replacePoint,
  /p_line_group_ids|target_scope/i,
);
console.log(
  "PASS M2B-07 Actual Point remains Summary Group only",
);

// M2B-08: existing Point Profile category limits are preserved.
assert.match(
  replacePoint,
  /settlement_point_profiles/,
);
assert.match(
  replacePoint,
  /max_special_codes/,
);
assert.match(
  replacePoint,
  /SPECIAL_POINT_LIMIT_%/,
);
assert.match(
  replacePoint,
  /DUPLICATE_POINT_CODE/,
);
console.log(
  "PASS M2B-08 Actual Point validation/limits preserved",
);

// M2B-09: Actual Point replacement is no-op aware and audited.
assert.match(
  replacePoint,
  /v_previous_codes\s*=\s*v_new_codes/i,
);
assert.match(
  replacePoint,
  /'action', 'NO_CHANGE'/,
);
assert.match(
  replacePoint,
  /settlement_round_actual_special_point_events/,
);
assert.match(
  replacePoint,
  /previous_codes/,
);
assert.match(
  replacePoint,
  /new_codes/,
);
console.log(
  "PASS M2B-09 Actual Point replacement is audited and idempotent",
);

// M2B-10: security-definer RPCs are service-role only.
for (const name of [
  "set_settlement_round_point_promotion",
  "delete_settlement_round_point_promotion",
  "replace_settlement_round_actual_special_codes",
]) {
  assert.match(
    sql,
    new RegExp(
      `revoke all[\\s\\S]*?public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      `grant execute[\\s\\S]*?public\\.${name}\\([\\s\\S]*?to service_role`,
      "i",
    ),
  );
}
console.log(
  "PASS M2B-10 service-role mutation boundary",
);

// M2B-11: this phase does not cut over legacy callers/read models.
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.set_settlement_summary_group_point_promotion/i,
);
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.delete_settlement_summary_group_point_promotion/i,
);
assert.doesNotMatch(
  sql,
  /create or replace function\s+public\.replace_settlement_summary_group_actual_special_codes/i,
);
assert.doesNotMatch(
  sql,
  /create or replace view\s+public\.session_/i,
);
console.log(
  "PASS M2B-11 no legacy API/read-model cutover",
);

console.log(
  "PASS: Round-scoped Point Config Mutation RPCs v1",
);
