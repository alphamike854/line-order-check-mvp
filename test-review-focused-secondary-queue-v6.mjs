import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const styles =
  fs.readFileSync(
    "public/styles.css",
    "utf8",
  );

const pkg =
  fs.readFileSync(
    "package.json",
    "utf8",
  );


/* Marker */
assert.ok(
  app.includes(
    "Review Focused Secondary Queue v6",
  ),
);

assert.ok(
  styles.includes(
    "Review Focused Secondary Queue v6",
  ),
);


/* Collapsed by default */
assert.ok(
  app.includes(
    '<details\n          id="staffLiveReviewQueue"',
  ),
);

assert.ok(
  app.includes(
    'class="preview-box staff-live-review-section review-secondary-details"',
  ),
);

assert.ok(
  !app.includes(
    '<details\n          id="staffLiveReviewQueue"\n          class="preview-box staff-live-review-section review-secondary-details"\n          open',
  ),
);


/* Clear summary + count */
assert.ok(
  app.includes(
    "รายการตรวจเพิ่มเติม",
  ),
);

assert.ok(
  app.includes(
    "${formatNumber(items.length)} รายการ",
  ),
);


/* Timeline explicitly remains primary */
assert.ok(
  app.includes(
    "ใช้ Timeline ด้านบนเป็นพื้นที่ตรวจและแก้ไขหลัก",
  ),
);


/* Secondary queue is visible as a folded panel despite old hide rules */
assert.match(
  styles,
  /#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  styles,
  /#reviewList:has\(#staffVerificationWorkbench\)[\s\S]*#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);


/* Strong card separation */
assert.match(
  styles,
  /\.staff-live-review-items[\s\S]*gap:\s*20px/,
);

assert.match(
  styles,
  /\.staff-live-review-items[\s\S]*>\s*\.review-card[\s\S]*border:\s*2px solid/,
);


/* Stable per-card identity */
assert.match(
  styles,
  /\.review-card::before[\s\S]*รายการตรวจ #[\s\S]*attr\(data-review-id\)/,
);


/* Existing semantic split is preserved */
assert.ok(
  app.includes(
    'class="live-review-card-left"',
  ),
);

assert.ok(
  app.includes(
    'class="live-review-card-right"',
  ),
);

assert.match(
  styles,
  /grid-template-columns:[\s\S]*minmax\(0,\s*1fr\)[\s\S]*minmax\(0,\s*1fr\)/,
);


/* Existing lifecycle controls remain */
assert.ok(
  app.includes(
    'class="review-editor"',
  ),
);

assert.ok(
  app.includes(
    'class="button primary small preview-review"',
  ),
);

assert.ok(
  app.includes(
    'class="button ghost small ignore-review"',
  ),
);

assert.ok(
  app.includes(
    'class="review-preview"',
  ),
);


/* Technical metadata remains collapsed */
assert.ok(
  app.includes(
    '<details class="live-review-technical">',
  ),
);

assert.ok(
  app.includes(
    "รายละเอียดระบบ",
  ),
);


/* Mounted card avoids duplicate outer identity */
assert.match(
  styles,
  /\.verification-inline-action-host[\s\S]*\.review-card::before[\s\S]*display:\s*none\s*!important/,
);


/* Post-close remains independent */
assert.ok(
  app.includes(
    'id="postCloseReviewQueue"',
  ),
);

assert.ok(
  app.includes(
    '<details class="preview-box staff-history-details">',
  ),
);


/* Mobile stacking */
assert.match(
  styles,
  /@media\s*\(max-width:\s*900px\)[\s\S]*#staffLiveReviewQueue\.review-secondary-details[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
);


/* Test registration */
assert.ok(
  pkg.includes(
    "test-review-focused-secondary-queue-v6.mjs",
  ),
);


console.log(
  "PASS UI6-01: secondary Review queue is collapsed by default",
);

console.log(
  "PASS UI6-02: folded summary shows purpose and item count",
);

console.log(
  "PASS UI6-03: Timeline remains the primary workflow",
);

console.log(
  "PASS UI6-04: expanded secondary Reviews are clearly separated",
);

console.log(
  "PASS UI6-05: each expanded Review has a stable Review identity",
);

console.log(
  "PASS UI6-06: original and correction panes remain left/right",
);

console.log(
  "PASS UI6-07: Review Preview / Ignore lifecycle remains intact",
);

console.log(
  "PASS UI6-08: technical metadata remains collapsed",
);

console.log(
  "PASS UI6-09: post-close history remains independent",
);

console.log(
  "PASS UI6-10: mobile expanded cards stack safely",
);

console.log(
  "PASS: Review Focused Secondary Queue v6",
);
