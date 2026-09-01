import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "public/app.js",
  "utf8"
);

const loadSettlementStart =
  source.indexOf(
    "async function loadSettlement()"
  );

const loadSettlementEnd =
  source.indexOf(
    "function focusCurrentSettlement",
    loadSettlementStart
  );

assert.ok(
  loadSettlementStart >= 0 &&
  loadSettlementEnd > loadSettlementStart
);

const block =
  source.slice(
    loadSettlementStart,
    loadSettlementEnd
  );

assert.match(
  block,
  /payload\.closed_sessions/
);

console.log(
  "PASS RH-01: closed settlement history remains in report selector"
);

assert.match(
  block,
  /previousSessionId && sessions\.some\(s=>s\.id===previousSessionId\)/
);

console.log(
  "PASS RH-02: existing valid report selection is preserved"
);

assert.match(
  block,
  /payload\.open_session\?\.id \|\| payload\.closed_sessions\?\.\[0\]\?\.id \|\| ""/
);

console.log(
  "PASS RH-03: latest closed session is fallback when no open session exists"
);

assert.match(
  block,
  /if\(reportSessionId\)select\.value=reportSessionId/
);

console.log(
  "PASS RH-04: resolved report session is explicitly selected"
);

const dashboardStart =
  source.indexOf(
    "async function loadDashboard("
  );

const dashboardEnd =
  source.indexOf(
    "function activateTab(",
    dashboardStart
  );

assert.ok(
  dashboardStart >= 0 &&
  dashboardEnd > dashboardStart
);

const dashboardBlock =
  source.slice(
    dashboardStart,
    dashboardEnd
  );

const settlementLoad =
  dashboardBlock.indexOf(
    "await loadSettlement();"
  );

const reportLoad =
  dashboardBlock.indexOf(
    'if (activeTab === "report") await loadReport();'
  );

assert.ok(
  settlementLoad >= 0 &&
  reportLoad > settlementLoad
);

console.log(
  "PASS RH-05: settlement selector resolves before report refresh"
);

const reportStart =
  source.indexOf(
    "async function loadReport("
  );

const reportEnd =
  source.indexOf(
    "function bindV5Controls",
    reportStart
  );

const reportBlock =
  source.slice(
    reportStart,
    reportEnd
  );

assert.match(
  reportBlock,
  /\$\("#reportSessionSelect"\)\.value \|\| state\.settlement\?\.open_session\?\.id/
);

console.log(
  "PASS RH-06: report loader consumes selected closed session"
);

console.log(
  "PASS: latest closed settlement report fallback v9.20"
);
