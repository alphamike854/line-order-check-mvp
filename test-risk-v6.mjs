import assert from "node:assert/strict";
import {
  DEFAULT_POINT_PROFILES,
  categoryRiskMetrics,
  compactTransferLines,
  effectiveMultiplier,
  overallRiskMetrics,
  pointExposure,
  selectReserveCandidates,
  validateActualSpecialCodes,
} from "./src/lib/risk-engine.mjs";

assert.equal(effectiveMultiplier(100, 50), 50);
assert.equal(pointExposure(12, 100, 50), 600);
assert.deepEqual(selectReserveCandidates([
  { code: "01", quantity: 50, multiplier: 14, promotion_factor_pct: 50 },
  { code: "02", quantity: 30, multiplier: 14, promotion_factor_pct: 100 },
], 1).map((x) => [x.code, x.exposure]), [["02", 420]]);

const fRisk = categoryRiskMetrics({
  adjustedTotal: 900,
  maxSpecialCodes: 6,
  candidates: [20,15,10,8,5,4,2].map((quantity, index) => ({ code:String(index+1).padStart(3,"0"), quantity, multiplier:20, promotion_factor_pct:100 })),
});
assert.equal(fRisk.point_reserve, (20+15+10+8+5+4)*20);
assert.equal(fRisk.reserve_candidates.length, 6);

const gReserve = selectReserveCandidates([10,8,7,5,4].map((quantity,index)=>({ code:String(index+1).padStart(3,"0"), quantity, multiplier:20, promotion_factor_pct:100 })),4);
assert.equal(gReserve.length,4);
assert.equal(gReserve.reduce((sum,row)=>sum+row.exposure,0),(10+8+7+5)*20);

const overall = overallRiskMetrics({ adjustedTotal: 3700, pointReserve: 2050, confirmedCut: 1000, pointLossTolerance: 10 });
assert.equal(overall.adjusted_total, 3700);
assert.equal(overall.risk_point_total, 2050);
assert.equal(overall.risk_mode, "RESERVE");
assert.equal(overall.net_safe_capacity, 1650); // legacy alias of Safety Margin
assert.equal(overall.safety_margin, 1650);
assert.equal(overall.risk_pct, 55.41);
assert.equal(overall.risk_budget, 3710);
assert.equal(overall.excess_point_risk, 0);

assert.deepEqual(compactTransferLines([
  {category:"A",code:"01",quantity:100},
  {category:"B",code:"01",quantity:100},
  {category:"A",code:"02",quantity:200},
  {category:"E",code:"125",quantity:50},
]), ["AB 01=100*100", "A 02=200", "E 125=50"]);

assert.deepEqual(validateActualSpecialCodes([
  {category:"A",code:"01"},
  {category:"B",code:"02"},
  {category:"E",code:"125"},
  {category:"G",code:"001"},
  {category:"G",code:"125"},
  {category:"G",code:"653"},
  {category:"G",code:"728"},
], DEFAULT_POINT_PROFILES), { A:1, B:1, E:1, G:4 });

assert.throws(() => validateActualSpecialCodes([{category:"A",code:"01"},{category:"A",code:"02"}], DEFAULT_POINT_PROFILES), /SPECIAL_POINT_LIMIT_A/);
console.log("PASS: Risk reserve + safe capacity v6 smoke tests");

import { createRiskTransferToken, verifyRiskTransferToken } from "./src/lib/risk-transfer-safety.mjs";
const signed = createRiskTransferToken({
  riskState:{settlement_session_id:"11111111-1111-4111-8111-111111111111",summary_group_id:"NORTH",risk_mode:"RESERVE",adjusted_received:1000,risk_point_total:1200,safety_margin:-200,risk_pct:120,point_loss_tolerance:10,risk_budget:1010,excess_point_risk:190,confirmed_cut_total:50},
  destination:"คลัง 2",
  destinationLimit:5,
  items:[{category:"A",code:"01",quantity:3,expected_retained_quantity:20,expected_effective_multiplier:14,expected_recommended_transfer:10},{category:"B",code:"01",quantity:2,expected_retained_quantity:10,expected_effective_multiplier:14,expected_recommended_transfer:5}],
  requestId:"22222222-2222-4222-8222-222222222222",
  nowMs:1_700_000_000_000,
  key:"test-key",
});
assert.deepEqual(signed.lines,["AB 01=3*2"]);
const verified=verifyRiskTransferToken({token:signed.token,nowMs:1_700_000_100_000,key:"test-key"});
assert.equal(verified.ok,true);
assert.equal(verified.cut_total,5);
assert.equal(verified.destination_limit,5);
