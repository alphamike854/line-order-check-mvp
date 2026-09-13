import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const css =
  fs.readFileSync(
    "public/styles.css",
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

const claimRenderer =
  between(
    app,
    "function reviewClaimStatusHtml(",
    "function reviewCardCanMutate(",
  );

const claimSync =
  between(
    app,
    "function syncReviewCardClaimUi(",
    "function applyFreshClaimStateToReviewCard(",
  );


// UI10-01
assert.match(
  loadReviews,
  /Review Inline Claim Control v10/,
);


// UI10-02
const left =
  loadReviews.indexOf(
    '<section class="live-review-card-left">',
  );

const right =
  loadReviews.indexOf(
    '<section class="live-review-card-right">',
  );

const claim =
  loadReviews.indexOf(
    '<div class="review-claim-state"></div>',
  );

const editor =
  loadReviews.indexOf(
    '<label class="editor-label live-review-editor-label">',
  );

assert.ok(
  left >= 0,
  "missing source pane",
);

assert.ok(
  right > left,
  "missing action pane",
);

assert.ok(
  claim > right,
  "claim control must be inside action pane",
);

assert.ok(
  editor > claim,
  "claim control must appear before editor",
);


// UI10-03
assert.ok(
  !loadReviews
    .slice(
      left,
      right,
    )
    .includes(
      "review-claim-state",
    ),
  "claim control must not remain in hidden source pane",
);


// UI10-04
assert.match(
  css,
  /\.verification-inline-action-host[\s\S]*\.live-review-card-left[\s\S]*display:\s*none\s*!important/,
);


// UI10-05
assert.match(
  claimRenderer,
  /claimState\s*===\s*"AVAILABLE"/,
);

assert.match(
  claimRenderer,
  /class="button primary small claim-review-work"/,
);

assert.match(
  claimRenderer,
  /รับรายการ/,
);


// UI10-06
assert.match(
  claimSync,
  /reviewClaimStatusHtml/,
);

assert.match(
  claimSync,
  /claim_state[\s\S]*===\s*"MINE"/,
);

assert.match(
  claimSync,
  /editor\.disabled\s*=\s*locked/,
);

assert.match(
  claimSync,
  /preview\.disabled\s*=\s*locked/,
);

assert.match(
  claimSync,
  /ignore\.disabled\s*=\s*locked/,
);

assert.match(
  claimSync,
  /bindReviewClaimButtons/,
);


// UI10-07
for (const endpoint of [
  '"/api/staff-work-claim"',
  '"/api/review-preview"',
  '"/api/review-resolve"',
]) {
  assert.ok(
    app.includes(endpoint),
    `missing endpoint ${endpoint}`,
  );
}


// UI10-08
assert.ok(
  pkg.includes(
    "test-review-inline-claim-control-v10.mjs",
  ),
);

console.log(
  "PASS UI10-01: Inline claim-control contract registered",
);

console.log(
  "PASS UI10-02: claim control is inside visible action pane",
);

console.log(
  "PASS UI10-03: claim control is absent from hidden source pane",
);

console.log(
  "PASS UI10-04: source-pane hiding contract remains intact",
);

console.log(
  "PASS UI10-05: AVAILABLE Review exposes รับรายการ",
);

console.log(
  "PASS UI10-06: claim ownership still locks/unlocks Review actions",
);

console.log(
  "PASS UI10-07: Review lifecycle APIs remain unchanged",
);

console.log(
  "PASS UI10-08: UI-10 joins full regression",
);

console.log(
  "PASS: Review Inline Claim Control v10",
);
