import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

// Saving Point must refresh the report.
assert.match(
  app,
  /async function saveSpecialPoints[\s\S]*await loadReport\(\)/,
  "saving Point should refresh the report"
);

// Presence and completeness are different states.
assert.match(
  app,
  /const pointSpecified=Boolean\(\(payload\.actual_special_codes\|\|\[\]\)\.length\)/,
  "report should detect saved Point codes independently from completeness"
);

assert.match(
  app,
  /pointSpecified\?formatNumber\(g\.special_point_total\):"รอระบุ"/,
  "saved Point total should be displayed immediately"
);

assert.match(
  app,
  /finalReady\?formatNumber\(g\.reconciliation_total\):"—"/,
  "reconciliation should remain provisional until Point is complete"
);

assert.match(
  app,
  /Point ระบุแล้ว · ยังไม่ครบ/,
  "partial Point state should be explicit"
);

// CSV must follow the same semantics.
assert.match(
  app,
  /const pointSpecified = Boolean\(\(payload\?\.actual_special_codes \|\| \[\]\)\.length\)/,
  "CSV should detect saved Point codes"
);

assert.match(
  app,
  /pointSpecified \? \(group\.special_point_total \?\? 0\) : "รอระบุ"/,
  "CSV should export the currently calculated Point"
);

console.log("PASS: partial/saved Point report visibility v8.5");
