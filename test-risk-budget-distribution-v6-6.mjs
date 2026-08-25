import fs from "node:fs";
import assert from "node:assert/strict";
import {
  buildRiskDistributionPlan,
  projectRiskAfterTransfers,
  retainedReserveSnapshot,
} from "./src/lib/risk-engine.mjs";
import { createRiskTransferToken, verifyRiskTransferToken } from "./src/lib/risk-transfer-safety.mjs";
import { validateRiskBudget, validateWarehouseLimit } from "./src/lib/settings-validation.mjs";

// User-confirmed business example: 100 orders -> after 40% = 60, accepted loss 10,
// x7 special Point => warehouse can retain 10; 35 received means distribute 25.
const simple = buildRiskDistributionPlan({
  adjustedTotal: 60,
  pointLossTolerance: 10,
  rows: [{ category:"A", code:"01", order_total:35, retained_quantity:35, confirmed_cut:0, effective_multiplier:7, max_special_codes:1 }],
});
assert.equal(simple.risk_budget,70);
assert.equal(simple.point_reserve_before,245);
assert.equal(simple.excess_point_risk_before,175);
assert.equal(simple.transfer_required_total,25);
assert.deepEqual(simple.recommendations.map((r)=>[r.category,r.code,r.recommended_transfer,r.projected_retained]),[["A","01",25,10]]);
assert.equal(simple.point_reserve_after_plan,70);

// A worst-case top-1 must re-rank dynamically. Reducing only the current top code is
// not enough; all three eventually level at 12 units so the max exposure is 168 <= 178.
const dynamic = buildRiskDistributionPlan({
  adjustedTotal:168,
  pointLossTolerance:10,
  rows:[120,60,30].map((q,i)=>({category:"A",code:String(i+1).padStart(2,"0"),order_total:q,retained_quantity:q,confirmed_cut:0,effective_multiplier:14,max_special_codes:1})),
});
assert.equal(dynamic.risk_budget,178);
assert.equal(dynamic.transfer_required_total,174);
assert.deepEqual(dynamic.recommendations.map((r)=>[r.code,r.recommended_transfer,r.projected_retained]),[["01",108,12],["02",48,12],["03",18,12]]);
assert.equal(dynamic.point_reserve_after_plan,168);

// Confirmed transfers reduce operational retained exposure, while raw Received stays intact.
const retained = retainedReserveSnapshot([
  {category:"A",code:"01",order_total:35,retained_quantity:10,confirmed_cut:25,effective_multiplier:7,max_special_codes:1},
]);
assert.equal(retained.point_reserve,70);

const projected = projectRiskAfterTransfers({
  adjustedTotal:60,
  pointLossTolerance:10,
  rows:[{category:"A",code:"01",order_total:35,retained_quantity:35,confirmed_cut:0,effective_multiplier:7,max_special_codes:1}],
  items:[{category:"A",code:"01",quantity:5}],
});
assert.equal(projected.projected_point_reserve,210);
assert.equal(projected.projected_excess_point_risk,140);

assert.equal(validateRiskBudget({summary_group_id:"NORTH",point_loss_tolerance:10}).point_loss_tolerance,10);
assert.equal(validateWarehouseLimit({destination:"คลัง 2",max_batch_quantity:5}).max_batch_quantity,5);

const signed=createRiskTransferToken({
  riskState:{settlement_session_id:"11111111-1111-4111-8111-111111111111",summary_group_id:"NORTH",risk_mode:"RESERVE",adjusted_received:60,risk_point_total:245,safety_margin:-185,risk_pct:408.33,point_loss_tolerance:10,risk_budget:70,excess_point_risk:175,confirmed_cut_total:0},
  destination:"คลัง 2",
  destinationLimit:5,
  items:[{category:"A",code:"01",quantity:5,expected_retained_quantity:35,expected_effective_multiplier:7,expected_recommended_transfer:25}],
  projectedRisk:projected,
  requestId:"22222222-2222-4222-8222-222222222222",
  nowMs:1_700_000_000_000,
  key:"test-key",
});
assert.equal(signed.cut_total,5);
assert.equal(signed.destination_limit,5);
assert.throws(()=>createRiskTransferToken({
  riskState:{settlement_session_id:"11111111-1111-4111-8111-111111111111",summary_group_id:"NORTH",risk_mode:"RESERVE",adjusted_received:60,risk_point_total:245,safety_margin:-185,risk_pct:408.33,point_loss_tolerance:10,risk_budget:70,excess_point_risk:175,confirmed_cut_total:0},
  destination:"คลัง 2",destinationLimit:5,
  items:[{category:"A",code:"01",quantity:6,expected_retained_quantity:35,expected_effective_multiplier:7,expected_recommended_transfer:25}],
  key:"test-key",
}),/TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT/);
assert.equal(verifyRiskTransferToken({token:signed.token,nowMs:1_700_000_100_000,key:"test-key"}).ok,true);

const migration=fs.readFileSync(new URL("./supabase/migrations/202608250012_add_dynamic_risk_budget_distribution.sql",import.meta.url),"utf8");
const dashboard=fs.readFileSync(new URL("./netlify/functions/dashboard.mjs",import.meta.url),"utf8");
const preview=fs.readFileSync(new URL("./netlify/functions/risk-transfer-preview.mjs",import.meta.url),"utf8");
const confirm=fs.readFileSync(new URL("./netlify/functions/risk-transfer-confirm.mjs",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("./public/index.html",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("./public/app.js",import.meta.url),"utf8");

assert.match(migration,/create table if not exists public\.summary_group_risk_settings/);
assert.match(migration,/create table if not exists public\.warehouse_transfer_limits/);
assert.match(migration,/retained_point_exposure/);
assert.match(migration,/risk_budget/);
assert.match(migration,/excess_point_risk/);
assert.match(migration,/confirm_risk_transfer_batch_budget_safe/);
assert.match(migration,/TRANSFER_EXCEEDS_WAREHOUSE_BATCH_LIMIT/);
assert.match(dashboard,/buildRiskDistributionPlan/);
assert.match(preview,/DESTINATION_LIMIT_NOT_CONFIGURED/);
assert.match(preview,/buildRiskDistributionPlan/);
assert.match(confirm,/confirm_risk_transfer_batch_budget_safe/);
assert.match(html,/id="riskBudgetForm"/);
assert.match(html,/id="warehouseLimitForm"/);
assert.match(app,/distributionPlanFor/);
assert.match(app,/risk_budget/);
assert.doesNotMatch(app,/นโยบายตัด/);
assert.doesNotMatch(app,/ยอดแนะนำรวม/);

console.log("PASS: Dynamic Risk Budget + bounded warehouse distribution v6.6 smoke tests");
