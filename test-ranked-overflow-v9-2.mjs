import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8"
  );

const css =
  fs.readFileSync(
    "public/styles.css",
    "utf8"
  );

// Summary: Top 20 first.
assert.match(
  app,
  /renderedRows\.slice\(0,\s*20\)/
);

assert.match(
  app,
  /renderedRows\.slice\(20\)/
);

// Shared expandable overflow.
assert.match(
  app,
  /function renderRankedOverflow/
);

assert.match(
  app,
  /ดูอีก \$\{formatNumber\(rowHtml\.length\)\} รหัส/
);

// Allocation: Top 20 helper retained.
assert.match(
  app,
  /function topAllocationVisibleCodes/
);

// Recommended rows outside Top 20
// must remain operationally visible.
assert.match(
  app,
  /const visible\s*=\s*[\s\S]*?top \|\| recommended > 0/
);

// Permanent hidden-row behavior must be gone.
assert.doesNotMatch(
  app,
  /allocation-ranked-hidden/
);

assert.doesNotMatch(
  css,
  /\.allocation-ranked-hidden/
);

// Native details UI.
assert.match(
  css,
  /\.ranked-overflow/
);

assert.match(
  css,
  /\.ranked-overflow-list/
);

assert.match(
  css,
  /\.ranked-overflow\[open\]/
);


// ---------------------------------------------------------
// Summary Top 20 is compact and scroll-free.
// ---------------------------------------------------------

assert.match(
  app,
  /summary-ranked-column/
);

assert.match(
  css,
  /\.summary-ranked-column \.board-code-list\s*\{[\s\S]*?max-height:none!important/
);

assert.match(
  css,
  /\.summary-ranked-column \.board-code-row\s*\{[\s\S]*?min-height:25px/
);


// ---------------------------------------------------------
// Allocation visible labels show code only.
//
// Category remains available in data attributes / aria-label,
// but must not be repeated in the visible code cell.
// ---------------------------------------------------------

const mainAllocationSource =
  app.slice(
    app.indexOf(
      "function renderLineGroupAllocationCategoryColumn("
    ),
    app.indexOf(
      "function renderLineGroupOneDigitCategory("
    ),
  );

const oneDigitAllocationSource =
  app.slice(
    app.indexOf(
      "function renderLineGroupOneDigitCategory("
    ),
    app.indexOf(
      "function renderAllocation()"
    ),
  );

assert.match(
  mainAllocationSource,
  /allocation-compact-code">\s*\$\{escapeHtml\(row\.code\)\}/
);

assert.doesNotMatch(
  mainAllocationSource,
  /allocation-compact-code">\s*\$\{escapeHtml\(category\)\}/
);

assert.match(
  oneDigitAllocationSource,
  /allocation-compact-code">\s*\$\{escapeHtml\(row\.code\)\}/
);

assert.doesNotMatch(
  oneDigitAllocationSource,
  /allocation-compact-code">\s*\$\{escapeHtml\(category\)\}/
);

// Category metadata remains intact for operations.
assert.match(
  mainAllocationSource,
  /data-category="\$\{escapeHtml\(category\)\}"/
);

assert.match(
  mainAllocationSource,
  /aria-label="เลือก \$\{escapeHtml\(category\)\}\$\{escapeHtml\(row\.code\)\}"/
);


// ---------------------------------------------------------
// Checkbox and visible code share one compact row.
// ---------------------------------------------------------

assert.match(
  css,
  /\.allocation-code-row\.allocation-compact-row,[\s\S]*?grid-template-columns:18px minmax\(0,1fr\)/
);

assert.match(
  css,
  /\.allocation-compact-row \.allocation-code-check\s*\{[\s\S]*?align-items:center/
);



// ---------------------------------------------------------
// Allocation Summary-style row contract.
// ---------------------------------------------------------

assert.match(
  app,
  /allocation-summary-row/
);

assert.match(
  app,
  /allocation-summary-main/
);

// Checkbox owns a separate column before code.
assert.match(
  css,
  /\.allocation-code-row\.allocation-summary-row,[\s\S]*?grid-template-columns:24px minmax\(0,1fr\)/
);

// Code / quantity / cut have independent columns.
assert.match(
  css,
  /\.allocation-summary-row \.allocation-summary-main\s*\{[\s\S]*?minmax\(38px,48px\)[\s\S]*?minmax\(58px,1fr\)[\s\S]*?minmax\(58px,max-content\)/
);

// Allocation Top 20 must not require an internal scroll.
assert.match(
  css,
  /\.allocation-board-column \.board-code-list,[\s\S]*?max-height:none!important[\s\S]*?overflow:visible!important/
);

// Visible code remains code-only.
assert.match(
  app,
  /allocation-compact-code">\s*\$\{escapeHtml\(row\.code\)\}/
);


console.log(
  "PASS: Top 20 + expandable overflow boards v9.2"
);
