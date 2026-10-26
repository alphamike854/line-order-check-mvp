// Candidate bridge into existing LOC auth and Supabase client. READ-ONLY.
// Place alongside code-audit-v02-core.mjs ONLY after isolated acceptance + approval.
import { authenticateWorkbenchActor, loadWorkbenchActorLineGroups } from './staff-access.mjs';
import { supabase } from './dashboard-api.mjs';
import { createCodeAuditReadHandler } from './code-audit-v02-core.mjs';

async function queryRpc(functionName, params) {
  const abort = new AbortController();
  const timeout = setTimeout(()=>abort.abort(), 8500);
  try {
    const {data,error} = await supabase.rpc(functionName,params).abortSignal(abort.signal);
    if (error) throw error;
    return data;
  } finally { clearTimeout(timeout); }
}

export const codeAuditRead = createCodeAuditReadHandler({
  authenticate: req => authenticateWorkbenchActor(req,{client:supabase}),
  getLineGroups: actor => loadWorkbenchActorLineGroups(supabase,actor),
  getSummary: ({groups,lines}) => queryRpc('code_audit_v02_summary',{
    p_summary_group_ids:groups, p_line_group_ids:lines,
  }),
  getDetail: ({groups,lines,category,code,cursor,pageSize}) => queryRpc('code_audit_v02_detail',{
    p_summary_group_ids:groups, p_line_group_ids:lines, p_category:category, p_code:code,
    p_page_size:pageSize,
    p_after_quantity:cursor?.quantity??null,
    p_after_event_timestamp:cursor?.event_timestamp??null,
    p_after_message_record_id:cursor?.message_record_id??null,
  }),
});
