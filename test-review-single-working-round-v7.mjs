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


// ------------------------------------------------------------
// UI7-01
// Timeline remains the primary operator workbench.
// ------------------------------------------------------------
assert.match(
  app,
  /id="staffVerificationWorkbench"/,
);

assert.match(
  css,
  /Review Single Visible Working Round v7/,
);

assert.match(
  css,
  /#staffVerificationWorkbench\s*\{[\s\S]*display:\s*block/,
);


// ------------------------------------------------------------
// UI7-02
// Live Review staging must not be a second visible queue.
// ------------------------------------------------------------
assert.match(
  css,
  /#staffLiveReviewQueue[\s\S]*display:\s*none\s*!important/,
);


// ------------------------------------------------------------
// UI7-03
// UI-6 secondary label may remain in DOM source for compatibility,
// but the entire staging root is operator-invisible.
// ------------------------------------------------------------
assert.match(
  app,
  /รายการตรวจเพิ่มเติม/,
);

assert.match(
  css,
  /#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*none\s*!important/,
);


// ------------------------------------------------------------
// UI7-04
// Post-close archive must not become another visible operator queue.
// ------------------------------------------------------------
assert.match(
  app,
  /id="postCloseReviewQueue"/,
);

assert.match(
  css,
  /#postCloseReviewQueue\s*\{[\s\S]*display:\s*none\s*!important/,
);


// ------------------------------------------------------------
// UI7-05
// Authoritative action DOM can still be mounted into Timeline.
// ------------------------------------------------------------
assert.match(
  app,
  /staffVerificationMountInlineWorkspaceRoot/,
);

assert.match(
  app,
  /verification-inline-action-host/,
);

assert.match(
  css,
  /\.verification-inline-action-host[\s\S]*#staffVerificationQueue[\s\S]*display:\s*block/,
);


// ------------------------------------------------------------
// UI7-06
// Existing Review actions remain present.
// ------------------------------------------------------------
for (const token of [
  "preview-review",
  "ignore-review",
  "review-editor",
]) {
  assert.ok(
    app.includes(token),
    `missing Review lifecycle control: ${token}`,
  );
}


// ------------------------------------------------------------
// UI7-07
// Existing post-close lifecycle remains in source. We are hiding
// presentation only, not removing safety infrastructure.
// ------------------------------------------------------------
for (const token of [
  "appendStaffPostCloseReviewQueue",
  "loadStaffPostCloseReviewPage",
  "postCloseReviewCardHtml",
]) {
  assert.ok(
    app.includes(token),
    `missing post-close lifecycle: ${token}`,
  );
}


// ------------------------------------------------------------
// UI7-08
// UI-6 remains registered; UI-7 deliberately supersedes only its
// visibility decision.
// ------------------------------------------------------------
assert.ok(
  pkg.includes(
    "test-review-focused-secondary-queue-v6.mjs",
  ),
);

assert.ok(
  pkg.includes(
    "test-review-single-working-round-v7.mjs",
  ),
);



// ------------------------------------------------------------
// V13 visibility supersession
//
// UI7 historical hide rules remain registered, but V13 is later
// in source order and exposes only the folded legacy details shell.
// Timeline/lifecycle/post-close contracts remain unchanged.
// ------------------------------------------------------------

const ui7Marker =
  css.indexOf(
    "Review Single Visible Working Round v7",
  );

const v13Marker =
  css.indexOf(
    "Review Legacy Section Collapse v13",
  );

assert.ok(
  ui7Marker >= 0,
  "UI7 marker missing",
);

assert.ok(
  v13Marker > ui7Marker,
  "V13 must supersede UI7 visibility by source order",
);

const v13Css =
  css.slice(
    v13Marker,
  );

assert.match(
  v13Css,
  /#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  v13Css,
  /#staffVerificationWorkbench[\s\S]*~\s*#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  v13Css,
  /#staffLiveReviewQueue\.review-secondary-details:not\(\[open\]\)[\s\S]*>\s*\.review-secondary-body[\s\S]*display:\s*none\s*!important/,
);

assert.match(
  v13Css,
  /#postCloseReviewQueue\s*\{[\s\S]*display:\s*none\s*!important/,
);

console.log(
  "PASS UI7-01: Timeline remains the single visible Working Round surface",
);

console.log(
  "PASS UI7-02: historical Live Review staging-hide rule remains registered",
);

console.log(
  "PASS UI7-03: V13 supersedes UI7 with folded legacy access only",
);

console.log(
  "PASS UI7-04: post-close archive is not exposed as a second workflow",
);

console.log(
  "PASS UI7-05: authoritative Review controls can still mount into Timeline",
);

console.log(
  "PASS UI7-06: Preview / Ignore / editor lifecycle remains intact",
);

console.log(
  "PASS UI7-07: post-close safety infrastructure remains intact",
);

console.log(
  "PASS UI7-08: UI7 lifecycle/safety contract remains under V13 visibility supersession",
);

console.log(
  "PASS: Review Single Visible Working Round v7",
);
