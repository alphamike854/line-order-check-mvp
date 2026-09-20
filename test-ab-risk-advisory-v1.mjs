import assert from "node:assert/strict";

import {
  buildSharedAbRiskPlan,
  buildAbBatchAdvisory,
  formatAbAdvisoryBubbles,
} from "./src/lib/ab-risk-advisory.mjs";

/*
 * EAST-shaped regression fixture.
 *
 * Adjusted:
 * A = 356,783.40
 * B = 345,214.80
 *
 * Effective multiplier = 70
 */
const rows = [
  {
    category: "A",
    code: "40",
    order_total: 594639,
    adjusted_total: 356783.4,
    retained_quantity: 10373,
    effective_multiplier: 70,
    max_special_codes: 1,
  },
  {
    category: "A",
    code: "74",
    order_total: 0,
    adjusted_total: 0,
    retained_quantity: 10245,
    effective_multiplier: 70,
    max_special_codes: 1,
  },
  {
    category: "B",
    code: "74",
    order_total: 575358,
    adjusted_total: 345214.8,
    retained_quantity: 10220,
    effective_multiplier: 70,
    max_special_codes: 1,
  },
];

const plan =
  buildSharedAbRiskPlan({
    rows,
    sharedMaxLoss: 200000,
  });

assert.equal(
  plan.gross_received,
  1169997
);

assert.equal(
  plan.adjusted_received,
  701998.2
);

assert.equal(
  plan.loss_budget.A,
  101647.95
);

assert.equal(
  plan.loss_budget.B,
  98352.05
);

assert.equal(
  plan.A.common_retention_limit,
  6549
);

assert.equal(
  plan.B.common_retention_limit,
  6336
);

assert.equal(
  plan.A.point_reserve_after_plan,
  458430
);

assert.equal(
  plan.B.point_reserve_after_plan,
  443520
);

assert.equal(
  plan.worst_case_loss,
  199951.8
);

assert.equal(
  plan.loss_headroom,
  48.2
);

assert.equal(
  plan.guard_pass,
  true
);

const a40 =
  plan.A.recommendations
    .find(
      (row) => row.code === "40"
    );

const a74 =
  plan.A.recommendations
    .find(
      (row) => row.code === "74"
    );

const b74 =
  plan.B.recommendations
    .find(
      (row) => row.code === "74"
    );

assert.equal(
  a40.recommended_transfer,
  3824
);

assert.equal(
  a74.recommended_transfer,
  3696
);

assert.equal(
  b74.recommended_transfer,
  3884
);

/*
 * Current round policy:
 * caller selects 500 / 1000 / 2000.
 * Planner limits each code to that amount
 * and never treats advisory as confirmed cut.
 */
const batch =
  buildAbBatchAdvisory({
    plan,
    batchLimit: 500,
  });

const messages =
  formatAbAdvisoryBubbles({
    summaryGroup: "EAST",
    time: "14:30",
    reductionPct: 40,
    plan,
    batch,
  });

assert.equal(
  messages.bubble1,
  [
    "EAST | 14:30",
    "",
    "ยอดรวม 1,169,997",
    "ยอดหลังหัก 40% 701,998",
    "",
    "เพดาน/รหัส",
    "บ 6,549",
    "ล 6,336",
  ].join("\n")
);

assert.equal(
  messages.bubble2,
  [
    "บ",
    "40=500",
    "",
    "บล",
    "74=500x500",
  ].join("\n")
);


/*
 * Strict normal-round batching:
 * recommendation smaller than batch is held
 * for a later round.
 */
const batchFixture = {
  A: {
    recommendations: [
      {
        category: "A",
        code: "20",
        recommended_transfer: 499,
      },
      {
        category: "A",
        code: "21",
        recommended_transfer: 500,
      },
      {
        category: "A",
        code: "22",
        recommended_transfer: 501,
      },
    ],
  },

  B: {
    recommendations: [
      {
        category: "B",
        code: "20",
        recommended_transfer: 250,
      },
      {
        category: "B",
        code: "21",
        recommended_transfer: 700,
      },
    ],
  },
};

const strict500 =
  buildAbBatchAdvisory({
    plan: batchFixture,
    batchLimit: 500,
  });

assert.deepEqual(
  strict500.rows,
  [
    {
      category: "A",
      code: "21",
      quantity: 500,
      required_total: 500,
    },
    {
      category: "A",
      code: "22",
      quantity: 500,
      required_total: 501,
    },
    {
      category: "B",
      code: "21",
      quantity: 500,
      required_total: 700,
    },
  ]
);

assert.equal(
  strict500.final_round,
  false
);

assert.equal(
  strict500.total_quantity,
  1500
);

/*
 * Final round may emit the real residual.
 */
const final500 =
  buildAbBatchAdvisory({
    plan: batchFixture,
    batchLimit: 500,
    finalRound: true,
  });

assert.deepEqual(
  final500.rows,
  [
    {
      category: "A",
      code: "20",
      quantity: 499,
      required_total: 499,
    },
    {
      category: "A",
      code: "21",
      quantity: 500,
      required_total: 500,
    },
    {
      category: "A",
      code: "22",
      quantity: 501,
      required_total: 501,
    },
    {
      category: "B",
      code: "20",
      quantity: 250,
      required_total: 250,
    },
    {
      category: "B",
      code: "21",
      quantity: 700,
      required_total: 700,
    },
  ]
);

assert.equal(
  final500.final_round,
  true
);

assert.equal(
  final500.total_quantity,
  2450
);

/*
 * Performance contract:
 * huge retained quantities must not cause
 * unit-by-unit simulation.
 */
const huge = [];

for (let i = 0; i < 100; i += 1) {
  const code =
    String(i).padStart(2, "0");

  huge.push({
    category: "A",
    code,
    order_total:
      i === 0 ? 1000000 : 0,
    adjusted_total:
      i === 0 ? 600000 : 0,
    retained_quantity: 1000000,
    effective_multiplier: 70,
    max_special_codes: 1,
  });

  huge.push({
    category: "B",
    code,
    order_total:
      i === 0 ? 1000000 : 0,
    adjusted_total:
      i === 0 ? 600000 : 0,
    retained_quantity: 1000000,
    effective_multiplier: 70,
    max_special_codes: 1,
  });
}

const hugePlan =
  buildSharedAbRiskPlan({
    rows: huge,
    sharedMaxLoss: 200000,
  });

assert.equal(
  hugePlan.guard_pass,
  true
);

assert.ok(
  hugePlan.transfer_required_total
  > 100000000
);

assert.throws(
  () =>
    buildSharedAbRiskPlan({
      rows: [{
        category: "A",
        code: "01",
        order_total: 100,
        adjusted_total: 60,
        retained_quantity: 100,
        effective_multiplier: 70,
        max_special_codes: 2,
      }],
      sharedMaxLoss: 200000,
    }),
  /AB_FAST_PLANNER_REQUIRES_MAX_SPECIAL_CODES_1/
);

console.log(
  "PASS: Fast A/B separate risk + shared max loss"
);

console.log(
  "PASS: exact A/B retention caps"
);

console.log(
  "PASS: 500/1000/2000 batch-limit contract"
);

console.log(
  "PASS: Bubble 1 concise summary contract"
);

console.log(
  "PASS: Bubble 2 บ / ล / บล operational format"
);

console.log(
  "PASS: no unit-by-unit simulation"
);
