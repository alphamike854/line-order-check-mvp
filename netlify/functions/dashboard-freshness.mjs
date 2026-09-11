import {
  fetchOpenSettlementSession,
  json,
  normalizeSummaryGroup,
  requireDashboardAccess,
  supabase,
} from "../../src/lib/dashboard-api.mjs";

import {
  buildDashboardFreshness,
  loadDashboardPointContext,
} from "../../src/lib/dashboard-point-context.mjs";


export default async(req)=>{
  if(req.method!=="GET"){
    return json({
      ok:false,
      error:"METHOD_NOT_ALLOWED",
    },405);
  }

  const denied=requireDashboardAccess(req);
  if(denied)return denied;

  try{
    const session=
      await fetchOpenSettlementSession();

    if(!session){
      return json({
        ok:true,
        settlement_session:null,
        freshness:{
          version:"NO_OPEN_SETTLEMENT",
        },
      });
    }

    const url=new URL(req.url);

    const summaryGroupId=
      normalizeSummaryGroup(
        url.searchParams.get("group")
      );

    let messageQuery=supabase
      .from("messages")
      .select("event_timestamp")
      .eq(
        "settlement_session_id",
        session.id
      )
      .order(
        "event_timestamp",
        {ascending:false}
      )
      .limit(1);

    if(summaryGroupId){
      messageQuery=
        messageQuery.eq(
          "summary_group_id",
          summaryGroupId
        );
    }

    const [
      msgResult,
      batchResult,
      pointContext,
      warehouseLimitResult,
      riskBudgetResult,
      settingsResult,
    ]=await Promise.all([
      messageQuery,

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
    ]);

    for(
      const result of [
        msgResult,
        batchResult,
        warehouseLimitResult,
        riskBudgetResult,
        settingsResult,
      ]
    ){
      if(result.error)throw result.error;
    }

    const freshness=
      buildDashboardFreshness({
        sessionId:session.id,
        messageAt:
          msgResult.data?.[0]
            ?.event_timestamp??null,
        transferAt:
          batchResult.data?.[0]
            ?.confirmed_at??null,
        settingsAt:
          settingsResult.data?.[0]
            ?.changed_at??null,
        rounds:pointContext.rounds,
        actualCodes:pointContext.actual,
        promotions:
          pointContext.promotions,
        warehouseLimits:
          warehouseLimitResult.data??[],
        riskBudgets:
          riskBudgetResult.data??[],
      });

    return json({
      ok:true,
      settlement_session:session,
      freshness,
    });
  }catch(error){
    console.error(
      "dashboard-freshness failed",
      error,
    );

    return json({
      ok:false,
      error:error?.message??String(error),
    },500);
  }
};

export const config={
  path:"/api/dashboard-freshness",
};
