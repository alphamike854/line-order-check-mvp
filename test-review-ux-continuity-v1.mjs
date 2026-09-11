import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "./public/app.js",
    "utf8",
  );

const css =
  fs.readFileSync(
    "./public/styles.css",
    "utf8",
  );

assert.match(
  css,
  /\.staff-verification-correction,[\s\S]*textarea\.review-editor[\s\S]*field-sizing:\s*content[\s\S]*overflow-y:\s*hidden/,
);

console.log(
  "PASS UX1-01: Human Verification and Live Review editors expand with content",
);

const confirmStart =
  app.indexOf(
    "async function confirmStaffVerification(",
  );

const confirmEnd =
  app.indexOf(
    "async function previewStaffVerificationCorrection(",
    confirmStart,
  );

const confirm =
  app.slice(
    confirmStart,
    confirmEnd,
  );

assert.ok(
  confirm.includes(
    '"/api/staff-verification-verify"',
  ),
);

for (
  const field
  of [
    "parser_version:",
    "normalized_text:",
    "items:",
  ]
) {
  assert.ok(
    confirm.includes(field),
    `Confirm missing ${field}`,
  );
}

assert.match(
  confirm,
  /reloadStaffVerificationQueuePreservingPosition\([\s\S]*messageRecordId/,
);

console.log(
  "PASS UX1-02: Confirm trust contract preserved with position continuity",
);

const applyStart =
  app.indexOf(
    "async function applyStaffVerificationCorrection(",
  );

const applyEnd =
  app.indexOf(
    "function bindStaffVerificationActions(",
    applyStart,
  );

const apply =
  app.slice(
    applyStart,
    applyEnd,
  );

assert.ok(
  apply.includes(
    '"/api/staff-verification-correct"',
  ),
);

assert.ok(
  apply.includes(
    "preview_token:",
  ),
);

assert.ok(
  apply.includes(
    "corrected_text:",
  ),
);

assert.match(
  apply,
  /reloadStaffVerificationQueuePreservingPosition\([\s\S]*messageRecordId/,
);

console.log(
  "PASS UX1-03: Apply signed Preview contract preserved with position continuity",
);

assert.match(
  app,
  /function staffVerificationCaptureContinuity\(/,
);

assert.match(
  app,
  /timelineScrollTop/,
);

assert.match(
  app,
  /pageScrollY/,
);

assert.match(
  app,
  /_verificationTimelineFilters/,
);

assert.match(
  app,
  /_verificationTimelineSort/,
);

assert.match(
  app,
  /selectStaffVerificationWorkbenchItem\([\s\S]*scroll:\s*false/,
);

console.log(
  "PASS UX1-04: Timeline/filter/sort/page continuity retained",
);

assert.match(
  app,
  /const timelineRow\s*=[\s\S]*verification-timeline-item\[data-message-record-id\][\s\S]*selectStaffVerificationWorkbenchItem/,
);

assert.match(
  css,
  /\.verification-timeline-item\s*\{[\s\S]*cursor:\s*pointer/,
);

console.log(
  "PASS UX1-05: complete Timeline row opens shared Inspector",
);

const timelineSourceStart =
  app.indexOf(
    "function staffVerificationTimelineSourceText(",
  );

const timelineSourceEnd =
  app.indexOf(
    "function staffVerificationTimelineMessageType(",
    timelineSourceStart,
  );

const timelineSource =
  app.slice(
    timelineSourceStart,
    timelineSourceEnd,
  );

assert.ok(
  timelineSource.includes(
    "item?.ocr_text",
  ),
);

const cardStart =
  app.indexOf(
    "function staffVerificationCardHtml(",
  );

const cardEnd =
  app.indexOf(
    "function hydrateStaffVerificationCards(",
    cardStart,
  );

const card =
  app.slice(
    cardStart,
    cardEnd,
  );

assert.ok(
  card.includes(
    "item?.ocr_text",
  ),
);

assert.match(
  app,
  /verification-timeline-image-ocr/,
);

console.log(
  "PASS UX1-06: IMAGE OCR/context visible in Timeline and Inspector",
);

assert.match(
  css,
  /\.verification-split-inspector\s*\{[\s\S]*max-height:\s*none[\s\S]*overflow:\s*visible/,
);

console.log(
  "PASS UX1-07: Inspector no longer creates nested vertical scrolling",
);

const highTotalSql =
  fs.readFileSync(
    "./supabase/migrations/20260907085000_add_high_total_verification_sort.sql",
    "utf8",
  );

assert.match(
  highTotalSql,
  /then\s+message_order_total/i,
);

console.log(
  "PASS UX1-08: High Total semantics intentionally unchanged",
);

console.log(
  "PASS: Review UX continuity v1.2",
);
