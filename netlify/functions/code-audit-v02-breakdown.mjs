import { json, supabase } from '../../src/lib/dashboard-api.mjs';
import { authenticateWorkbenchActor, loadWorkbenchActorLineGroups } from '../../src/lib/staff-access.mjs';
const GROUP=/^[A-Z0-9_-]{1,64}$/;
const CATEGORY=new Set(['A','B','E','F','H','L']);
const CODE=/^\d{1,3}$/;
export default async function handler(req) {
  if(req.method!=='GET')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try {
    const auth=await authenticateWorkbenchActor(req,{client:supabase,dashboardReviewerStaffCode:''});
    if(!auth.ok)return json({ok:false,error:auth.error},auth.status);
    const actor=auth.actor;
    if(actor?.kind!=='STAFF'||!actor.staff_id||!['ADMIN','SUPERVISOR'].includes(String(actor.role).toUpperCase()))return json({ok:false,error:'FORBIDDEN'},403);
    const q=new URL(req.url).searchParams;
    const supplied=q.getAll('group');
    const category=q.get('category'), code=q.get('code');
    if(!CATEGORY.has(category)||!CODE.test(String(code||''))||supplied.length>64||supplied.some(g=>!GROUP.test(g))||new Set(supplied).size!==supplied.length)return json({ok:false,error:'INVALID_SELECTION'},400);
    const allowed=await loadWorkbenchActorLineGroups(supabase,actor);
    const allGroups=[...new Set(allowed.map(g=>g.summary_group_id))].sort();
    const groups=supplied.length?supplied:allGroups;
    if(!groups.length||groups.some(g=>!allGroups.includes(g)))return json({ok:false,error:'INVALID_GROUP_SCOPE'},400);
    const lines=[...new Set(allowed.filter(x=>groups.includes(x.summary_group_id)).map(x=>x.line_group_id))];
    if(!lines.length)return json({ok:false,error:'FORBIDDEN'},403);
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),9000);
    let rpc;
    try {rpc=await supabase.rpc('code_audit_v02_breakdown',{
      p_summary_group_ids:groups,p_line_group_ids:lines,p_category:category,p_code:code,
    }).abortSignal(controller.signal);} finally{clearTimeout(deadline);}
    if(rpc.error||!rpc.data||!Array.isArray(rpc.data.rows))throw Error('INVALID_BREAKDOWN_RPC');
    return json({ok:true,scope:{summary_groups:groups,line_groups:lines},rows:rpc.data.rows});
  }catch(error){console.error('code audit breakdown unavailable',error?.name||'Error');return json({ok:false,error:'CODE_AUDIT_READ_UNAVAILABLE'},503);}
}
export const config={path:'/api/code-audit-v02-breakdown',region:'sin'};
