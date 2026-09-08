import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8",
  );

const styles =
  fs.readFileSync(
    "public/styles.css",
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
  "named Admin reviewer must be allowed to Claim through the existing server-authorized path",
);

const workbench =
  between(
    "function staffVerificationQueueBadgeHtml(",
    "// R2D3B-2 Staff-scoped Post-close Review Queue",
  );

assert.match(
  workbench,
  /id="staffVerificationWorkbench"/,
);

assert.match(
  workbench,
  /id="staffVerificationQueue"/,
);

assert.equal(
  (
    workbench.match(
      /id="staffVerificationQueue"/g,
    )
    ?? []
  ).length,
  1,
  "shared verification editor must exist once",
);

assert.match(
  workbench,
  /RECENT/,
);

assert.match(
  workbench,
  /HIGH_TOTAL/,
);

assert.match(
  workbench,
  /high_total_items/,
);

assert.match(
  workbench,
  /message_record_id/,
);

assert.match(
  workbench,
  /needs_interpretation/,
);

assert.match(
  workbench,
  /review_id/,
);

assert.match(
  workbench,
  /open-staff-verification-item/,
);

assert.match(
  workbench,
  /claimButton\.click\(\)/,
  "เริ่มตรวจ must trigger the existing Claim handler",
);

assert.match(
  workbench,
  /needs_interpretation[\s\S]*return;/,
  "interpretation items must stay on legacy Review flow",
);

assert.match(
  workbench,
  /load-more-verification-feed/,
);

assert.match(
  workbench,
  /selectStaffVerificationWorkbenchItem/,
);

assert.match(
  workbench,
  /เปิดตรวจแก้/,
);

assert.match(
  app,
  /เริ่มตรวจ/,
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

assert.match(
  styles,
  /\.verification-queue-grid/,
);

assert.match(
  styles,
  /grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,\.85fr\)/,
);

assert.match(
  styles,
  /@media\(max-width:900px\)/,
);

assert.match(
  html,
  /ตรวจตามเวลา/,
);

assert.match(
  html,
  /พื้นที่ตรวจเดียวกัน/,
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
    `${file} must be registered in npm test`,
  );
}

console.log(
  "PASS: dual RECENT + HIGH_TOTAL Review workbench v1",
);
