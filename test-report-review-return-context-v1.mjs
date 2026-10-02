import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );

console.log(
  "===== Report Return Context v1 =====",
);

const helperStart =
  app.indexOf(
    "let reportReturnContext = null;",
  );

const bridgeStart =
  app.indexOf(
    "async function openReportMessageInReview(",
  );

assert.ok(
  helperStart >= 0
  && bridgeStart > helperStart,
);

const helpers =
  app.slice(
    helperStart,
    bridgeStart,
  );

assert.match(
  helpers,
  /function captureReportReturnContext\(/,
);

assert.match(
  helpers,
  /payload:\s*state\.reportPayload/,
);

assert.match(
  helpers,
  /messageRecordId/,
);

assert.match(
  helpers,
  /lineGroupId/,
);

assert.match(
  helpers,
  /scrollY:\s*window\.scrollY/,
);

console.log(
  "PASS RRC-01: exact Report context is captured",
);

assert.match(
  helpers,
  /function restoreReportReturnContext\(/,
);

assert.match(
  helpers,
  /reportReturnContext = null;/,
);

const renderIndex =
  helpers.indexOf(
    "renderReport(context.payload);",
  );

const refreshIndex =
  helpers.indexOf(
    "loadReport({\n    silent: true,",
  );

assert.ok(
  renderIndex >= 0,
  "cached Report paint missing",
);

assert.ok(
  refreshIndex > renderIndex,
  "network refresh must follow cached paint",
);

console.log(
  "PASS RRC-02: cached Report paints before reconciliation",
);

assert.match(
  helpers,
  /\.report-review-message\[data-message-record-id\]/,
);

assert.match(
  helpers,
  /el\.dataset\.messageRecordId[\s\S]*?=== context\.messageRecordId/,
);

assert.match(
  helpers,
  /scrollIntoView\(/,
);

assert.match(
  helpers,
  /window\.scrollTo\(/,
);

console.log(
  "PASS RRC-03: exact message row position is restored",
);

const bridgeEnd =
  app.indexOf(
    "function bindReportReviewMessageBridge(",
    bridgeStart,
  );

assert.ok(
  bridgeEnd > bridgeStart,
);

const bridge =
  app.slice(
    bridgeStart,
    bridgeEnd,
  );

const sessionGuard =
  bridge.indexOf(
    "const reportSessionId =",
  );

const capture =
  bridge.indexOf(
    "captureReportReturnContext(",
  );

const reviewNavigation =
  bridge.indexOf(
    'selectTabUi("review")',
  );

assert.ok(
  sessionGuard >= 0,
);

assert.ok(
  capture > sessionGuard,
  "capture must occur after historical guard",
);

assert.ok(
  reviewNavigation > capture,
  "capture must occur before Review navigation",
);

console.log(
  "PASS RRC-04: historical guard remains authoritative",
);

const activateStart =
  app.indexOf(
    "function activateTab(",
  );

const activateEnd =
  app.indexOf(
    'loginForm.addEventListener("submit"',
    activateStart,
  );

assert.ok(
  activateStart >= 0
  && activateEnd > activateStart,
);

const activate =
  app.slice(
    activateStart,
    activateEnd,
  );

assert.match(
  activate,
  /name === "report"[\s\S]*?state\.authMode === "STAFF"[\s\S]*?restoreReportReturnContext\(\)[\s\S]*?return;/,
);

const restoreIndex =
  activate.indexOf(
    "restoreReportReturnContext()",
  );

const settlementIndex =
  activate.indexOf(
    "loadSettlement()",
  );

assert.ok(
  restoreIndex >= 0
  && (
    settlementIndex < 0
    || restoreIndex < settlementIndex
  ),
);

console.log(
  "PASS RRC-05: return path bypasses normal Staff Report reload",
);

assert.match(
  helpers,
  /state\.authMode === "STAFF"[\s\S]*?\.edit-report-points/,
);

console.log(
  "PASS RRC-05A: cached Staff Report remains read-only",
);

assert.match(
  helpers,
  /loadReport\(\{\s*silent:\s*true,\s*\}\)/,
);

assert.match(
  helpers,
  /!state\.reportPayload[\s\S]*?state\.reportPayload\s*=\s*context\.payload/,
);

console.log(
  "PASS RRC-06: silent reconciliation keeps cached fallback",
);

assert.ok(
  pkg.includes(
    "test-report-review-return-context-v1.mjs",
  ),
);

console.log(
  "PASS RRC-07: regression registered",
);

console.log(
  "PASS: Report Return Context v1",
);
