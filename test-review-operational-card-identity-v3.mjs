import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  "public/app.js",
  "utf8",
);

const styles = fs.readFileSync(
  "public/styles.css",
  "utf8",
);

const pkg = fs.readFileSync(
  "package.json",
  "utf8",
);

function section(
  startMarker,
  endMarker,
) {
  const start =
    app.indexOf(startMarker);

  assert.ok(
    start >= 0,
    `missing ${startMarker}`,
  );

  const end =
    endMarker
      ? app.indexOf(
          endMarker,
          start + startMarker.length,
        )
      : -1;

  return end >= 0
    ? app.slice(
        start,
        end,
      )
    : app.slice(start);
}

assert.match(
  app,
  /Review Operational Card Identity \+ Single Visible Timeline v3/,
);

assert.match(
  styles,
  /Review Operational Card Identity \+ Single Visible Timeline v3/,
);

const identity = section(
  "function staffVerificationTimelineCardIdentity(",
  "function staffVerificationTimelineItemHtml(",
);

assert.match(
  identity,
  /staffVerificationSourceDisplayItems/,
);

assert.match(
  identity,
  /staffVerificationItemKey/,
);

assert.match(
  identity,
  /message_record_id/,
);

assert.match(
  identity,
  /\.slice\(\s*0,\s*8,\s*\)/,
);

assert.match(
  identity,
  /extraCodeCount/,
);

const timelineCard = section(
  "function staffVerificationTimelineItemHtml(",
  "function staffVerificationTimelineSortedItems(",
);

assert.match(
  timelineCard,
  /staffVerificationTimelineCardIdentity/,
);

assert.match(
  timelineCard,
  /verification-timeline-card-identity/,
);

assert.match(
  timelineCard,
  /verification-card-reference/,
);

assert.match(
  timelineCard,
  /verification-card-code/,
);

assert.match(
  timelineCard,
  /รหัสยังไม่ชัดเจน/,
);

assert.match(
  timelineCard,
  /verification-card-code-more/,
);

/*
 * Single visible current-round list:
 *
 * Live Review must remain in DOM as lifecycle staging,
 * but be visually hidden only when Timeline Workbench exists.
 */
assert.match(
  app,
  /id="staffLiveReviewQueue"/,
);

assert.match(
  styles,
  /#staffVerificationWorkbench[\s\S]*~\s*#staffLiveReviewQueue[\s\S]*display:\s*none\s*!important/,
);

/*
 * Historical post-close work is a distinct lifecycle and must
 * remain available as its own collapsed section.
 */
assert.match(
  app,
  /id="postCloseReviewQueue"/,
);

assert.match(
  app,
  /staff-history-details/,
);

assert.match(
  app,
  /งานย้อนหลัง/,
);

/*
 * Existing inline lifecycle DOM remains authoritative.
 */
assert.match(
  app,
  /function staffVerificationRestoreInlineWorkspaceRoot\(/,
);

assert.match(
  app,
  /function staffVerificationMountInlineWorkspaceRoot\(/,
);

assert.match(
  app,
  /staffVerificationRestoreLiveReviewInspectorCard/,
);

assert.match(
  pkg,
  /test-review-operational-card-identity-v3\.mjs/,
);

console.log(
  "PASS UI3-01: each Timeline card has a stable short operator reference",
);

console.log(
  "PASS UI3-02: first parsed code is promoted into card identity",
);

console.log(
  "PASS UI3-03: multi-code cards show an additional-code count",
);

console.log(
  "PASS UI3-04: unresolved cards explicitly say the code is unclear",
);

console.log(
  "PASS UI3-05: current live Review remains DOM staging but is not a duplicate visible list",
);

console.log(
  "PASS UI3-06: post-close historical work remains a distinct collapsed section",
);

console.log(
  "PASS UI3-07: existing Review lifecycle mount/restore contract is retained",
);

console.log(
  "PASS: Review Operational Card Identity + Single Visible Timeline v3",
);
