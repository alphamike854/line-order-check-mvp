import fs from "node:fs";
import assert from "node:assert/strict";

const accounting =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const migration =
  fs.readFileSync(
    "supabase/migrations/" +
    "20260831204000_scope_point_promotions_by_summary_group.sql",
    "utf8",
  );

console.log(
  "===== Summary Group Point Promotion Integration v9.17 =====",
);


// Integration-01
assert.match(
  accounting,
  /select\("summary_group_id,category,code,point_factor_pct"\)/,
);

assert.match(
  accounting,
  /`\$\{r\.summary_group_id\}\|\$\{r\.category\}\|\$\{r\.code\}`/,
);

assert.match(
  accounting,
  /promoMap\.get\(`\$\{cfg\.summary_group_id\}\|\$\{key\}`\)\?\?100/,
);

console.log(
  "PASS P1INT-01 accounting report Promotion is Summary-Group scoped",
);


// Integration-02
assert.match(
  dashboard,
  /select\("summary_group_id,category,code,point_factor_pct"\)/,
);

assert.match(
  dashboard,
  /r\.summary_group_id===summaryGroupId/,
);

assert.match(
  dashboard,
  /`\$\{r\.summary_group_id\}:\$\{r\.category\}\$\{r\.code\}:\$\{r\.point_factor_pct\}`/,
);

console.log(
  "PASS P1INT-02 dashboard Promotion payload/freshness is scoped",
);


// Integration-03
function functionSlice(name, nextName) {
  const start =
    migration.indexOf(
      `public.${name}(`,
    );

  assert.ok(
    start >= 0,
    `${name} missing`,
  );

  const end =
    nextName
      ? migration.indexOf(
          `public.${nextName}(`,
          start + 1,
        )
      : migration.length;

  return migration.slice(
    start,
    end > start
      ? end
      : migration.length,
  );
}

const setFn =
  functionSlice(
    "set_settlement_summary_group_point_promotion",
    "delete_settlement_summary_group_point_promotion",
  );

const deleteFn =
  functionSlice(
    "delete_settlement_summary_group_point_promotion",
    "open_settlement_session",
  );

for (
  const [label, fn]
  of [
    ["SET", setFn],
    ["DELETE", deleteFn],
  ]
) {
  assert.match(
    fn,
    /LINE_ORDER_SETTLEMENT_OPEN_CLOSE/,
    `${label} must share global settlement lock`,
  );

  assert.match(
    fn,
    /concat_ws\(\s*'\|',\s*p_settlement_session_id::text,\s*v_summary\s*\)/s,
    `${label} must share Summary Group lock`,
  );

  assert.match(
    fn,
    /SETTLEMENT_POINT_PROMOTION/,
    `${label} must retain code-level Promotion lock`,
  );

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
    globalPos >= 0
    && groupPos > globalPos
    && codePos > groupPos,
    `${label} lock order must be global -> group -> code`,
  );
}

console.log(
  "PASS P1INT-03 Promotion mutation shares atomic confirm boundary",
);

console.log(
  "PASS: Summary Group Point Promotion Integration v9.17",
);
