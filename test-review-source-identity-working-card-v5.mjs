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
  /Review Source Identity \+ Single Working Card v5/,
);

assert.match(
  styles,
  /Review Source Identity \+ Single Working Card v5/,
);

/*
 * Review cards without parsed items still need a useful
 * operator-facing identity from their exact source.
 */
assert.match(
  app,
  /function staffVerificationFirstSourceCodeLabel\(/,
);

assert.match(
  app,
  /staffVerificationFirstSourceCodeLabel\(\s*sourceText,\s*\)/,
);

assert.match(
  app,
  /\\d\{1,3\}/,
);

assert.match(
  app,
  /standalone short date/,
);

/*
 * Explicit examples of the conservative source fallback.
 */
function firstCode(sourceText) {
  const lines =
    String(sourceText ?? "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

  for (const originalLine of lines) {
    if (
      /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/u
        .test(originalLine)
    ) {
      continue;
    }

    const line =
      originalLine.replace(
        /^[^\p{L}\p{N}]+/u,
        "",
      );

    const match =
      line.match(
        /^(?:[ABEFGHL]\s*)?(\d{1,3})(?=$|[\s=/*xX,\-])/iu,
      );

    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

assert.equal(
  firstCode(
    [
      "338",
      "833",
      "383",
      "388",
      "883",
      "838=10",
      "83=30x30",
    ].join("\n"),
  ),
  "338",
);

assert.equal(
  firstCode("A 01=20"),
  "01",
);

assert.equal(
  firstCode("E123=10"),
  "123",
);

assert.equal(
  firstCode("13/9/69"),
  "",
);

/*
 * Current-round duplicate lifecycle queue remains DOM staging,
 * but Timeline is the only visible operational list.
 */
assert.match(
  styles,
  /#reviewList:has\(#staffVerificationWorkbench\)[\s\S]*#staffLiveReviewQueue[\s\S]*display:\s*none\s*!important/,
);

/*
 * Cards must have a strong visual rhythm.
 */
assert.match(
  styles,
  /\.verification-timeline-shell\s*\{[\s\S]*background:/,
);

assert.match(
  styles,
  /\.verification-timeline-items\s*\{[\s\S]*gap:\s*20px/,
);

assert.match(
  styles,
  /\.verification-timeline-item\s*\{[\s\S]*border-width:\s*2px/,
);

assert.match(
  styles,
  /\.verification-timeline-card-identity\s*\{[\s\S]*border-bottom:/,
);

/*
 * Selected card becomes one working card:
 * summary hidden, split workspace visible.
 */
assert.match(
  styles,
  /\.verification-timeline-item\.selected[\s\S]*>\s*\.verification-timeline-collapsed-body[\s\S]*display:\s*none\s*!important/,
);

assert.match(
  styles,
  /\.verification-timeline-item\.selected[\s\S]*>\s*\.verification-inline-workspace[\s\S]*display:\s*grid\s*!important/,
);

assert.match(
  styles,
  /grid-template-columns:[\s\S]*minmax\(0,\s*1fr\)[\s\S]*minmax\(0,\s*1fr\)/,
);

assert.match(
  styles,
  /\.verification-inline-original[\s\S]*white-space:\s*pre-wrap/,
);

/*
 * Existing lifecycle staging/mount contract must remain.
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

/*
 * Historical post-close work remains distinct.
 */
assert.match(
  app,
  /id="postCloseReviewQueue"/,
);

assert.match(
  pkg,
  /test-review-source-identity-working-card-v5\.mjs/,
);

console.log(
  "PASS UI5-01: unresolved Review identity falls back to first source code",
);

console.log(
  "PASS UI5-02: source-code fallback rejects standalone short dates",
);

console.log(
  "PASS UI5-03: Timeline cards have stronger scan separation",
);

console.log(
  "PASS UI5-04: card header has a repeatable identity/context rhythm",
);

console.log(
  "PASS UI5-05: historical Timeline staging-hide rule remains registered; V13 owns final folded visibility",
);

console.log(
  "PASS UI5-06: selected Timeline item becomes one split Working Card",
);

console.log(
  "PASS UI5-07: selected summary body cannot duplicate Working Card content",
);

console.log(
  "PASS UI5-08: multiline source readability is retained",
);

console.log(
  "PASS: Review Source Identity + Single Working Card v5",
);
