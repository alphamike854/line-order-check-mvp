import fs from "node:fs";
import assert from "node:assert/strict";

const special = fs.readFileSync(
  "netlify/functions/special-points.mjs",
  "utf8",
);

const accounting = fs.readFileSync(
  "netlify/functions/accounting-report.mjs",
  "utf8",
);

const dashboard = fs.readFileSync(
  "netlify/functions/dashboard.mjs",
  "utf8",
);

const freshness = fs.readFileSync(
  "netlify/functions/dashboard-freshness.mjs",
  "utf8",
);

const app = fs.readFileSync(
  "public/app.js",
  "utf8",
);

console.log(
  "===== Summary Group Actual Point App Cutover v9.20 =====",
);


// A2A-01
assert.match(
  special,
  /settlement_summary_group_actual_special_point_codes/,
);

assert.match(
  special,
  /session_summary_group_actual_point_status/,
);

assert.match(
  special,
  /replace_settlement_summary_group_actual_special_codes/,
);

assert.match(
  special,
  /body\.summary_group_id/,
);

console.log(
  "PASS A2A-01 Special Point API is Summary-Group scoped",
);


// A2A-02
assert.doesNotMatch(
  special,
  /\.from\("settlement_actual_special_point_codes"\)/,
);

assert.doesNotMatch(
  special,
  /\.from\("session_actual_point_status"\)/,
);

console.log(
  "PASS A2A-02 Special Point API no longer reads legacy source",
);


// A2A-03
assert.match(
  accounting,
  /settlement_summary_group_actual_special_point_codes/,
);

assert.match(
  accounting,
  /session_summary_group_actual_point_status/,
);

assert.match(
  accounting,
  /`\$\{cfg\.summary_group_id\}\|\$\{key\}`/,
);

assert.match(
  accounting,
  /point_specified:pointSpecified/,
);

assert.match(
  accounting,
  /actual_point_status:actualPointStatus/,
);

console.log(
  "PASS A2A-03 Accounting Point calculation cannot leak across Summary Groups",
);


// A2A-04
assert.match(
  dashboard,
  /settlement_summary_group_actual_special_point_codes/,
);

assert.match(
  dashboard,
  /select\("summary_group_id,category,code,created_at"\)/,
);

console.log(
  "PASS A2A-04 Dashboard Actual Point payload carries Summary Group identity",
);


// A2A-05
assert.match(
  freshness,
  /settlement_summary_group_actual_special_point_codes/,
);

assert.match(
  freshness,
  /\$\{r\.summary_group_id\}\|\$\{r\.category\}\$\{r\.code\}@/,
);

console.log(
  "PASS A2A-05 Freshness signature detects group-specific Point changes",
);


// A2A-06
assert.match(
  app,
  /specialPointSummaryGroupId/,
);

assert.match(
  app,
  /summary_group_id:\s*summaryGroupId/,
);

assert.match(
  app,
  /selected_summary_group/,
);

assert.match(
  app,
  /if \(activeTab === "points"\) await loadSpecialPoints\(\)/,
);

console.log(
  "PASS A2A-06 Point editor follows selected Summary Group",
);


// A2A-07
assert.match(
  app,
  /data-summary-group-id=/,
);

assert.match(
  app,
  /editReportPoints\(\s*button\.dataset\.sessionId,\s*button\.dataset\.summaryGroupId/s,
);

assert.match(
  app,
  /g\.actual_point_status\s*\?\.actual_codes_ready/,
);

assert.match(
  app,
  /g\.point_specified/,
);

console.log(
  "PASS A2A-07 Report readiness and Point actions are group-specific",
);


// Keep v7.4 close-later semantics visible.
assert.match(
  app,
  /หลังปิดยังระบุ Point ได้/,
);

assert.match(
  app,
  /pointSpecified\?formatNumber\(g\.special_point_total\):"รอระบุ"/,
);

assert.match(
  app,
  /finalReady\?formatNumber\(g\.reconciliation_total\):"—"/,
);

console.log(
  "PASS A2A-08 close-before-Point reporting semantics preserved",
);


console.log(
  "PASS: Summary Group Actual Point App Cutover v9.20",
);
