import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(
  new URL("./public/index.html", import.meta.url),
  "utf8",
);

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8",
);

const css = fs.readFileSync(
  new URL("./public/styles.css", import.meta.url),
  "utf8",
);


// =========================================================
// 1. Operational navigation keeps all existing routes.
// =========================================================

for (const tab of [
  "summary",
  "allocation",
  "review",
  "report",
  "postcut",
  "points",
  "unsend",
  "settings",
]) {
  assert.match(
    html,
    new RegExp(`data-tab="${tab}"`),
  );
}

assert.match(
  html,
  /class="tabs operational-tabs"/,
);

assert.match(
  html,
  /ศูนย์ควบคุมออเดอร์/,
);


// =========================================================
// 2. Critical operational IDs remain exactly once.
// =========================================================

for (const id of [
  "allocationLineGroupSelect",
  "bulkDistributionControls",
  "warehouseChoices",
  "bulkDistributionSummary",
  "runBulkDistributionButton",
  "transferPreview",
  "allocationBoard",
  "allocationHistoryList",
  "reloadAllocationHistoryButton",
]) {
  assert.equal(
    (
      html.match(
        new RegExp(`id="${id}"`, "g"),
      ) || []
    ).length,
    1,
    `${id} must exist exactly once`,
  );
}


// =========================================================
// 3. Allocation is presented as operational workspace.
// =========================================================

assert.match(
  html,
  /allocation-workspace/,
);

assert.match(
  html,
  /allocation-control-panel/,
);

assert.match(
  html,
  /allocation-main/,
);

assert.match(
  html,
  /allocation-history-section/,
);

// History is always visible; no collapsed legacy details shell.
assert.doesNotMatch(
  html,
  /<details class="allocation-history-details"/,
);


// =========================================================
// 4. Headline metrics prefer LINE Group risk read model.
// =========================================================

const metricsStart =
  app.indexOf("function renderMetrics(metrics)");

const groupNameStart =
  app.indexOf(
    "function groupName",
    metricsStart,
  );

assert.ok(
  metricsStart >= 0
  && groupNameStart > metricsStart,
);

const metrics =
  app.slice(
    metricsStart,
    groupNameStart,
  );

assert.match(
  metrics,
  /line_group_risk/,
);

assert.match(
  metrics,
  /recommended_cut_total/,
);

assert.match(
  metrics,
  /confirmed_cut_total/,
);

assert.match(
  metrics,
  /retained_total/,
);

assert.match(
  metrics,
  /"ต้องตัด"/,
);

assert.match(
  metrics,
  /"ตัดแล้ว"/,
);

assert.match(
  metrics,
  /"คงเหลือ"/,
);

assert.match(
  metrics,
  /reviewBadge/,
);


// =========================================================
// 5. Allocation snapshot uses exact LINE Group state.
// =========================================================

assert.match(
  app,
  /line-group-risk-hero/,
);

assert.match(
  app,
  /risk\.gross_received/,
);

assert.match(
  app,
  /risk\.calculation_band/,
);

assert.match(
  app,
  /risk\.risk_budget/,
);

assert.match(
  app,
  /risk\.recommended_cut_total/,
);

assert.match(
  app,
  /risk\.confirmed_cut_total/,
);

assert.match(
  app,
  /risk\.retained_total/,
);


// =========================================================
// 6. Allocation history exposes persisted attribution.
// =========================================================

assert.match(
  app,
  /function allocationHistoryLineGroupLabel/,
);

assert.match(
  app,
  /item\.line_group_id/,
);

assert.match(
  app,
  /item\.risk_model/,
);

assert.match(
  app,
  /row\.retention_limit/,
);

assert.match(
  app,
  /row\.effective_multiplier/,
);

assert.match(
  app,
  /LINE Group Retention/,
);


// =========================================================
// 7. Operational CSS contract.
// =========================================================

for (const className of [
  "operational-tabs",
  "line-group-risk-hero",
  "allocation-workspace",
  "allocation-control-panel",
  "allocation-history-section",
  "operational-history-card",
]) {
  assert.match(
    css,
    new RegExp(`\\.${className}`),
  );
}


// =========================================================
// 8. Existing v3 write safety remains present.
// =========================================================

assert.match(
  app,
  /LINE_GROUP_CATEGORY_RETENTION/,
);

assert.match(
  app,
  /confirmation_token_version/,
);

assert.match(
  app,
  /confirmation_token:\s*preview\.confirmation_token/,
);

console.log(
  "PASS: operational UI v8.9.4"
);
