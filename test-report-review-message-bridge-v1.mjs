import assert from "node:assert/strict";
import fs from "node:fs";

const api =
  fs.readFileSync(
    "netlify/functions/accounting-report.mjs",
    "utf8",
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

console.log(
  "===== Report -> Exact Review Message Bridge v1 =====",
);

assert.match(
  api,
  /message_record_id:\s*message\.id/,
);

assert.match(
  api,
  /summary_quantity:\s*qty/,
);

console.log(
  "PASS RR1-01: ledger carries exact source-message identity",
);

assert.match(
  app,
  /class="button ghost small report-review-message"/,
);

assert.match(
  app,
  />ตรวจรายการนี้<\/button>/,
);

console.log(
  "PASS RR1-02: report row exposes Review navigation",
);

const start =
  app.indexOf(
    "async function openReportMessageInReview(",
  );

const end =
  app.indexOf(
    "function bindReportReviewMessageBridge(",
    start,
  );

assert.ok(
  start >= 0
  && end > start,
);

const bridge =
  app.slice(start, end);

assert.match(
  bridge,
  /selectTabUi\("review"\)/,
);

assert.match(
  bridge,
  /await loadReviews\(\)/,
);

assert.doesNotMatch(
  bridge,
  /^\s*activateTab\(\s*"review"\s*\)\s*;?/m,
);

console.log(
  "PASS RR1-03: bridge avoids asynchronous activateTab race",
);

const reportSessionGuard =
  bridge.indexOf(
    "const reportSessionId =",
  );

const reviewNavigation =
  bridge.indexOf(
    'selectTabUi("review")',
  );

assert.ok(
  reportSessionGuard >= 0,
  "Report bridge must resolve selected Report settlement",
);

assert.ok(
  reviewNavigation > reportSessionGuard,
  "historical-session guard must run before Review navigation",
);

assert.match(
  bridge,
  /state\.settlement[\s\S]*?\.open_session[\s\S]*?\.id/,
);

assert.match(
  bridge,
  /reportSessionId[\s\S]*?!==\s*currentOpenSessionId/,
);

assert.match(
  bridge,
  /รายงานย้อนหลัง/,
);

console.log(
  "PASS RR1-03A: historical settlement fails closed before Review mutation workflow",
);


assert.match(
  bridge,
  /_verificationPagination[\s\S]*has_more/,
);

assert.match(
  bridge,
  /await loadMoreStaffVerificationTimeline\(/,
);

assert.match(
  bridge,
  /pageGuard < 20/,
);

console.log(
  "PASS RR1-04: earlier Timeline pages remain reachable",
);

assert.match(
  bridge,
  /_verificationTimelineFilters[\s\S]*clear\(\)/,
);

assert.match(
  bridge,
  /selectStaffVerificationWorkbenchItem\(/,
);

assert.match(
  bridge,
  /scrollIntoView\(/,
);

console.log(
  "PASS RR1-05: existing exact-message selection is reused",
);

assert.doesNotMatch(
  bridge,
  /method:\s*["'](?:POST|PATCH|DELETE)["']/,
);

console.log(
  "PASS RR1-06: Report bridge introduces no mutation",
);

const csvStart =
  app.indexOf(
    "function buildDailyReportCsv(",
  );

const csvEnd =
  app.indexOf(
    "function exportDailyReportCsv(",
    csvStart,
  );

assert.ok(
  csvStart >= 0
  && csvEnd > csvStart,
);

assert.doesNotMatch(
  app.slice(csvStart, csvEnd),
  /message_record_id/,
);

console.log(
  "PASS RR1-07: internal UUID is not exported to CSV",
);

console.log(
  "PASS: Report -> Exact Review Message Bridge v1",
);
