import fs from 'node:fs';
import assert from 'node:assert/strict';
import { splitDistributionRounds } from './src/lib/distribution-round-planner.mjs';
import { createDistributionRunToken, verifyDistributionRunToken } from './src/lib/distribution-run-safety.mjs';

// User-confirmed example: retain 10 from 35 => distribute 25. Warehouse limit 5
// must become five recorded rounds without five separate user confirmations.
const oneWarehouse = splitDistributionRounds({
  targets:[{category:'A',code:'01',quantity:25,expected_retained_quantity:35,expected_effective_multiplier:7}],
  warehouses:[{destination:'คลัง 2',max_batch_quantity:5}],
});
assert.equal(oneWarehouse.total_quantity,25);
assert.equal(oneWarehouse.round_count,5);
assert.deepEqual(oneWarehouse.rounds.map((r)=>r.quantity),[5,5,5,5,5]);
assert.ok(oneWarehouse.rounds.every((r)=>r.destination==='คลัง 2'));

// Multiple codes can be packed into the same user action and multiple warehouses
// rotate automatically while respecting every warehouse's own per-round limit.
const many = splitDistributionRounds({
  targets:[
    {category:'A',code:'01',quantity:8,expected_retained_quantity:20,expected_effective_multiplier:7},
    {category:'B',code:'02',quantity:7,expected_retained_quantity:15,expected_effective_multiplier:14},
  ],
  warehouses:[
    {destination:'คลัง 2',max_batch_quantity:5},
    {destination:'คลัง 3',max_batch_quantity:4},
  ],
});
assert.equal(many.total_quantity,15);
assert.ok(many.rounds.every((r)=>r.quantity<=r.destination_limit));
assert.deepEqual(many.rounds.slice(0,2).map((r)=>r.destination),['คลัง 2','คลัง 3']);

const riskState={
  settlement_session_id:'11111111-1111-4111-8111-111111111111',summary_group_id:'NORTH',risk_mode:'RESERVE',
  adjusted_received:60,risk_point_total:245,safety_margin:-185,risk_pct:408.33,
  point_loss_tolerance:10,risk_budget:70,excess_point_risk:175,confirmed_cut_total:0,
};
const signed=createDistributionRunToken({
  riskState,
  rounds:oneWarehouse.rounds,
  projectedRisk:{projected_point_reserve:70,projected_excess_point_risk:0},
  requestId:'22222222-2222-4222-8222-222222222222',
  nowMs:1_700_000_000_000,
  key:'test-key',
});
assert.equal(signed.planned_quantity,25);
assert.equal(signed.planned_rounds,5);
assert.equal(verifyDistributionRunToken({token:signed.token,nowMs:1_700_000_100_000,key:'test-key'}).ok,true);

const migration=fs.readFileSync(new URL('./supabase/migrations/202608250013_sync_live_point_profiles_and_bulk_distribution.sql',import.meta.url),'utf8');
const preview=fs.readFileSync(new URL('./netlify/functions/risk-distribution-preview.mjs',import.meta.url),'utf8');
const confirm=fs.readFileSync(new URL('./netlify/functions/risk-distribution-confirm.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('./public/app.js',import.meta.url),'utf8');

assert.match(migration,/point_category_profiles_sync_open_settlement_trg/);
assert.match(migration,/where s\.status='OPEN'/);
assert.match(migration,/confirm_risk_distribution_run_budget_safe/);
assert.match(migration,/distribution_run_id/);
assert.match(preview,/splitDistributionRounds/);
assert.match(confirm,/confirm_risk_distribution_run_budget_safe/);
assert.match(html,/ค่าบริษัทใช้กับยอดที่กำลัง OPEN ทันที/);
assert.match(html,/กระจายยอดที่เลือกตามแผน/);
assert.match(app,/renderAllocationCategoryColumn/);
assert.match(app,/selectedRecommendedCodes/);
assert.match(app,/risk-distribution-preview/);
assert.match(app,/risk-distribution-confirm/);
assert.doesNotMatch(html,/เลือกรหัส \+ ยอดรอบนี้/);

console.log('PASS: Live Point multiplier + fast bulk allocation v6.7 smoke tests');
