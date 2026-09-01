import assert from "node:assert/strict";
import fs from "node:fs";

const source =
  fs.readFileSync(
    "public/app.js",
    "utf8"
  );

const start =
  source.indexOf(
    "let reportLoadVersion = 0;"
  );

const end =
  source.indexOf(
    "function bindV5Controls()",
    start
  );

assert.ok(
  start >= 0 &&
  end > start
);

const block =
  source.slice(start, end);

console.log(
  "===== Report LINE Group Request Safety v9.20 ====="
);

assert.match(
  block,
  /let reportLoadVersion = 0;/
);

assert.match(
  block,
  /const loadVersion = \+\+reportLoadVersion;/
);

console.log(
  "PASS RLS-01: report requests are generation tracked"
);

assert.match(
  block,
  /const reportSummaryGroup =\s*summaryGroupSelect\.value \|\| "ALL";/
);

assert.match(
  block,
  /const reportLineGroup =\s*\$\("#reportLineGroupSelect"\)\.value \|\| "ALL";/
);

console.log(
  "PASS RLS-02: report filters use stable request snapshot"
);

assert.match(
  block,
  /const summaryOnly=\s*reportLineGroup==="ALL";/
);

assert.match(
  block,
  /summaryOnly\s*\?\s*"&summary_only=1"\s*:\s*""/
);

console.log(
  "PASS RLS-03: ALL requests summary-only instead of full ledger"
);

assert.match(
  block,
  /line_group=\$\{encodeURIComponent\(reportLineGroup\)\}/
);

assert.doesNotMatch(
  block,
  /line_group=\$\{encodeURIComponent\(\$\("#reportLineGroupSelect"\)/
);

console.log(
  "PASS RLS-04: selected LINE Group is sent explicitly"
);

const firstGuard =
  block.indexOf(
    "if(loadVersion!==reportLoadVersion)return;"
  );

const render =
  block.indexOf(
    "renderReport(payload);"
  );

assert.ok(
  firstGuard >= 0 &&
  render > firstGuard
);

console.log(
  "PASS RLS-05: stale successful response cannot overwrite latest report"
);

const catchStart =
  block.indexOf(
    "catch(error)"
  );

const secondGuard =
  block.indexOf(
    "if(loadVersion!==reportLoadVersion)return;",
    firstGuard + 1
  );

assert.ok(
  catchStart >= 0 &&
  secondGuard > catchStart
);

console.log(
  "PASS RLS-06: stale failure cannot overwrite latest report"
);

assert.match(
  source,
  /payload\?\.summary_only===true/
);

assert.match(
  source,
  /summaryOnly\s*\|\|\s*!payload\?\.session/
);

console.log(
  "PASS RLS-07: summary-only payload cannot export incomplete ledger CSV"
);

console.log(
  "PASS: report LINE Group request safety v9.20"
);
