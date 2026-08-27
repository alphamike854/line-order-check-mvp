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
import { buildRiskDistributionPlan } from "../../src/lib/risk-engine.mjs";

function sum(rows, key) { return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0); }
const RISK_POOL_CATEGORIES = Object.freeze({ MAIN:new Set(["A","B","E","F","G"]), H:new Set(["H"]), L:new Set(["L"]) });

export default async (req) => {
  if (req.method !== "GET") return json({ ok:false,error:"METHOD_NOT_ALLOWED" },405);
  const denied=requireDashboardAccess(req); if(denied)return denied;
  try {
    const url=new URL(req.url);
    const summaryGroupId=normalizeSummaryGroup(url.searchParams.get("group"));
    const [{summaryGroups,lineGroups},session]=await Promise.all([loadGroupConfig(),fetchOpenSettlementSession()]);
    if(!session){
      return json({ok:true,settlement_session:null,business_date:null,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),summary_groups:summaryGroups,line_groups:lineGroups,metrics:{messages_total:0,parsed:0,pending:0,review_open:0,gross_received:0,adjusted_received:0,point_reserve_total:0,risk_point_total:0,safety_margin:0,point_loss_tolerance:0,risk_budget:0,excess_point_risk:0,transfer_required_total:0,distribution_incomplete:false,confirmed_cut_total:0,risk_pct:0,last_event_at:null},risk_codes:[],category_risk:[],overall_risk:[],risk_pools:[],distribution_plans:[],actual_special_codes:[],point_profiles:[],point_promotions:[],warehouse_limits:[],freshness:{version:"NO_OPEN_SETTLEMENT"}});
    }

    let codeQuery=supabase.from("session_code_risk_state").select("settlement_session_id,business_date,summary_group_id,category,code,order_total,adjusted_total,special_multiplier,max_special_codes,promotion_factor_pct,effective_multiplier,point_exposure,reserve_rank,reserve_candidate,actual_special_point,actual_point,confirmed_cut,available_to_cut,retained_quantity,retained_point_exposure").eq("settlement_session_id",session.id);
    let categoryQuery=supabase.from("session_category_risk_state").select("settlement_session_id,business_date,summary_group_id,category,special_multiplier,max_special_codes,actual_selected_count,order_total,adjusted_total,point_reserve,actual_point,reserve_safe_capacity,reserve_risk_pct").eq("settlement_session_id",session.id);
    let overallQuery=supabase.from("session_overall_risk_state").select("settlement_session_id,business_date,summary_group_id,gross_received,adjusted_received,point_reserve_total,actual_point_total,actual_codes_ready,risk_mode,risk_point_total,net_safe_capacity,confirmed_cut_total,remaining_safe_capacity,over_safe_amount,risk_pct,safety_margin,safety_margin_pct,point_loss_tolerance,risk_budget,risk_budget_margin,excess_point_risk").eq("settlement_session_id",session.id);
    let poolQuery=supabase.from("session_risk_pool_state").select("settlement_session_id,business_date,summary_group_id,risk_pool,gross_received,adjusted_received,point_reserve_total,actual_point_total,multiplier_configured,actual_codes_ready,risk_mode,risk_point_total,safety_margin,confirmed_cut_total,point_loss_tolerance,risk_pct,risk_budget,excess_point_risk,risk_budget_margin").eq("settlement_session_id",session.id);
    let messagesQuery=supabase.from("messages").select("parse_status,event_timestamp").eq("settlement_session_id",session.id).order("event_timestamp",{ascending:false}).limit(10000);
    if(summaryGroupId){codeQuery=codeQuery.eq("summary_group_id",summaryGroupId);categoryQuery=categoryQuery.eq("summary_group_id",summaryGroupId);overallQuery=overallQuery.eq("summary_group_id",summaryGroupId);poolQuery=poolQuery.eq("summary_group_id",summaryGroupId);messagesQuery=messagesQuery.eq("summary_group_id",summaryGroupId);}

    const [codeResult,categoryResult,overallResult,poolResult,messagesResult,profileResult,promoResult,actualResult,warehouseLimitResult,riskBudgetResult,reviews,unsends,batchFreshResult]=await Promise.all([
      codeQuery,categoryQuery,overallQuery,poolQuery,messagesQuery,
      supabase.from("settlement_point_profiles").select("category,special_multiplier,max_special_codes").eq("settlement_session_id",session.id).order("category"),
      supabase.from("settlement_point_promotions").select("category,code,point_factor_pct").eq("settlement_session_id",session.id).order("category").order("code"),
      supabase.from("settlement_actual_special_point_codes").select("category,code,created_at").eq("settlement_session_id",session.id).order("category").order("code"),
      supabase.from("warehouse_transfer_limits").select("destination,max_batch_quantity,enabled,updated_at").eq("enabled",true).order("destination"),
      supabase.from("summary_group_risk_pool_settings").select("summary_group_id,risk_pool,point_loss_tolerance,updated_at").order("summary_group_id").order("risk_pool"),
      fetchOpenReviews(session.business_date,summaryGroupId,session.id),fetchUnsends(session.business_date,summaryGroupId),
      supabase.from("settlement_transfer_batches").select("confirmed_at").eq("settlement_session_id",session.id).order("confirmed_at",{ascending:false}).limit(1),
    ]);
    for(const r of [codeResult,categoryResult,overallResult,poolResult,messagesResult,profileResult,promoResult,actualResult,warehouseLimitResult,riskBudgetResult,batchFreshResult]) if(r.error) throw r.error;

    const riskCodes=(codeResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category)||Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code));
    const categoryRisk=(categoryResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category));
    const overallRisk=(overallResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id));
    const riskPools=(poolResult.data??[]).sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.risk_pool.localeCompare(b.risk_pool));
    const distributionPlans=riskPools.map((pool)=>{
      const allowed=RISK_POOL_CATEGORIES[pool.risk_pool] || new Set();
      if(pool.multiplier_configured===false && Number(pool.gross_received||0)>0){
        return {
          summary_group_id:pool.summary_group_id,
          risk_pool:pool.risk_pool,
          adjusted_received:Number(pool.adjusted_received||0),
          point_loss_tolerance:Number(pool.point_loss_tolerance||0),
          risk_budget:Number(pool.risk_budget||0),
          point_reserve_before:Number(pool.risk_point_total||0),
          point_reserve_after_plan:Number(pool.risk_point_total||0),
          excess_point_risk_before:0,
          excess_point_risk_after_plan:0,
          transfer_required_total:0,
          recommendations:[],
          multiplier_configured:false,
          calculation_status:"UNCONFIGURED",
          calculation_error:null,
        };
      }

      try {
        const plan=buildRiskDistributionPlan({
          rows:riskCodes.filter((row)=>row.summary_group_id===pool.summary_group_id && allowed.has(row.category)),
          adjustedTotal:Number(pool.adjusted_received||0),
          pointLossTolerance:Number(pool.point_loss_tolerance||0),
          maxSimulationUnits:5000,
        });
        return {
          summary_group_id:pool.summary_group_id,
          risk_pool:pool.risk_pool,
          multiplier_configured:pool.multiplier_configured!==false,
          calculation_status:"READY",
          calculation_error:null,
          ...plan,
        };
      } catch(error) {
        if(error?.message!=="RISK_DISTRIBUTION_SIMULATION_LIMIT") throw error;

        console.warn("dashboard risk distribution calculation limit", {
          settlement_session_id:session.id,
          summary_group_id:pool.summary_group_id,
          risk_pool:pool.risk_pool,
        });

        return {
          summary_group_id:pool.summary_group_id,
          risk_pool:pool.risk_pool,
          multiplier_configured:pool.multiplier_configured!==false,
          adjusted_received:Number(pool.adjusted_received||0),
          point_loss_tolerance:Number(pool.point_loss_tolerance||0),
          risk_budget:Number(pool.risk_budget||0),
          point_reserve_before:Number(pool.risk_point_total||0),
          point_reserve_after_plan:null,
          excess_point_risk_before:Number(pool.excess_point_risk||0),
          excess_point_risk_after_plan:null,
          transfer_required_total:null,
          recommendations:[],
          calculation_status:"LIMIT",
          calculation_error:"RISK_DISTRIBUTION_SIMULATION_LIMIT",
        };
      }
    });
    const messages=messagesResult.data??[];
    const profiles=profileResult.data??[];
    const promotions=promoResult.data??[];
    const actual=actualResult.data??[];
    const warehouseLimits=warehouseLimitResult.data??[];
    const riskBudgets=riskBudgetResult.data??[];
    const settingsSignature=[
      ...warehouseLimits.map(r=>`${r.destination}:${r.max_batch_quantity}:${r.updated_at}`),
      ...riskBudgets.map(r=>`${r.summary_group_id}:${r.point_loss_tolerance}:${r.updated_at}`),
    ].join(",");
    const version=[session.id,messages[0]?.event_timestamp??"",batchFreshResult.data?.[0]?.confirmed_at??"",actual.map(r=>`${r.category}${r.code}`).join(","),promotions.map(r=>`${r.category}${r.code}:${r.point_factor_pct}`).join(","),settingsSignature].join("|");

    const mainPlans=distributionPlans.filter((plan)=>plan.risk_pool==="MAIN");
    const distributionIncomplete = summaryGroupId
      ? distributionPlans.some((plan)=>
          plan.summary_group_id===summaryGroupId
          && plan.calculation_status==="LIMIT"
        )
      : distributionPlans.some((plan)=>plan.calculation_status==="LIMIT");

    const metricOverall = summaryGroupId
      ? {
          ...overallRisk[0],
          transfer_required_total:distributionIncomplete
            ? null
            : Number(mainPlans.find((plan)=>plan.summary_group_id===overallRisk[0]?.summary_group_id)?.transfer_required_total||0),
        }
      : {
          gross_received:sum(overallRisk,"gross_received"),
          adjusted_received:sum(overallRisk,"adjusted_received"),
          point_reserve_total:sum(overallRisk,"point_reserve_total"),
          risk_point_total:sum(overallRisk,"risk_point_total"),
          safety_margin:sum(overallRisk,"safety_margin"),
          point_loss_tolerance:sum(overallRisk,"point_loss_tolerance"),
          risk_budget:sum(overallRisk,"risk_budget"),
          excess_point_risk:sum(overallRisk,"excess_point_risk"),
          confirmed_cut_total:sum(overallRisk,"confirmed_cut_total"),
          transfer_required_total:distributionIncomplete
            ? null
            : sum(mainPlans,"transfer_required_total"),
          risk_pct:sum(overallRisk,"adjusted_received")>0
            ? Math.round(sum(overallRisk,"risk_point_total")/sum(overallRisk,"adjusted_received")*10000)/100
            : 0,
        };

    return json({
      ok:true,settlement_session:session,business_date:session.business_date,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),freshness:{version},summary_groups:summaryGroups,line_groups:lineGroups,
      metrics:{messages_total:messages.length,parsed:messages.filter(m=>m.parse_status==="PARSED").length,pending:messages.filter(m=>m.parse_status==="PENDING").length,review_open:reviews.length,gross_received:Number(metricOverall?.gross_received||0),adjusted_received:Number(metricOverall?.adjusted_received||0),point_reserve_total:Number(metricOverall?.point_reserve_total||0),risk_point_total:Number(metricOverall?.risk_point_total||0),safety_margin:Number(metricOverall?.safety_margin||0),point_loss_tolerance:Number(metricOverall?.point_loss_tolerance||0),risk_budget:Number(metricOverall?.risk_budget||0),excess_point_risk:Number(metricOverall?.excess_point_risk||0),transfer_required_total:metricOverall?.transfer_required_total==null?null:Number(metricOverall.transfer_required_total||0),distribution_incomplete:distributionIncomplete,confirmed_cut_total:Number(metricOverall?.confirmed_cut_total||0),risk_pct:Number(metricOverall?.risk_pct||0),last_event_at:messages[0]?.event_timestamp??session.opened_at},
      risk_codes:riskCodes,category_risk:categoryRisk,overall_risk:overallRisk,risk_pools:riskPools,distribution_plans:distributionPlans,point_profiles:profiles,point_promotions:promotions,warehouse_limits:warehouseLimits,actual_special_codes:actual,
    });
  } catch(error){console.error("dashboard failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard"};
