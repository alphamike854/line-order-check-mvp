import {
  buildDashboardFreshness,
  loadDashboardPointContext,
} from "../../src/lib/dashboard-point-context.mjs";
import {
  loadDashboardRoundContext,
  sameDashboardRoundScope,
} from "../../src/lib/dashboard-round-context.mjs";
import {
  fetchOpenSettlementSession,
  fetchOpenReviewCount,
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
      return json({ok:true,settlement_session:null,business_date:null,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),summary_groups:summaryGroups,line_groups:lineGroups,metrics:{messages_total:0,parsed:0,pending:0,review_open:0,gross_received:0,adjusted_received:0,point_reserve_total:0,risk_point_total:0,safety_margin:0,point_loss_tolerance:0,risk_budget:0,excess_point_risk:0,transfer_required_total:0,distribution_incomplete:false,confirmed_cut_total:0,risk_pct:0,last_event_at:null},risk_codes:[],category_risk:[],overall_risk:[],risk_pools:[],distribution_plans:[],line_group_risk:[],line_group_risk_codes:[],line_group_distribution_plans:[],actual_special_codes:[],point_profiles:[],point_promotions:[],warehouse_limits:[],freshness:{version:"NO_OPEN_SETTLEMENT"}});
    }

    const roundContext=
      await loadDashboardRoundContext({
        supabase,
        settlementSessionId:session.id,
        summaryGroupId,
      });

    const messageRoundIds=
      roundContext.roundIds;

    const riskSnapshotQuery=supabase.rpc(
      "dashboard_risk_snapshot",
      {
        p_settlement_session_id:session.id,
        p_summary_group_id:summaryGroupId??null,
      }
    );

    let messagesQueryPromise=
      Promise.resolve({
        data:[],
        error:null,
      });

    if(messageRoundIds.length){
      let messagesQuery=supabase
        .from("messages")
        .select(
          "parse_status,event_timestamp,summary_group_round_id"
        )
        .eq(
          "settlement_session_id",
          session.id
        )
        .in(
          "summary_group_round_id",
          messageRoundIds
        )
        .order(
          "event_timestamp",
          {ascending:false}
        )
        .limit(10000);

      if(summaryGroupId){
        messagesQuery=
          messagesQuery.eq(
            "summary_group_id",
            summaryGroupId
          );
      }

      messagesQueryPromise=
        messagesQuery;
    }

    const [
      riskSnapshotResult,
      messagesResult,
      profileResult,
      pointContext,
      warehouseLimitResult,
      riskBudgetResult,
      settingsFreshResult,
      reviewOpenCount,
      unsends,
      batchFreshResult,
    ]=await Promise.all([
      riskSnapshotQuery,
      messagesQueryPromise,

      supabase
        .from("settlement_point_profiles")
        .select(
          "category,special_multiplier,max_special_codes"
        )
        .eq(
          "settlement_session_id",
          session.id
        )
        .order("category"),

      loadDashboardPointContext({
        supabase,
        settlementSessionId:session.id,
        summaryGroupId,
      }),

      supabase
        .from("warehouse_transfer_limits")
        .select(
          "destination,max_batch_quantity,enabled,updated_at"
        )
        .eq("enabled",true)
        .order("destination"),

      supabase
        .from("summary_group_risk_pool_settings")
        .select(
          "summary_group_id,risk_pool,point_loss_tolerance,updated_at"
        )
        .order("summary_group_id")
        .order("risk_pool"),

      supabase
        .from("settings_change_events")
        .select("changed_at")
        .order(
          "changed_at",
          {ascending:false}
        )
        .limit(1),

      fetchOpenReviewCount(
        messageRoundIds,
        summaryGroupId,
        session.id
      ),

      fetchUnsends(
        messageRoundIds,
        summaryGroupId
      ),

      supabase
        .from("settlement_transfer_batches")
        .select("confirmed_at")
        .eq(
          "settlement_session_id",
          session.id
        )
        .order(
          "confirmed_at",
          {ascending:false}
        )
        .limit(1),
    ]);

    for(
      const result of [
        riskSnapshotResult,
        messagesResult,
        profileResult,
        warehouseLimitResult,
        riskBudgetResult,
        settingsFreshResult,
        batchFreshResult,
      ]
    ){
      if(result.error)throw result.error;
    }

    const finalRoundContext=
      await loadDashboardRoundContext({
        supabase,
        settlementSessionId:session.id,
        summaryGroupId,
      });

    if(
      !sameDashboardRoundScope(
        roundContext,
        finalRoundContext
      )
    ){
      throw new Error(
        "DASHBOARD_ROUND_CONTEXT_CHANGED"
      );
    }

    const riskSnapshot=riskSnapshotResult.data;
    const riskSnapshotKeys=[
      "risk_codes",
      "category_risk",
      "overall_risk",
      "risk_pools",
      "line_group_risk",
      "line_group_risk_codes",
    ];

    if(
      !riskSnapshot
      || typeof riskSnapshot!=="object"
      || Array.isArray(riskSnapshot)
      || riskSnapshotKeys.some(
        key=>!Array.isArray(riskSnapshot[key])
      )
    ){
      throw new Error(
        "DASHBOARD_RISK_SNAPSHOT_INVALID"
      );
    }

    const riskCodes=[...riskSnapshot.risk_codes].sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category)||Number(b.order_total)-Number(a.order_total)||a.code.localeCompare(b.code));
    const categoryRisk=[...riskSnapshot.category_risk].sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.category.localeCompare(b.category));
    const overallRisk=[...riskSnapshot.overall_risk].sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id));
    const riskPools=[...riskSnapshot.risk_pools].sort((a,b)=>a.summary_group_id.localeCompare(b.summary_group_id)||a.risk_pool.localeCompare(b.risk_pool));

    const lineGroupRisk=[...riskSnapshot.line_group_risk].sort(
      (a,b)=>
        a.summary_group_id.localeCompare(b.summary_group_id)
        || String(a.line_group_name||a.line_group_id)
          .localeCompare(String(b.line_group_name||b.line_group_id))
    );

    const lineGroupRiskCodes=[...riskSnapshot.line_group_risk_codes].sort(
      (a,b)=>
        a.summary_group_id.localeCompare(b.summary_group_id)
        || a.line_group_id.localeCompare(b.line_group_id)
        || a.category.localeCompare(b.category)
        || Number(b.order_total)-Number(a.order_total)
        || a.code.localeCompare(b.code)
    );

    const lineGroupDistributionPlans=lineGroupRisk.flatMap((risk)=>
      ["MAIN","H","L"].map((riskPool)=>{
        const allowed=
          RISK_POOL_CATEGORIES[riskPool]
          || new Set();

        const rows=lineGroupRiskCodes.filter(
          (row)=>
            row.line_group_id===risk.line_group_id
            && allowed.has(row.category)
        );

        const hasIntegrityError=
          risk.risk_status==="DATA_INTEGRITY_ERROR"
          || Number(risk.over_cut_code_count||0)>0
          || rows.some(
            (row)=>
              row.retention_status==="DATA_INTEGRITY_ERROR"
              || row.confirmed_cut_exceeds_order_total===true
          );

        const unconfigured=rows.some(
          (row)=>
            Number(row.order_total||0)>0
            && (
              row.retention_status==="UNCONFIGURED"
              || Number(row.effective_multiplier||0)<=0
            )
        );

        const bandReady=
          risk.calculation_status==="READY";

        const calculationReady=
          bandReady
          && risk.risk_calculation_ready!==false
          && !hasIntegrityError
          && !unconfigured;

        let calculationStatus="READY";

        if(hasIntegrityError){
          calculationStatus="DATA_INTEGRITY_ERROR";
        }else if(unconfigured){
          calculationStatus="UNCONFIGURED";
        }else if(!bandReady){
          calculationStatus=
            risk.calculation_status
            || "NOT_READY";
        }else if(risk.risk_calculation_ready===false){
          calculationStatus="NOT_READY";
        }

        const recommendations=calculationReady
          ? rows
              .filter(
                (row)=>
                  row.retention_status==="CUT_REQUIRED"
                  && Number(row.recommended_cut||0)>0
              )
              .map((row)=>({
                line_group_id:risk.line_group_id,
                category:row.category,
                code:row.code,

                recommended_transfer:
                  Number(row.recommended_cut||0),

                retained_quantity:
                  Number(row.retained_quantity||0),

                retention_limit:
                  Number(row.retention_limit||0),

                effective_multiplier:
                  Number(row.effective_multiplier||0),

                recommended_point_reduction:
                  Number(row.recommended_point_reduction||0),
              }))
          : [];

        return {
          line_group_id:
            risk.line_group_id,

          line_group_name:
            risk.line_group_name,

          summary_group_id:
            risk.summary_group_id,

          risk_pool:
            riskPool,

          risk_model:
            risk.risk_model,

          gross_received:
            Number(risk.gross_received||0),

          calculation_band:
            Number(risk.calculation_band||0),

          reduction_pct:
            Number(risk.reduction_pct||0),

          risk_budget:
            Number(risk.risk_budget||0),

          confirmed_cut_total:
            Number(risk.confirmed_cut_total||0),

          retained_total:
            Number(risk.retained_total||0),

          amount_to_next_band:
            Number(risk.amount_to_next_band||0),

          risk_calculation_ready:
            calculationReady,

          risk_status:
            risk.risk_status,

          calculation_status:
            calculationStatus,

          transfer_required_total:
            hasIntegrityError
              ? null
              : recommendations.reduce(
                  (total,row)=>
                    total
                    + Number(
                      row.recommended_transfer||0
                    ),
                  0
                ),

          recommendations,
        };
      })
    );
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

      if(
        pool.actual_codes_ready===false
        && Number(pool.gross_received||0)>0
      ){
        return {
          summary_group_id:pool.summary_group_id,
          risk_pool:pool.risk_pool,
          adjusted_received:Number(pool.adjusted_received||0),
          point_loss_tolerance:Number(pool.point_loss_tolerance||0),
          risk_budget:Number(pool.risk_budget||0),
          point_reserve_before:Number(pool.risk_point_total||0),
          point_reserve_after_plan:null,
          excess_point_risk_before:Number(pool.excess_point_risk||0),
          excess_point_risk_after_plan:null,
          transfer_required_total:null,
          recommendations:[],
          multiplier_configured:pool.multiplier_configured!==false,
          calculation_status:"NOT_READY",
          calculation_error:"ACTUAL_POINT_CODES_INCOMPLETE",
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
    const promotions=pointContext.promotions;
    const actual=pointContext.actual;
    const warehouseLimits=warehouseLimitResult.data??[];
    const riskBudgets=riskBudgetResult.data??[];

    const freshness=
      buildDashboardFreshness({
        sessionId:session.id,
        messageAt:
          messages[0]?.event_timestamp??null,
        transferAt:
          batchFreshResult.data?.[0]
            ?.confirmed_at??null,
        settingsAt:
          settingsFreshResult.data?.[0]
            ?.changed_at??null,
        rounds:pointContext.rounds,
        actualCodes:actual,
        promotions,
        warehouseLimits,
        riskBudgets,
      });

    const mainPlans=distributionPlans.filter((plan)=>plan.risk_pool==="MAIN");

    const relevantDistributionPlans=summaryGroupId
      ? distributionPlans.filter(
          (plan)=>plan.summary_group_id===summaryGroupId
        )
      : distributionPlans;

    const distributionIncomplete=
      relevantDistributionPlans.some(
        (plan)=>plan.calculation_status==="LIMIT"
      );

    const distributionPointPending=
      relevantDistributionPlans.some(
        (plan)=>plan.calculation_status==="NOT_READY"
      );

    const metricOverall = summaryGroupId
      ? {
          ...overallRisk[0],
          transfer_required_total:(distributionIncomplete||distributionPointPending)
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
          transfer_required_total:(distributionIncomplete||distributionPointPending)
            ? null
            : sum(mainPlans,"transfer_required_total"),
          risk_pct:sum(overallRisk,"adjusted_received")>0
            ? Math.round(sum(overallRisk,"risk_point_total")/sum(overallRisk,"adjusted_received")*10000)/100
            : 0,
        };

    return json({
      ok:true,settlement_session:session,business_date:roundContext.businessDate,business_dates:roundContext.businessDates,current_rounds:roundContext.rounds,selected_summary_group:summaryGroupId??"ALL",generated_at:new Date().toISOString(),freshness,summary_groups:summaryGroups,line_groups:lineGroups,
      metrics:{messages_total:messages.length,parsed:messages.filter(m=>m.parse_status==="PARSED").length,pending:messages.filter(m=>m.parse_status==="PENDING").length,review_open:Number(reviewOpenCount||0),gross_received:Number(metricOverall?.gross_received||0),adjusted_received:Number(metricOverall?.adjusted_received||0),point_reserve_total:Number(metricOverall?.point_reserve_total||0),risk_point_total:Number(metricOverall?.risk_point_total||0),safety_margin:Number(metricOverall?.safety_margin||0),point_loss_tolerance:Number(metricOverall?.point_loss_tolerance||0),risk_budget:Number(metricOverall?.risk_budget||0),excess_point_risk:Number(metricOverall?.excess_point_risk||0),transfer_required_total:metricOverall?.transfer_required_total==null?null:Number(metricOverall.transfer_required_total||0),distribution_incomplete:distributionIncomplete,distribution_point_pending:distributionPointPending,confirmed_cut_total:Number(metricOverall?.confirmed_cut_total||0),risk_pct:Number(metricOverall?.risk_pct||0),last_event_at:messages[0]?.event_timestamp??roundContext.rounds[0]?.opened_at??session.opened_at},
      risk_codes:riskCodes,category_risk:categoryRisk,overall_risk:overallRisk,risk_pools:riskPools,distribution_plans:distributionPlans,line_group_risk:lineGroupRisk,line_group_risk_codes:lineGroupRiskCodes,line_group_distribution_plans:lineGroupDistributionPlans,point_profiles:profiles,point_promotions:promotions,warehouse_limits:warehouseLimits,actual_special_codes:actual,
    });
  } catch(error){console.error("dashboard failed",error);return json({ok:false,error:error?.message??String(error)},500);}
};
export const config={path:"/api/dashboard",region:"sin"};
