import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("public/app.js", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");

const start = app.indexOf(
  "function renderPostCutCategoryColumn("
);

const end = app.indexOf(
  "function renderPostCutGroupBoard(",
  start
);

assert.ok(start >= 0);
assert.ok(end > start);

const source = app.slice(start, end);

// Top 20 ranked by the already-sorted codeRowsFor result.
assert.match(
  source,
  /rows\s*\.slice\(\s*0,\s*20\s*\)/
);

// A cut transaction outside Top 20 must stay visible.
assert.match(
  source,
  /top \|\| cut > 0/
);

// Remaining rows remain accessible.
assert.match(
  source,
  /renderRankedOverflow\(\s*overflowRows\s*\)/
);

// Summary-like compact columns.
assert.match(
  source,
  /postcut-summary-row/
);

assert.match(
  source,
  /postcut-summary-main/
);

assert.match(
  source,
  /postcut-table-head/
);

// Visible code is code only.
assert.match(
  source,
  /class="postcut-code"[\s\S]*?\$\{escapeHtml\(row\.code\)\}/
);

// Received / cut / retained are independent cells.
assert.match(source, /postcut-received/);
assert.match(source, /postcut-cut/);
assert.match(source, /postcut-retained/);

// Transfer round history remains available but collapsed.
assert.match(
  source,
  /postcut-round-details/
);

// No internal scroll for Top 20.
assert.match(
  css,
  /\.postcut-board-column\s+\.board-code-list\s*\{[\s\S]*?max-height\s*:\s*none!important[\s\S]*?overflow\s*:\s*visible!important/
);

// Four visual columns: code | received | cut | retained.
assert.match(
  css,
  /\.postcut-summary-main\s*\{[\s\S]*?grid-template-columns\s*:[\s\S]*?repeat\(\s*3\s*,\s*minmax\(\s*50px\s*,\s*1fr\s*\)\s*\)/
);

console.log(
  "PASS: After-cut ranked board v9.2.2"
);
