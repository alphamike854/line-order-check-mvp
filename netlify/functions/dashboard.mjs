import {
  fetchOpenSettlementSession,
  fetchOpenReviews,
  fetchUnsends,
  json,
  loadGroupConfig,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";
import { createAllocationConfirmationToken } from "../../src/lib/allocation-safety.mjs";
import { thresholdProgress } from "../../src/lib/settlement-calculations.mjs";

function sum(rows, key) { return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0); }
function withConfirmationToken(row) {
  const enriched = { ...row, threshold_progress: thresholdProgress(row.order_total, row.threshold) };
  if (Number(row.transfer_now) <= 0) return enriched;
  const signed = createAllocationConfirmationToken({ allocation: row });
  return { ...enriched, confirmation_token:signed.token, confirmation_request_id:signed.request_id, confirmation_expires_at:signed.expires_at };
}

export default async (req) => {
  if (req.method !== "GET") return json({ ok:false,error:"METHOD_NOT_ALLOWED" },405);
  const denied=requireDashboardAccess(req); if(denied)return denied;
  try {
    const url=new URL(req.url);
    const summaryGroupId=normalizeSummaryGroup(url.searchParams.get("group"));
    const [{summaryGroups,lineGroups},session]=await Promise.all([loadGroupConfig(),fetchOpenSettlementSession()]);
    if(!session){
      return json({ok:true,settlement_session:null,business_date:null,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),summary_groups:summaryGroups,line_groups:lineGroups,metrics:{messages_total:0,parsed:0,pending:0,review_open:0,order_total:0,transfer_now_total:0,transfer_required_codes:0,last_event_at:null},summary:[],allocation:[],special_point_rules:[],freshness:{version:"NO_OPEN_SETTLEMENT"}});
    }
    let summaryQuery=supabase.from("session_current_summary").select("settlement_session_id,business_date,summary_group_id,category,code,order_total,last_updated").eq("settlement_session_id",session.id);
    let allocationQuery=supabase.from("session_allocation_state").select("settlement_session_id,business_date,summary_group_id,category,code,order_total,threshold,destination,promotion_override,should_transfer,confirmed_transfer,transfer_now,status").eq("settlement_session_id",session.id);
    let messagesQuery=supabase.from("messages").select("parse_status,event_timestamp").eq("settlement_session_id",session.id).order("event_timestamp",{ascending:false}).limit(10000);
    if(summaryGroupId){summaryQuery=summaryQuery.eq("summary_group_id",summaryGroupId); allocationQuery=allocationQuery.eq("summary_group_id",summaryGroupId); messagesQuery=messagesQuery.eq("summary_group_id",summaryGroupId);}
    const [summaryResult,allocationResult,messagesResult,pointResult,reviews,unsends,allocationFreshResult]=await Promise.all([
      summaryQuery,allocationQuery,messagesQuery,
      supabase.from("settlement_special_point_rules").select("category,code,multiplier").eq("settlement_session_id",session.id),
      fetchOpenReviews(session.business_date,summaryGroupId,session.id),fetchUnsends(session.business_date,summaryGroupId),
      supabase.from("allocation_confirmation_events").select("confirmed_at").eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(1),
    ]);
    for(const r of [summaryResult,allocationResult,messagesResult,pointResult,allocationFreshResult]) if(r.error) throw r.error;
    const summary=(summaryResult.data??[]).sort((a,b)=>a.category.localeCompare(b.category)||Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code));
    const allocation=(allocationResult.data??[]).sort((a,b)=>a.category.localeCompare(b.category)||Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code)).map(withConfirmationToken);
    const messages=messagesResult.data??[];
    const pointRules=pointResult.data??[];
    const pointMap=new Map(pointRules.map(r=>[`${r.category}|${r.code}`,Number(r.multiplier)]));
    const summaryWithPoint=summary.map(r=>({...r,special_point_multiplier:pointMap.get(`${r.category}|${r.code}`)??null}));
    const allocationWithPoint=allocation.map(r=>({...r,special_point_multiplier:pointMap.get(`${r.category}|${r.code}`)??null}));
    const version=[session.id,messages[0]?.event_timestamp??"",allocationFreshResult.data?.[0]?.confirmed_at??"",pointRules.map(r=>`${r.category}${r.code}x${r.multiplier}`).join(",")].join("|");
    return json({ok:true,settlement_session:session,business_date:session.business_date,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),freshness:{version},summary_groups:summaryGroups,line_groups:lineGroups,metrics:{messages_total:messages.length,parsed:messages.filter(m=>m.parse_status==="PARSED").length,pending:messages.filter(m=>m.parse_status==="PENDING").length,review_open:reviews.length,order_total:sum(summary,"order_total"),transfer_now_total:sum(allocation,"transfer_now"),transfer_required_codes:allocation.filter(r=>Number(r.transfer_now)>0).length,last_event_at:messages[0]?.event_timestamp??session.opened_at},summary:summaryWithPoint,allocation:allocationWithPoint,special_point_rules:pointRules});
  } catch(error){console.error("dashboard failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard"};
