import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseOrder, PARSER_VERSION } from './src/lib/order-parser.mjs';
import { DEFAULT_POINT_PROFILES, retainedReserveSnapshot, buildRiskDistributionPlan } from './src/lib/risk-engine.mjs';
import { validateCategoryAlias, validatePointProfile, validateRiskBudget } from './src/lib/settings-validation.mjs';
import { createDistributionRunToken, verifyDistributionRunToken, DISTRIBUTION_RUN_TOKEN_VERSION } from './src/lib/distribution-run-safety.mjs';

function mapItems(result) {
  return Object.fromEntries(result.items.map((item) => [`${item.category}${item.code}`, Number(item.quantity)]));
}

// H = วิ่งบน, one-digit category.
for (const text of ['H1=500','วิ่งบน1=500','วิ่งบน 1=500','วิ่ง บ 1=500']) {
  const result = parseOrder(text);
  assert.equal(result.status, 'PARSED', text);
  assert.deepEqual(mapItems(result), { H1:500 }, text);
}
{
  const result = parseOrder('วิ่งบน 1 3 5=500');
  assert.equal(result.status, 'PARSED');
  assert.deepEqual(mapItems(result), { H1:500,H3:500,H5:500 });
}

// L = วิ่งล่าง, one-digit category.
for (const text of ['L2=300','วิ่งล่าง2=300','วิ่งล่าง 2=300','วิ่ง ล 2=300']) {
  const result = parseOrder(text);
  assert.equal(result.status, 'PARSED', text);
  assert.deepEqual(mapItems(result), { L2:300 }, text);
}

assert.ok(['1.4.0', '1.5.0', '1.5.1', '1.5.2', '1.5.3', '1.6.0', '1.6.1', '1.6.2', '1.6.3', '1.6.4', '1.7.0', '1.7.1', '1.7.2', '1.7.3', '1.7.4', '1.7.5', '1.7.6', '1.7.7', '1.7.8', '1.7.9', '1.7.10', '1.7.11', '1.7.12', '1.7.13'].includes(PARSER_VERSION));
assert.deepEqual(DEFAULT_POINT_PROFILES.H, { multiplier:0,max_special_codes:3 });
assert.deepEqual(DEFAULT_POINT_PROFILES.L, { multiplier:0,max_special_codes:2 });

// H and L slot counts are business rules; multiplier remains configurable and starts unconfigured.
assert.equal(validatePointProfile({category:'H',special_multiplier:0,max_special_codes:3}).max_special_codes,3);
assert.equal(validatePointProfile({category:'L',special_multiplier:0,max_special_codes:2}).max_special_codes,2);
assert.throws(()=>validatePointProfile({category:'H',special_multiplier:7,max_special_codes:2}),/INVALID_POINT_CODE_LIMIT_H/);
assert.throws(()=>validatePointProfile({category:'L',special_multiplier:7,max_special_codes:3}),/INVALID_POINT_CODE_LIMIT_L/);
assert.equal(validateCategoryAlias({alias:'วิ่งบน',canonical_category:'H'}).canonical_category,'H');
assert.equal(validateCategoryAlias({alias:'วิ่งล่าง',canonical_category:'L'}).canonical_category,'L');
assert.equal(validateRiskBudget({summary_group_id:'NORTH',risk_pool:'H',point_loss_tolerance:50}).risk_pool,'H');

// Risk reserve for H chooses 3 worst codes; L chooses 2. These snapshots are calculated
// independently to prevent H/L from entering the MAIN A/B/E/F/G budget.
const hRows = [
  ['1',500],['2',300],['3',800],['4',200],['5',700],
].map(([code,qty])=>({category:'H',code,retained_quantity:qty,effective_multiplier:7,max_special_codes:3}));
const hReserve = retainedReserveSnapshot(hRows);
assert.equal(hReserve.selected_keys.size,3);
assert.equal(hReserve.point_reserve,(800+700+500)*7);
assert.ok(hReserve.selected_keys.has('H|3'));
assert.ok(hReserve.selected_keys.has('H|5'));
assert.ok(hReserve.selected_keys.has('H|1'));

const lRows = [
  ['0',100],['2',300],['8',250],
].map(([code,qty])=>({category:'L',code,retained_quantity:qty,effective_multiplier:5,max_special_codes:2}));
const lReserve = retainedReserveSnapshot(lRows);
assert.equal(lReserve.selected_keys.size,2);
assert.equal(lReserve.point_reserve,(300+250)*5);

const hPlan = buildRiskDistributionPlan({rows:hRows,adjustedTotal:2500,pointLossTolerance:0,maxSimulationUnits:10000});
assert.ok(hPlan.transfer_required_total>0);
assert.ok(hPlan.recommendations.every((row)=>row.category==='H'));

// Pool identity is signed into the bulk-distribution confirmation token.
const signed=createDistributionRunToken({
  riskState:{settlement_session_id:'11111111-1111-4111-8111-111111111111',summary_group_id:'NORTH',risk_pool:'H',risk_mode:'RESERVE',adjusted_received:500,risk_point_total:3500,safety_margin:-3000,risk_pct:700,point_loss_tolerance:0,risk_budget:500,excess_point_risk:3000,confirmed_cut_total:0},
  rounds:[{destination:'คลัง 2',destination_limit:5,items:[{category:'H',code:'1',quantity:5,expected_retained_quantity:500,expected_effective_multiplier:7}]}],
  projectedRisk:{projected_point_reserve:3465,projected_excess_point_risk:2965},
  requestId:'22222222-2222-4222-8222-222222222222',nowMs:1_700_000_000_000,key:'test-key',
});
const verified=verifyDistributionRunToken({token:signed.token,nowMs:1_700_000_001_000,key:'test-key'});
assert.equal(verified.ok,true);
assert.equal(verified.snapshot.risk_pool,'H');
assert.equal(DISTRIBUTION_RUN_TOKEN_VERSION,'v2');

const migration=fs.readFileSync(new URL('./supabase/migrations/202608260019_add_one_digit_hl_risk_pools.sql',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('./netlify/functions/dashboard.mjs',import.meta.url),'utf8');
const preview=fs.readFileSync(new URL('./netlify/functions/risk-distribution-preview.mjs',import.meta.url),'utf8');
const confirm=fs.readFileSync(new URL('./netlify/functions/risk-distribution-confirm.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('./public/app.js',import.meta.url),'utf8');

assert.match(migration,/\('H','วิ่งบน',1,'H',true\)/);
assert.match(migration,/\('L','วิ่งล่าง',1,'L',true\)/);
assert.match(migration,/\('H',0,3\),\('L',0,2\)/);
assert.match(migration,/create or replace view public\.session_risk_pool_state/);
assert.match(migration,/where f\.risk_pool='MAIN'/);
assert.match(migration,/confirm_separate_risk_distribution_run/);
assert.match(migration,/concat_ws\('\|',p_settlement_session_id::text,p_summary_group_id\),0/);
assert.match(dashboard,/RISK_POOL_CATEGORIES/);
assert.match(dashboard,/risk_pools:riskPools/);
assert.match(preview,/\['MAIN','H','L'\]/);
assert.match(confirm,/confirm_separate_risk_distribution_run/);
assert.match(html,/H — 1 หลัก/);
assert.match(html,/L — 1 หลัก/);
assert.match(app,/one-digit-board/);
assert.match(app,/คำนวณความเสี่ยงแยก/);

console.log('PASS: H/L one-digit categories + separate risk pools v7.7 smoke tests');
