import assert from "node:assert/strict";
import fs from "node:fs";

import {
  calculateLineGroupRiskBand,
  retainedReserveSnapshot,
} from "./src/lib/risk-engine.mjs";


function riskRow(
  category,
  code,
  quantity,
  multiplier,
  maxSpecialCodes,
) {
  return {
    category,
    code,
    order_total: quantity,
    retained_quantity: quantity,
    confirmed_cut: 0,
    effective_multiplier: multiplier,
    max_special_codes: maxSpecialCodes,
  };
}


const rows = [
  riskRow("A", "01", 4000, 70, 1),
  riskRow("B", "01", 3000, 70, 1),

  riskRow("E", "123", 100, 550, 1),

  riskRow("F", "101", 50, 100, 6),
  riskRow("F", "102", 50, 100, 6),
  riskRow("F", "103", 50, 100, 6),
  riskRow("F", "104", 50, 100, 6),
  riskRow("F", "105", 50, 100, 6),
  riskRow("F", "106", 50, 100, 6),

  riskRow("G", "001", 40, 100, 4),
  riskRow("G", "002", 40, 100, 4),
  riskRow("G", "003", 40, 100, 4),
  riskRow("G", "004", 30, 100, 4),

  riskRow("H", "1", 200, 3, 3),
  riskRow("H", "2", 150, 3, 3),
  riskRow("H", "3", 150, 3, 3),

  riskRow("L", "1", 150, 4, 2),
  riskRow("L", "2", 150, 4, 2),
];


const snapshot = retainedReserveSnapshot(rows);

assert.equal(
  snapshot.category_reserve.A,
  280000,
);

assert.equal(
  snapshot.category_reserve.B,
  210000,
);

assert.equal(
  snapshot.category_reserve.E,
  55000,
);

assert.equal(
  snapshot.category_reserve.F,
  30000,
);

assert.equal(
  snapshot.category_reserve.G,
  15000,
);

assert.equal(
  snapshot.category_reserve.H,
  1500,
);

assert.equal(
  snapshot.category_reserve.L,
  1200,
);

assert.equal(
  snapshot.point_reserve,
  592700,
);


const oneMillionBand = calculateLineGroupRiskBand({
  grossReceived: 1000000,
  reductionPct: 40,
});

assert.equal(
  oneMillionBand.risk_budget,
  600000,
);

assert.equal(
  snapshot.point_reserve <= oneMillionBand.risk_budget,
  true,
  "592,700 exposure must remain inside the 600,000 Risk Budget",
);


// Increasing A01 from 4,000 to 5,000 raises exposure by 70,000.
const overRiskRows = rows.map((row) =>
  row.category === "A" && row.code === "01"
    ? {
        ...row,
        order_total: 5000,
        retained_quantity: 5000,
      }
    : row,
);

const overRisk = retainedReserveSnapshot(overRiskRows);

assert.equal(
  overRisk.point_reserve,
  662700,
);

assert.equal(
  overRisk.point_reserve - oneMillionBand.risk_budget,
  62700,
);

assert.equal(
  overRisk.point_reserve > oneMillionBand.risk_budget,
  true,
);


const migration = fs.readFileSync(
  "supabase/migrations/20260828034000_add_line_group_point_exposure_state.sql",
  "utf8",
);

assert.match(
  migration,
  /session_line_group_code_risk_state/,
);

assert.match(
  migration,
  /session_line_group_category_risk_state/,
);

assert.match(
  migration,
  /session_line_group_risk_state/,
);

assert.match(
  migration,
  /partition by[\s\S]*e\.settlement_session_id,[\s\S]*e\.line_group_id,[\s\S]*e\.category/i,
  "reserve ranking must be isolated by LINE Group and category",
);

assert.match(
  migration,
  /settlement_point_profiles/,
  "company Point multiplier must come from settlement snapshot",
);

assert.match(
  migration,
  /reserve_rank\s*<=\s*r\.max_special_codes/,
  "worst-case code count must follow the settlement Point profile",
);

assert.match(
  migration,
  /WAITING_FIRST_BAND/,
);

assert.match(
  migration,
  /UNCONFIGURED/,
);

assert.match(
  migration,
  /CUT_REQUIRED/,
);

assert.doesNotMatch(
  migration,
  /settlement_transfer_batch_items/,
  "Phase 1D must not attribute or subtract legacy transfer items",
);

assert.doesNotMatch(
  migration,
  /point_loss_tolerance/,
  "new LINE Group Risk calculation must not use legacy tolerance",
);

console.log(
  "PASS: LINE Group Point exposure state v8.9.3",
);
