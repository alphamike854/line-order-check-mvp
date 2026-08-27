import fs from "node:fs";
import assert from "node:assert/strict";
import { buildRiskDistributionPlan } from "./src/lib/risk-engine.mjs";

const dashboard = fs.readFileSync(
  new URL("./netlify/functions/dashboard.mjs", import.meta.url),
  "utf8"
);

const app = fs.readFileSync(
  new URL("./public/app.js", import.meta.url),
  "utf8"
);

// The engine still preserves the bounded unit-by-unit contract.
assert.throws(
  () => buildRiskDistributionPlan({
    rows: [{
      category:"A",
      code:"01",
      retained_quantity:10,
      effective_multiplier:14,
      max_special_codes:1,
    }],
    adjustedTotal:0,
    pointLossTolerance:0,
    maxSimulationUnits:1,
  }),
  /RISK_DISTRIBUTION_SIMULATION_LIMIT/
);

// A single heavy risk pool must no longer take down the whole dashboard.
assert.match(dashboard, /RISK_DISTRIBUTION_SIMULATION_LIMIT/);
assert.match(dashboard, /maxSimulationUnits:5000/);
assert.match(dashboard, /calculation_status:"LIMIT"/);
assert.match(dashboard, /distribution_incomplete:distributionIncomplete/);
assert.match(dashboard, /transfer_required_total:null/);

// UI must never present a failed calculation as "0 / no cut required".
assert.match(app, /function distributionPlanCalculationFailed/);
assert.match(app, /function anyDistributionPlanCalculationFailed/);
assert.match(app, /คำนวณไม่สำเร็จ/);
assert.match(app, /ยังไม่ควรตัดยอดจนกว่าจะคำนวณใหม่ได้/);
assert.match(app, /แผนตัดยอดคำนวณไม่สำเร็จ กรุณายังไม่ตัดยอด/);

console.log(
  "PASS: dashboard survives risk simulation limit without unsafe zero fallback v8.9.2"
);
