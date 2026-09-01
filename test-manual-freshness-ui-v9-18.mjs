import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

console.log(
  "===== Manual Freshness UI v9.18 ====="
);

assert.match(
  app,
  /const FRESHNESS_POLL_MS = 60_000;/,
  "Freshness polling must remain at 60 seconds"
);

const start = app.indexOf(
  "async function checkFreshness()"
);

const end = app.indexOf(
  "function startFreshnessPolling()",
  start
);

assert.ok(
  start >= 0 && end > start,
  "checkFreshness function must exist"
);

const freshness = app.slice(start, end);

assert.match(
  freshness,
  /\/api\/dashboard-freshness/,
  "Freshness polling must continue checking server state"
);

assert.doesNotMatch(
  freshness,
  /await loadDashboard\(/,
  "Freshness polling must not auto-render the dashboard"
);

assert.doesNotMatch(
  freshness,
  /await loadReport\(/,
  "Freshness polling must not auto-render the report"
);

assert.match(
  freshness,
  /activeTab === "review"/,
  "Review workbench must keep its special stable behavior"
);

assert.match(
  freshness,
  /setDashboardStale\(true\)/,
  "Changed data must mark the current dashboard snapshot stale"
);

const dashboardStart = app.indexOf(
  "async function loadDashboard("
);

const dashboardEnd = app.indexOf(
  "function activateTab(",
  dashboardStart
);

assert.ok(
  dashboardStart >= 0 && dashboardEnd > dashboardStart,
  "loadDashboard function must exist"
);

const dashboard = app.slice(
  dashboardStart,
  dashboardEnd
);

assert.match(
  dashboard,
  /setDashboardStale\(false\)/,
  "Manual dashboard refresh must clear stale state"
);

console.log(
  "PASS MF-01 polling still checks freshness"
);
console.log(
  "PASS MF-02 incoming data does not auto-render dashboard"
);
console.log(
  "PASS MF-03 incoming data does not auto-render report"
);
console.log(
  "PASS MF-04 stale safety state remains active"
);
console.log(
  "PASS MF-05 Review workbench remains stable"
);
console.log(
  "PASS: Manual Freshness UI v9.18"
);
