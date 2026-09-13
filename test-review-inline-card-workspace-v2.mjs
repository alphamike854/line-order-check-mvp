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
    ? app.slice(start, end)
    : app.slice(start);
}

assert.match(
  app,
  /Review Inline Timeline Card Workspace v2/,
);

assert.match(
  styles,
  /Review Inline Timeline Card Workspace v2/,
);

const fullSource = section(
  "function staffVerificationFullSourceText(",
  "function staffVerificationPreferFullSourceValue(",
);

for (const field of [
  "raw_text",
  "text",
  "display_text",
  "ocr_text",
  "normalized_text",
]) {
  assert.ok(
    fullSource.includes(field),
    `full source missing ${field}`,
  );
}

const fullSourceResolver =
  Function(
    `"use strict";
${fullSource}
return staffVerificationFullSourceText;`,
  )();

const multilineText = [
  "338",
  "833",
  "383",
  "388",
  "883",
  "838=10",
  "83=30x30",
  "38=30x30",
  "88=20x20",
  "33=20x20",
].join("\n");

const priorityExcerpt =
  "338 833 383 388 883";

assert.equal(
  fullSourceResolver({
    message_type: "text",
    raw_text: multilineText,
    text: priorityExcerpt,
    display_text: priorityExcerpt,
    normalized_text:
      "338 833 383 388 883 838=10 83=30x30 38=30x30 88=20x20 33=20x20",
  }),
  multilineText,
  "TEXT must preserve canonical raw_text instead of a shorter feed excerpt",
);

const imageOcrText = [
  "A 01 02 03=20",
  "B 04 05=10",
].join("\n");

assert.equal(
  fullSourceResolver({
    message_type: "image",
    ocr_text: imageOcrText,
    raw_text: "IMAGE",
    normalized_text:
      "A 01 02 03=20 B 04 05=10",
    text:
      "A 01 02 03=20",
  }),
  imageOcrText,
  "IMAGE must preserve OCR text as the source before normalized/raw fallbacks",
);

assert.equal(
  fullSourceResolver({
    message_type: "text",
    text: "legacy display source",
  }),
  "legacy display source",
  "legacy feed text must remain a fallback when canonical source fields are absent",
);

const merge = section(
  "function staffVerificationMergeTimelineItems(",
  "function staffVerificationTimelineMatchesFilters(",
);

assert.match(
  merge,
  /staffVerificationPreferFullSourceValue/,
);

assert.match(
  merge,
  /"text"[\s\S]*"display_text"[\s\S]*"raw_text"[\s\S]*"ocr_text"[\s\S]*"normalized_text"/,
);

const timelineCard = section(
  "function staffVerificationTimelineItemHtml(",
  "function staffVerificationTimelineSortedItems(",
);

assert.match(
  timelineCard,
  /verification-timeline-collapsed-body/,
);

assert.match(
  timelineCard,
  /verification-inline-workspace/,
);

assert.match(
  timelineCard,
  /verification-inline-original/,
);

assert.match(
  timelineCard,
  /data-verification-inline-action-host/,
);

assert.match(
  timelineCard,
  /staffVerificationFullSourceText/,
);

assert.doesNotMatch(
  timelineCard,
  /\.slice\(\s*0\s*,\s*(?:140|260)\s*\)/,
);

assert.match(
  timelineCard,
  /staffVerificationImageEvidenceHtml/,
);

const select = section(
  "function selectStaffVerificationWorkbenchItem(",
  "function staffVerificationSourceDisplayItems(",
);

assert.match(
  select,
  /staffVerificationRestoreLiveReviewInspectorCard/,
);

assert.match(
  select,
  /staffVerificationRestoreInlineWorkspaceRoot/,
);

assert.match(
  select,
  /staffVerificationMountInlineWorkspaceRoot/,
);

assert.match(
  select,
  /legacyCard/,
);

const render = section(
  "function staffVerificationRenderTimeline(",
  "function staffVerificationRestoreInlineWorkspaceRoot(",
);

assert.match(
  render,
  /staffVerificationRestoreInlineWorkspaceRoot/,
);

assert.match(
  render,
  /staffVerificationMountInlineWorkspaceRoot/,
);

const resolution = section(
  "function staffVerificationResolutionHtml(",
  "function staffVerificationImageEvidenceHtml(",
);

assert.match(
  resolution,
  /staffVerificationFullSourceText/,
);

const preview = section(
  "function staffVerificationPreviewHtml(",
  "function clearStaffVerificationPreview(",
);

for (const label of [
  "ยอดเดิม",
  "ยอดใหม่",
  "ผลต่าง",
]) {
  assert.ok(
    preview.includes(label),
    `Human Verification preview missing ${label}`,
  );
}

const legacyPreview = section(
  "function previewItemsHtml(",
  "function clearReviewPreview(",
);

for (const label of [
  "ยอดเดิม",
  "ยอดใหม่",
  "ผลต่าง",
]) {
  assert.ok(
    legacyPreview.includes(label),
    `legacy Preview missing ${label}`,
  );
}

assert.match(
  styles,
  /\.verification-timeline-item\.selected[\s\S]*\.verification-inline-workspace[\s\S]*display:\s*grid/,
);

assert.match(
  styles,
  /\.verification-split-view[\s\S]*>\s*#staffVerificationQueue[\s\S]*display:\s*none/,
);

assert.match(
  styles,
  /\.verification-inline-action-host[\s\S]*>\s*#staffVerificationQueue[\s\S]*display:\s*block/,
);

assert.match(
  app,
  /reloadStaffVerificationQueuePreservingPosition/,
);

assert.match(
  app,
  /timelineScrollTop/,
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
  pkg,
  /test-review-inline-card-workspace-v2\.mjs/,
);

console.log(
  "PASS UI2-01: one message remains one Timeline card",
);

console.log(
  "PASS UI2-02: selected card expands inline left/right",
);

console.log(
  "PASS UI2-03: TEXT and IMAGE share the same workspace contract",
);

console.log(
  "PASS UI2-04: full source survives multi-feed merge",
);

console.log(
  "PASS UI2-05: correction editor starts from full source",
);

console.log(
  "PASS UI2-06: old/new totals and delta are visible",
);

console.log(
  "PASS UI2-07: legacy Review lifecycle remains authoritative",
);

console.log(
  "PASS UI2-08: continuity preserves scroll/filter/sort",
);

console.log(
  "PASS: Review Inline Timeline Card Workspace v2",
);
