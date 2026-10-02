import assert from "node:assert/strict";
import fs from "node:fs";

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8",
  );

function sliceBetween(
  source,
  startMarker,
  endMarker,
) {
  const start =
    source.indexOf(startMarker);

  const end =
    source.indexOf(
      endMarker,
      start,
    );

  assert.ok(
    start >= 0
      && end > start,
    `cannot isolate ${startMarker}`,
  );

  return source.slice(
    start,
    end,
  );
}

console.log(
  "===== Report LINE Group Detail-First Safety v1 =====",
);

const loadReport =
  sliceBetween(
    app,
    "async function loadReport(options = {})",
    "function bindV5Controls()",
  );

assert.match(
  app,
  /let reportLoadVersion = 0;/,
);

assert.match(
  loadReport,
  /const loadVersion\s*=\s*\+\+reportLoadVersion;/,
);

console.log(
  "PASS RLS-01: report generation guard retained",
);

assert.match(
  loadReport,
  /const reportSummaryGroup\s*=\s*summaryGroupSelect\.value\s*\|\|\s*"ALL"/,
);

assert.match(
  loadReport,
  /const reportLineGroup\s*=\s*\$\("#reportLineGroupSelect"\)\.value\s*\|\|\s*"ALL"/,
);

console.log(
  "PASS RLS-02: stable Report scope snapshot retained",
);

const allGuardIndex =
  loadReport.indexOf(
    'if (reportLineGroup === "ALL")',
  );

const apiIndex =
  loadReport.indexOf(
    "await api(reportPath)",
  );

assert.ok(
  allGuardIndex >= 0,
  "ALL guard missing",
);

assert.ok(
  apiIndex > allGuardIndex,
  "API call must follow ALL guard",
);

const allGuard =
  loadReport.slice(
    allGuardIndex,
    apiIndex,
  );

assert.match(
  allGuard,
  /เลือก LINE Group เพื่อดูและตรวจรายละเอียด/,
);

assert.match(
  allGuard,
  /\breturn;/,
);

console.log(
  "PASS RLS-03: ALL stops before Accounting API",
);

assert.doesNotMatch(
  loadReport,
  /summary_only=1/,
);

assert.doesNotMatch(
  loadReport,
  /summaryOnlyQuery/,
);

console.log(
  "PASS RLS-04: browser summary-only request removed",
);

assert.match(
  loadReport,
  /line_group=\$\{encodeURIComponent\(\s*reportLineGroup/,
);

console.log(
  "PASS RLS-05: selected LINE Group is explicit",
);

const staleGuards =
  loadReport.match(
    /loadVersion\s*!==\s*reportLoadVersion/g,
  )
  ?? [];

assert.ok(
  staleGuards.length >= 2,
  "success/failure stale guards required",
);

console.log(
  "PASS RLS-06: stale success/failure guards retained",
);

assert.match(
  allGuard,
  /exportButton\.disabled\s*=\s*true/,
);

console.log(
  "PASS RLS-07: ALL cannot export nonexistent ledger",
);

const metricLine =
  app
    .split("\n")
    .find(
      (line) =>
        line.includes(
          'class="report-metrics"',
        )
        && line.includes(
          "g.received_total",
        ),
    );

assert.ok(
  metricLine,
  "selected LINE Group metric row missing",
);

assert.match(
  metricLine,
  /ยอดรับจริง/,
);

assert.match(
  metricLine,
  /Point พิเศษ/,
);

assert.doesNotMatch(
  metricLine,
  /ยอดหลังลด|ยอดสุทธิเทียบ|<span>ลด<\/span>/,
);

console.log(
  "PASS RLS-08: detail card exposes only received total + Special Point",
);

console.log(
  "PASS: Report LINE Group Detail-First Safety v1",
);
