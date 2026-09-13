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

function between(
  source,
  startToken,
  endToken,
) {
  const start =
    source.indexOf(
      startToken,
    );

  assert.notEqual(
    start,
    -1,
    `missing start token: ${startToken}`,
  );

  const end =
    source.indexOf(
      endToken,
      start + startToken.length,
    );

  assert.notEqual(
    end,
    -1,
    `missing end token: ${endToken}`,
  );

  return source.slice(
    start,
    end,
  );
}

const loadReviews =
  between(
    app,
    "async function loadReviews()",
    "async function loadUnsends()",
  );

const selectItem =
  between(
    app,
    "function selectStaffVerificationWorkbenchItem(",
    "async function loadMoreStaffVerificationFeed(",
  );


// ------------------------------------------------------------
// UI9-01
// Live Review scope is no longer based on work_items alone.
// ------------------------------------------------------------

assert.match(
  loadReviews,
  /Review Workbench Scope Bridge v9/,
);

assert.match(
  loadReviews,
  /const reviewScopeItems\s*=\s*\[/,
);

for (const feed of [
  "verification_items",
  "attention_items",
  "high_total_items",
  "work_items",
]) {
  assert.ok(
    loadReviews.includes(
      `workbenchPayload.${feed}`,
    ),
    `missing authorized Workbench feed: ${feed}`,
  );
}


// ------------------------------------------------------------
// UI9-02
// work_items is deliberately last so its Review claim metadata
// wins if the same Review exists in several feeds.
// ------------------------------------------------------------

const verificationPos =
  loadReviews.indexOf(
    "workbenchPayload.verification_items",
  );

const attentionPos =
  loadReviews.indexOf(
    "workbenchPayload.attention_items",
  );

const highTotalPos =
  loadReviews.indexOf(
    "workbenchPayload.high_total_items",
  );

const workPos =
  loadReviews.indexOf(
    "workbenchPayload.work_items",
  );

assert.ok(
  verificationPos >= 0
  && attentionPos > verificationPos
  && highTotalPos > attentionPos
  && workPos > highTotalPos,
  "authorized Review scope feed order is invalid",
);


// ------------------------------------------------------------
// UI9-03
// Scope map must exclude null Review identity.
// ------------------------------------------------------------

assert.match(
  loadReviews,
  /item\?\.review_id\s*!==\s*null/,
);

assert.match(
  loadReviews,
  /item\?\.review_id\s*!==\s*undefined/,
);

assert.match(
  loadReviews,
  /const workByReviewId\s*=\s*new Map\(/,
);

assert.match(
  loadReviews,
  /reviewScopeItems\.map/,
);


// ------------------------------------------------------------
// UI9-04
// Staff Review DOM remains server-scoped by authorized Review id.
// ------------------------------------------------------------

assert.match(
  loadReviews,
  /workByReviewId\.has\([\s\S]*String\(item\.id\)/,
);


// ------------------------------------------------------------
// UI9-05
// Interpretation items still seek the authoritative Live Review
// card by review_id first.
// ------------------------------------------------------------

assert.match(
  selectItem,
  /item\?\.needs_interpretation[\s\S]*item\?\.review_id/,
);

assert.match(
  selectItem,
  /\.review-card\[data-review-id\]/,
);

assert.match(
  selectItem,
  /verification-inspector-live-review-card/,
);


// ------------------------------------------------------------
// UI9-06
// Missing Live Review DOM must fail closed.
// ------------------------------------------------------------

assert.match(
  selectItem,
  /verification-live-review-missing/,
);

assert.match(
  selectItem,
  /ไม่สามารถเปิดพื้นที่แก้ไข Review รายการนี้ได้/,
);


// ------------------------------------------------------------
// UI9-07
// Fail-closed branch must occur before Human Verification fallback.
// ------------------------------------------------------------

const missingPos =
  selectItem.indexOf(
    "verification-live-review-missing",
  );

const humanFallbackPos =
  selectItem.indexOf(
    "root._staffVerificationActor",
  );

assert.ok(
  missingPos >= 0,
  "missing fail-closed Review branch",
);

assert.ok(
  humanFallbackPos > missingPos,
  "Human Verification fallback occurs before Review fail-closed boundary",
);

assert.ok(
  selectItem
    .slice(
      missingPos,
      humanFallbackPos,
    )
    .includes(
      "return;",
    ),
  "Review fail-closed branch must return before Human Verification",
);


// ------------------------------------------------------------
// UI9-08
// Existing lifecycle endpoints remain separate.
// ------------------------------------------------------------

for (const endpoint of [
  '"/api/staff-work-claim"',
  '"/api/review-preview"',
  '"/api/review-resolve"',
  '"/api/staff-verification-claim"',
]) {
  assert.ok(
    app.includes(endpoint),
    `missing lifecycle endpoint: ${endpoint}`,
  );
}


// ------------------------------------------------------------
// UI9-09
// Regression is part of npm test.
// ------------------------------------------------------------

assert.ok(
  pkg.includes(
    "test-review-workbench-scope-bridge-v9.mjs",
  ),
);

console.log(
  "PASS UI9-01: Live Review scope uses the authorized Workbench feed union",
);

console.log(
  "PASS UI9-02: work_items claim metadata remains final authority",
);

console.log(
  "PASS UI9-03: null Review identities cannot enter the Review scope map",
);

console.log(
  "PASS UI9-04: Staff Review DOM remains server-authorized by Review identity",
);

console.log(
  "PASS UI9-05: interpretation items prefer authoritative Live Review DOM",
);

console.log(
  "PASS UI9-06: missing Live Review DOM fails closed",
);

console.log(
  "PASS UI9-07: PARTIAL Review cannot fall through to Human Verification",
);

console.log(
  "PASS UI9-08: Review and Human Verification lifecycles remain separate",
);

console.log(
  "PASS UI9-09: UI-9 joins full regression",
);

console.log(
  "PASS: Review Workbench Scope Bridge v9",
);
