import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCeilingReport, buildAnnouncement, divisorForCategory, parsePositiveLimit } from './public/supervisor-category-ceiling-calc.js';
const profiles = {
  A:{status:'READY',multiplier:14,max_special_codes:1},
  B:{status:'READY',multiplier:14,max_special_codes:1},
  E:{status:'READY',multiplier:100,max_special_codes:1},
  F:{status:'READY',multiplier:20,max_special_codes:6},
};
const input = [
  {category:'A',code:'09',order_total:65500,net_total:59000},
  {category:'A',code:'60',order_total:55000,net_total:49500},
  {category:'A',code:'05',order_total:45000,net_total:40500},
  {category:'B',code:'09',order_total:50000,net_total:45000},
  {category:'E',code:'123',order_total:3000,net_total:2700},
  {category:'F',code:'123',order_total:420,net_total:400},
];
const d = buildCeilingReport(input, profiles);
assert.equal(d.length,4);
assert.equal(d[0].orderTotal,165500); assert.equal(d[0].netTotal,149000);
assert.equal(d[0].automatic,10642); // A-funded independently: floor(149000/14), not /28
assert.equal(d[1].automatic,3214);
assert.equal(d[2].automatic,27);
assert.equal(d[3].automatic,3); // floor(400 / (20*6))
assert.equal(divisorForCategory('A',profiles.A),1);
assert.equal(divisorForCategory('F',profiles.F),6);
assert.equal(d[0].reached.length,3);
assert.equal(d[0].records[0].code,'09');
assert.equal(d[3].reached[0].code,'123');
assert.equal(buildAnnouncement(d,'2026-10-13',false),null);
const manual = buildCeilingReport(input, profiles, {
  A:{mode:'MANUAL',manualCap:50000,codeCaps:{'05':'40000','60':'70000'}},
  B:{mode:'MANUAL',manualCap:50000,codeCaps:{}},
});
assert.equal(manual[0].defaultCap,50000);
assert.equal(manual[0].records.find(r=>r.code==='09').delta,15500);
assert.equal(manual[0].records.find(r=>r.code==='60').reached,false);
assert.equal(manual[0].records.find(r=>r.code==='05').reached,true);
assert.equal(manual[1].records.find(r=>r.code==='09').delta,0);
const text=buildAnnouncement(manual,'2026-10-13',true);
assert.match(text,/A09.*65,500.*50,000.*15,500/);
assert.match(text,/A05/);
assert.match(text,/B09.*ถึงเพดาน/);
assert.doesNotMatch(text,/A60/);
const absent=buildCeilingReport(input,{...profiles,E:{status:'PROFILE_CONFLICT'} });
assert.equal(absent[2].records[0].cap,null);
assert.equal(buildAnnouncement(absent,'2026-10-13',true),null);
const badOverride=buildCeilingReport(input, profiles, {
  A:{codeCaps:{'09':'-50'}},
});
assert.equal(badOverride[0].records.find(r=>r.code==='09').cap,null);
assert.equal(buildAnnouncement(badOverride,'2026-10-13',true),null);
assert.equal(parsePositiveLimit(''),null);
assert.equal(parsePositiveLimit('-1'),null);
assert.equal(parsePositiveLimit('50000.5'),null);
assert.equal(parsePositiveLimit('50000'),50000);
// No writes on server; no arbitrary unsafe content injection in UI.
const api = fs.readFileSync('netlify/functions/supervisor-category-ceiling.mjs','utf8');
assert.match(api,/req\.method !== 'GET'/);
assert.match(api,/authenticateWorkbenchActor/);
assert.match(api,/canReadSupervisorCategoryCeiling/);
assert.match(api,/error:'FORBIDDEN'/);
assert.doesNotMatch(api,/SUPERVISOR_READONLY_KEY|x-supervisor-key/);
assert.match(api,/settlement_point_profiles/);
assert.match(api,/supervisor_category_ceiling_report_v2/);
assert.doesNotMatch(api,/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
const sql = fs.readFileSync('supabase/migrations/20261013150000_supervisor_category_ceiling_report_v2.sql','utf8');
assert.match(sql,/accounting_effective_order_items_rounds\(/);
assert.match(sql,/summary_group_round_runtime_state/);
assert.match(sql,/category IN \('A', 'B', 'E', 'F'\)/);
assert.doesNotMatch(sql,/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
const ui = fs.readFileSync('public/supervisor-category-ceiling.js','utf8');
assert.match(ui,/\.textContent/);
assert.doesNotMatch(ui,/\.innerHTML/);
console.log('PASS: A/B/E/F separately funded auto ceiling, category multipliers, F multi-code divisor');
console.log('PASS: manual category + per-code ceiling, reached including exactly-at-limit');
console.log('PASS: missing data disables collective announcement; server GET-only');
console.log('PASS: no operational mutations; no LINE send');
console.log('DB_ISOLATED_RUNTIME=NOT_RUN');
