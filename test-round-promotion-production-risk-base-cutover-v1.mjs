import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath =
  "supabase/migrations/20260910163000_cut_over_production_risk_base_to_round.sql";

const sql =
  readFileSync(migrationPath, "utf8");

console.log(
  "===== Round Promotion Production Risk Base Cutover v1 ====="
);

const createdViews = [
  ...sql.matchAll(
    /create or replace view\s+public\.([a-z0-9_]+)\s+as/gi
  ),
].map((match) => match[1]);

assert.deepEqual(
  createdViews,
  [
    "session_line_group_code_risk_state",
    "session_code_risk_state",
    "session_category_risk_state",
  ],
);

console.log(
  "PASS P3A1-01 exactly three production base Risk views are replaced"
);

function viewBlock(name) {
  const marker =
    `create or replace view public.${name} as`;

  const lower =
    sql.toLowerCase();

  const start =
    lower.indexOf(marker);

  assert.notEqual(
    start,
    -1,
    `missing view ${name}`
  );

  const next =
    lower.indexOf(
      "create or replace view public.",
      start + marker.length
    );

  return sql.slice(
    start,
    next === -1
      ? sql.length
      : next
  );
}

function selectedColumns(block) {
  const match =
    block.match(
      /\bas\s+select\s+([\s\S]*?)\s+from\s+/i
    );

  assert.ok(
    match,
    "unable to parse projection columns"
  );

  const source = match[1];
  const columns = [];
  let current = "";
  let depth = 0;

  for (const char of source) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;

      assert.ok(
        depth >= 0,
        "projection parser has unbalanced parentheses"
      );
    }

    if (
      char === ","
      && depth === 0
    ) {
      columns.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  assert.equal(
    depth,
    0,
    "projection parser has unbalanced parentheses"
  );

  if (current.trim()) {
    columns.push(current);
  }

  return columns.map((value) =>
    value
      .trim()
      .replace(/\s+/g, " ")
  );
}

const lineBlock =
  viewBlock(
    "session_line_group_code_risk_state"
  );

const codeBlock =
  viewBlock(
    "session_code_risk_state"
  );

const categoryBlock =
  viewBlock(
    "session_category_risk_state"
  );

assert.deepEqual(
  selectedColumns(lineBlock),
  [
    "settlement_session_id",
    "business_date",
    "line_group_id",
    "line_group_name",
    "summary_group_id",
    "category",
    "code",
    "order_total",
    "special_multiplier",
    "max_special_codes",
    "multiplier_configured",
    "promotion_factor_pct",
    "effective_multiplier",
    "point_exposure",
    "reserve_rank",
    "reserve_candidate",
  ],
);

assert.match(
  lineBlock,
  /from\s+public\.session_round_line_group_code_risk_shadow\b/i
);

console.log(
  "PASS P3A1-02 LINE Group production contract projects only Round shadow truth"
);

assert.deepEqual(
  selectedColumns(codeBlock),
  [
    "settlement_session_id",
    "business_date",
    "summary_group_id",
    "category",
    "code",
    "order_total",
    "adjusted_total",
    "special_multiplier::numeric(12,3) as special_multiplier",
    "max_special_codes",
    "promotion_factor_pct",
    "effective_multiplier::numeric as effective_multiplier",
    "point_exposure::numeric as point_exposure",
    "actual_special_point",
    "reserve_rank",
    "reserve_candidate",
    "actual_point::numeric as actual_point",
    "confirmed_cut",
    "available_to_cut",
    "retained_quantity",
    "retained_point_exposure::numeric as retained_point_exposure",
  ],
);

assert.match(
  codeBlock,
  /from\s+public\.session_round_code_risk_shadow\b/i
);

assert.equal(
  (
    codeBlock.match(
      /::numeric(?:\(12,3\))?/g
    ) || []
  ).length,
  5,
);

console.log(
  "PASS P3A1-03 Summary code projects Round truth with exact production typmods"
);

assert.deepEqual(
  selectedColumns(categoryBlock),
  [
    "settlement_session_id",
    "business_date",
    "summary_group_id",
    "category",
    "special_multiplier",
    "max_special_codes",
    "actual_selected_count",
    "order_total",
    "adjusted_total",
    "point_reserve",
    "actual_point",
    "reserve_safe_capacity",
    "reserve_risk_pct",
  ],
);

assert.match(
  categoryBlock,
  /from\s+public\.session_round_category_risk_shadow\b/i
);

console.log(
  "PASS P3A1-04 Summary category production contract projects only Round shadow truth"
);

for (const block of [
  lineBlock,
  codeBlock,
  categoryBlock,
]) {
  assert.doesNotMatch(
    block,
    /\bround_id\b|\bround_no\b|\bround_status\b/i
  );
}

console.log(
  "PASS P3A1-05 Round identity remains internal and does not change production contracts"
);

for (const legacy of [
  "settlement_point_promotions",
  "settlement_summary_group_actual_special_point_codes",
  "order_items",
  "settlement_line_group_config",
]) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      `\\b${legacy}\\b`,
      "i"
    )
  );
}

console.log(
  "PASS P3A1-06 production base views no longer calculate from legacy Promotion or Actual Point sources"
);

for (const downstream of [
  "session_line_group_code_retention_state",
  "session_line_group_category_retention_state",
  "session_line_group_risk_state",
  "session_line_group_category_risk_state",
  "session_risk_pool_state",
  "session_overall_risk_state",
]) {
  assert.doesNotMatch(
    sql,
    new RegExp(
      `create or replace view\\s+public\\.${downstream}\\s+as`,
      "i"
    )
  );
}

console.log(
  "PASS P3A1-07 downstream Risk calculations remain unchanged"
);

assert.doesNotMatch(
  sql,
  /\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+public\.|\btruncate\b/i
);

console.log(
  "PASS P3A1-08 migration performs no business-row mutation"
);

assert.doesNotMatch(
  sql,
  /\bgrant\b|\brevoke\b|\balter\s+view\b|\bsecurity_invoker\b|\bsecurity_barrier\b/i
);

console.log(
  "PASS P3A1-09 existing production ownership privileges and view options are not deliberately changed"
);

assert.doesNotMatch(
  sql,
  /accounting_report_line_group_summary|netlify\/functions|public\/app\.js/i
);

console.log(
  "PASS P3A1-10 Accounting and browser/application code remain outside P3A1"
);

console.log(
  "PASS: Round Promotion Production Risk Base Cutover v1"
);
