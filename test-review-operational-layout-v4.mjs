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

assert.match(
  app,
  /Review Scanable Cards \+ Unified Split Review v4/,
);

assert.match(
  styles,
  /Review Scanable Cards \+ Unified Split Review v4/,
);

/*
 * Timeline cards must have strong independent boundaries.
 */
assert.match(
  styles,
  /\.verification-timeline-items\s*\{[\s\S]*?gap:\s*14px/,
);

assert.match(
  styles,
  /\.verification-timeline-item\s*\{[\s\S]*?border:\s*1px solid/,
);

assert.match(
  styles,
  /\.verification-timeline-item\s*\{[\s\S]*?border-radius:\s*16px/,
);

assert.match(
  styles,
  /\.verification-timeline-item[\s\S]*>\s*\.verification-queue-item-head\s*\{[\s\S]*?background:/,
);

assert.match(
  styles,
  /\.verification-timeline-item\.needs-fix[\s\S]*#b94a3a/,
);

assert.match(
  styles,
  /\.verification-timeline-item\.high-total:not\(\.needs-fix\)[\s\S]*#d58a23/,
);

assert.match(
  styles,
  /\.verification-timeline-item\.selected[\s\S]*border-color:/,
);

/*
 * Live Review fallback card uses the same left/right mental model.
 */
assert.match(
  app,
  /class="live-review-card-left"/,
);

assert.match(
  app,
  /class="live-review-card-right"/,
);

assert.match(
  app,
  />\s*ข้อมูลเดิม\s*</,
);

assert.match(
  app,
  />\s*ตรวจ \/ แก้ไขรายการ\s*</,
);

assert.match(
  styles,
  /#staffLiveReviewQueue[\s\S]*\.staff-live-review-items[\s\S]*>\s*\.review-card[\s\S]*grid-template-columns:/,
);

assert.match(
  styles,
  /minmax\(0,\s*1fr\)[\s\S]*minmax\(0,\s*1fr\)/,
);

/*
 * Inline Timeline workspace must not duplicate the source pane.
 */
assert.match(
  styles,
  /\.verification-inline-action-host[\s\S]*\.live-review-card-left[\s\S]*display:\s*none\s*!important/,
);

assert.match(
  styles,
  /\.verification-inline-action-host[\s\S]*\.live-review-card-right[\s\S]*padding:\s*0/,
);

/*
 * Narrow screens stack the fallback card.
 */
assert.match(
  styles,
  /@media\s*\(max-width:\s*900px\)[\s\S]*#staffLiveReviewQueue[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
);

/*
 * Distinct post-close historical lifecycle remains present.
 */
assert.match(
  app,
  /id="postCloseReviewQueue"/,
);

/*
 * Existing UI-3 single-visible-Timeline rule remains registered.
 */
assert.match(
  styles,
  /#staffVerificationWorkbench[\s\S]*~\s*#staffLiveReviewQueue[\s\S]*display:\s*none\s*!important/,
);

assert.match(
  pkg,
  /test-review-operational-layout-v4\.mjs/,
);

console.log(
  "PASS UI4-01: Timeline cards have stronger independent visual boundaries",
);

console.log(
  "PASS UI4-02: Timeline header band creates a repeatable scan start-point",
);

console.log(
  "PASS UI4-03: needs-fix and high-total cards remain visually distinct",
);

console.log(
  "PASS UI4-04: selected Timeline card is visually anchored",
);

console.log(
  "PASS UI4-05: visible Live Review fallback uses one two-column card",
);

console.log(
  "PASS UI4-06: left pane is source/reason and right pane is correction/actions",
);

console.log(
  "PASS UI4-07: mounted Timeline action workspace suppresses duplicate source pane",
);

console.log(
  "PASS UI4-08: narrow screens stack the split card safely",
);

console.log(
  "PASS: Review Scanable Cards + Unified Split Review v4",
);
