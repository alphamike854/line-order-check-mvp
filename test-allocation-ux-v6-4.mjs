import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(
  new URL("./public/index.html", import.meta.url),
  "utf8"
);

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

// Current Allocation UI surface
assert.match(html, /id="allocationTab"/);
assert.match(html, /เลือกรหัสได้หลายตัว ระบบแบ่งรอบให้เอง/);
assert.match(html, /id="allocationRiskSummary"/);
assert.match(html, /id="bulkDistributionControls"/);
assert.match(html, /id="warehouseChoices"/);
assert.match(html, /id="bulkDistributionSummary"/);
assert.match(html, /id="runBulkDistributionButton"/);
assert.match(html, /id="transferPreview"/);
assert.match(html, /id="allocationBoard"/);
assert.match(html, /id="allocationHistoryList"/);

// Current frontend allocation state
assert.match(app, /transferPreview:\s*null/);
assert.match(app, /bulkDistributionPreview:\s*null/);
assert.match(app, /allocationHistory:\s*\[\]/);

// Freshness / stale-data safety
assert.match(app, /function setDashboardStale/);
assert.match(app, /state\.dashboardStale/);
assert.match(app, /runBulkDistributionButton/);
assert.match(app, /ข้อมูลเปลี่ยน กรุณาอัปเดต/);

// Dashboard still exposes current risk / transfer metrics
assert.match(app, /metrics\.risk_budget/);
assert.match(app, /metrics\.excess_point_risk/);
assert.match(app, /metrics\.transfer_required_total/);

console.log(
  "PASS: Current allocation UX + stale-data safety contract smoke tests"
);
