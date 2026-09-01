import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

const css = fs.readFileSync(
  new URL("./public/styles.css", import.meta.url),
  "utf8"
);

console.log(
  "===== Promotion Code Visual Cue v9.19 ====="
);


function section(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);

  assert.ok(
    from >= 0 && to > from,
    `missing section: ${start}`
  );

  return app.slice(from, to);
}


// One shared source of truth: Summary Group + category + code.
const helper = section(
  "function promotionFactorForSummaryCode(",
  "function promotionCodeClass("
);

assert.match(
  helper,
  /item\.summary_group_id === summaryGroupId/
);

assert.match(
  helper,
  /item\.category === category/
);

assert.match(
  helper,
  /String\(item\.code\) === String\(code\)/
);

console.log(
  "PASS PCV-01 Promotion cue remains Summary-Group scoped"
);


// Shared visual helpers.
assert.match(
  app,
  /function promotionCodeClass\(factor\)/
);

assert.match(
  app,
  /function promotionCodeCue\(factor\)/
);

assert.match(
  app,
  /class="promotion-code-cue"/
);

console.log(
  "PASS PCV-02 shared row + percentage cue helpers exist"
);


// Summary A/B/E/F.
const summary = section(
  "function renderCategoryColumn(groupId, category) {",
  "function renderOneDigitSummaryCategory(groupId, category) {"
);

assert.match(
  summary,
  /promotionFactorForSummaryCode\([\s\S]*?groupId,[\s\S]*?category,[\s\S]*?row\.code/
);

assert.match(
  summary,
  /\$\{promotionClass\}/
);

assert.match(
  summary,
  /\$\{promotionCue\}/
);

console.log(
  "PASS PCV-03 Summary ranked codes show Promotion cue"
);


// Summary H/L.
const summaryOneDigit = section(
  "function renderOneDigitSummaryCategory(groupId, category) {",
  "function renderOneDigitSummaryPair(groupId) {"
);

assert.match(
  summaryOneDigit,
  /promotionFactorForSummaryCode/
);

assert.match(
  summaryOneDigit,
  /\$\{promotionCue\}/
);

console.log(
  "PASS PCV-04 H/L Summary codes show Promotion cue"
);


// Summary G.
const groupBoard = section(
  "function renderGroupBoard(groupId) {",
  "function renderSummary() {"
);

assert.match(
  groupBoard,
  /promotionFactorForSummaryCode\(groupId, "G", row\.code\)/
);

assert.match(
  groupBoard,
  /promotionCodeCue\(promotionFactorForSummaryCode\(groupId, "G", row\.code\)\)/
);

console.log(
  "PASS PCV-05 G Summary codes show Promotion cue"
);


// Current LINE Group allocation renderer.
const allocation = section(
  "function renderLineGroupAllocationCategoryColumn(",
  "function renderLineGroupOneDigitCategory("
);

assert.match(
  allocation,
  /promotionFactorForSummaryCode\([\s\S]*?row\.summary_group_id/
);

assert.match(
  allocation,
  /\$\{promotionClass\}/
);

assert.match(
  allocation,
  /\$\{promotionCue\}/
);

console.log(
  "PASS PCV-06 active LINE Group Allocation shows scoped Promotion"
);


// Current H/L allocation renderer.
const allocationOneDigit = section(
  "function renderLineGroupOneDigitCategory(",
  "function renderAllocation() {"
);

assert.match(
  allocationOneDigit,
  /promotionFactorForSummaryCode/
);

assert.match(
  allocationOneDigit,
  /\$\{promotionCue\}/
);

console.log(
  "PASS PCV-07 H/L Allocation shows Promotion cue"
);


// After-cut board.
const postCut = section(
  "function renderPostCutCategoryColumn(groupId, category, roundsByCode) {",
  "function renderPostCutGroupBoard(groupId, roundsByCode) {"
);

assert.match(
  postCut,
  /promotionFactorForSummaryCode/
);

assert.match(
  postCut,
  /\$\{promotionClass\}/
);

assert.match(
  postCut,
  /\$\{promotionCue\}/
);

console.log(
  "PASS PCV-08 After-cut codes retain Promotion cue"
);


// G After-cut.
const postCutGroup = section(
  "function renderPostCutGroupBoard(groupId, roundsByCode) {",
  "function renderAfterCut() {"
);

assert.match(
  postCutGroup,
  /promotionFactorForSummaryCode\([\s\S]*?groupId,[\s\S]*?"G"/
);

assert.match(
  postCutGroup,
  /promotionCodeCue\(promotionFactor\)/
);

console.log(
  "PASS PCV-09 G After-cut shows Promotion cue"
);


// CSS is a visual layer only — no replacement of risk backgrounds.
assert.match(
  css,
  /\/\* v9\.19: Promotion code visual cue/
);

assert.match(
  css,
  /\.promotion-code-row::before\s*\{[\s\S]*?width:3px[\s\S]*?background:#7c3aed/
);

assert.match(
  css,
  /\.promotion-code-cue,[\s\S]*?background:#ede9fe[\s\S]*?color:#6d28d9/
);

console.log(
  "PASS PCV-10 purple rail + compact percentage badge are styled"
);

console.log(
  "PASS: Promotion Code Visual Cue v9.19"
);
