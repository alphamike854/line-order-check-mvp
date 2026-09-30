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
  "===== Report -> Review Exact Item Materialization v2 =====",
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
  "Report -> Review bridge missing",
);

const bridge =
  app.slice(
    start,
    end,
  );

const materializationStart =
  bridge.indexOf(
    "const findTargetTimelineRow = () =>",
  );

assert.ok(
  materializationStart >= 0,
  "Timeline materialization resolver missing",
);

const materialization =
  bridge.slice(
    materializationStart,
  );

assert.match(
  materialization,
  /\.verification-timeline-item\[data-message-record-id\]/,
);

assert.match(
  materialization,
  /row\.dataset\.messageRecordId[\s\S]*?=== targetId/,
);

console.log(
  "PASS RRV2-01: exact navigation resolves real Timeline DOM row",
);

assert.doesNotMatch(
  materialization,
  /_verificationWorkbenchItems[\s\S]*?\.get\(targetId\)/,
);

console.log(
  "PASS RRV2-02: Workbench union presence cannot terminate navigation paging",
);

assert.match(
  materialization,
  /let targetRow\s*=\s*[\s\S]*?findTargetTimelineRow\(\)/,
);

assert.match(
  materialization,
  /while\s*\([\s\S]*?!targetRow[\s\S]*?_verificationPagination[\s\S]*?has_more[\s\S]*?pageGuard < 20/,
);

console.log(
  "PASS RRV2-03: pagination is driven by missing materialized target row",
);

const firstClear =
  materialization.indexOf(
    "._verificationTimelineFilters",
  );

const firstRender =
  materialization.indexOf(
    "staffVerificationRenderTimeline(",
  );

const firstResolve =
  materialization.indexOf(
    "let targetRow =",
  );

assert.ok(
  firstClear >= 0
  && firstRender > firstClear
  && firstResolve > firstRender,
  "filters must clear and Timeline render before first target lookup",
);

console.log(
  "PASS RRV2-04: direct navigation clears filters before target lookup",
);

const loadMore =
  materialization.indexOf(
    "await loadMoreStaffVerificationTimeline(",
  );

const renderAfterMore =
  materialization.indexOf(
    "staffVerificationRenderTimeline(",
    loadMore,
  );

const recheckAfterMore =
  materialization.indexOf(
    "findTargetTimelineRow()",
    renderAfterMore,
  );

assert.ok(
  loadMore >= 0
  && renderAfterMore > loadMore
  && recheckAfterMore > renderAfterMore,
  "each Timeline page load must render and recheck actual target row",
);

console.log(
  "PASS RRV2-05: later Timeline pages are materialized before recheck",
);

const notFound =
  materialization.indexOf(
    'if (!targetRow)',
  );

const select =
  materialization.indexOf(
    "selectStaffVerificationWorkbenchItem(",
  );

const scroll =
  materialization.indexOf(
    "targetRow.scrollIntoView(",
  );

assert.ok(
  notFound >= 0
  && select > notFound
  && scroll > select,
  "selection and scroll must occur only after materialized target exists",
);

assert.match(
  materialization,
  /ไม่พบรายการนี้ในรอบตรวจปัจจุบัน/,
);

console.log(
  "PASS RRV2-06: missing Timeline target fails closed before selection",
);

const navigation =
  bridge.indexOf(
    'selectTabUi("review")',
  );

const loadReviews =
  bridge.indexOf(
    "await loadReviews()",
  );

assert.ok(
  navigation >= 0
  && loadReviews > navigation
  && materializationStart > loadReviews,
  "shared exact navigation must run after authoritative Review load",
);

const sharedMaterialization =
  bridge.slice(
    loadReviews,
  );

assert.doesNotMatch(
  sharedMaterialization,
  /state\.authMode\s*===\s*"(?:STAFF|DASHBOARD)"/,
);

console.log(
  "PASS RRV2-07: exact-item materialization is shared by Admin and Staff",
);

assert.match(
  bridge,
  /state\.reportPayload\?\.session\?\.status === "OPEN"/,
);

assert.match(
  bridge,
  /state\.settlement\?\.open_session\?\.id/,
);

assert.match(
  bridge,
  /reportSessionId[\s\S]*?!==\s*currentOpenSessionId/,
);

console.log(
  "PASS RRV2-08: existing Staff/Dashboard session safety remains intact",
);

assert.match(
  pkg,
  /node test-report-review-exact-item-materialization-v2\.mjs/,
);

console.log(
  "PASS RRV2-09: regression joins full npm suite",
);

console.log(
  "PASS: Report -> Review Exact Item Materialization v2",
);
