// Read-only client model: reject invalid or incomplete rows rather than display plausible false totals.
export const CATEGORIES = Object.freeze(['A', 'B', 'E', 'F', 'H', 'L']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP = /^[A-Z0-9_-]{1,64}$/;
const CODE = /^\d{1,3}$/;
export const REVIEW_KEY = 'locCodeAuditReviewTargetV1';
export function fail(message) { throw new Error(message); }
export function checkedInt(value, label = 'INVALID_NUMBER') {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || value === null || value === '' || typeof value === 'boolean') fail(label);
  return n;
}
export function formatTotal(v) { return new Intl.NumberFormat('th-TH').format(checkedInt(v)); }
export function personalActor(p) {
  const a = p?.actor;
  if (p?.ok !== true || a?.kind !== 'STAFF' || !UUID.test(String(a?.staff_id || '')) || !['ADMIN','SUPERVISOR'].includes(a?.role)) fail('PERSONAL_ADMIN_OR_SUPERVISOR_REQUIRED');
  if (!Array.isArray(p.line_groups)) fail('GROUP_SCOPE_UNAVAILABLE');
  const groups = p.line_groups.map(x => ({
    summary_group_id: String(x.summary_group_id || ''),
    line_group_id: String(x.line_group_id || ''),
    line_group_name: String(x.line_group_name || x.line_group_id || ''),
  }));
  if (groups.some(x => !GROUP.test(x.summary_group_id) || !x.line_group_id)) fail('GROUP_SCOPE_INVALID');
  return { actor:a, lineGroups:groups, summaryGroups:[...new Set(groups.map(x=>x.summary_group_id))].sort() };
}
export function summaryRows(payload, selected) {
  if (payload?.ok !== true || !Array.isArray(payload.rows) || !Array.isArray(payload.round_scope) || !Array.isArray(selected)) fail('INVALID_SUMMARY_PAYLOAD');
  const selectedSet = new Set(selected);
  const rows = payload.rows.map(x=>({category:String(x.category), code:String(x.code), order_total:checkedInt(x.order_total), message_count:checkedInt(x.message_count)}));
  if (rows.some(x=>!CATEGORIES.includes(x.category)||!CODE.test(x.code))) fail('INVALID_SUMMARY_CODE');
  const seen = new Set();
  for (const row of rows) {const k=`${row.category}:${row.code}`; if(seen.has(k))fail('DUPLICATE_SUMMARY_CODE');seen.add(k);}
  for (const round of payload.round_scope) {if(!selectedSet.has(round.summary_group_id)||!['OPEN','CLOSED'].includes(round.status))fail('INVALID_ROUND_SCOPE');}
  const visibleRounds = new Set(payload.round_scope.map(r=>r.summary_group_id));
  const completeRoundScope = selected.length>0 && selected.every(g=>visibleRounds.has(g));
  rows.sort((a,b)=>b.order_total-a.order_total||a.category.localeCompare(b.category)||a.code.localeCompare(b.code));
  return { rows, completeRoundScope, roundScope:payload.round_scope, fetchedAt:payload.fetched_at || null };
}
export function breakdownRows(payload, category, code, total, selectedGroups, allowedLines) {
  if(payload?.ok!==true||!Array.isArray(payload.rows))fail('INVALID_BREAKDOWN_PAYLOAD');
  const groups=new Set(selectedGroups), lines=new Set(allowedLines);
  const rows=payload.rows.map(r=>({
    summary_group_id:String(r.summary_group_id||''), line_group_id:String(r.line_group_id||''),
    line_group_name:String(r.line_group_name||r.line_group_id||''),
    order_total:checkedInt(r.order_total), message_count:checkedInt(r.message_count),
  }));
  const seen=new Set();let sum=0;
  for(const r of rows){
    if(!groups.has(r.summary_group_id)||!lines.has(r.line_group_id))fail('BREAKDOWN_SCOPE_MISMATCH');
    const k=`${r.summary_group_id}:${r.line_group_id}`;if(seen.has(k))fail('DUPLICATE_BREAKDOWN_GROUP'); seen.add(k);
    sum+=r.order_total;if(!Number.isSafeInteger(sum))fail('UNSAFE_BREAKDOWN_SUM');
  }
  if(sum!==checkedInt(total))fail('BREAKDOWN_TOTAL_MISMATCH');
  rows.sort((a,b)=>b.order_total-a.order_total||a.summary_group_id.localeCompare(b.summary_group_id)||a.line_group_id.localeCompare(b.line_group_id));
  return rows;
}
export function detailRows(payload, category, code, group, line) {
  if(payload?.ok!==true||!Array.isArray(payload.rows)||typeof payload.has_more!=='boolean')fail('INVALID_DETAIL_PAYLOAD');
  if(payload.has_more && (typeof payload.next_cursor!=='string'||!payload.next_cursor))fail('MISSING_DETAIL_CURSOR');
  const rows=payload.rows.map(x=>({
    message_record_id:String(x.message_record_id||''),
    summary_group_id:String(x.summary_group_id||''),
    line_group_id:String(x.line_group_id||''),
    event_timestamp:String(x.event_timestamp||''),
    business_date:String(x.business_date||''),
    first_order_code:x.first_order_code==null?null:String(x.first_order_code),
    truth_source:String(x.truth_source||''),
    quantity:checkedInt(x.quantity),
  }));
  for(const r of payload.rows){if(r.category!==category||String(r.code)!==code)fail('DETAIL_CODE_MISMATCH');}
  for(const r of rows){if(!UUID.test(r.message_record_id)||r.summary_group_id!==group||r.line_group_id!==line||r.quantity<=0||!['CANONICAL','VERIFIED','POST_CLOSE'].includes(r.truth_source)||!Number.isFinite(Date.parse(r.event_timestamp)))fail('DETAIL_SCOPE_OR_DATA_MISMATCH');}
  return {rows, hasMore:payload.has_more, nextCursor:payload.has_more?payload.next_cursor:null};
}
export function reviewTarget(row){
  if(!UUID.test(row?.message_record_id||'')||!GROUP.test(row?.summary_group_id||'')||!row?.line_group_id)fail('INVALID_REVIEW_TARGET');
  return {message_record_id:row.message_record_id,summary_group_id:row.summary_group_id,line_group_id:row.line_group_id,created_at:Date.now()};
}
