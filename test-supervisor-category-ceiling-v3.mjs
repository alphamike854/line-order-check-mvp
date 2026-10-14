import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCeilingReport,buildAnnouncement} from './public/supervisor-category-ceiling-calc.js';
const sql2=fs.readFileSync('supabase/migrations/20261013150000_supervisor_category_ceiling_report_v2.sql','utf8');
const sql3=fs.readFileSync('supabase/migrations/20261014170000_supervisor_category_ceiling_group_filter_v3.sql','utf8');
assert.match(sql3,/supervisor_category_ceiling_report_v3\(/);
assert.match(sql3,/p_summary_group_ids text\[\]/);
assert.match(sql3,/AND g\.id = ANY\(p_summary_group_ids\)/);
assert.match(sql3,/accounting_effective_order_items_rounds\(/);
assert.match(sql3,/GRANT EXECUTE ON FUNCTION .*\(date,text\[\]\)\s+TO service_role/);
assert.doesNotMatch(sql3,/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
const normalizeV3=(text)=>text
  .replace('-- LOC Supervisor V3: selected Summary Group read-only ceilings for A/B/E/F.',
   '-- LOC Supervisor: independent read-only cross-Summary-Group ceilings for A/B/E/F.')
  .replace('-- to the latest current Round per selected enabled Summary Group for Bangkok date.',
   '-- to the latest current Round per enabled Summary Group for Bangkok business date.')
  .replaceAll('supervisor_category_ceiling_report_v3','supervisor_category_ceiling_report_v2')
  .replace('p_business_date date,\n  p_summary_group_ids text[]','p_business_date date')
  .replace('     AND g.id = ANY(p_summary_group_ids)\n','')
  .replaceAll('supervisor_category_ceiling_report_v2(date,text[])','supervisor_category_ceiling_report_v2(date)')
  .replace('Read-only A/B/E/F current-round effective Accounting aggregate across selected enabled Summary Groups; exact Bangkok date, no changes to source data or operations.',
    'Read-only A/B/E/F current-round effective Accounting aggregate across enabled Summary Groups; exact Bangkok date, no changes to source data or operations.');
assert.equal(normalizeV3(sql3),sql2,'V3 SQL must differ from V2 only by typed selected-group filter');
const api=fs.readFileSync('netlify/functions/supervisor-category-ceiling.mjs','utf8');
assert.match(api,/authenticateWorkbenchActor/);
assert.match(api,/canReadSupervisorCategoryCeiling/);
assert.match(api,/getAll\('group'\)/);
assert.match(api,/new Set\(requested\)\.size !== requested\.length/);
assert.match(api,/p_summary_group_ids: selectedIds/);
assert.match(api,/selected_group_ids: selectedIds/);
assert.match(api,/available_groups: availableGroups/);
assert.doesNotMatch(api,/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
const ui=fs.readFileSync('public/supervisor-category-ceiling.js','utf8');
assert.match(ui,/selectedGroupIds === null/);
assert.match(ui,/requestId !== activeRequest/);
assert.match(ui,/clearReport\('กำลังโหลดข้อมูลใหม่/);
assert.match(ui,/snapshot\.selected_group_ids/);
assert.match(ui,/preferencesKey\(\)/);
assert.doesNotMatch(ui,/\.innerHTML/);
const html=fs.readFileSync('public/supervisor-category-ceiling.html','utf8');
assert.match(html,/id="groupOptions"/);
assert.match(html,/id="selectAllGroups"/);
const profiles={
  A:{status:'READY',multiplier:14,max_special_codes:1},
  B:{status:'READY',multiplier:14,max_special_codes:1},
  E:{status:'READY',multiplier:100,max_special_codes:1},
  F:{status:'READY',multiplier:20,max_special_codes:6},
};
const selectWest=[{category:'A',code:'01',order_total:200,net_total:180}];
const selectEast=[{category:'A',code:'01',order_total:100,net_total:90}];
const subset=buildCeilingReport(selectWest,profiles);
const all=buildCeilingReport([{category:'A',code:'01',order_total:300,net_total:270}],profiles);
assert.equal(subset[0].orderTotal,200);
assert.equal(subset[0].automatic,12);
assert.equal(all[0].orderTotal,300);
assert.equal(all[0].automatic,19);
assert.equal(buildAnnouncement(subset,'2026-10-14',false,['SOUTHWEST'],false),null);
const withManual=buildCeilingReport(selectWest,profiles,{A:{mode:'MANUAL',manualCap:100}});
assert.match(buildAnnouncement(withManual,'2026-10-14',true,['SOUTHWEST'],false),/เฉพาะกลุ่มสรุป: SOUTHWEST/);
assert.match(buildAnnouncement(withManual,'2026-10-14',true,['SOUTHWEST','NORTH'],true),/รวมทุกกลุ่มสรุป/);
console.log('PASS: V3 selected-group-only SQL extension matches V2 accounting semantics');
console.log('PASS: groups validated and scoped server-side; read-only, privileged GET');
console.log('PASS: UI selection clears stale report and scopes manual settings + announcement');
console.log('PASS: subset recalculates order total AND net-based ceiling');
console.log('DB_SQL_RUNTIME=NOT_RUN');
