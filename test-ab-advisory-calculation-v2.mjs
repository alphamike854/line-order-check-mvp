import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

import {
  buildAbBatchAdvisory,
} from "./src/lib/ab-risk-advisory.mjs";


const fixedPlan = {
  A: {
    recommendations: [
      {
        category: "A",
        code: "01",
        recommended_transfer: 1499,
      },
      {
        category: "A",
        code: "02",
        recommended_transfer: 1500,
      },
      {
        category: "A",
        code: "03",
        recommended_transfer: 2750,
      },
    ],
  },

  B: {
    recommendations: [],
  },
};


const fixed1500 =
  buildAbBatchAdvisory({
    plan:
      fixedPlan,

    batchLimit:
      1500,
  });

assert.equal(
  fixed1500.mode,
  "FIXED",
);

assert.equal(
  fixed1500.batch_limit,
  1500,
);

assert.deepEqual(
  fixed1500.rows,
  [
    {
      category: "A",
      code: "02",
      quantity: 1500,
      required_total: 1500,
    },
    {
      category: "A",
      code: "03",
      quantity: 1500,
      required_total: 2750,
    },
  ],
);


const autoPlan = {
  A: {
    recommendations: [
      {
        category: "A",
        code: "79",
        recommended_transfer: 6455,
      },
      {
        category: "A",
        code: "89",
        recommended_transfer: 4741,
      },
      {
        category: "A",
        code: "35",
        recommended_transfer: 952,
      },
      {
        category: "A",
        code: "01",
        recommended_transfer: 499,
      },
    ],
  },

  B: {
    recommendations: [
      {
        category: "B",
        code: "89",
        recommended_transfer: 3416,
      },
    ],
  },
};


const automatic =
  buildAbBatchAdvisory({
    plan:
      autoPlan,

    batchLimit:
      "AUTO",
  });

assert.equal(
  automatic.mode,
  "AUTO",
);

assert.equal(
  automatic.batch_limit,
  null,
);

assert.deepEqual(
  automatic.rows,
  [
    {
      category: "A",
      code: "79",
      quantity: 5000,
      required_total: 6455,
    },
    {
      category: "A",
      code: "89",
      quantity: 4500,
      required_total: 4741,
    },
    {
      category: "A",
      code: "35",
      quantity: 500,
      required_total: 952,
    },
    {
      category: "B",
      code: "89",
      quantity: 3000,
      required_total: 3416,
    },
  ],
);

assert.ok(
  automatic.rows.every(
    row =>
      row.quantity <= 5000
      && row.quantity % 500 === 0,
  ),
);


const sweep =
  buildAbBatchAdvisory({
    plan:
      autoPlan,

    batchLimit:
      "SWEEP",
  });

assert.equal(
  sweep.mode,
  "SWEEP",
);

assert.equal(
  sweep.batch_limit,
  null,
);

assert.equal(
  sweep.total_quantity,
  16063,
);

assert.deepEqual(
  sweep.rows,
  [
    {
      category: "A",
      code: "79",
      quantity: 6455,
      required_total: 6455,
    },
    {
      category: "A",
      code: "89",
      quantity: 4741,
      required_total: 4741,
    },
    {
      category: "A",
      code: "35",
      quantity: 952,
      required_total: 952,
    },
    {
      category: "A",
      code: "01",
      quantity: 499,
      required_total: 499,
    },
    {
      category: "B",
      code: "89",
      quantity: 3416,
      required_total: 3416,
    },
  ],
);

assert.ok(
  sweep.rows.every(
    row =>
      row.quantity
      === row.required_total,
  ),
);

assert.throws(
  () =>
    buildAbBatchAdvisory({
      plan:
        fixedPlan,

      batchLimit:
        750,
    }),
  /AB_BATCH_LIMIT_INVALID/,
);


const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

for (
  const value
  of [
    "500",
    "1000",
    "1500",
    "2000",
    "2500",
    "3000",
    "3500",
    "4000",
    "4500",
    "5000",
    "AUTO",
    "SWEEP",
  ]
) {
  assert.match(
    html,
    new RegExp(
      `value="${value}"`,
    ),
  );
}


const preview =
  fs.readFileSync(
    "public/ab-advisory-preview.js",
    "utf8",
  );

const runtime = {
  Intl,
  Map,
  Set,
  Number,
  String,
  Math,
  Date,
};

vm.createContext(runtime);

vm.runInContext(
  preview,
  runtime,
);


const previewAutoPlan = {
  A: {
    recommendations: [
      {
        code: "79",
        retained_before: 12019,
        retention_limit: 5564,
        recommended_transfer: 6455,
      },
      {
        code: "89",
        retained_before: 10305,
        retention_limit: 5564,
        recommended_transfer: 4741,
      },
      {
        code: "35",
        retained_before: 6516,
        retention_limit: 5564,
        recommended_transfer: 952,
      },
      {
        code: "01",
        retained_before: 6000,
        retention_limit: 5564,
        recommended_transfer: 499,
      },
    ],
  },

  B: {
    recommendations: [
      {
        code: "89",
        retained_before: 8607,
        retention_limit: 5191,
        recommended_transfer: 3416,
      },
    ],
  },
};


const previewAutoRows =
  runtime
    .abPreviewBatchRows(
      previewAutoPlan,
      "AUTO",
    );

assert.deepEqual(
  Array.from(
    previewAutoRows,
    row => ({
      category:
        row.category,

      code:
        row.code,

      quantity:
        row.quantity,
    }),
  ),
  [
    {
      category: "A",
      code: "79",
      quantity: 5000,
    },
    {
      category: "A",
      code: "89",
      quantity: 4500,
    },
    {
      category: "A",
      code: "35",
      quantity: 500,
    },
    {
      category: "B",
      code: "89",
      quantity: 3000,
    },
  ],
);


const previewSweepRows =
  runtime
    .abPreviewBatchRows(
      previewAutoPlan,
      "SWEEP",
    );

assert.equal(
  previewSweepRows.length,
  5,
);

assert.equal(
  previewSweepRows.reduce(
    (sum, row) =>
      sum + row.quantity,
    0,
  ),
  16063,
);

assert.ok(
  previewSweepRows.every(
    row =>
      row.quantity
      === row.recommended_transfer,
  ),
);


const highToLowRows = [
  {
    category: "A",
    code: "04",
    quantity: 500,
    retained_before: 6000,
    retention_limit: 5000,
    recommended_transfer: 1000,
  },
  {
    category: "A",
    code: "99",
    quantity: 500,
    retained_before: 9000,
    retention_limit: 5000,
    recommended_transfer: 4000,
  },
  {
    category: "A",
    code: "40",
    quantity: 500,
    retained_before: 8000,
    retention_limit: 5000,
    recommended_transfer: 3000,
  },
];


assert.equal(
  runtime
    .abPreviewOperationalText(
      highToLowRows,
      "A",
    ),
  [
    "บ",
    "99 40 04=500",
  ].join("\n"),
);


const mixedAutoText =
  runtime
    .abPreviewOperationalText(
      previewAutoRows,
      "A",
    );

assert.match(
  mixedAutoText,
  /79=5000/,
);

assert.match(
  mixedAutoText,
  /89=4500x3000/,
);

assert.match(
  mixedAutoText,
  /35=500/,
);

assert.equal(
  runtime
    .abPreviewBatchLabel(
      "AUTO",
    ),
  "อัตโนมัติ",
);


assert.equal(
  runtime
    .abPreviewBatchLabel(
      "SWEEP",
    ),
  "กวาดทั้งหมด",
);


const sweepMessages =
  runtime
    .abPreviewBuildMessages(
      {
        summary_group_id:
          "NORTH",

        plan: {
          ...previewAutoPlan,

          gross_received:
            200000,

          adjusted_received:
            150000,

          transfer_required_total:
            16063,
        },
      },

      "SWEEP",

      {
        generated_at:
          "2026-10-08T08:00:00.000Z",

        summary_groups: [
          {
            id: "NORTH",
            name: "ภาคเหนือ",
          },
        ],
      },

      "A",
    );

assert.equal(
  sweepMessages
    .batchRows
    .reduce(
      (sum, row) =>
        sum + row.quantity,
      0,
    ),
  16063,
);

assert.match(
  sweepMessages.bubble1,
  /ต้องส่งออกทั้งหมด 16,063/,
);

assert.match(
  sweepMessages.bubble1,
  /ส่งออกรอบนี้ 16,063/,
);

assert.match(
  sweepMessages.bubble1,
  /เหลือรอส่งออก 0/,
);

assert.match(
  sweepMessages.bubble2,
  /89=4741x3416/,
);

assert.match(
  sweepMessages.bubble2,
  /35=952/,
);


console.log(
  "PASS: fixed 500-step calculation 500..5000",
);

console.log(
  "PASS: AUTO floors to 500 and caps A/B code at 5000",
);

console.log(
  "PASS: SWEEP selects exact recommended transfer and leaves zero remaining",
);

console.log(
  "PASS: Copy order follows order quantity high -> low",
);

console.log(
  "PASS: mixed AUTO quantities remain copyable",
);

console.log(
  "PASS: calculation remains preview-only",
);
