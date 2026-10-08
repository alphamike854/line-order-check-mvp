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



const sweepPlan = {
  A: {
    recommendations: [
      {
        category: "A",
        code: "01",
        recommended_transfer: 12632,
      },
      {
        category: "A",
        code: "02",
        recommended_transfer: 17000,
      },
    ],
  },

  B: {
    recommendations: [
      {
        category: "B",
        code: "03",
        recommended_transfer: 21000,
      },
    ],
  },
};


const sweep =
  buildAbBatchAdvisory({
    plan:
      sweepPlan,

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
  sweep.batch_count,
  5,
);

assert.equal(
  sweep.total_quantity,
  50500,
);

assert.equal(
  sweep.remaining_quantity,
  132,
);

assert.deepEqual(
  sweep.batches,
  [
    [
      {
        category: "A",
        code: "01",
        quantity: 5000,
        required_total: 12632,
      },
      {
        category: "A",
        code: "02",
        quantity: 5000,
        required_total: 17000,
      },
      {
        category: "B",
        code: "03",
        quantity: 5000,
        required_total: 21000,
      },
    ],

    [
      {
        category: "A",
        code: "01",
        quantity: 5000,
        required_total: 12632,
      },
      {
        category: "A",
        code: "02",
        quantity: 5000,
        required_total: 17000,
      },
      {
        category: "B",
        code: "03",
        quantity: 5000,
        required_total: 21000,
      },
    ],

    [
      {
        category: "A",
        code: "01",
        quantity: 2500,
        required_total: 12632,
      },
      {
        category: "A",
        code: "02",
        quantity: 5000,
        required_total: 17000,
      },
      {
        category: "B",
        code: "03",
        quantity: 5000,
        required_total: 21000,
      },
    ],

    [
      {
        category: "A",
        code: "02",
        quantity: 2000,
        required_total: 17000,
      },
      {
        category: "B",
        code: "03",
        quantity: 5000,
        required_total: 21000,
      },
    ],

    [
      {
        category: "B",
        code: "03",
        quantity: 1000,
        required_total: 21000,
      },
    ],
  ],
);

assert.ok(
  sweep.rows.every(
    row =>
      row.quantity >= 500
      && row.quantity <= 5000
      && row.quantity % 500 === 0,
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



const previewSweepPlan = {
  A: {
    recommendations: [
      {
        code: "79",
        retained_before: 12019,
        retention_limit: 5564,
        recommended_transfer: 6455,
      },
      {
        code: "98",
        retained_before: 14264,
        retention_limit: 5564,
        recommended_transfer: 8700,
      },
    ],
  },

  B: {
    recommendations: [
      {
        code: "98",
        retained_before: 16391,
        retention_limit: 5191,
        recommended_transfer: 11200,
      },
    ],
  },
};


const previewSweepBatches =
  runtime
    .abPreviewSweepBatches(
      previewSweepPlan,
    );

assert.equal(
  previewSweepBatches.length,
  3,
);

assert.deepEqual(
  Array.from(
    previewSweepBatches,
    batch =>
      Array.from(
        batch,
        row => ({
          category:
            row.category,

          code:
            row.code,

          quantity:
            row.quantity,
        }),
      ),
  ),
  [
    [
      {
        category: "A",
        code: "79",
        quantity: 5000,
      },
      {
        category: "A",
        code: "98",
        quantity: 5000,
      },
      {
        category: "B",
        code: "98",
        quantity: 5000,
      },
    ],

    [
      {
        category: "A",
        code: "79",
        quantity: 1000,
      },
      {
        category: "A",
        code: "98",
        quantity: 3500,
      },
      {
        category: "B",
        code: "98",
        quantity: 5000,
      },
    ],

    [
      {
        category: "B",
        code: "98",
        quantity: 1000,
      },
    ],
  ],
);

assert.ok(
  previewSweepBatches
    .flat()
    .every(
      row =>
        row.quantity >= 500
        && row.quantity <= 5000
        && row.quantity % 500 === 0,
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
          ...previewSweepPlan,

          gross_received:
            200000,

          adjusted_received:
            150000,

          transfer_required_total:
            26355,
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
  sweepMessages.sweep,
  true,
);

assert.equal(
  sweepMessages.copyBatches.length,
  3,
);

assert.equal(
  sweepMessages
    .batchRows
    .reduce(
      (sum, row) =>
        sum + row.quantity,
      0,
    ),
  25500,
);

assert.match(
  sweepMessages.bubble1,
  /ต้องส่งออกทั้งหมด 26,355/,
);

assert.match(
  sweepMessages.bubble1,
  /ส่งออกรอบนี้ 25,500/,
);

assert.match(
  sweepMessages.bubble1,
  /เหลือรอส่งออก 855/,
);

assert.equal(
  sweepMessages.copyBatches[0].text,
  [
    "บ",
    "79=5000",
    "",
    "บล",
    "98=5000x5000",
  ].join("\n"),
);

assert.equal(
  sweepMessages.copyBatches[1].text,
  [
    "บ",
    "79=1000",
    "",
    "บล",
    "98=3500x5000",
  ].join("\n"),
);

assert.equal(
  sweepMessages.copyBatches[2].text,
  [
    "ล",
    "98=1000",
  ].join("\n"),
);

assert.doesNotMatch(
  sweepMessages.bubble2,
  /\bA\d{2}\b|\bB\d{2}\b/,
);

assert.match(
  preview,
  /data-batch-index=/,
);

assert.match(
  preview,
  /Copy ชุด/,
);


const requestedFormatRows = [
  {
    category: "A",
    code: "79",
    quantity: 5000,
    retained_before: 20000,
    recommended_transfer: 5000,
  },
  {
    category: "A",
    code: "52",
    quantity: 5000,
    retained_before: 19000,
    recommended_transfer: 5000,
  },
  {
    category: "B",
    code: "57",
    quantity: 2500,
    retained_before: 18000,
    recommended_transfer: 2500,
  },
  {
    category: "B",
    code: "75",
    quantity: 2500,
    retained_before: 17000,
    recommended_transfer: 2500,
  },
  {
    category: "A",
    code: "98",
    quantity: 5000,
    retained_before: 16000,
    recommended_transfer: 5000,
  },
  {
    category: "B",
    code: "98",
    quantity: 5000,
    retained_before: 15000,
    recommended_transfer: 5000,
  },
  {
    category: "A",
    code: "82",
    quantity: 5000,
    retained_before: 14000,
    recommended_transfer: 5000,
  },
  {
    category: "B",
    code: "82",
    quantity: 2000,
    retained_before: 13000,
    recommended_transfer: 2000,
  },
];


const requestedFormat =
  runtime
    .abPreviewSweepOperationalText(
      requestedFormatRows,
    );

assert.equal(
  requestedFormat,
  [
    "บ",
    "79=5000",
    "52=5000",
    "",
    "ล",
    "57=2500",
    "75=2500",
    "",
    "บล",
    "98=5000x5000",
    "82=5000x2000",
  ].join("\n"),
);

assert.doesNotMatch(
  requestedFormat,
  /A79|A52|B57|B75|A98|B98/,
);


console.log(
  "PASS: fixed 500-step calculation 500..5000",
);

console.log(
  "PASS: AUTO floors to 500 and caps A/B code at 5000",
);

console.log(
  "PASS: SWEEP floors to 500, caps each code at 5000 per batch and carries overflow",
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
