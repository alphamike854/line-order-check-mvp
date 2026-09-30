import assert from "node:assert/strict";
import fs from "node:fs";

const report =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

function sliceBetween(
  source,
  start,
  end,
) {
  const startIndex =
    source.indexOf(start);

  const endIndex =
    source.indexOf(
      end,
      startIndex + start.length,
    );

  assert.ok(
    startIndex >= 0
      && endIndex > startIndex,
    `cannot isolate ${start}`,
  );

  return source.slice(
    startIndex,
    endIndex,
  );
}

console.log(
  "===== Staff Review + Report Access v1 =====",
);

assert.match(
  report,
  /authenticateWorkbenchActor/,
);
console.log(
  "PASS SRA-01: Report authenticates authoritative actor",
);

assert.match(
  report,
  /loadActorSessionLineGroupIds/,
);
console.log(
  "PASS SRA-02: Staff Report resolves session assignment scope",
);

assert.doesNotMatch(
  report,
  /requireDashboardAccess/,
);
console.log(
  "PASS SRA-03: Report is no longer Dashboard-key-only",
);

assert.match(
  report,
  /auth\.actor\?\.kind === "STAFF"/,
);
console.log(
  "PASS SRA-04: Staff mode derives from server actor",
);

assert.match(
  report,
  /MESSAGE_OUTSIDE_STAFF_SCOPE/,
);
assert.match(
  report,
  /MESSAGE_OUTSIDE_STAFF_SCOPE[\s\S]*?403/,
);
console.log(
  "PASS SRA-05: out-of-scope Staff Report fails 403",
);

assert.match(
  report,
  /\.in\(\s*"line_group_id",\s*staffLineGroupIds,\s*\)/,
);
console.log(
  "PASS SRA-06: Staff ALL is constrained to assigned LINE Groups",
);

assert.match(
  report,
  /selectedLine[\s\S]*?!staffLineGroupIds\.includes\(\s*selectedLine/,
);
console.log(
  "PASS SRA-07: explicit unassigned LINE Group is rejected",
);

const shell =
  sliceBetween(
    app,
    "function configureAppForAuthMode(",
    "function selectTabUi(",
  );

assert.match(
  shell,
  /!== "review"[\s\S]*?!== "report"/,
);
console.log(
  "PASS SRA-08: Staff shell exposes Review + Report only",
);

const staffEntry =
  sliceBetween(
    app,
    "async function enterStaffSession(",
    "async function enterDashboardSession(",
  );

assert.match(
  staffEntry,
  /configureStaffReportScope\(\s*auth\.lineGroups \|\| \[\]/,
);
assert.doesNotMatch(
  staffEntry,
  /\/api\/dashboard/,
);
console.log(
  "PASS SRA-09: Staff Report scope comes from staff-me without Dashboard bootstrap",
);

const activateTab =
  sliceBetween(
    app,
    "function activateTab(",
    'loginForm.addEventListener("submit"',
  );

assert.match(
  activateTab,
  /name !== "review"[\s\S]*?name !== "report"/,
);
console.log(
  "PASS SRA-10: Staff cannot activate other Dashboard tabs",
);

const loadReport =
  sliceBetween(
    app,
    "async function loadReport(",
    "function bindV5Controls(",
  );

assert.match(
  loadReport,
  /!sessionId[\s\S]*?state\.authMode!=="STAFF"/,
);
assert.match(
  loadReport,
  /\/api\/accounting-report\?group=/,
);
console.log(
  "PASS SRA-11: Staff Report can resolve current session server-side",
);

assert.match(
  loadReport,
  /state\.authMode==="STAFF"[\s\S]*?\.edit-report-points/,
);
console.log(
  "PASS SRA-12: Staff Report removes Point mutation control",
);

assert.match(
  app,
  /async function openReportMessageInReview\(/,
);
console.log(
  "PASS SRA-13: existing Report -> Review bridge remains present",
);

assert.match(
  app,
  /x-staff-key/,
);
assert.match(
  app,
  /headers\.delete\(\s*"x-dashboard-key"/,
);
console.log(
  "PASS SRA-14: Staff requests retain independent Staff credential",
);

console.log(
  "PASS: Staff Review + Report Access v1",
);
