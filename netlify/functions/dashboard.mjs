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

function sum(rows, key) { return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0); }

export default async (req) => {
  if (req.method !== "GET") return json({ ok:false,error:"METHOD_NOT_ALLOWED" },405);
  const denied=requireDashboardAccess(req); if(denied)return denied;
  try {
    const url=new URL(req.url);
    const summaryGroupId=normalizeSummaryGroup(url.searchParams.get("group"));
    const [{summaryGroups,lineGroups},session]=await Promise.all([loadGroupConfig(),fetchOpenSettlementSession()]);
    if(!session){
      return json({ok:true,settlement_session:null,business_date:null,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),summary_groups:summaryGroups,line_groups:lineGroups,metrics:{messages_total:0,parsed:0,pending:0,review_open:0,gross_received:0,adjusted_received:0,point_reserve_total:0,risk_point_total:0,net_safe_capacity:0,confirmed_cut_total:0,remaining_safe_capacity:0,risk_pct:0,last_event_at:null},risk_codes:[],category_risk:[],overall_risk:[],actual_special_codes:[],point_profiles:[],point_promotions:[],freshness:{version:"NO_OPEN_SETTLEMENT"}});
    }

    let codeQuery=supabase.from("session_code_risk_state").select("settlement_session_id,business_date,summary_group_id,category,code,order_total,adjusted_total,special_multiplier,max_special_codes,promotion_factor_pct,effective_multiplier,point_exposure,reserve_rank,reserve_candidate,actual_special_point,actual_point,confirmed_cut,available_to_cut").eq("settlement_session_id",session.id);
    let categoryQuery=supabase.from("session_category_risk_state").select("settlement_session_id,business_date,summary_group_id,category,special_multiplier,max_special_codes,actual_selected_count,order_total,adjusted_total,point_reserve,actual_point,reserve_safe_capacity,reserve_risk_pct").eq("settlement_session_id",session.id);
    let overallQuery=supabase.from("session_overall_risk_state").select("settlement_session_id,business_date,summary_group_id,gross_received,adjusted_received,point_reserve_total,actual_point_total,actual_codes_ready,risk_mode,risk_point_total,net_safe_capacity,confirmed_cut_total,remaining_safe_capacity,over_safe_amount,risk_pct").eq("settlement_session_id",session.id);
    let messagesQuery=supabase.from("messages").select("parse_status,event_timestamp").eq("settlement_session_id",session.id).order("event_timestamp",{ascending:false}).limit(10000);
    if(summaryGroupId){codeQuery=codeQuery.eq("summary_group_id",summaryGroupId);categoryQuery=categoryQuery.eq("summary_group_id",summaryGroupId);overallQuery=overallQuery.eq("summary_group_id",summaryGroupId);messagesQuery=messagesQuery.eq("summary_group_id",summaryGroupId);}

    const [codeResult,categoryResult,overallResult,messagesResult,profileResult,promoResult,actualResult,reviews,unsends,batchFreshResult]=await Promise.all([
      codeQuery,categoryQuery,overallQuery,messagesQuery,
      supabase.from("settlement_point_profiles").select("category,special_multiplier,max_special_codes").eq("settlement_session_id",session.id).order("category"),
      supabase.from("settlement_point_promotions").select("category,code,point_factor_pct").eq("settlement_session_id",session.id).order("category").order("code"),
      supabase.from("settlement_actual_special_point_codes").select("category,code,created_at").eq("settlement_session_id",session.id).order("category").order("code"),
      fetchOpenReviews(session.business_date,summaryGroupId,session.id),fetchUnsends(session.business_date,summaryGroupId),
      supabase.from("settlement_transfer_batches").select("confirmed_at").eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(1),
    ]);
    for(const r of [codeResult,categoryResult,overallResult,messagesResult,profileResult,promoResult,actualResult,batchFreshResult]) if(r.error) throw r.error;

    const riskCodes=(codeResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category)||Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code));
    const categoryRisk=(categoryResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category));
    const overallRisk=(overallResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id));
    const messages=messagesResult.data??[];
    const profiles=profileResult.data??[];
    const promotions=promoResult.data??[];
    const actual=actualResult.data??[];
    const version=[session.id,messages[0]?.event_timestamp??"",batchFreshResult.data?.[0]?.confirmed_at??"",actual.map(r=>`${r.category}${r.code}`).join(","),promotions.map(r=>`${r.category}${r.code}:${r.point_factor_pct}`).join(",")].join("|");

    const metricOverall = summaryGroupId
      ? overallRisk[0]
      : {
          gross_received:sum(overallRisk,"gross_received"), adjusted_received:sum(overallRisk,"adjusted_received"), point_reserve_total:sum(overallRisk,"point_reserve_total"),
          risk_point_total:sum(overallRisk,"risk_point_total"), net_safe_capacity:sum(overallRisk,"net_safe_capacity"), confirmed_cut_total:sum(overallRisk,"confirmed_cut_total"),
          remaining_safe_capacity:sum(overallRisk,"remaining_safe_capacity"), risk_pct:sum(overallRisk,"adjusted_received")>0?Math.round(sum(overallRisk,"risk_point_total")/sum(overallRisk,"adjusted_received")*10000)/100:0,
        };

    return json({
      ok:true,settlement_session:session,business_date:session.business_date,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),freshness:{version},summary_groups:summaryGroups,line_groups:lineGroups,
      metrics:{messages_total:messages.length,parsed:messages.filter(m=>m.parse_status==="PARSED").length,pending:messages.filter(m=>m.parse_status==="PENDING").length,review_open:reviews.length,gross_received:Number(metricOverall?.gross_received||0),adjusted_received:Number(metricOverall?.adjusted_received||0),point_reserve_total:Number(metricOverall?.point_reserve_total||0),risk_point_total:Number(metricOverall?.risk_point_total||0),net_safe_capacity:Number(metricOverall?.net_safe_capacity||0),confirmed_cut_total:Number(metricOverall?.confirmed_cut_total||0),remaining_safe_capacity:Number(metricOverall?.remaining_safe_capacity||0),risk_pct:Number(metricOverall?.risk_pct||0),last_event_at:messages[0]?.event_timestamp??session.opened_at},
      risk_codes:riskCodes,category_risk:categoryRisk,overall_risk:overallRisk,point_profiles:profiles,point_promotions:promotions,actual_special_codes:actual,
    });
  } catch(error){console.error("dashboard failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard"};
