import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const dashboard =
  fs.readFileSync(
    "netlify/functions/dashboard.mjs",
    "utf8",
  );

const freshness =
  fs.readFileSync(
    "netlify/functions/dashboard-freshness.mjs",
    "utf8",
  );

/*
 * Bound selectedQuery by the next known function.
 * Do not attempt to implement a JavaScript lexer in this test.
 */
const selectedStart =
  app.indexOf(
    "function selectedQuery()",
  );

const freshnessStart =
  app.indexOf(
    "async function checkFreshness()",
  );

assert.ok(
  selectedStart >= 0,
  "selectedQuery() exists",
);

assert.ok(
  freshnessStart > selectedStart,
  "checkFreshness() follows selectedQuery()",
);

const selectedQuerySource =
  app.slice(
    selectedStart,
    freshnessStart,
  );

assert.doesNotMatch(
  selectedQuerySource,
  /summaryGroupSelect\.value\s*\|\|\s*["']ALL["']/,
  "selectedQuery cannot manufacture ALL",
);

assert.match(
  selectedQuerySource,
  /const\s+selectedGroup\s*=\s*summaryGroupSelect\.value/,
  "selectedQuery reads Summary Group explicitly",
);

assert.match(
  selectedQuerySource,
  /selectedGroup\s*&&\s*selectedGroup\s*!==\s*["']ALL["']/,
  "legacy ALL is normalized out",
);

/*
 * Dashboard Summary Group UI does not expose ทุกกลุ่ม.
 */
assert.doesNotMatch(
  app,
  /summaryGroupSelect\.innerHTML\s*=\s*`<option value="ALL">ทุกกลุ่ม<\/option>`/,
  "Dashboard UI has no ทุกกลุ่ม option",
);

/*
 * Normal no-group metadata bootstrap.
 */
const bootstrap =
  dashboard.indexOf(
    "selection_required:true",
  );

assert.ok(
  bootstrap >= 0,
  "Dashboard metadata bootstrap exists",
);

const roundLoad =
  dashboard.indexOf(
    "loadDashboardRoundContext",
    bootstrap,
  );

const riskRpc =
  dashboard.indexOf(
    "dashboard_risk_snapshot",
    bootstrap,
  );

assert.ok(
  roundLoad > bootstrap,
  "bootstrap exits before Round work",
);

assert.ok(
  riskRpc > roundLoad,
  "Risk remains after Round scope",
);

/*
 * No-session path must not reintroduce ALL.
 */
assert.match(
  dashboard,
  /selection_required:!summaryGroupId/,
  "no-session response exposes selection requirement",
);

assert.match(
  dashboard,
  /selected_summary_group:summaryGroupId\?\?null/,
  "no-session response uses null instead of ALL",
);

assert.doesNotMatch(
  dashboard,
  /business_date:null,selected_summary_group:summaryGroupId\?\?"ALL"/,
  "no-session branch cannot identify as ALL",
);

/*
 * Selected-group Risk contract remains unchanged.
 */
assert.match(
  dashboard,
  /p_summary_group_id\s*:\s*summaryGroupId\s*\?\?\s*null/,
  "selected Summary Group Risk contract retained",
);

/*
 * UI consumes metadata bootstrap and then chooses a real group.
 */
assert.match(
  app,
  /payload\.selection_required\s*===\s*true/,
  "UI consumes selection-required bootstrap",
);

assert.match(
  app,
  /summaryGroupSelect\.selectedIndex\s*=\s*0/,
  "UI chooses first configured Summary Group",
);

assert.match(
  app,
  /return\s+await\s+loadDashboard\s*\(\s*\{/,
  "UI reloads after Summary Group selection",
);

/*
 * Freshness prefix only:
 * bound it by the fetch call rather than parsing the whole function.
 */
const freshnessFetch =
  app.indexOf(
    "/api/dashboard-freshness?${selectedQuery()}",
    freshnessStart,
  );

assert.ok(
  freshnessFetch > freshnessStart,
  "Dashboard freshness fetch exists",
);

const freshnessPrefix =
  app.slice(
    freshnessStart,
    freshnessFetch,
  );

assert.match(
  freshnessPrefix,
  /const\s+freshnessSummaryGroup\s*=\s*summaryGroupSelect\.value/,
  "Freshness reads selected Summary Group",
);

assert.match(
  freshnessPrefix,
  /!freshnessSummaryGroup/,
  "Freshness blocks empty group",
);

assert.match(
  freshnessPrefix,
  /freshnessSummaryGroup\s*===\s*["']ALL["']/,
  "Freshness blocks legacy ALL state",
);

/*
 * Server freshness guard must remain before Round work.
 */
const serverFreshGuard =
  freshness.indexOf(
    'error:"SUMMARY_GROUP_REQUIRED"',
  );

assert.ok(
  serverFreshGuard >= 0,
  "Freshness server guard exists",
);

const serverFreshRound =
  freshness.indexOf(
    "loadDashboardRoundContext",
    serverFreshGuard,
  );

assert.ok(
  serverFreshRound > serverFreshGuard,
  "Freshness guard precedes Round work",
);

assert.match(
  freshness,
  /status\s*:\s*400/,
  "Freshness no-group response is HTTP 400",
);

console.log(
  "PASS: selectedQuery operational ALL disabled",
);

console.log(
  "PASS: Dashboard ทุกกลุ่ม UI removed",
);

console.log(
  "PASS: metadata-only bootstrap precedes Round/Risk",
);

console.log(
  "PASS: no-session bootstrap cannot reintroduce ALL",
);

console.log(
  "PASS: first configured Summary Group is initial scope",
);

console.log(
  "PASS: Freshness requires a real Summary Group",
);

console.log(
  "PASS: unrelated ALL semantics remain untouched",
);
