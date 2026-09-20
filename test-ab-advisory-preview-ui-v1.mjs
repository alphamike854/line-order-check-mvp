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
    "20=500x500",
    "40=500x500",
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
  /ยอดต้องตัดทั้งหมด/
);

assert.match(
  preview,
  /ยอดตัดรอบนี้/
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
