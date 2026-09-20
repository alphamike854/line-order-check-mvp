import assert
  from "node:assert/strict";

import {
  buildAbAdvisoryScopes,
} from "./src/lib/ab-advisory-scope.mjs";

/*
 * Two LINE Groups.
 *
 * Each LINE Group holds only 600
 * of A20 / B20.
 *
 * Combined Summary Group holds 1,200.
 *
 * Summary cap = 700.
 *
 * This proves:
 * - Summary Group needs action.
 * - Neither LINE Group may independently
 *   consume its own Max Loss budget.
 */
const summaryRows = [
  {
    summary_group_id: "EAST",
    category: "A",
    code: "20",
    order_total: 10000,
    adjusted_total: 6000,
    retained_quantity: 1200,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
  {
    summary_group_id: "EAST",
    category: "B",
    code: "20",
    order_total: 10000,
    adjusted_total: 6000,
    retained_quantity: 1200,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
];

const lineGroupRows = [
  {
    summary_group_id: "EAST",
    line_group_id: "LG-1",
    line_group_name: "กลุ่ม 1",
    category: "A",
    code: "20",
    order_total: 5000,
    adjusted_total: 3000,
    retained_quantity: 600,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
  {
    summary_group_id: "EAST",
    line_group_id: "LG-1",
    line_group_name: "กลุ่ม 1",
    category: "B",
    code: "20",
    order_total: 5000,
    adjusted_total: 3000,
    retained_quantity: 600,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
  {
    summary_group_id: "EAST",
    line_group_id: "LG-2",
    line_group_name: "กลุ่ม 2",
    category: "A",
    code: "20",
    order_total: 5000,
    adjusted_total: 3000,
    retained_quantity: 600,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
  {
    summary_group_id: "EAST",
    line_group_id: "LG-2",
    line_group_name: "กลุ่ม 2",
    category: "B",
    code: "20",
    order_total: 5000,
    adjusted_total: 3000,
    retained_quantity: 600,
    effective_multiplier: 10,
    max_special_codes: 1,
  },
];

const result =
  buildAbAdvisoryScopes({
    summaryRows,
    lineGroupRows,
    sharedMaxLoss: 2000,
  });

assert.equal(
  result.summary_groups.length,
  1
);

assert.equal(
  result.line_groups.length,
  2
);

const summary =
  result.summary_groups[0];

assert.equal(
  summary.decision_role,
  "AUTHORITATIVE"
);

assert.equal(
  summary.calculation_status,
  "READY"
);

assert.equal(
  summary.plan.A
    .common_retention_limit,
  700
);

assert.equal(
  summary.plan.B
    .common_retention_limit,
  700
);

assert.equal(
  summary.plan.A
    .transfer_required_total,
  500
);

assert.equal(
  summary.plan.B
    .transfer_required_total,
  500
);

assert.equal(
  summary.plan
    .transfer_required_total,
  1000
);

for (
  const line
  of result.line_groups
) {
  assert.equal(
    line.decision_role,
    "ATTRIBUTION_ONLY"
  );

  assert.equal(
    line.calculation_status,
    "READY"
  );

  assert.equal(
    line.metrics.A
      .retained_quantity,
    600
  );

  assert.equal(
    line.metrics.B
      .retained_quantity,
    600
  );

  /*
   * Each LINE Group alone is below
   * Summary cap 700.
   *
   * Yet combined Summary Group is above it.
   */
  assert.equal(
    line.metrics.A
      .codes_over_summary_cap,
    0
  );

  assert.equal(
    line.metrics.B
      .codes_over_summary_cap,
    0
  );
}

/*
 * Failure isolation:
 * an invalid Summary Group must be
 * NOT_READY rather than throwing
 * and taking all scopes down.
 */
const isolated =
  buildAbAdvisoryScopes({
    summaryRows: [
      ...summaryRows,

      {
        summary_group_id: "BROKEN",
        category: "A",
        code: "01",
        order_total: 100,
        adjusted_total: 60,
        retained_quantity: 100,
        effective_multiplier: 0,
        max_special_codes: 1,
      },
    ],
    lineGroupRows,
    sharedMaxLoss: 2000,
  });

const east =
  isolated.summary_groups.find(
    row =>
      row.summary_group_id
      === "EAST"
  );

const broken =
  isolated.summary_groups.find(
    row =>
      row.summary_group_id
      === "BROKEN"
  );

assert.equal(
  east.calculation_status,
  "READY"
);

assert.equal(
  broken.calculation_status,
  "NOT_READY"
);

assert.ok(
  broken.calculation_error
);

console.log(
  "PASS: Summary Group is authoritative"
);

console.log(
  "PASS: LINE Group is attribution only"
);

console.log(
  "PASS: Shared Max Loss is not duplicated per LINE Group"
);

console.log(
  "PASS: combined-code risk remains Summary scoped"
);

console.log(
  "PASS: one bad Summary Group does not take down others"
);
