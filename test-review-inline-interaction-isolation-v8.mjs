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

function sliceBetween(
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

const bind =
  sliceBetween(
    app,
    "function bindStaffVerificationWorkbench(",
    "function appendStaffVerificationQueue(",
  );


// UI8-01
assert.match(
  bind,
  /Review Inline Interaction Isolation v8/,
);


// UI8-02
assert.match(
  bind,
  /event\.target\.closest\(\s*"\.verification-inline-workspace"/,
);

assert.match(
  bind,
  /if\s*\(inlineWorkspace\)\s*\{\s*return;\s*\}/,
);


// UI8-03
const guardPos =
  bind.indexOf(
    "const inlineWorkspace"
  );

const filterPos =
  bind.indexOf(
    "const filterButton"
  );

const rowPos =
  bind.indexOf(
    "const timelineRow"
  );

const selectPos =
  bind.indexOf(
    "selectStaffVerificationWorkbenchItem("
  );

assert.ok(
  guardPos >= 0
  && guardPos < filterPos
  && filterPos < rowPos
  && rowPos < selectPos,
);


// UI8-04
assert.match(
  bind,
  /\.verification-timeline-item\[data-message-record-id\]/,
);

assert.match(
  bind,
  /\.open-staff-verification-item/,
);


// UI8-05
const select =
  sliceBetween(
    app,
    "function selectStaffVerificationWorkbenchItem(",
    "async function loadMoreStaffVerificationFeed(",
  );

assert.match(
  select,
  /item\?\.needs_interpretation/,
);

assert.match(
  select,
  /item\?\.review_id/,
);

assert.match(
  select,
  /\.review-card\[data-review-id\]/,
);

assert.match(
  select,
  /verification-inspector-live-review-card/,
);


// UI8-06
const claimUi =
  sliceBetween(
    app,
    "function syncReviewCardClaimUi(",
    "async function mutateReviewClaim(",
  );

assert.match(
  claimUi,
  /claim_state[\s\S]*===\s*"MINE"/,
);

assert.match(
  claimUi,
  /editor\.disabled\s*=\s*locked/,
);

assert.match(
  claimUi,
  /preview\.disabled\s*=\s*locked/,
);

assert.match(
  claimUi,
  /ignore\.disabled\s*=\s*locked/,
);


// UI8-07
for (const token of [
  '"/api/staff-work-claim"',
  '"/api/review-preview"',
  '"/api/review-resolve"',
]) {
  assert.ok(
    app.includes(token),
    `missing authoritative Live Review API: ${token}`,
  );
}


// UI8-08
assert.ok(
  pkg.includes(
    "test-review-inline-interaction-isolation-v8.mjs",
  ),
);

console.log(
  "PASS UI8-01: Working Card interaction isolation is registered",
);

console.log(
  "PASS UI8-02: inline workspace interactions stop before Timeline selection",
);

console.log(
  "PASS UI8-03: isolation runs before all Timeline click handling",
);

console.log(
  "PASS UI8-04: normal Timeline selection remains available",
);

console.log(
  "PASS UI8-05: parser failures still bridge to authoritative Live Review DOM",
);

console.log(
  "PASS UI8-06: Live Review claim ownership still locks/unlocks editor controls",
);

console.log(
  "PASS UI8-07: Live Review claim/preview/resolve APIs are unchanged",
);

console.log(
  "PASS UI8-08: UI-8 joins full regression",
);

console.log(
  "PASS: Review Inline Interaction Isolation v8",
);
