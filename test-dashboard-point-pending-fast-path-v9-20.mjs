import assert from "node:assert/strict";
import fs from "node:fs";

const dashboard = fs.readFileSync(
  new URL(
    "./netlify/functions/dashboard.mjs",
    import.meta.url,
  ),
  "utf8",
);

const app = fs.readFileSync(
  new URL(
    "./public/app.js",
    import.meta.url,
  ),
  "utf8",
);

console.log(
  "===== Dashboard Point Pending Fast Path v9.20 =====",
);

const readinessGate =
  dashboard.indexOf(
    "pool.actual_codes_ready===false",
  );

const simulation =
  dashboard.indexOf(
    "const plan=buildRiskDistributionPlan({",
  );

assert.ok(
  readinessGate >= 0,
  "Point readiness gate missing",
);

assert.ok(
  simulation > readinessGate,
  "Point readiness must precede simulation",
);

console.log(
  "PASS DP-01 Point readiness precedes expensive simulation",
);

assert.match(
  dashboard,
  /calculation_status:"NOT_READY"/,
);

assert.match(
  dashboard,
  /calculation_error:"ACTUAL_POINT_CODES_INCOMPLETE"/,
);

assert.match(
  dashboard,
  /transfer_required_total:null/,
);

assert.match(
  dashboard,
  /recommendations:\[\]/,
);

console.log(
  "PASS DP-02 incomplete Point returns safe NOT_READY plan",
);

assert.match(
  dashboard,
  /calculation_status:"LIMIT"/,
);

assert.match(
  dashboard,
  /RISK_DISTRIBUTION_SIMULATION_LIMIT/,
);

console.log(
  "PASS DP-03 simulation LIMIT semantics remain intact",
);

assert.match(
  dashboard,
  /const distributionPointPending=/,
);

assert.match(
  dashboard,
  /distribution_point_pending:distributionPointPending/,
);

console.log(
  "PASS DP-04 Point pending remains distinct from simulation failure",
);

assert.match(
  dashboard,
  /distributionIncomplete\|\|distributionPointPending/,
);

console.log(
  "PASS DP-05 pending Point cannot become unsafe zero transfer",
);

assert.match(
  app,
  /metrics\.distribution_point_pending/,
);

assert.match(
  app,
  /รอระบุ Point/,
);

assert.match(
  app,
  /plan\?\.calculation_status === "NOT_READY"/,
);

console.log(
  "PASS DP-06 UI identifies Point pending correctly",
);

assert.match(
  app,
  /calculationFailed \|\| pointPending/,
);

console.log(
  "PASS DP-07 pending H\/L cannot expose recommendations",
);

console.log(
  "PASS: Dashboard Point Pending Fast Path v9.20",
);
