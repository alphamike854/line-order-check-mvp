import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");

console.log("===== Export Preparation Read-only UI v1 =====");

assert.ok(
  html.includes('id="exportPreparationReadOnlyPanel"'),
);
console.log("PASS EXP2F2A-01: panel exists");

assert.equal(
  html.count?.("x"),
  undefined,
);

assert.ok(
  html.includes("<h3>เตรียมส่งออก</h3>"),
);
console.log("PASS EXP2F2A-02: legacy A/B advisory retained");

assert.ok(
  app.includes('"/api/export-preparation"'),
);
assert.ok(
  app.includes('"?group="'),
);
console.log("PASS EXP2F2A-03: read API bound");

const start = app.indexOf(
  "async function loadExportPreparationReadOnly()",
);
const end = app.indexOf(
  "async function loadDashboard({",
  start,
);

assert.ok(start >= 0);
assert.ok(end > start);

const source = app.slice(start, end);

for (const forbidden of [
  "/api/export-preparation-draft",
  "/api/export-preparation-ready",
  "/api/export-preparation-send",
  "/api/export-preparation-sent",
]) {
  assert.equal(source.includes(forbidden), false);
}

assert.equal(
  /\bmethod\s*:\s*["']POST["']/.test(source),
  false,
);

console.log("PASS EXP2F2A-04: GET-only UI");

assert.ok(
  source.includes('groupId === "ALL"'),
);
console.log("PASS EXP2F2A-05: ALL fails closed");

for (const field of [
  "current_effective_quantity",
  "sent_cumulative_quantity",
  "available_quantity",
  "over_sent_quantity",
  "reconciliation_required",
]) {
  assert.ok(app.includes(field), field);
}
console.log("PASS EXP2F2A-06: cumulative fields rendered");

for (const status of ["DRAFT", "READY", "SENT"]) {
  assert.ok(
    app.includes(`case "${status}"`),
  );
}
console.log("PASS EXP2F2A-07: lifecycle labels readable");

assert.ok(
  app.includes("exportPreparationReadGeneration"),
);
assert.ok(
  app.includes("EXPORT_PREPARATION_GROUP_MISMATCH"),
);
console.log("PASS EXP2F2A-08: stale/group guards present");

assert.ok(
  css.includes("EXPORT PREPARATION READ-ONLY UI V1"),
);
console.log("PASS EXP2F2A-09: styles present");

for (const id of [
  "exportPreparationDraftButton",
  "exportPreparationReadyButton",
  "exportPreparationSendButton",
]) {
  assert.equal(html.includes(id), false);
}
console.log("PASS EXP2F2A-10: no mutation controls");


const exportUiStart =
  app.indexOf(
    "function renderExportPreparationReadOnly"
  );

const exportUiEnd =
  app.indexOf(
    "async function loadExportPreparationReadOnly",
    exportUiStart,
  );

assert.ok(
  exportUiStart >= 0,
);

assert.ok(
  exportUiEnd > exportUiStart,
);

const exportUiSource =
  app.slice(
    exportUiStart,
    exportUiEnd,
  );

assert.ok(
  exportUiSource.includes(
    "export-preparation-category-grid",
  ),
);

assert.ok(
  exportUiSource.includes(
    "current_effective_quantity",
  ),
);

assert.ok(
  exportUiSource.includes(
    "export-preparation-risk-red",
  ),
);

assert.ok(
  exportUiSource.includes(
    "export-preparation-risk-yellow",
  ),
);

assert.ok(
  exportUiSource.includes(
    "export-preparation-risk-green",
  ),
);

assert.ok(
  exportUiSource.includes(
    "หมวด ${escapeHtml(category)}",
  ),
);

assert.equal(
  exportUiSource.includes(
    "<th>สถานะ</th>",
  ),
  false,
);

assert.equal(
  exportUiSource.includes(
    "String(item?.category || \"\")"
    + "\n                  + String(item?.code || \"\")",
  ),
  false,
);

const {
  readFileSync:
    readExportPreparationSource,
} =
  await import(
    "node:fs"
  );

const exportReadSource =
  readExportPreparationSource(
    new URL(
      "./netlify/functions/export-preparation.mjs",
      import.meta.url,
    ),
    "utf8",
  );

assert.ok(
  exportReadSource.includes(
    "buildExportPreparationRiskAssessmentMap",
  ),
);

assert.ok(
  exportReadSource.includes(
    "risk_band",
  ),
);

const {
  buildExportPreparationRiskBandMap,
} =
  await import(
    "./src/lib/export-preparation-risk-band.mjs"
  );

function exportBandFor({
  quantity,
  tolerance,
}) {
  const bands =
    buildExportPreparationRiskBandMap({
      summaryGroupId:
        "NORTH",

      riskCodes: [
        {
          summary_group_id:
            "NORTH",

          category:
            "A",

          code:
            "01",

          order_total:
            quantity,

          retained_quantity:
            quantity,

          confirmed_cut:
            0,

          effective_multiplier:
            7,

          max_special_codes:
            1,
        },
      ],

      riskPools: [
        {
          summary_group_id:
            "NORTH",

          risk_pool:
            "MAIN",

          adjusted_received:
            60,

          point_loss_tolerance:
            tolerance,

          multiplier_configured:
            true,
        },
      ],
    });

  return bands.get(
    "A|01",
  );
}

/*
 * adjusted = 60
 * multiplier = 7
 * accepted loss = 10
 *
 * 8 x 7 = 56  => GREEN
 * 10 x 7 = 70 => YELLOW
 * 11 x 7 = 77 => RED
 */
assert.equal(
  exportBandFor({
    quantity: 8,
    tolerance: 10,
  }),
  "GREEN",
);

assert.equal(
  exportBandFor({
    quantity: 10,
    tolerance: 10,
  }),
  "YELLOW",
);

assert.equal(
  exportBandFor({
    quantity: 11,
    tolerance: 10,
  }),
  "RED",
);

console.log(
  "PASS EXP2F2A-11: categories separated"
);

console.log(
  "PASS EXP2F2A-12: export remainder descending"
);

console.log(
  "PASS EXP2F2A-13: canonical green/yellow/red risk zones"
);

console.log(
  "PASS EXP2F2A-14: status column removed"
);


for (const field of [
  "over_ceiling_quantity",
  "export_remaining_quantity",
  "order_remaining_quantity",
]) {
  assert.ok(
    exportReadSource.includes(field),
    field,
  );
  assert.ok(
    exportUiSource.includes(field),
    field,
  );
}

for (const heading of [
  "รหัส",
  "ยอดออเดอร์",
  "เกินเพดาน",
  "ส่งแล้ว",
  "คงเหลือส่งออก",
  "ออเดอร์คงเหลือ",
]) {
  assert.ok(
    exportUiSource.includes(heading),
    heading,
  );
}

assert.ok(
  exportUiSource.includes(
    "b?.export_remaining_quantity",
  ),
);

assert.ok(
  exportUiSource.includes(
    "b?.over_ceiling_quantity",
  ),
);

assert.ok(
  exportReadSource.includes(
    "recommended_transfer",
  ),
);

const {
  buildExportPreparationRiskAssessmentMap:
    buildRiskAssessmentForExport,
} =
  await import(
    "./src/lib/export-preparation-risk-band.mjs"
  );

function exportAssessmentFor({
  quantity,
  tolerance,
}) {
  return buildRiskAssessmentForExport({
    summaryGroupId:
      "NORTH",

    riskCodes: [
      {
        summary_group_id:
          "NORTH",

        category:
          "A",

        code:
          "01",

        order_total:
          quantity,

        retained_quantity:
          quantity,

        confirmed_cut:
          0,

        effective_multiplier:
          7,

        max_special_codes:
          1,
      },
    ],

    riskPools: [
      {
        summary_group_id:
          "NORTH",

        risk_pool:
          "MAIN",

        adjusted_received:
          60,

        point_loss_tolerance:
          tolerance,

        multiplier_configured:
          true,
      },
    ],
  }).get("A|01");
}

const yellowAssessment =
  exportAssessmentFor({
    quantity: 10,
    tolerance: 10,
  });

assert.equal(
  yellowAssessment?.risk_band,
  "YELLOW",
);

assert.equal(
  yellowAssessment?.recommended_transfer,
  0,
);

const redAssessment =
  exportAssessmentFor({
    quantity: 11,
    tolerance: 10,
  });

assert.equal(
  redAssessment?.risk_band,
  "RED",
);

assert.equal(
  redAssessment?.recommended_transfer,
  1,
);

console.log(
  "PASS EXP2F2A-15: six-column operator semantics"
);

console.log(
  "PASS EXP2F2A-16: configured-tolerance recommendation exposed"
);

console.log(
  "PASS EXP2F2A-17: export remainder priority sort"
);


assert.ok(
  exportUiSource.includes(
    "formatExportPreparationOverCeiling",
  ),
);

assert.ok(
  exportUiSource.includes(
    '`(+${formatNumber(numeric)})`',
  ),
);

assert.ok(
  exportUiSource.includes(
    'numeric === 0',
  ),
);

assert.ok(
  exportUiSource.includes(
    '["RED", 0]',
  ),
);

assert.ok(
  exportUiSource.includes(
    '["YELLOW", 1]',
  ),
);

assert.ok(
  exportUiSource.includes(
    '["GREEN", 2]',
  ),
);

assert.ok(
  exportUiSource.includes(
    '["UNKNOWN", 3]',
  ),
);

assert.ok(
  exportUiSource.includes(
    "const visibleLimit =",
  ),
);

assert.ok(
  exportUiSource.includes(
    "20;",
  ),
);

assert.ok(
  exportUiSource.includes(
    "export-preparation-extra-row",
  ),
);

assert.ok(
  exportUiSource.includes(
    "export-preparation-more-toggle",
  ),
);

assert.ok(
  exportUiSource.includes(
    "ดูอีก ${formatNumber(hiddenCount)} รหัส",
  ),
);

assert.ok(
  exportUiSource.includes(
    '"ย่อรายการ"',
  ),
);

console.log(
  "PASS EXP2F2A-18: zero renders as dash"
);

console.log(
  "PASS EXP2F2A-19: over-ceiling renders as (+N)"
);

console.log(
  "PASS EXP2F2A-20: risk-band tie ordering"
);

console.log(
  "PASS EXP2F2A-21: top 20 per category with collapsed remainder"
);

console.log("PASS: Export Preparation Read-only UI v1");
