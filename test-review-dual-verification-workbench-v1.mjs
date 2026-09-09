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

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      "package.json",
      "utf8",
    ),
  );

function between(
  start,
  end,
) {
  const s =
    app.indexOf(start);

  const e =
    app.indexOf(
      end,
      s + start.length,
    );

  assert.ok(
    s >= 0,
    `missing ${start}`,
  );

  assert.ok(
    e > s,
    `missing ${end}`,
  );

  return app.slice(
    s,
    e,
  );
}

const query =
  between(
    "function staffVerificationQueueQuery(",
    "function staffVerificationMessageRecordId(",
  );

assert.match(
  query,
  /verification_limit/,
);

assert.match(
  query,
  /high_total_limit/,
);

assert.match(
  query,
  /high_total_offset/,
);

const mutate =
  between(
    "function staffVerificationCanMutate(",
    "function staffVerificationIssueText(",
  );

assert.match(
  mutate,
  /_staffVerificationActor[\s\S]*staff_id/,
);

assert.doesNotMatch(
  mutate,
  /state\.authMode/,
);

const claimMutation =
  between(
    "async function mutateStaffVerificationClaim(",
    "async function confirmStaffVerification(",
  );

assert.doesNotMatch(
  claimMutation,
  /state\.authMode/,
  "named Admin reviewer must remain allowed through the existing server-authorized path",
);

const timeline =
  between(
    "/* Review Timeline v1 */",
    "function selectStaffVerificationWorkbenchItem(",
  );

assert.match(
  timeline,
  /staffVerificationMergeTimelineItems/,
);

assert.match(
  timeline,
  /staffVerificationTimelineMatchesFilters/,
);

assert.match(
  timeline,
  /staffVerificationRenderTimeline/,
);

assert.match(
  timeline,
  /_verificationHighTotalIds/,
);

assert.match(
  timeline,
  /message_record_id/,
);

for (const filter of [
  "NEEDS_FIX",
  "HIGH_TOTAL",
  "AUTO",
  "TEXT",
  "IMAGE",
]) {
  assert.match(
    timeline,
    new RegExp(
      `"${filter}"`,
    ),
    `missing Timeline filter ${filter}`,
  );
}

assert.match(
  timeline,
  /ระบบ Auto/,
);

assert.match(
  timeline,
  /ต้องแก้ไข/,
);

assert.match(
  timeline,
  /ยอดสูง/,
);

assert.match(
  timeline,
  /🖼 รูปภาพ/,
);

assert.match(
  timeline,
  /💬 ข้อความ/,
);

const loadMore =
  between(
    "async function loadMoreStaffVerificationFeed(",
    "function bindStaffVerificationWorkbench(",
  );

assert.match(
  loadMore,
  /"RECENT"/,
);

assert.match(
  loadMore,
  /"HIGH_TOTAL"/,
);

assert.match(
  loadMore,
  /verification_items/,
);

assert.match(
  loadMore,
  /high_total_items/,
);

assert.match(
  loadMore,
  /Promise\.all/,
  "one Timeline Load More action must preserve independent backend pagination",
);

const binding =
  between(
    "function bindStaffVerificationWorkbench(",
    "function appendStaffVerificationQueue(",
  );

assert.match(
  binding,
  /open-staff-verification-item/,
);

assert.doesNotMatch(
  binding,
  /claimButton\.click\(\)/,
  "Timeline selection must not auto-claim; Claim belongs in the Inspector",
);

assert.match(
  app,
  /function staffVerificationApplyLocalClaimState\(/,
  "Human Verification Claim must support local Inspector refresh",
);

assert.match(
  app,
  /staffVerificationApplyLocalClaimState\([\s\S]*messageRecordId[\s\S]*action[\s\S]*payload/,
  "successful Claim must apply server-returned state locally",
);

assert.match(
  app,
  /function staffVerificationRestoreLiveReviewInspectorCard\(/,
  "Split Inspector must preserve the existing Live Review card lifecycle",
);

assert.match(
  app,
  /verificationInspectorLiveReviewCard/,
  "selected Live Review card must be tracked by the Split Inspector",
);

assert.doesNotMatch(
  binding,
  /needs_interpretation[\s\S]*return;/,
  "Timeline handler must not branch interpretation work away from the Inspector",
);

assert.match(
  app,
  /item\?\.needs_interpretation[\s\S]*item\?\.review_id[\s\S]*legacyCard/,
  "interpretation items must still resolve the authoritative legacy Review card",
);

assert.match(
  app,
  /legacyCard\.classList\.add\([\s\S]*verification-inspector-live-review-card[\s\S]*itemsRoot\.replaceChildren\([\s\S]*legacyCard/,
  "legacy Review card must be moved into the Split Inspector without replacing its lifecycle",
);

assert.match(
  binding,
  /load-more-verification-timeline/,
);

assert.match(
  binding,
  /verification-timeline-sort/,
);

const append =
  between(
    "function appendStaffVerificationQueue(",
    "// R2D3B-2 Staff-scoped Post-close Review Queue",
  );

assert.match(
  append,
  /id="staffVerificationWorkbench"/,
);

assert.match(
  append,
  /id="staffVerificationQueue"/,
);

assert.equal(
  (
    append.match(
      /id="staffVerificationQueue"/g,
    )
    ?? []
  ).length,
  1,
  "shared verification editor must exist once",
);

assert.match(
  append,
  /data-verification-timeline-items/,
);

assert.match(
  append,
  /verification-split-view/,
  "Timeline and Inspector must share one desktop split layout",
);

assert.match(
  append,
  /verification-split-inspector/,
  "right-side Inspector must be part of the unified workbench",
);


assert.match(
  append,
  /data-verification-timeline-summary/,
);

assert.match(
  append,
  /data-verification-filter="ALL"/,
);

assert.match(
  append,
  /ล่าสุดก่อน/,
);

assert.match(
  append,
  /เก่าสุดก่อน/,
);

assert.match(
  append,
  /ยอดสูงสุด/,
);

assert.doesNotMatch(
  append,
  /verification-queue-grid/,
  "presentation must no longer render dual queue columns",
);

assert.doesNotMatch(
  append,
  /คิวตรวจตามเวลา/,
);

assert.doesNotMatch(
  append,
  /ยอดสูง — ควรทำก่อน/,
);

assert.match(
  append,
  /verification_items/,
);

assert.match(
  append,
  /high_total_items/,
);

assert.match(
  append,
  /attention_items/,
  "Timeline must consume server PRIORITY coverage",
);

assert.match(
  append,
  /attentionNeedsFixItems[\s\S]*needs_interpretation/,
  "Timeline must supplement only rows that truly need interpretation",
);

assert.match(
  append,
  /staffVerificationMergeTimelineItems\([\s\S]*attentionNeedsFixItems[\s\S]*"PRIORITY"/,
  "PRIORITY needs-fix rows must join the unified Timeline",
);

assert.match(
  append,
  /staffVerificationMergeTimelineItems\([\s\S]*"RECENT"/,
);

assert.match(
  append,
  /staffVerificationMergeTimelineItems\([\s\S]*"HIGH_TOTAL"/,
);

assert.match(
  app,
  /function staffVerificationItemsTotal/,
  "Correction Preview must calculate total from server-returned items",
);

assert.match(
  app,
  /staffVerificationOriginalTotal/,
  "Correction Preview must retain the original message total",
);

assert.match(
  app,
  /สรุปยอดหลังแก้ไข/,
);

assert.match(
  app,
  /ยอดเดิม:/,
);

assert.match(
  app,
  /ยอดใหม่:/,
);

assert.match(
  app,
  /ผลต่าง:/,
);

assert.match(
  app,
  /staffVerificationPreviewHtml\([\s\S]*card\._staffVerificationItem/,
  "Preview renderer must compare server Preview with the current Workbench item",
);

const reviews =
  between(
    "async function loadReviews()",
    "async function loadUnsends()",
  );

assert.match(
  reviews,
  /staffVerificationQueueQuery/,
);

assert.match(
  reviews,
  /if \(realStaff\)/,
);

assert.match(
  reviews,
  /appendStaffVerificationQueue/,
);

assert.match(
  reviews,
  /state\.authMode === "STAFF"[\s\S]*appendStaffPostCloseReviewQueue/,
);

assert.doesNotMatch(
  html,
  /ตรวจตามเวลา/,
  "legacy time-queue shell copy must be removed",
);

assert.doesNotMatch(
  html,
  /พื้นที่ตรวจเดียวกัน/,
  "legacy shared-workspace shell copy must be removed",
);

assert.match(
  html,
  /รายการตรวจ/,
);

assert.match(
  html,
  /Timeline เดียว/,
);

assert.match(
  styles,
  /Review Timeline v1/,
);

assert.match(
  styles,
  /Review Split View v1/,
);

assert.match(
  styles,
  /\.verification-split-view/,
);

assert.match(
  styles,
  /grid-template-columns/,
);

assert.match(
  styles,
  /#staffLiveReviewQueue[\s\S]*display:\s*none/,
  "legacy Live Review queue must become a hidden staging host for Staff",
);


assert.match(
  styles,
  /\.verification-timeline-items/,
);

assert.match(
  styles,
  /\.verification-filter-chip/,
);

assert.match(
  styles,
  /\.verification-timeline-sort/,
);

assert.match(
  styles,
  /@media\(max-width:700px\)/,
);

const standardTest =
  String(
    pkg?.scripts?.test
    ?? "",
  );

for (
  const file
  of [
    "test-high-total-verification-sort.mjs",
    "test-staff-workbench-multi-verification-feeds.mjs",
    "test-review-dual-verification-workbench-v1.mjs",
  ]
) {
  assert.ok(
    standardTest.includes(file),
    `${file} must remain registered in npm test`,
  );
}

console.log(
  "PASS: unified Review Timeline over RECENT + HIGH_TOTAL feeds v1",
);
