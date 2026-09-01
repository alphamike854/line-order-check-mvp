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
  end > start,
  "report load safety block must exist"
);

const block =
  source.slice(start, end);

console.log(
  "===== Report LINE Group Request Safety v9.20 ====="
);

assert.match(
  block,
  /let reportLoadVersion = 0;/,
  "report loader must track request generation"
);

assert.match(
  block,
  /const loadVersion = \+\+reportLoadVersion;/,
  "each report load must get a new generation"
);

console.log(
  "PASS RLS-01: report requests are generation tracked"
);

assert.match(
  block,
  /const reportSummaryGroup =\s*summaryGroupSelect\.value \|\| "ALL";/,
  "summary group must be captured before request"
);

assert.match(
  block,
  /const reportLineGroup =\s*\$\("#reportLineGroupSelect"\)\.value \|\| "ALL";/,
  "LINE Group must be captured before request"
);

console.log(
  "PASS RLS-02: report filters use stable request snapshot"
);

const allGuard =
  block.indexOf(
    'if(reportLineGroup==="ALL")'
  );

const apiCall =
  block.indexOf(
    "/api/accounting-report?"
  );

assert.ok(
  allGuard >= 0 &&
  apiCall > allGuard,
  "ALL guard must run before accounting report API"
);

assert.match(
  block,
  /เลือก LINE Group เพื่อดูรายละเอียดรายงาน/,
  "ALL report must instruct operator to choose a LINE Group"
);

console.log(
  "PASS RLS-03: ALL view does not request full ledger"
);

assert.match(
  block,
  /group=\$\{encodeURIComponent\(reportSummaryGroup\)\}/,
  "request must use captured Summary Group"
);

assert.match(
  block,
  /line_group=\$\{encodeURIComponent\(reportLineGroup\)\}/,
  "request must use captured LINE Group"
);

assert.doesNotMatch(
  block,
  /line_group=\$\{encodeURIComponent\(\$\("#reportLineGroupSelect"\)\.value/,
  "request must not reread LINE Group DOM value"
);

console.log(
  "PASS RLS-04: selected LINE Group is sent explicitly"
);

const firstStaleGuard =
  block.indexOf(
    "if(loadVersion!==reportLoadVersion)return;"
  );

const renderCall =
  block.indexOf(
    "renderReport(payload);"
  );

assert.ok(
  firstStaleGuard >= 0 &&
  renderCall > firstStaleGuard,
  "stale success response must be rejected before render"
);

console.log(
  "PASS RLS-05: stale successful response cannot overwrite latest report"
);

const catchStart =
  block.indexOf(
    "catch(error)"
  );

const secondStaleGuard =
  block.indexOf(
    "if(loadVersion!==reportLoadVersion)return;",
    firstStaleGuard + 1
  );

assert.ok(
  catchStart >= 0 &&
  secondStaleGuard > catchStart,
  "stale failed response must be ignored inside catch"
);

console.log(
  "PASS RLS-06: stale failure cannot overwrite latest report"
);

assert.match(
  block,
  /state\.reportPayload=null;/,
  "ALL/error paths must clear stale export payload"
);

assert.match(
  block,
  /exportButton\.disabled=true/,
  "ALL/error paths must disable stale CSV export"
);

console.log(
  "PASS RLS-07: stale report export is disabled"
);

console.log(
  "PASS: report LINE Group request safety v9.20"
);
