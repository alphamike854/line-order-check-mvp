import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8"
  );

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8"
  );

const styles =
  fs.readFileSync(
    "public/styles.css",
    "utf8"
  );

const preview =
  fs.readFileSync(
    "public/ab-advisory-preview.js",
    "utf8"
  );

/*
 * HTML contract.
 */
assert.match(
  html,
  /id="abAdvisoryPreview"/
);

assert.match(
  html,
  /id="abAdvisoryBatchSelect"/
);

assert.match(
  html,
  /value="500"/
);

assert.match(
  html,
  /value="1000"/
);

assert.match(
  html,
  /value="2000"/
);

assert.match(
  html,
  /ข้อเสนอเท่านั้น/
);

const previewScriptPos =
  html.indexOf(
    "ab-advisory-preview.js"
  );

const appScriptPos =
  html.indexOf(
    "app.js"
  );

assert.ok(
  previewScriptPos >= 0
  && appScriptPos >= 0
  && previewScriptPos
    < appScriptPos,
  "preview helper must load before app.js"
);

/*
 * app.js integration only.
 */
assert.match(
  app,
  /renderAbAdvisoryPreview\(\{/
);

assert.match(
  app,
  /dashboard:\s*state\.dashboard/
);

assert.match(
  app,
  /selectedSummaryGroup:[\s\S]*summaryGroupSelect\.value/
);

assert.match(
  app,
  /bindAbAdvisoryPreviewControls\(\{/
);

assert.match(
  app,
  /dashboard:\s*state\.dashboard/
);

assert.match(
  app,
  /selectedSummaryGroup:[\s\S]*summaryGroupSelect\.value/
);

assert.match(
  app,
  /getDashboard:\s*\(\)\s*=>[\s\S]*state\.dashboard/
);

assert.doesNotMatch(
  preview,
  /state\.dashboard/
);

assert.doesNotMatch(
  preview,
  /summaryGroupSelect/
);

assert.doesNotMatch(
  preview,
  /\btoast\s*\(/
);

/*
 * Preview must remain read-only.
 */
assert.doesNotMatch(
  preview,
  /\bfetch\s*\(/
);

assert.doesNotMatch(
  preview,
  /\bapi\s*\(/
);

assert.doesNotMatch(
  preview,
  /LINE_PUSH/
);

assert.doesNotMatch(
  preview,
  /risk-distribution-confirm/
);

assert.doesNotMatch(
  preview,
  /confirm-transfer/
);

/*
 * Copy is the only operator action.
 */
assert.match(
  preview,
  /navigator\.clipboard/
);

assert.match(
  preview,
  /ab-advisory-copy-button/
);

/*
 * Load pure helper functions in VM.
 */
const context = {
  Intl,
  Map,
  Number,
  String,
  Math,
  Date,
};

vm.createContext(context);
vm.runInContext(
  preview,
  context
);

const plan = {
  A: {
    recommendations: [
      {
        code: "04",
        recommended_transfer: 499,
      },
      {
        code: "20",
        recommended_transfer: 500,
      },
      {
        code: "40",
        recommended_transfer: 3824,
      },
    ],
  },

  B: {
    recommendations: [
      {
        code: "08",
        recommended_transfer: 500,
      },
      {
        code: "20",
        recommended_transfer: 700,
      },
      {
        code: "40",
        recommended_transfer: 2627,
      },
    ],
  },
};

const rows =
  context.abPreviewBatchRows(
    plan,
    500
  );

assert.equal(
  rows.length,
  5
);

assert.ok(
  rows.every(
    row => row.quantity === 500
  )
);

assert.equal(
  rows.some(
    row =>
      row.category === "A"
      && row.code === "04"
  ),
  false
);

const text =
  context.abPreviewOperationalText(
    rows
  );

assert.equal(
  text,
  [
    "ล",
    "08=500",
    "",
    "บล",
    "20 40=500x500",
  ].join("\n")
);

/*
 * 1000 round must not leak 500 residuals.
 */
const rows1000 =
  context.abPreviewBatchRows(
    plan,
    1000
  );

assert.ok(
  rows1000.every(
    row => row.quantity === 1000
  )
);

assert.equal(
  rows1000.length,
  2
);

/*
 * CSS contract.
 */
assert.match(
  styles,
  /\.ab-advisory-preview-panel/
);

assert.match(
  styles,
  /\.ab-advisory-bubbles/
);

console.log(
  "PASS: A/B Advisory Preview UI shell"
);

console.log(
  "PASS: 500/1000/2000 strict batch UI"
);

console.log(
  "PASS: บ / ล / บล formatting"
);

console.log(
  "PASS: copy-only operator action"
);

console.log(
  "PASS: no API / LINE / cut mutation in preview"
);

assert.match(
  preview,
  /function abPreviewTotalRequired\(/
);

assert.match(
  preview,
  /plan\?\.\[category\]/
);

assert.match(
  preview,
  /row\.recommended_transfer/
);

assert.match(
  preview,
  /function abPreviewBatchTotal\(/
);

assert.match(
  preview,
  /row\.quantity/
);

assert.match(
  preview,
  /ต้องส่งออกทั้งหมด/
);

assert.match(
  preview,
  /ส่งออกรอบนี้/
);

console.log(
  "PASS: total required + selected batch total copy"
);

const authoritativeTotalHelperStart =
  preview.indexOf(
    "function abPreviewTotalRequired("
  );

const authoritativeTotalHelperEnd =
  preview.indexOf(
    "function abPreviewBatchTotal(",
    authoritativeTotalHelperStart
  );

assert.ok(
  authoritativeTotalHelperStart >= 0
    && authoritativeTotalHelperEnd
      > authoritativeTotalHelperStart
);

const authoritativeTotalHelper =
  preview.slice(
    authoritativeTotalHelperStart,
    authoritativeTotalHelperEnd
  );

assert.match(
  authoritativeTotalHelper,
  /plan\?\.transfer_required_total/
);

assert.doesNotMatch(
  authoritativeTotalHelper,
  /recommendations|recommended_transfer/
);

console.log(
  "PASS: Bubble 1 total uses authoritative plan transfer total"
);

// ============================================================
// A/B Advisory Preview V2
// ============================================================

assert.match(
  html,
  /id="abAdvisoryTemplateSelect"/
);

assert.match(
  html,
  /value="A">แบบ A/
);

assert.match(
  html,
  /value="B">แบบ B/
);

assert.match(
  html,
  /value="C">แบบ C/
);

assert.match(
  styles,
  /\.ab-advisory-preview-controls/
);

assert.match(
  preview,
  /function abPreviewOrderCodes\(/
);

assert.match(
  preview,
  /function abPreviewAuditText\(/
);

assert.match(
  preview,
  /function abPreviewTemplate\(/
);

assert.match(
  preview,
  /templateSelect\.addEventListener\(\s*"change"/
);

assert.doesNotMatch(
  preview,
  /\bMath\.random\s*\(/
);

assert.doesNotMatch(
  preview,
  /\bspin\b/i
);


// ------------------------------------------------------------
// Execute presentation helpers directly.
// ------------------------------------------------------------

const {
  runInNewContext,
} =
  await import(
    "node:vm"
  );

const v2Runtime = {};

runInNewContext(
  preview,
  v2Runtime
);


const normalizedArray =
  value =>
    Array.from(value);


// ------------------------------------------------------------
// Reverse-pair ordering.
// ------------------------------------------------------------

assert.deepEqual(
  normalizedArray(
    v2Runtime
      .abPreviewOrderCodes(
        [
          "40",
          "04",
          "83",
          "38",
          "44",
          "60",
          "06",
        ]
      )
  ),
  [
    "04",
    "40",
    "06",
    "60",
    "38",
    "83",
    "44",
  ]
);

assert.deepEqual(
  normalizedArray(
    v2Runtime
      .abPreviewOrderCodes(
        [
          "40",
          "06",
          "44",
          "83",
        ]
      )
  ),
  [
    "06",
    "40",
    "44",
    "83",
  ],
  "missing reverse codes must never be manufactured"
);

assert.deepEqual(
  normalizedArray(
    v2Runtime
      .abPreviewOrderCodes(
        [
          "21",
          "12",
          "03",
          "30",
          "11",
          "99",
        ]
      )
  ),
  [
    "03",
    "30",
    "11",
    "12",
    "21",
    "99",
  ]
);


// ------------------------------------------------------------
// Presentation fixture.
// ------------------------------------------------------------

const v2Rows = [
  {
    category: "A",
    code: "40",
    quantity: 500,
    retained_before: 7850,
    retention_limit: 6549,
    recommended_transfer: 1301,
  },
  {
    category: "A",
    code: "04",
    quantity: 500,
    retained_before: 8100,
    retention_limit: 6549,
    recommended_transfer: 1551,
  },
  {
    category: "A",
    code: "60",
    quantity: 500,
    retained_before: 7020,
    retention_limit: 6549,
    recommended_transfer: 471,
  },
  {
    category: "A",
    code: "06",
    quantity: 500,
    retained_before: 7300,
    retention_limit: 6549,
    recommended_transfer: 751,
  },

  {
    category: "B",
    code: "43",
    quantity: 500,
    retained_before: 7500,
    retention_limit: 6336,
    recommended_transfer: 1164,
  },
  {
    category: "B",
    code: "34",
    quantity: 500,
    retained_before: 7900,
    retention_limit: 6336,
    recommended_transfer: 1564,
  },
  {
    category: "B",
    code: "83",
    quantity: 500,
    retained_before: 6800,
    retention_limit: 6336,
    recommended_transfer: 464,
  },
  {
    category: "B",
    code: "38",
    quantity: 500,
    retained_before: 7100,
    retention_limit: 6336,
    recommended_transfer: 764,
  },
  {
    category: "B",
    code: "44",
    quantity: 500,
    retained_before: 6600,
    retention_limit: 6336,
    recommended_transfer: 264,
  },

  {
    category: "A",
    code: "39",
    quantity: 500,
    retained_before: 7900,
    retention_limit: 6549,
    recommended_transfer: 1351,
  },
  {
    category: "B",
    code: "39",
    quantity: 500,
    retained_before: 7100,
    retention_limit: 6336,
    recommended_transfer: 764,
  },

  {
    category: "A",
    code: "93",
    quantity: 500,
    retained_before: 7000,
    retention_limit: 6549,
    recommended_transfer: 451,
  },
  {
    category: "B",
    code: "93",
    quantity: 500,
    retained_before: 6900,
    retention_limit: 6336,
    recommended_transfer: 564,
  },
];

assert.equal(
  v2Runtime
    .abPreviewOperationalText(
      v2Rows,
      "A"
    ),
  [
    "บ",
    "04 40 06 60=500",
    "",
    "ล",
    "34 43 38 83 44=500",
    "",
    "บล",
    "39 93=500x500",
  ].join("\n")
);

assert.equal(
  v2Runtime
    .abPreviewOperationalText(
      v2Rows,
      "B"
    ),
  [
    "บ =500",
    "04 40 06 60",
    "",
    "ล =500",
    "34 43 38 83 44",
    "",
    "บล =500x500",
    "39 93",
  ].join("\n")
);

assert.equal(
  v2Runtime
    .abPreviewOperationalText(
      v2Rows,
      "C"
    ),
  [
    "บ",
    "04",
    "40",
    "06",
    "60=500",
    "",
    "ล",
    "34",
    "43",
    "38",
    "83",
    "44=500",
    "",
    "บล",
    "39",
    "93=500x500",
  ].join("\n")
);


// ------------------------------------------------------------
// Bubble 1 audit.
// ------------------------------------------------------------

const v2Audit =
  v2Runtime
    .abPreviewAuditText(
      v2Rows
    );

assert.ok(
  v2Audit.includes(
    "04 8,100 | เกิน 1,551"
  )
);

assert.ok(
  v2Audit.includes(
    "40 7,850 | เกิน 1,301"
  )
);

assert.ok(
  v2Audit.indexOf(
    "04 8,100"
  )
  <
  v2Audit.indexOf(
    "40 7,850"
  ),
  "Bubble 1 A codes must sort retained high -> low"
);

assert.ok(
  v2Audit.includes(
    "39 บ 7,900 เกิน 1,351 | ล 7,100 เกิน 764"
  )
);


console.log(
  "PASS: A/B Advisory Preview V2 audit + deterministic templates"
);


// Bubble V3 presentation contract.
{
  const {
    default: assertBubbleV3,
  } =
    await import(
      "node:assert/strict"
    );

  const {
    readFileSync:
      readBubbleV3Source,
  } =
    await import(
      "node:fs"
    );

  const bubbleV3Source =
    readBubbleV3Source(
      new URL(
        "./public/ab-advisory-preview.js",
        import.meta.url
      ),
      "utf8"
    );

  for (
    const required of [
      "ยอดรวม",
      "ยอดสุทธิ",
      "ต้องส่งออกทั้งหมด",
      "ส่งออกรอบนี้",
      "เหลือรอส่งออก",
      "remainingRequired",
      "รหัส · เพดาน",
      "recommended_transfer",
      "v3: true",
    ]
  ) {
    assertBubbleV3.ok(
      bubbleV3Source.includes(
        required
      ),
      `Bubble V3 marker missing: ${required}`
    );
  }

  for (
    const stale of [
      '"เพดาน/รหัส"',
      "`ยอดหลังหัก ${",
      "`ยอดต้องตัดทั้งหมด ${",
      "`ยอดตัดรอบนี้ ${",
    ]
  ) {
    assertBubbleV3.ok(
      !bubbleV3Source.includes(
        stale
      ),
      `stale Bubble V2 UI marker remains: ${stale}`
    );
  }

  assertBubbleV3.match(
    bubbleV3Source,
    /remainingRequired\s*=\s*Math\.max\(\s*0,\s*totalRequired\s*-\s*batchTotal/s,
    "remaining export must derive from authoritative total minus current batch"
  );

  assertBubbleV3.match(
    bubbleV3Source,
    /abPreviewAuditText\(\s*rows,\s*\{\s*plan,\s*v3:\s*true,/s,
    "Bubble 1 must render stable V3 audit presentation"
  );

  assertBubbleV3.match(
    bubbleV3Source,
    /`บ · \$\{abPreviewFormat\(a\.length\)\} รหัส · เพดาน \$\{capA\}`/,
    "A-only section must show count and A cap"
  );

  assertBubbleV3.match(
    bubbleV3Source,
    /`ล · \$\{abPreviewFormat\(b\.length\)\} รหัส · เพดาน \$\{capB\}`/,
    "B-only section must show count and B cap"
  );

  assertBubbleV3.match(
    bubbleV3Source,
    /`บล · \$\{abPreviewFormat\(ab\.length\)\} รหัส · เพดาน บ \$\{capA\} \/ ล \$\{capB\}`/,
    "AB section must show both caps"
  );

  console.log(
    "PASS: A/B Advisory Preview V3 Bubble 1 presentation contract"
  );
}
