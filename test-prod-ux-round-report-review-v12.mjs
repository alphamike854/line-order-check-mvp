import assert from "node:assert/strict";
import fs from "node:fs";

const app=
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const styles=
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

const packageJson=
  fs.readFileSync(
    "package.json",
    "utf8",
  );

function section(
  text,
  startToken,
  endToken,
) {
  const start=
    text.indexOf(startToken);

  assert.ok(
    start>=0,
    `missing ${startToken}`,
  );

  const end=
    text.indexOf(
      endToken,
      start+startToken.length,
    );

  assert.ok(
    end>start,
    `missing ${endToken}`,
  );

  return text.slice(
    start,
    end,
  );
}

const settlement=
  section(
    app,
    "function renderSettlementStatus(payload)",
    "function focusCurrentSettlement()",
  );

const report=
  section(
    app,
    "function renderReport(payload)",
    "let reportLoadVersion",
  );

const apply=
  section(
    app,
    "async function applyReview(card)",
    "async function ignoreReview(event)",
  );

const ignore=
  section(
    app,
    "async function ignoreReview(event)",
    "// ============================================================\n// C3B-3 Human Verification Correction Browser",
  );

const local=
  section(
    app,
    "function completeReviewResolutionLocally(",
    "const REVIEW_RESOLUTION_CLAIM_CONFLICTS",
  );

assert.match(
  app,
  /function settlementRoundBusinessDates\(/,
);

assert.doesNotMatch(
  settlement,
  /businessDateInput\.value\s*=\s*open\.business_date/,
);

assert.match(
  settlement,
  /settlementSelectedRoundBusinessDate\(\s*payload/,
);

assert.match(
  settlement,
  /currentOpenRoundDateLabel/,
);

for (const label of [
  "สรุปรวมทุกห้อง",
  "ยอดซื้อรวม",
  "ยอดหลังลด %",
  "Point พิเศษ",
  "ยอดคงเหลือ",
]) {
  assert.ok(
    report.includes(label),
    `missing ${label}`,
  );
}

assert.match(
  report,
  /overallByBusinessDate/,
);

assert.match(
  apply,
  /completeReviewResolutionLocally\(\s*card,\s*messageRecordId/,
);

assert.match(
  ignore,
  /completeReviewResolutionLocally\(\s*card,\s*messageRecordId/,
);

assert.doesNotMatch(
  apply,
  /reloadStaffVerificationQueuePreservingPosition\(/,
);

assert.doesNotMatch(
  ignore,
  /reloadStaffVerificationQueuePreservingPosition\(/,
);

for (const token of [
  "_verificationWorkbenchItems",
  "_verificationHighTotalIds",
  "staffVerificationRenderTimeline",
  "selectStaffVerificationWorkbenchItem",
  "card?.remove?.()",
]) {
  assert.ok(
    local.includes(token),
    `local helper missing ${token}`,
  );
}

assert.doesNotMatch(
  local,
  /\bremoveCompletedReviewCard\s*\(|\breleaseReviewClaimAfterCompletion\s*\(/,
);

const styleStart=
  styles.indexOf(
    "/* Production UX Truth + Fast Review v12 */",
  );

assert.ok(
  styleStart>=0,
  "V12 CSS missing",
);

const v12Styles=
  styles.slice(styleStart);

assert.match(
  v12Styles,
  /\.verification-timeline-items[\s\S]*max-height:\s*none\s*!important[\s\S]*overflow:\s*visible\s*!important/,
);

assert.equal(
  styles.endsWith("\n\n"),
  false,
  "styles.css has blank EOF line",
);

assert.ok(
  packageJson.includes(
    "test-prod-ux-round-report-review-v12.mjs",
  ),
);

console.log("PASS UX12-01: operational date uses Round authority");
console.log("PASS UX12-02: current report selector uses Round date");
console.log("PASS UX12-03: overall report added");
console.log("PASS UX12-04: totals partition by business date");
console.log("PASS UX12-05: purchase/reduction/Point/balance totals exposed");
console.log("PASS UX12-06: CORRECT uses local completion");
console.log("PASS UX12-07: IGNORE uses local completion");
console.log("PASS UX12-08: local completion has no duplicate RELEASE call");
console.log("PASS UX12-09: resolved local Map/Set state removed");
console.log("PASS UX12-10: Timeline uses page vertical scroll");
console.log("PASS UX12-11: styles.css EOF clean");
console.log("PASS: Production UX Round Report Review v12");
