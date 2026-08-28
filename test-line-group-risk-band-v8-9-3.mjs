import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_RISK_BAND_SIZE,
  calculateLineGroupRiskBand,
} from "./src/lib/risk-engine.mjs";

assert.equal(DEFAULT_RISK_BAND_SIZE, 100000);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 0,
    reductionPct: 40,
  }),
  {
    gross_received: 0,
    calculation_band: 0,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 0,
    calculation_status: "WAITING_FIRST_BAND",
    amount_to_next_band: 100000,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 99999,
    reductionPct: 40,
  }),
  {
    gross_received: 99999,
    calculation_band: 0,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 0,
    calculation_status: "WAITING_FIRST_BAND",
    amount_to_next_band: 1,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 100000,
    reductionPct: 40,
  }),
  {
    gross_received: 100000,
    calculation_band: 100000,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 60000,
    calculation_status: "READY",
    amount_to_next_band: 100000,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 487174,
    reductionPct: 40,
  }),
  {
    gross_received: 487174,
    calculation_band: 400000,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 240000,
    calculation_status: "READY",
    amount_to_next_band: 12826,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 1000000,
    reductionPct: 40,
  }),
  {
    gross_received: 1000000,
    calculation_band: 1000000,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 600000,
    calculation_status: "READY",
    amount_to_next_band: 100000,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 1099999,
    reductionPct: 40,
  }),
  {
    gross_received: 1099999,
    calculation_band: 1000000,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 600000,
    calculation_status: "READY",
    amount_to_next_band: 1,
  },
);

assert.deepEqual(
  calculateLineGroupRiskBand({
    grossReceived: 1100000,
    reductionPct: 40,
  }),
  {
    gross_received: 1100000,
    calculation_band: 1100000,
    reduction_pct: 40,
    risk_budget_pct: 60,
    risk_budget: 660000,
    calculation_status: "READY",
    amount_to_next_band: 100000,
  },
);

assert.throws(
  () => calculateLineGroupRiskBand({
    grossReceived: -1,
    reductionPct: 40,
  }),
  /INVALID_LINE_GROUP_GROSS_RECEIVED/,
);

assert.throws(
  () => calculateLineGroupRiskBand({
    grossReceived: 100000,
    reductionPct: 101,
  }),
  /INVALID_LINE_GROUP_REDUCTION_PCT/,
);

const migration = fs.readFileSync(
  "supabase/migrations/20260828033000_add_line_group_risk_band_state.sql",
  "utf8",
);

assert.match(
  migration,
  /session_line_group_risk_band_state/,
  "migration must create LINE Group risk state",
);

assert.match(
  migration,
  /cfg\.line_group_id/,
  "risk state must retain LINE Group identity",
);

assert.match(
  migration,
  /floor\(t\.gross_received::numeric\s*\/\s*100000\)/,
  "risk calculation must advance in 100,000 bands",
);

assert.match(
  migration,
  /\(100\s*-\s*b\.reduction_pct\)/,
  "risk budget must use the retained percentage after LINE Group reduction",
);

assert.match(
  migration,
  /WAITING_FIRST_BAND/,
  "groups below 100,000 must not authorize automatic risk cuts",
);

assert.doesNotMatch(
  migration,
  /point_loss_tolerance/,
  "new LINE Group Risk Budget must not use the legacy tolerance formula",
);

console.log(
  "PASS: LINE Group 100k Risk Band foundation v8.9.3",
);
