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

const start =
  app.indexOf(
    "const liveReviewCardsHtml",
  );

const end =
  app.indexOf(
    "const itemById",
    start,
  );

assert.ok(
  start >= 0 && end > start,
  "legacy Review wrapper range missing",
);

const region =
  app.slice(
    Math.max(
      0,
      start - 700,
    ),
    end,
  );

/*
 * DASHBOARD + STAFF must share the same folded wrapper.
 */
assert.doesNotMatch(
  region,
  /if\s*\(\s*state\.authMode\s*===\s*"STAFF"\s*\)\s*\{\s*const\s+liveReviewCardsHtml/,
  "legacy wrapper is still STAFF-only",
);

assert.match(
  region,
  /Review Legacy Section Collapse v13/,
);

assert.match(
  region,
  /<details\s+id="staffLiveReviewQueue"/,
);

assert.match(
  region,
  /class="preview-box staff-live-review-section review-secondary-details"/,
);

assert.doesNotMatch(
  region,
  /<details\s+id="staffLiveReviewQueue"[^>]*\sopen(?:\s|=|>)/,
  "legacy details must start closed",
);

assert.match(
  region,
  /ข้อมูลเดิม · รายการตรวจเพิ่มเติม/,
);

assert.match(
  region,
  /\$\{formatNumber\(items\.length\)\} รายการ/,
);

assert.match(
  region,
  /state\.authMode === "STAFF"[\s\S]*ใช้ Timeline ด้านบนเป็นพื้นที่ตรวจและแก้ไขหลัก[\s\S]*ข้อมูลเดิมสำหรับเปิดตรวจสอบเมื่อจำเป็น/,
);

/*
 * V13 must be later than UI6/UI7/V12 and therefore final.
 */
const ui6 =
  css.indexOf(
    "Review Focused Secondary Queue v6",
  );

const ui7 =
  css.indexOf(
    "Review Single Visible Working Round v7",
  );

const v12 =
  css.indexOf(
    "Production UX Truth + Fast Review v12",
  );

const v13 =
  css.indexOf(
    "Review Legacy Section Collapse v13",
  );

assert.ok(
  ui6 >= 0,
  "UI6 marker missing",
);

assert.ok(
  ui7 > ui6,
  "UI7 source order invalid",
);

assert.ok(
  v12 > ui7,
  "V12 source order invalid",
);

assert.ok(
  v13 > v12,
  "V13 must be final visibility authority",
);

const finalCss =
  css.slice(
    v13,
  );

assert.match(
  finalCss,
  /#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  finalCss,
  /#staffVerificationWorkbench[\s\S]*~\s*#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  finalCss,
  /#reviewList:has\(#staffVerificationWorkbench\)[\s\S]*#staffLiveReviewQueue\.review-secondary-details[\s\S]*display:\s*block\s*!important/,
);

assert.match(
  finalCss,
  /#staffLiveReviewQueue\.review-secondary-details:not\(\[open\]\)[\s\S]*>\s*\.review-secondary-body[\s\S]*display:\s*none\s*!important/,
);

assert.match(
  finalCss,
  /#postCloseReviewQueue\s*\{[\s\S]*display:\s*none\s*!important/,
);

/*
 * V12 Timeline/lifecycle remains intact.
 */
for (const token of [
  "function staffVerificationTimelineItemHtml(",
  "function staffVerificationRenderTimeline(",
  "function selectStaffVerificationWorkbenchItem(",
  "function completeReviewResolutionLocally(",
  "preview-review",
  "ignore-review",
  "review-editor",
  "appendStaffPostCloseReviewQueue",
]) {
  assert.ok(
    app.includes(token),
    `missing retained contract: ${token}`,
  );
}

assert.ok(
  pkg.includes(
    "test-review-legacy-section-collapse-v13.mjs",
  ),
);

console.log(
  "PASS UI13-01: DASHBOARD raw Review cards enter folded legacy shell",
);

console.log(
  "PASS UI13-02: STAFF retains Timeline plus folded legacy shell",
);

console.log(
  "PASS UI13-03: legacy shell starts closed",
);

console.log(
  "PASS UI13-04: V13 supersedes UI7 visibility only",
);

console.log(
  "PASS UI13-05: post-close archive remains hidden",
);

console.log(
  "PASS UI13-06: Review lifecycle remains intact",
);

console.log(
  "PASS UI13-07: V12 Timeline implementation remains intact",
);

console.log(
  "PASS: Review Legacy Section Collapse v13",
);
